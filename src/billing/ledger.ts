// The append-only credit ledger (migration 005, ADR 006 seam 2 / ADR 020).
// Balance = SUM(delta); there is no mutable balance column and no UPDATE/
// DELETE path — credit_transactions' own BEFORE UPDATE OR DELETE trigger
// makes that structural, not just a convention this module happens to follow.
//
// Idempotency throughout uses `ON CONFLICT ... DO NOTHING RETURNING id` and a
// branch on the empty-vs-one-row result — never a caught thrown
// unique-violation. A Postgres statement error aborts the enclosing
// transaction even if the JS exception is caught; ON CONFLICT never throws,
// so it is safe to call from inside or outside a transaction alike.
import { createHash } from 'node:crypto';
import type { Db } from '../db/types.ts';
import type { ActionClass, LedgerReason } from './types.ts';
import { compensateBucket, debitBucket, getBucketBalance } from './pro-bucket.ts';

/** Derives a distinct, deterministic UUID from a base requestId + a
 * disambiguating suffix — used by reserveWebSearchDebit/reserveDatasetDebit
 * below to give their bucket-eligible add-on debit its own identity, distinct
 * from the question debit's own requestId that rides alongside it (see their
 * doc comments for why that distinctness matters).
 *
 * **Deviation from the plan/brief's literal sample** (a plain
 * `` `${requestId}:websearch` `` colon-joined string): `credit_transactions.
 * request_id` (migration 005) AND `pro_bucket_ledger.request_id` (migration
 * 030) are BOTH declared Postgres `uuid`, which rejects any value that is not
 * syntactically a UUID — the brief's plain string fails at the database with
 * `invalid input syntax for type uuid`, confirmed by actually running it
 * against the real migrated schema (this task's own Step 2 "run to verify
 * they fail" surfaced it as a hard DB error, not a normal red assertion).
 * This derives a SHA-256 hash of `requestId:suffix`, formatted into standard
 * UUID syntax — deterministic (the SAME requestId + suffix always derives
 * the SAME id, so a genuine retry of the add-on call, which reuses the same
 * base requestId, stays idempotent) and, by the hash's own collision
 * resistance, never collides with the base requestId itself or with a
 * different suffix's derived id. Not RFC 4122 version/variant-compliant (no
 * version nibble is forced into the hash) — Postgres's `uuid` type does not
 * check either, only the 8-4-4-4-12 hex shape, so that is not needed for
 * correctness here. Reuses this codebase's existing
 * `createHash('sha256')...digest('hex')` idiom (src/answer/llm/client.ts,
 * src/answer/audit/write.ts) rather than introducing a UUID library. */
function deriveAddonRequestId(requestId: string, suffix: string): string {
  const hex = createHash('sha256').update(`${requestId}:${suffix}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function getBalance(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query(
    'select coalesce(sum(delta), 0) as balance from credit_transactions where user_id = $1',
    [userId],
  );
  return Number(rows[0]!.balance);
}

/** null if the user has no active Pro subscription row, or it has lapsed
 * (current_period_end in the past) — the SAME condition src/billing/pro.ts's
 * hasProPlan checks for the subscription-row half of its OR (Task 4/7 wires
 * hasProPlan itself; this is the lower-level DB read splitDebit needs). */
export async function getCurrentGrantId(db: Db, userId: string): Promise<string | null> {
  const { rows } = await db.query(
    `select current_period_grant_id from pro_subscriptions
     where user_id = $1 and status in ('active', 'trialing', 'past_due') and current_period_end > now()`,
    [userId],
  );
  const row = rows[0];
  return row === undefined ? null : String(row.current_period_grant_id);
}

export async function getSpendableBalance(db: Db, userId: string, grantId: string | null): Promise<number> {
  const permanent = await getBalance(db, userId);
  const bucket = grantId === null ? 0 : await getBucketBalance(db, userId, grantId);
  return permanent + bucket;
}

/** Reads the current price from action_class_prices (migration 006) — never
 * inline in code, per ADR 006's "prices must be easy to change". Throws if
 * pricing-apply.ts has never been run against this database; that is a real
 * operational precondition (mirrors src/registry/apply.ts's equivalent
 * all-or-nothing gate), not a scenario to silently paper over with a
 * hardcoded fallback. */
export async function getActionClassPrice(db: Db, actionClass: ActionClass): Promise<number> {
  const { rows } = await db.query('select credits from action_class_prices where action_class = $1', [
    actionClass,
  ]);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`no action_class_prices row for '${actionClass}' — run \`npm run pricing:apply\` first`);
  }
  return Number(row.credits);
}

