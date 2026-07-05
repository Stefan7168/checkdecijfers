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
import type { Db } from '../db/types.ts';
import type { ActionClass } from './types.ts';

export async function getBalance(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query(
    'select coalesce(sum(delta), 0) as balance from credit_transactions where user_id = $1',
    [userId],
  );
  return Number(rows[0]!.balance);
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
     values ($1, $2, 'question_cost', $3, 'question debit')
     on conflict (user_id, request_id) where reason = 'question_cost' do nothing
     returning id`,
    [userId, -credits, requestId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

export type ReserveDebitResult =
  | { kind: 'debited'; entry: LedgerEntry }
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
 * exhausting the connection pool under real concurrent traffic. */
export async function reserveDebit(
  db: Db,
  userId: string,
  requestId: string,
  required: number,
): Promise<ReserveDebitResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [userId]);
    const balance = await getBalance(tx, userId);
    if (balance < required) {
      return { kind: 'insufficient', balance };
    }
    const entry = await debitQuestion(tx, userId, requestId, required);
    return entry === null ? { kind: 'duplicate' } : { kind: 'debited', entry };
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
     values ($1, $2, 'onboarding_cost', $3, 'on-demand CBS table onboarding debit')
     on conflict (user_id, request_id) where reason = 'onboarding_cost' do nothing
     returning id`,
    [userId, -credits, requestId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

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
 * design. */
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