export interface LedgerEntry {
  id: number;
}

type DebitFn = (db: Db, userId: string, requestId: string, credits: number) => Promise<LedgerEntry | null>;

/** The subset of LedgerReason a DebitFn can write: the four negative-delta,
 * request_id-scoped reasons, each with its own
 * `(user_id, request_id)`-partial unique index (migrations 005/012/018/027).
 * Derived from LedgerReason with Extract so renaming a reason there breaks
 * here loudly instead of silently drifting. */
type DebitReason = Extract<
  LedgerReason,
  'question_cost' | 'onboarding_cost' | 'websearch_cost' | 'dataset_cost'
>;

/** A debit primitive bound to the `reason` it writes — ONE value, passed as
 * one argument, so the reason splitDebit's cross-ledger idempotency check
 * looks for and the reason the INSERT actually writes cannot drift apart.
 *
 * They used to be two independent string literals that merely happened to
 * match (review finding F2): reserveDebit passed `'question_cost'` to
 * splitDebit while debitQuestion separately wrote `'question_cost'` into its
 * own SQL. A future edit changing one and not the other would have silently
 * reopened the cross-ledger double-charge this module's guard exists to
 * close — invisible to every existing test, because the check would simply
 * look in the wrong per-reason index and find nothing. Each descriptor below
 * takes its `reason` from the very constant its `write` function interpolates
 * into both halves of its own statement, so there is exactly one source. */
export interface LedgerDebit {
  readonly reason: DebitReason;
  readonly write: DebitFn;
}

// One constant per debit reason, interpolated into BOTH halves of its own
// INSERT (the `values` list and the `on conflict ... where` predicate) and
// handed to the LedgerDebit descriptor beneath the function. Interpolation
// rather than a bind parameter is deliberate and safe: each value is a
// compile-time constant of a closed string-literal union, never runtime or
// user-supplied data, and Postgres CANNOT take a parameter in an ON CONFLICT
// arbiter predicate — it has to prove the partial unique index's predicate at
// plan time, which `reason = $n` does not let it do.
const QUESTION_COST = 'question_cost' satisfies DebitReason;
const ONBOARDING_COST = 'onboarding_cost' satisfies DebitReason;
const WEBSEARCH_COST = 'websearch_cost' satisfies DebitReason;
const DATASET_COST = 'dataset_cost' satisfies DebitReason;

/** Idempotent debit: a repeated (userId, requestId) is a no-op (returns
 * null), never a second charge. src/billing/gate.ts relies on this to detect
 * a client retry (double submit, network retry) BEFORE ever re-running the
 * answer pipeline a second time.
 *
 * Does NOT check balance itself — see reserveDebit() below for the
 * balance-checked, race-free entry point src/billing/gate.ts actually calls.
 * This bare primitive stays exported for its own direct tests. */
export async function debitQuestion(
  db: Db,
  userId: string,
  requestId: string,
  credits: number,
): Promise<LedgerEntry | null> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, note)
     values ($1, $2, '${QUESTION_COST}', $3, 'question debit')
     on conflict (user_id, request_id) where reason = '${QUESTION_COST}' do nothing
     returning id`,
    [userId, -credits, requestId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

/** debitQuestion bound to the reason it writes — what reserveDebit hands to
 * splitDebit. See LedgerDebit above for why this is one value and not two
 * arguments. */
export const QUESTION_DEBIT: LedgerDebit = { reason: QUESTION_COST, write: debitQuestion };

export type ReserveDebitResult =
  | { kind: 'debited'; split: SplitDebitResult }
  | { kind: 'insufficient'; balance: number }
  | { kind: 'duplicate' };

/** The balance-checked, race-free entry point (adversarial-review finding,
 * WP13): getBalance + debitQuestion used to be two independent statements,
 * so two concurrent requests with DIFFERENT requestIds from a user at
 * exactly `required` credits could both read the same pre-debit balance and
 * both pass the check before either debit committed — contradicting ADR
 * 020's own claim that the debit is "checked and reserved atomically per
 * request." Fixed with a per-user Postgres advisory transaction lock
 * (pg_advisory_xact_lock, keyed on a hash of userId): concurrent calls for
 * the SAME user serialize on this fast check-and-debit; different users
 * never contend. Deliberately does NOT wrap the caller's subsequent pipeline
 * call (src/billing/gate.ts's `run()`) — holding a transaction (and a
 * pooled connection) open across a multi-second LLM call would risk
 * exhausting the connection pool under real concurrent traffic.
 *
 * Pro bucket integration (Task 4, open-questions #205): the balance check
 * and the debit itself now both go through the Pro monthly-allowance
 * bucket, spent first, via getSpendableBalance/splitDebit — both called
 * from inside this same advisory-locked transaction, so the check-and-debit
 * stays atomic across bucket AND ledger together, not just the ledger. For
 * a non-Pro user (getCurrentGrantId returns null — no active subscription
 * row, or a lapsed one) this collapses to exactly today's behavior: zero
 * bucket balance, so splitDebit's fromBucket is always 0 and it makes
 * exactly one debitQuestion call for the full amount, byte-identical to the
 * pre-Task-4 debitQuestion(tx, userId, requestId, required) call this
 * replaces.
 *
 * Duplicate detection: previously a single `entry === null` check on
 * debitQuestion's own idempotent `on conflict`. splitDebit can now write up
 * to two rows (bucket + ledger) sharing one requestId, in two DIFFERENT
 * tables — and each table's `on conflict` only ever catches a retry that
 * lands on the same table as the original attempt.
 *
 * An earlier version of this comment claimed a retry landing on the other
 * leg "cannot happen". That was wrong, and was reproduced against a real
 * migrated database (review finding, 2026-09-14): the first attempt finds an
 * empty bucket and debits credit_transactions; a Stripe invoice.paid webhook
 * funds the bucket; the SAME requestId is retried, now has bucket balance,
 * and its pro_bucket_ledger insert conflicts with nothing — two real charges
 * for one logical request, and (via gate.ts) the answer pipeline rerun a
 * second time. That is one of several shapes — the mirror direction and the
 * partial-overlap case are enumerated on hasCommittedDebit below, and none of
 * them needs the subscription to have lapsed; a drained bucket on an active
 * subscription is enough. splitDebit therefore now checks BOTH ledgers for an
 * already-committed debit on this (userId, requestId) BEFORE it decides
 * which leg to write, and returns the same both-entries-null result an
 * ordinary same-table retry produces — so
 * `bucketEntry === null && ledgerEntry === null` remains the single "this
 * exact request was already fully processed" signal, now covering the
 * cross-ledger case too. */
export async function reserveDebit(
  db: Db,
  userId: string,
  requestId: string,
  required: number,
): Promise<ReserveDebitResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [userId]);
    const grantId = await getCurrentGrantId(tx, userId);
    const balance = await getSpendableBalance(tx, userId, grantId);
    if (balance < required) {
      return { kind: 'insufficient', balance };
    }
    const split = await splitDebit(tx, userId, requestId, required, QUESTION_DEBIT, 'question debit', grantId);
    if (split.bucketEntry === null && split.ledgerEntry === null) {
      return { kind: 'duplicate' };
    }
    return { kind: 'debited', split };
  });
}

/** Idempotent onboarding debit: a repeated (userId, requestId) is a no-op
 * (returns null), mirroring debitQuestion's contract for the new
 * 'onboarding_cost' reason (migration 012, WP16 sub-part 2). Kept as its own
 * function rather than parameterizing debitQuestion's reason: debitQuestion is
 * a hot path called on every question, and this design deliberately does not
 * touch it (design §2's "do NOT parameterize the existing hot reserveDebit"
 * applies equally to its debit primitive).
 *
 * Exported (WP16 sub-part 2 CORE-1) because the onboarding TRIGGER must do the
 * debit AND the pending-row insert in ONE transaction (design §0.3), and this
 * project's withTransaction cannot nest — so triggerOnboarding composes the
 * advisory-lock + getBalance + this debit primitive itself inside its single
 * tx, instead of calling reserveOnboardingDebit (which opens its own tx). The
 * standalone reserveOnboardingDebit stays for direct/tested single-use. */
export async function debitOnboarding(
  db: Db,
  userId: string,
  requestId: string,
  credits: number,
): Promise<LedgerEntry | null> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, note)
     values ($1, $2, '${ONBOARDING_COST}', $3, 'on-demand CBS table onboarding debit')
     on conflict (user_id, request_id) where reason = '${ONBOARDING_COST}' do nothing
     returning id`,
    [userId, -credits, requestId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

/** debitOnboarding bound to its reason, ready for Task 6's splitDebit wiring (see
 * LedgerDebit). Not consumed yet: its own reserve* function still calls the
 * primitive directly, unchanged. */
export const ONBOARDING_DEBIT: LedgerDebit = { reason: ONBOARDING_COST, write: debitOnboarding };

export type ReserveOnboardingDebitResult =
  | { kind: 'debited'; entry: LedgerEntry }
  | { kind: 'insufficient'; balance: number }
  | { kind: 'duplicate' };

/** The onboarding sibling of reserveDebit (design §2, CORE-1's
 * triggerOnboarding calls this): same per-user advisory-lock
 * check-and-debit pattern, applied to the 100-credit 'onboarding_cost' reason
 * instead of 'question_cost'. Kept as a separate function rather than a
 * parameterized reserveDebit for the same reason debitOnboarding is separate
 * from debitQuestion above — reserveDebit is the hot path, untouched by this
 * design. Deliberately excluded from the Pro-bucket spend-first mechanic
 * (open-questions #205) — see docs/superpowers/plans/2026-09-13-pro-subscription-tier.md
 * Task 5: onboarding's 100-credit cost and its own refund path
 * (pending_table_requests.debit_transaction_id, not-null) made bucket-eligibility real
 * schema growth for a rare, heavy, one-off action; it always spends permanent credits. */
export async function reserveOnboardingDebit(
  db: Db,
  userId: string,
  requestId: string,
  required: number,
): Promise<ReserveOnboardingDebitResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [userId]);
    const balance = await getBalance(tx, userId);
    if (balance < required) {
      return { kind: 'insufficient', balance };
    }
    const entry = await debitOnboarding(tx, userId, requestId, required);
    return entry === null ? { kind: 'duplicate' } : { kind: 'debited', entry };
  });
}

/** Idempotent web-search add-on debit: a repeated (userId, requestId) is a
 * no-op (returns null), mirroring debitOnboarding's contract for the new
 * 'websearch_cost' reason (migration 018, WP129+130 / ADR 032). Kept as its
 * own function rather than parameterizing debitQuestion's reason for the same
 * reason debitOnboarding is separate: debitQuestion is the hot path, untouched
 * by this design. Reserved lazily by web/app/actions.ts right before the web
 * API call (debit-before-spend); refunded via compensate() UNCHANGED (keyed on
 * this debit's own id, so the base question refund and the web add-on refund
 * coexist for one turn — each reverses a distinct debit row). */
export async function debitWebSearch(
  db: Db,
  userId: string,
  requestId: string,
  credits: number,
): Promise<LedgerEntry | null> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, note)
     values ($1, $2, '${WEBSEARCH_COST}', $3, 'web search add-on debit')
     on conflict (user_id, request_id) where reason = '${WEBSEARCH_COST}' do nothing
     returning id`,
    [userId, -credits, requestId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

/** debitWebSearch bound to its reason, ready for Task 6's splitDebit wiring (see
 * LedgerDebit). Not consumed yet: its own reserve* function still calls the
 * primitive directly, unchanged. */
export const WEBSEARCH_DEBIT: LedgerDebit = { reason: WEBSEARCH_COST, write: debitWebSearch };

export type ReserveWebSearchDebitResult =
  | { kind: 'debited'; split: SplitDebitResult }
  | { kind: 'insufficient'; balance: number }
  | { kind: 'duplicate' };

/** The web-search sibling of reserveDebit (WP129+130 / ADR 032): same per-user
 * advisory-lock check-and-debit pattern, applied to the 10-credit
 * 'websearch_cost' reason instead of 'question_cost'. web/app/actions.ts's web
 * billing closure calls this INSIDE the pipeline (after the base gate already
 * held the 20-credit question debit), so a web-opted turn transiently needs a
 * balance of 30 in both modes — see ADR 032's worked-out pricing table. Kept a
 * separate function rather than a parameterized reserveDebit for the same
 * reason debitWebSearch is separate from debitQuestion above — reserveDebit is
 * the hot path, untouched by this design.
 *
 * Pro bucket integration (Task 6, open-questions #205): same
 * getSpendableBalance/splitDebit wiring as reserveDebit (Task 4) — bucket
 * spent first, remainder from the ledger via the unchanged debitWebSearch
 * primitive. For a non-Pro user this collapses to exactly the pre-Task-6
 * single debitWebSearch call for the full amount.
 *
 * **requestId disambiguation (the Task 6 landmine, progress.md / Task 4 fix
 * round 2) — BUCKET SIDE ONLY:** `pro_bucket_ledger_one_debit_per_request`
 * (migration 030) is `(user_id, request_id) where reason = 'debit'` with NO
 * action-type scope. The question debit (reserveDebit) and this add-on debit
 * are called with the SAME base requestId (ADR 032's own contract — every
 * caller of reserveWebSearchDebit keeps passing that shared id, unchanged).
 * If both resolved to a bucket debit under that literal requestId, the
 * add-on's pro_bucket_ledger insert would conflict with the question's and
 * silently no-op — and since Task 4's cross-ledger guard (hasCommittedDebit),
 * an empty bucket at add-on time short-circuits the WHOLE add-on debit,
 * ledger leg included, not just its bucket half. So splitDebit's
 * `bucketRequestId` here is `deriveAddonRequestId(requestId, 'websearch')` —
 * a deterministic UUID derived once, internally — while the PLAIN `requestId`
 * still goes through unchanged as splitDebit's own `requestId` (the
 * `credit_transactions`/ledger-leg id). That split matters: this function's
 * own doc comment on `splitDebit` explains why the ledger leg CANNOT be
 * disambiguated the same way — src/billing/history.ts and
 * src/threads/index.ts join a `websearch_cost` row back to its question by an
 * EXACT `request_id` match to net the turn's displayed cost, so changing the
 * ledger-leg id would silently break the dashboard/thread-replay cost total
 * for a partially-or-fully-ledger-funded add-on. (A plain colon-joined string
 * — the plan/brief's literal sample — was tried first and rejected for a
 * simpler reason: both `request_id` columns are Postgres `uuid`, which
 * rejects a non-UUID string outright.) No caller outside this function ever
 * needs to know about any of this: the audit trail, the question's own
 * reserveDebit call, and every existing call site in web/app/actions.ts keep
 * passing the same requestId they always have. */
export async function reserveWebSearchDebit(
  db: Db,
  userId: string,
  requestId: string,
  required: number,
): Promise<ReserveWebSearchDebitResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [userId]);
    const grantId = await getCurrentGrantId(tx, userId);
    const balance = await getSpendableBalance(tx, userId, grantId);
    if (balance < required) {
      return { kind: 'insufficient', balance };
    }
    const bucketRequestId = deriveAddonRequestId(requestId, 'websearch');
    const split = await splitDebit(
      tx,
      userId,
      requestId,
      required,
      WEBSEARCH_DEBIT,
      'websearch debit',
      grantId,
      bucketRequestId,
    );
    if (split.bucketEntry === null && split.ledgerEntry === null) {
      return { kind: 'duplicate' };
    }
    return { kind: 'debited', split };
  });
}

/** Idempotent dataset-chat-turn debit: a repeated (userId, requestId) is a
 * no-op (returns null), mirroring debitWebSearch's contract for the new
 * 'dataset_cost' reason (migration 027, WP202a / ADR 037). Kept as its own
 * function for the same reason debitWebSearch is separate from
 * debitQuestion above — reserveDebit is the hot path, untouched by this
 * design. Reserved by askDataset right before the instruct LLM call
 * (debit-before-spend); refunded via compensate() with `auditAnswerId:
 * null` always (dataset turns live in dataset_turns, never audit_answers —
 * see LedgerReason's dataset_cost doc comment). CSV/TSV ingest itself is
 * free and never calls this at all (ADR 037 D12). */
export async function debitDataset(
  db: Db,
  userId: string,
  requestId: string,
  credits: number,
): Promise<LedgerEntry | null> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, note)
     values ($1, $2, '${DATASET_COST}', $3, 'dataset-chat turn debit')
     on conflict (user_id, request_id) where reason = '${DATASET_COST}' do nothing
     returning id`,
    [userId, -credits, requestId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

/** debitDataset bound to its reason, ready for Task 6's splitDebit wiring (see
 * LedgerDebit). Not consumed yet: its own reserve* function still calls the
 * primitive directly, unchanged. */
export const DATASET_DEBIT: LedgerDebit = { reason: DATASET_COST, write: debitDataset };

export type ReserveDatasetDebitResult =
  | { kind: 'debited'; split: SplitDebitResult }
  | { kind: 'insufficient'; balance: number }
  | { kind: 'duplicate' };

/** The dataset-chat sibling of reserveDebit (WP202a / ADR 037): same
 * per-user advisory-lock check-and-debit pattern, applied to the
 * 'dataset_cost' reason instead of 'question_cost'.
 *
 * Pro bucket integration + requestId disambiguation (Task 6, open-questions
 * #205): same wiring and same landmine as reserveWebSearchDebit above — see
 * its doc comment for the full explanation, including why the disambiguation
 * is BUCKET-SIDE ONLY (`splitDebit`'s `bucketRequestId`), never the ledger
 * leg. The bucket id passed here is `deriveAddonRequestId(requestId,
 * 'dataset')`, derived internally so dataset-gate.ts's caller keeps passing
 * the same requestId it always has, and the plain `requestId` still goes
 * through unchanged as the `credit_transactions`/ledger-leg id. */
export async function reserveDatasetDebit(
  db: Db,
  userId: string,
  requestId: string,
  required: number,
): Promise<ReserveDatasetDebitResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [userId]);
    const grantId = await getCurrentGrantId(tx, userId);
    const balance = await getSpendableBalance(tx, userId, grantId);
    if (balance < required) {
      return { kind: 'insufficient', balance };
    }
    const bucketRequestId = deriveAddonRequestId(requestId, 'dataset');
    const split = await splitDebit(
      tx,
      userId,
      requestId,
      required,
      DATASET_DEBIT,
      'dataset debit',
      grantId,
      bucketRequestId,
    );
    if (split.bucketEntry === null && split.ledgerEntry === null) {
      return { kind: 'duplicate' };
    }
    return { kind: 'debited', split };
  });
}

/** Idempotent compensation: a repeated call for the same debitId is a no-op —
 * a structural backstop (gate.ts's own request_id dedup on the debit is the
 * primary defense against re-entry; this protects against the gate itself
 * ever calling compensate twice for one debit). */
export async function compensate(
  db: Db,
  userId: string,
  debitId: number,
  credits: number,
  auditAnswerId: number | null,
): Promise<LedgerEntry | null> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, related_transaction_id, audit_answer_id, note)
     values ($1, $2, 'compensation', $3, $4, 'refund: no answer produced')
     on conflict (related_transaction_id) where reason = 'compensation' do nothing
     returning id`,
    [userId, credits, debitId, auditAnswerId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

export interface SplitDebitResult {
  fromBucket: number;
  fromLedger: number;
  bucketEntry: { id: number } | null;
  ledgerEntry: LedgerEntry | null;
}

/** Cross-ledger idempotency guard (review finding, 2026-09-14, #205): has
 * this exact (userId, requestId) ALREADY been debited, in EITHER ledger?
 *
 * Each table's own `on conflict ... do nothing` only catches a retry that
 * lands on the SAME table as the original attempt. A retry that lands
 * anywhere the original did not conflicts with nothing there and inserts a
 * second, real charge for one logical request.
 *
 * The trigger is simply that the bucket balance MOVED between the attempt
 * and its retry — in either direction, and for reasons that have nothing to
 * do with whether the subscription is still active:
 *   - ledger → bucket: the first attempt found an empty (or absent) bucket
 *     and debited credit_transactions; an invoice.paid webhook funded the
 *     bucket; the retry now covers the charge from the bucket.
 *   - bucket → ledger: the first attempt spent from the bucket, and by the
 *     retry the bucket no longer covers the charge. **Subscription status is
 *     irrelevant here.** A perfectly ACTIVE subscription whose bucket is
 *     merely drained by the user's other requests — grantId still non-null,
 *     getBucketBalance simply returns less than `credits` — hits this exactly
 *     as a lapsed subscription or a rotated grant (grantId null) does. The
 *     lapsed case is the easiest to picture, not the only one, and not even
 *     the likeliest: a busy Pro user empties the bucket every month.
 *   - and the partial case in between: an original ledger-only debit retried
 *     once the bucket covers PART of the charge writes a new bucket row for
 *     that part while its ledger half conflicts — a smaller overcharge, same
 *     root cause.
 *
 * So both halves of the check run unconditionally: when grantId is null,
 * when it is non-null with a full bucket, and when it is non-null with an
 * empty one. The caller's Pro state at retry time says nothing about where a
 * PREVIOUS attempt's money came from, and neither does the current bucket
 * balance.
 *
 * Each half asks exactly what that table's own unique index would have
 * caught, so this can never refuse an insert the index itself would have
 * allowed:
 *   - credit_transactions' per-reason partial unique indexes on
 *     (user_id, request_id) — migrations 005/012/018/027. Hence the `reason`
 *     scope: an add-on debit (e.g. websearch_cost) that deliberately rides
 *     alongside a question_cost debit on the SAME requestId is a distinct,
 *     legitimate charge, not a duplicate.
 *   - pro_bucket_ledger_one_debit_per_request (migration 030), which is
 *     `(user_id, request_id) where reason = 'debit'` with NO action-type
 *     scope. Consequence for a future caller: two different action types
 *     sharing one requestId cannot both spend from the bucket — the second
 *     reads as a duplicate here. That is the migration's existing behavior,
 *     not something added here (its `on conflict` already no-op'd the second
 *     insert); a caller that needs two bucket-eligible debits for one turn
 *     must derive a distinct requestId for the add-on.
 *
 * **Two ids, not one (Task 6, open-questions #205):** `requestId` and
 * `bucketRequestId` are the SAME value for every caller except
 * reserveWebSearchDebit/reserveDatasetDebit's add-on debits — see splitDebit's
 * own doc comment for why those two callers need a distinct bucket-side id
 * (src/billing/history.ts and src/threads/index.ts join
 * `credit_transactions` back to `audit_answers` by an EXACT `request_id`
 * match to net a turn's cost for the dashboard/thread-replay, so the LEDGER
 * side must keep the caller's original id; only `pro_bucket_ledger`'s
 * un-scoped unique index forces the bucket side to differ).
 *
 * Race safety: a SELECT followed by a conditional INSERT is only safe
 * because every caller runs splitDebit inside reserveDebit's existing
 * pg_advisory_xact_lock'd transaction (splitDebit's own contract, below).
 * Concurrent calls for the same user serialize on that lock, and READ
 * COMMITTED gives this statement a fresh snapshot that already includes
 * whatever the previous lock holder committed. The per-table `on conflict`
 * clauses stay in place underneath, unchanged, as the structural backstop —
 * this guard is the primary defense, not a replacement for them. */
async function hasCommittedDebit(
  tx: Db,
  userId: string,
  requestId: string,
  bucketRequestId: string,
  reason: DebitReason,
): Promise<boolean> {
  const { rows } = await tx.query(
    `select 1 as hit from credit_transactions
       where user_id = $1 and request_id = $2 and reason = $4
     union all
     select 1 as hit from pro_bucket_ledger
       where user_id = $1 and request_id = $3 and reason = 'debit'
     limit 1`,
    [userId, requestId, bucketRequestId, reason],
  );
  return rows.length > 0;
}

/** Splits one logical charge between the Pro bucket (spent first) and the
 * permanent ledger (the remainder). MUST be called inside the same
 * advisory-locked transaction as the caller's existing balance check
 * (reserveDebit's pattern) — never as a separate statement, or it
 * reintroduces the exact race pg_advisory_xact_lock exists to close, and
 * hasCommittedDebit's check-then-insert above loses its serialization.
 * `debit` is the LedgerDebit descriptor for this action type (QUESTION_DEBIT,
 * ONBOARDING_DEBIT, WEBSEARCH_DEBIT, DATASET_DEBIT) — one value carrying both
 * the existing, UNCHANGED debit primitive and the `reason` that primitive
 * writes, so the idempotency check below and the INSERT cannot look at
 * different reasons (see LedgerDebit). Its `write` is called with ONLY the
 * ledger portion, so a fully-bucket-funded charge writes zero
 * credit_transactions rows (the byte-identical-for-non-Pro guarantee: when
 * grantId is null or the bucket is empty, fromBucket is always 0 and this
 * collapses to exactly today's single debit call with the full amount).
 * `note` is the free-text label for the bucket row.
 *
 * `bucketRequestId` (Task 6, open-questions #205) — defaults to `requestId`,
 * so reserveDebit's own call site is completely unchanged and every
 * pre-Task-6 behavior (including this function's own signature for every
 * existing caller) is preserved byte-for-byte. Pass a DIFFERENT value only
 * when `requestId` itself cannot double as the bucket's own idempotency key —
 * today that is reserveWebSearchDebit/reserveDatasetDebit's add-on debits,
 * which are deliberately called with the SAME requestId as the question debit
 * they ride alongside (ADR 032's contract), and `pro_bucket_ledger`'s own
 * unique index (`pro_bucket_ledger_one_debit_per_request`, migration 030) is
 * `(user_id, request_id) where reason = 'debit'` with NO action-type scope —
 * so a shared requestId's bucket leg would read as a duplicate of the
 * question's own bucket debit (see hasCommittedDebit's doc comment).
 * `requestId` itself is UNCHANGED and still goes to `debit.write` (the
 * `credit_transactions` leg) — that table's per-reason unique index already
 * disambiguates by `reason`, AND src/billing/history.ts /
 * src/threads/index.ts's dashboard/thread-replay cost-netting queries match
 * a `websearch_cost` row back to its question by an EXACT `request_id` join,
 * so the ledger leg must keep the caller's real requestId no matter what the
 * bucket leg uses.
 *
 * A request that was already debited (in either ledger, by any earlier
 * attempt) returns {fromBucket: 0, fromLedger: 0, bucketEntry: null,
 * ledgerEntry: null} — the same both-entries-null shape a same-table `on
 * conflict` retry has always produced, which reserveDebit reads as
 * `kind: 'duplicate'`. Nothing is written, and the caller must not re-run
 * whatever the original charge paid for. */
export async function splitDebit(
  tx: Db,
  userId: string,
  requestId: string,
  credits: number,
  debit: LedgerDebit,
  note: string,
  grantId: string | null = null,
  bucketRequestId: string = requestId,
): Promise<SplitDebitResult> {
  if (await hasCommittedDebit(tx, userId, requestId, bucketRequestId, debit.reason)) {
    return { fromBucket: 0, fromLedger: 0, bucketEntry: null, ledgerEntry: null };
  }
  const bucketBalance = grantId === null ? 0 : await getBucketBalance(tx, userId, grantId);
  const fromBucket = Math.min(credits, bucketBalance);
  const fromLedger = credits - fromBucket;
  const bucketEntry =
    fromBucket > 0 ? await debitBucket(tx, userId, grantId!, bucketRequestId, fromBucket, note) : null;
  const ledgerEntry = fromLedger > 0 ? await debit.write(tx, userId, requestId, fromLedger) : null;
  return { fromBucket, fromLedger, bucketEntry, ledgerEntry };
}

/** Refunds a split debit, bucket portion first (capped at what was actually
 * taken from it), then the ledger portion — the exact inverse order of
 * splitDebit's consumption, so a full refund (refundCredits === the
 * original `credits`) exactly undoes it, and a partial refund (the
 * clarification-price case) always tops up the bucket before the ledger.
 * Both legs run inside one transaction (coordinator-requested fix,
 * 2026-09-13): compensateBucket and compensate each accept a plain Db, so —
 * mirroring reserveDebit's own pattern of passing `tx` into ordinary
 * Db-typed helpers below — this wraps them in db.withTransaction and passes
 * `tx` to both, so a failure between the two legs can never leave a partial
 * refund (bucket reversed, ledger not, or vice versa). */
export async function compensateSplit(
  db: Db,
  userId: string,
  split: SplitDebitResult,
  refundCredits: number,
  auditAnswerId: number | null,
): Promise<void> {
  await db.withTransaction(async (tx) => {
    let remaining = refundCredits;
    if (split.bucketEntry !== null && remaining > 0) {
      const amount = Math.min(remaining, split.fromBucket);
      await compensateBucket(tx, userId, split.bucketEntry.id, amount);
      remaining -= amount;
    }
    if (split.ledgerEntry !== null && remaining > 0) {
      const amount = Math.min(remaining, split.fromLedger);
      await compensate(tx, userId, split.ledgerEntry.id, amount, auditAnswerId);
      remaining -= amount;
    }
  });
}
