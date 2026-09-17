// WP135 chat workspace (ADR 033): persisted conversation threads. This module
// is the backend seam the web layer reaches through the `web/backend -> ../src`
// symlink (web/backend/threads). A NEW top-level module per ADR 001's as-built
// list — it owns the thread entity's read/write SQL, mirroring the
// bound-parameter + user-scoping discipline of src/answer/audit/retention.ts
// and the ledger-join shape of src/billing/history.ts.
//
// Two structural GDPR facts make this safe by construction (ADR 033 D1/D2):
//   - chat_threads holds NO text (migration 019) — a thread stores WHEN, never
//     WHAT — so it needs no place in the #14/#120 retention purge.
//   - Thread titles are DERIVED at read time from the first non-redacted audit
//     row's question, so redacting the audit rows automatically empties the
//     sidebar (a fully-redacted thread is filtered out here, not deleted).
//
// THE CRITICAL SECURITY DISCIPLINE (the #14 cross-user pins, extended to the
// two new read paths): every statement binds `user_id` as a parameter. There
// is no code path here that can touch another user's threads or rows — no
// dynamic SQL, no string interpolation of a caller id. A forged thread id is
// coerced to a number and filtered out by the WHERE, never trusted.
//
// Note the deliberate id-type split (migration 004 predates the auth provider,
// ADR 006): chat_threads.user_id is `uuid` (matching auth.users), while
// audit_answers.user_id is `text`. The queries below scope chat_threads by
// `user_id = $n::uuid` (index-friendly; the session id is always a real uuid)
// and audit_answers by the plain text `user_id = $n` — never mixing the two.
import { createHash } from 'node:crypto';
import type { Db, QueryResultRow } from '../db/types.ts';
import { REDACTED_QUESTION_TEXT } from '../answer/audit/retention.ts';
import type { ComposedResponse } from '../answer/respond/types.ts';

/** Sidebar entry: identity + read-time-derived title + last activity. No text
 * is stored — `title` is computed from the audit rows every read. `kind`
 * (ADR 037 D10) is REQUIRED, not optional as the design doc's own sketch had
 * it — `listThreads` is this type's one producer and always knows which kind
 * a row is, so an always-populated field is simpler and less error-prone
 * than an optional one only some call sites remember to set. */
export interface ThreadSummary {
  id: number;
  title: string;
  lastActivityAt: string;
  kind: 'cbs' | 'dataset';
}

/** One thread turn, read back for replay/resume (getThreadRows). The full
 * envelope rides along (same zero-loss posture as src/billing/history.ts) plus
 * the per-row net cost from the ledger join — the live cost caption comes from
 * gated.netCost, which is NOT in the stored envelope, so replay must recompute
 * it from the ledger or the caption silently vanishes on resume (⟨A3⟩). */
export interface ThreadRow {
  id: number;
  kind: 'answer' | 'clarification' | 'refusal';
  question: string;
  finalText: string;
  replyText: string | null;
  createdAt: string;
  response: ComposedResponse;
  creditsCharged: number | null;
}

/** Max title length (chars), truncated in TS so the SQL stays a plain first-row
 * lookup (ADR 033 D2: titles are derived, never stored). */
const TITLE_MAX_LENGTH = 60;

/** Untrusted client thread id → a safe positive integer, or null. A malformed,
 * negative, non-integer, or out-of-safe-range value degrades to null (a fresh
 * thread / an empty result), never an error that could leak a thread's
 * existence (⟨A1⟩ fail-safe, the ADR-021 invalid-context treatment). */
function coerceThreadId(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** jsonb column → typed envelope. pg and PGlite both return a parsed object for
 * a jsonb select; a string fallback keeps this driver-agnostic (the
 * context/build.ts expected_dimensions precedent). */
function decodeResponse(raw: unknown): ComposedResponse {
  return (typeof raw === 'string' ? (JSON.parse(raw) as ComposedResponse) : (raw as ComposedResponse));
}

/** #246 fix (session 109): a byte-for-byte DUPLICATE of
 * src/billing/ledger.ts's (unexported) deriveAddonRequestId — deliberately
 * NOT imported. This module's own doc comment on attachOrCreateThread states
 * a load-bearing invariant, "this module NEVER touches src/billing/**",
 * which importing from ledger.ts would break; this file already duplicates
 * SQL (the credit_transactions netting formula in getThreadRows below is its
 * own independent copy of history.ts's, not a shared function) and a small
 * helper (decodeResponse above, vs. history.ts's own copy) for the same
 * boundary reason, so this follows the same precedent rather than carving
 * out a one-off exception.
 *
 * The drift risk a plain duplicate would normally carry — this MUST derive
 * the exact same id ledger.ts's splitDebit wrote a pro_bucket_ledger row
 * under, or a websearch/dataset add-on's bucket debit silently stops
 * matching here again (the original #246 bug) — is closed by
 * tests/threads/threads.test.ts's "deriveAddonRequestId parity" pin, which
 * imports BOTH this copy (exported for exactly that test, no other
 * production caller uses the export) and ledger.ts's real
 * deriveAddonRequestId and asserts they agree across a range of inputs; that
 * test fails loudly the moment the two drift, rather than the mismatch
 * silently reappearing as a display bug. See ledger.ts's own doc comment on
 * deriveAddonRequestId for the full algorithm rationale (why a hash instead
 * of a colon-joined string, etc.) — that reasoning is not repeated here. */
export function deriveAddonRequestId(requestId: string, suffix: string): string {
  const hex = createHash('sha256').update(`${requestId}:${suffix}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** ⟨A1⟩ READ-ONLY ownership check — NEVER an INSERT. Returns the validated
 * thread id when it exists AND belongs to `userId`, else null (null/malformed
 * id, or a thread owned by someone else). A forged id can therefore never
 * attach rows to another user's thread and never errors in a way that leaks
 * existence. Bound parameters only. */
export async function validateThreadOwnership(
  db: Db,
  userId: string,
  rawThreadId: unknown,
): Promise<number | null> {
  const threadId = coerceThreadId(rawThreadId);
  if (threadId === null) return null;
  const { rows } = await db.query(
    'select id from chat_threads where id = $1 and user_id = $2::uuid',
    [threadId, userId],
  );
  return rows.length === 0 ? null : threadId;
}

/** ⟨A1⟩ The ONLY place a CBS-thread `chat_threads` row is created —
 * atomically, and ONLY called on a gated-ok outcome with a real audit id
 * (insufficient_credits, duplicate_request, the ⟨W4⟩ early return, and thrown
 * pipeline exceptions never reach this call). Thread creation is thereby lazy
 * BY CONSTRUCTION (ADR 033 D1: no empty threads). `createDatasetThread`
 * below is a SECOND, deliberately different creation path (ADR 037 D10): a
 * dataset thread is created EAGERLY, at upload time, because the upload
 * itself is the first meaningful event — there is no "empty thread" risk to
 * guard against there the way there is for a lazily-attached CBS answer.
 *
 * One transaction: create the thread if `validatedThreadId` is null, then
 * attach the audit row (UPDATE scoped by the caller's `user_id`, only when
 * `thread_id IS NULL`), then touch `last_activity_at`. If the audit row is not
 * the caller's or is already attached, the UPDATE matches nothing and the whole
 * transaction rolls back (throwing) — so a freshly-created thread is never left
 * empty, and the caller (web/app/actions.ts) treats a failed attach as a
 * threadless-but-still-audited answer (degraded, logged; never blocks or rolls
 * back the answer itself). Returns the attached thread id.
 *
 * This module NEVER touches src/billing/** — thread attach is a post-hoc UPDATE
 * on audit rows (UPDATE-on-audit-rows is precedented by redaction). */
export async function attachOrCreateThread(
  db: Db,
  userId: string,
  validatedThreadId: number | null,
  auditId: number,
): Promise<number> {
  return db.withTransaction(async (tx) => {
    let threadId = validatedThreadId;
    if (threadId === null) {
      const { rows } = await tx.query(
        'insert into chat_threads (user_id) values ($1::uuid) returning id',
        [userId],
      );
      threadId = Number(rows[0]!.id);
    }
    const { rows: attached } = await tx.query(
      `update audit_answers set thread_id = $1
         where id = $2 and user_id = $3 and thread_id is null
         returning id`,
      [threadId, auditId, userId],
    );
    if (attached.length === 0) {
      // Not the caller's audit row, or already attached: never leave a
      // freshly-created empty thread behind (ADR 033 D1). Throwing rolls the
      // whole transaction back; the caller degrades to a threadless answer.
      throw new Error(`attachOrCreateThread: audit row ${auditId} is not attachable for this user`);
    }
    await tx.query('update chat_threads set last_activity_at = now() where id = $1', [threadId]);
    return threadId;
  });
}

/** ADR 037 D10: creates a dataset thread EAGERLY, at upload time — a
 * `chat_threads` row with `dataset_id` set from the moment the upload
 * completes, unlike attachOrCreateThread's lazy CBS-thread creation above.
 * Called from `web/app/dataset-actions.ts`'s `ingestFile`, immediately after
 * the dataset row itself commits; `datasetId` is the caller's own
 * just-inserted, already-ownership-bound id (never a client-supplied one),
 * so there is no ownership check to make here beyond binding `user_id`. */
export async function createDatasetThread(db: Db, userId: string, datasetId: number): Promise<number> {
  const { rows } = await db.query(
    'insert into chat_threads (user_id, dataset_id) values ($1::uuid, $2) returning id',
    [userId, datasetId],
  );
  return Number(rows[0]!.id);
}

/** ADR 037 D8 step 1: an `askDataset` call binds BOTH the dataset and the
 * thread to the SAME caller, AND to each other — nothing at the schema level
 * otherwise stops a caller's own valid `datasetId` from being paired with a
 * DIFFERENT one of their own threads (even a CBS one, whose `dataset_id` is
 * NULL). Returns the validated thread id, or null for any mismatch (unowned
 * thread, wrong dataset, or a threadless/CBS thread) — the same
 * indistinguishable-on-purpose contract as `validateThreadOwnership`. */
export async function validateDatasetThreadOwnership(
  db: Db,
  userId: string,
  rawThreadId: unknown,
  datasetId: number,
): Promise<number | null> {
  const threadId = coerceThreadId(rawThreadId);
  if (threadId === null) return null;
  const { rows } = await db.query(
    'select id from chat_threads where id = $1 and user_id = $2::uuid and dataset_id = $3',
    [threadId, userId, datasetId],
  );
  return rows.length === 0 ? null : threadId;
}

/** ADR 037 D10: `loadMyThread`'s (web/app/actions.ts) dispatch point — does
 * this ALREADY-ownership-validated thread carry a dataset, or is it a CBS
 * thread? Takes a validated `threadId` (from `validateThreadOwnership`), not
 * a raw one — this function does no EXISTENCE check of its own, it only
 * reads one column off a row the caller already proved is theirs. `userId`
 * is re-bound anyway (this module's own defense-in-depth convention, applied
 * even where a caller mistake is the only way it would ever matter — every
 * other reader here does the same under an already-scoped join). Returns
 * null for a CBS thread (`dataset_id` NULL) OR a threadId that doesn't
 * actually belong to `userId`; never throws for a dataset that no longer
 * exists — that is `getDataset`'s ownership check to make next, not this
 * function's job. */
export async function getThreadDatasetId(db: Db, userId: string, threadId: number): Promise<number | null> {
  // Emergency fix (2026-09-07, session 86): migrations 026/027 add BOTH
  // `user_datasets` and this very `chat_threads.dataset_id` column — until
  // the owner-supervised apply runs, `dataset_id` does not exist in the real
  // database at all, and this SELECT throws (column does not exist), not
  // just returns an empty/null result. That is exactly the #154 lesson this
  // repo's own RUNBOOK names ("the design's 'apply the migration later'
  // claim is worthless the moment the code SELECTs the new column"), missed
  // when this thread-kind dispatch was added — deploy had been broken for
  // weeks, so this never actually ran against production until today's
  // deploy-pipeline fix exposed it as a live 500 on every thread selection.
  // Every thread is a CBS thread pre-migration by construction, so the safe
  // answer is `null` with no query at all.
  if (!(await userDatasetsTableExists(db))) return null;
  const { rows } = await db.query('select dataset_id from chat_threads where id = $1 and user_id = $2::uuid', [
    threadId,
    userId,
  ]);
  const value = (rows[0] as { dataset_id: number | string | null } | undefined)?.dataset_id ?? null;
  return value === null ? null : Number(value);
}

/** Check-not-catch (the retention-job.ts precedent, `trialTableExists`/
 * `errorLogTableExists`): `user_datasets` and `chat_threads.dataset_id` are
 * both added by migration 026 in one file, so this single check stands in
 * for both — a table probe is enough, since a column can't exist without its
 * own migration having run. */
async function userDatasetsTableExists(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.user_datasets') as t`, []);
  return rows[0]?.t != null;
}

/** The sidebar list: a user's threads, most-recent-activity first. A CBS
 * thread's title is the first NON-redacted audit row's question
 * (created_at asc, id asc); a dataset thread's title (ADR 037 D10) is its
 * dataset's `display_name` — NULL for one still redacted (status <>
 * 'redacted' in the bind, not just a join condition), so a fully-redacted
 * dataset thread is filtered OUT exactly like a fully-redacted CBS thread
 * (ADR 033 D2's invariant, extended to the new kind, not narrowed to it).
 * Truncated in TS. Bound parameters throughout; scoped to `userId` —
 * **fixed in review**: the dataset-title subselect re-binds `user_id` on
 * `user_datasets` too, even though `t.dataset_id` already came from a
 * row scoped by the outer WHERE — every existing subselect in this
 * function already re-binds `user_id` under an already-scoped join as
 * deliberate defense-in-depth, and the new one follows the same rule. */
export async function listThreads(db: Db, userId: string, limit = 50): Promise<ThreadSummary[]> {
  // Emergency fix (2026-09-07, session 86): same #154-class bug as
  // `getThreadDatasetId` above — `t.dataset_id`/`user_datasets` don't exist
  // pre-migration-026, so the dataset-aware query below throws (not just
  // returns empty) against the real, not-yet-migrated database. Every
  // thread is a CBS thread pre-migration, so the fallback is exactly the
  // pre-ADR-037 query (byte-identical to before WP202a), with the two new
  // columns hardcoded to their CBS-only values so the row-processing loop
  // below is unchanged either way.
  const datasetAware = await userDatasetsTableExists(db);
  const { rows } = await db.query(
    datasetAware
      ? `select
       t.id,
       t.last_activity_at,
       t.dataset_id is not null as is_dataset,
       case when t.dataset_id is null then (
         select a.question
         from audit_answers a
         where a.thread_id = t.id
           and a.user_id = $1
           and a.question <> $2
         order by a.created_at asc, a.id asc
         limit 1
       ) end as cbs_title_source,
       case when t.dataset_id is not null then (
         select ud.display_name
         from user_datasets ud
         where ud.id = t.dataset_id
           and ud.user_id = $1::uuid
           and ud.status <> 'redacted'
       ) end as dataset_title_source
     from chat_threads t
     where t.user_id = $1::uuid
     order by t.last_activity_at desc, t.id desc
     limit $3`
      : `select
       t.id,
       t.last_activity_at,
       false as is_dataset,
       (
         select a.question
         from audit_answers a
         where a.thread_id = t.id
           and a.user_id = $1
           and a.question <> $2
         order by a.created_at asc, a.id asc
         limit 1
       ) as cbs_title_source,
       null as dataset_title_source
     from chat_threads t
     where t.user_id = $1::uuid
     order by t.last_activity_at desc, t.id desc
     limit $3`,
    [userId, REDACTED_QUESTION_TEXT, limit],
  );
  const summaries: ThreadSummary[] = [];
  for (const row of rows) {
    const isDataset = Boolean(row.is_dataset);
    const titleSource = isDataset ? row.dataset_title_source : row.cbs_title_source;
    // title source NULL ⇒ the thread has no non-redacted content to show
    // (fully redacted, or — defensively — no rows at all): filter it out.
    if (titleSource === null || titleSource === undefined) continue;
    const title = String(titleSource).slice(0, TITLE_MAX_LENGTH);
    summaries.push({
      id: Number(row.id),
      title,
      lastActivityAt: toIso(row.last_activity_at),
      kind: isDataset ? 'dataset' : 'cbs',
    });
  }
  return summaries;
}

/** A thread's turns for replay/resume: every audit row in the thread (created_at
 * asc, id asc), full envelope + the per-row net cost from the SAME
 * debit/compensation ledger arithmetic src/billing/history.ts implements — but
 * EXTENDED (⟨A3⟩, unlike history.ts's dashboard join) to net the 'websearch_cost'
 * add-on debit as well as the base 'question_cost' debit, so a resumed web turn
 * shows the same cost the live chat showed (gated.netCost including a kept +10).
 * Mind the cast: audit_answers.user_id is TEXT, credit_transactions.user_id is
 * uuid — cast the uuid side to text, as history.ts does. Redacted rows are
 * INCLUDED (a partially-redacted thread shows its live rows + placeholders on
 * replay); the replay layer detects them by the sentinel. Scoped to `userId`
 * (defense in depth even after validateThreadOwnership — loadMyThread reads this
 * directly). */
export async function getThreadRows(db: Db, userId: string, threadId: number): Promise<ThreadRow[]> {
  const { rows } = await db.query(
    `select
       a.id,
       a.kind,
       a.question,
       a.final_text,
       a.reply_text,
       a.created_at,
       a.response,
       -- ⟨A3⟩ per-row net cost = the LIVE gated.netCost caption a resumed turn
       -- must reproduce byte-for-byte. A turn's net is EVERY debit on its
       -- (user_id, request_id) — the 'question_cost' debit AND, on a web-opted
       -- turn, the SEPARATE 'websearch_cost' add-on debit (migration 018, ADR
       -- 032), AND, on an on-demand-onboarding trigger turn, the SEPARATE
       -- 100-credit 'onboarding_cost' debit (WP16 sub-part 2, ADR 026) —
       -- minus every compensation that reversed one of those debits.
       -- Each debit is independently refundable: a KEPT add-on stands with no
       -- compensation and lifts netCost by +10 (settleWebAddon bumps netCost in
       -- memory only — the debit is the sole persisted trace, so replay MUST
       -- net it or the resumed cost silently drops the add-on); a refunded one
       -- carries its own compensation row (related_transaction_id -> the web
       -- debit). The onboarding case is the same shape: the ACK turn's
       -- question_cost debit is fully refunded (nets 0) while its separate
       -- onboarding_cost debit stands (maybeTriggerOnboarding overrides the LIVE
       -- netCost to 100), so replay MUST net onboarding_cost too or the resumed
       -- ack bubble silently drops to "0 credits" for a turn the user paid 100
       -- (bug found by adversarial review, 2026-07-13). A later verification
       -- failure refunds it via a compensation on the onboarding debit, netting
       -- it back to 0 — the same debit-minus-compensation rule. No double-count:
       -- the onboarding DELIVERY row (source_tag 'onboarding_delivery', which the
       -- dashboard attributes the 100 to) is a background cron re-run and is
       -- NEVER thread-attached (attachThread runs only on the live chat turn),
       -- so it never appears in this thread scan — the ACK row is the sole
       -- in-thread carrier of that request_id's onboarding_cost. Aggregated as
       -- correlated subqueries, NOT extra LEFT JOINs: several debits plus their
       -- compensations would multiply the row (cartesian product) under a join.
       -- NB history.ts's dashboard shows onboarding on the DELIVERY row +
       -- excludes the ack row (the opposite surface), so the two files
       -- handle onboarding by design differently — a separate, reviewed
       -- change; do not read across.
       --
       -- #246 fix (session 109, open-questions #246): this used to collapse
       -- straight to null via a single CASE when nothing matched here — but
       -- "nothing in credit_transactions" no longer means "nothing was
       -- charged": a fully Pro-bucket-funded turn's ONLY trace is a
       -- pro_bucket_ledger row (splitDebit, src/billing/ledger.ts, never
       -- writes a credit_transactions row when the whole charge came from
       -- the bucket). onboarding_cost itself is deliberately EXCLUDED from
       -- the bucket mechanic (reserveOnboardingDebit's doc comment) and
       -- always lands here, unaffected — only the base question_cost debit
       -- and the websearch_cost add-on can ever be bucket-funded. So this
       -- query now reports the LEDGER side's own number (always numeric, 0
       -- when this turn has no ledger debit) plus a separate
       -- ledger_has_debit flag; queryBucketNetCosts (computed just below, in
       -- JS, batched over the whole thread) supplies the bucket side
       -- afterwards. The null-or-number decision moves to
       -- resolveThreadRowCreditsCharged, which also computes the
       -- websearch/dataset add-on's derived bucket id via this file's own
       -- local deriveAddonRequestId (a deliberate duplicate of
       -- src/billing/ledger.ts's — see that function's doc comment above for
       -- why) — pro_bucket_ledger has no reason column to filter by, only a
       -- request_id an add-on debit derives specially, so a plain request_id
       -- match alone would silently miss it (exactly the wrinkle
       -- open-questions #246 flags).
       coalesce((
         select -sum(d.delta)
         from credit_transactions d
         where d.user_id::text = a.user_id
           and d.request_id = a.request_id
           and d.reason in ('question_cost', 'websearch_cost', 'onboarding_cost')
       ), 0)
       - coalesce((
         select sum(c.delta)
         from credit_transactions c
         where c.reason = 'compensation'
           and c.related_transaction_id in (
             select d.id
             from credit_transactions d
             where d.user_id::text = a.user_id
               and d.request_id = a.request_id
               and d.reason in ('question_cost', 'websearch_cost', 'onboarding_cost')
           )
       ), 0) as ledger_net,
       exists (
         select 1
         from credit_transactions d
         where d.user_id::text = a.user_id
           and d.request_id = a.request_id
           and d.reason in ('question_cost', 'websearch_cost', 'onboarding_cost')
       ) as ledger_has_debit,
       a.request_id as request_id
     from audit_answers a
     where a.thread_id = $1
       and a.user_id = $2
     order by a.created_at asc, a.id asc`,
    [threadId, userId],
  );
  // #246 fix (session 109): one batched round trip against pro_bucket_ledger
  // for every row's candidate bucket ids, mirroring src/billing/history.ts's
  // own getBucketNetCosts call -- duplicated here (a local, DB-touching
  // query), never imported, per this file's "NEVER touches src/billing/**"
  // invariant (attachOrCreateThread's doc comment above) and its usual
  // threads/billing module-boundary convention (see decodeResponse's own
  // duplicate, and this file's local deriveAddonRequestId duplicate).
  const bucketNetCosts = await queryBucketNetCosts(db, userId, collectBucketCandidateIds(rows));
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind as ThreadRow['kind'],
    question: String(row.question),
    finalText: String(row.final_text),
    replyText: row.reply_text === null ? null : String(row.reply_text),
    createdAt: toIso(row.created_at),
    response: decodeResponse(row.response),
    creditsCharged: resolveThreadRowCreditsCharged(row, bucketNetCosts),
  }));
}

/** #246 fix (session 109): every candidate pro_bucket_ledger request_id this
 * thread's rows could possibly have a bucket debit under -- the base
 * request_id (a question/onboarding-ack debit's own bucketRequestId
 * default) plus the two derived add-on ids (splitDebit's disambiguation for
 * reserveWebSearchDebit/reserveDatasetDebit — see deriveAddonRequestId's doc
 * comment in src/billing/ledger.ts). onboarding_cost debits are always
 * ledger-only (never bucket-eligible, reserveOnboardingDebit's doc comment)
 * so no separate exclusion is needed the way history.ts needs one for its
 * onboarding DELIVERY rows — this file's thread scan never sees a delivery
 * row at all (see the SQL's own comment above). Deduplicated (a Set) since
 * the two derived ids are each 32 bytes of SHA-256 — no reason to ask
 * Postgres to match the same uuid twice. */
function collectBucketCandidateIds(rows: readonly QueryResultRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.request_id === null || row.request_id === undefined) continue;
    const requestId = String(row.request_id);
    ids.add(requestId);
    ids.add(deriveAddonRequestId(requestId, 'websearch'));
    ids.add(deriveAddonRequestId(requestId, 'dataset'));
  }
  return [...ids];
}

/** #246 fix (session 109): the local, threads-module copy of
 * src/billing/pro-bucket.ts's getBucketNetCosts — same query, same
 * semantics (a Map from request_id to net credits charged, present only for
 * an id with a committed 'debit' row), duplicated per this file's usual
 * threads/billing SQL-independence convention (see e.g. this function's own
 * sibling, the credit_transactions correlated subquery above, which
 * independently re-derives history.ts's netting formula rather than
 * importing it). Scoped to `userId`, mirroring every other cross-ledger read
 * in this file. */
async function queryBucketNetCosts(db: Db, userId: string, requestIds: readonly string[]): Promise<Map<string, number>> {
  if (requestIds.length === 0) return new Map();
  const { rows } = await db.query(
    `select
       d.request_id as request_id,
       (-d.delta) - coalesce(
         (select sum(c.delta) from pro_bucket_ledger c where c.related_entry_id = d.id and c.reason = 'compensation'),
         0
       ) as net
     from pro_bucket_ledger d
     where d.user_id = $1
       and d.reason = 'debit'
       and d.request_id = any($2::uuid[])`,
    [userId, requestIds],
  );
  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(String(row.request_id), Number(row.net));
  }
  return result;
}

/** #246 fix (session 109): the null-or-number decision the SQL used to make
 * alone now also needs the bucket side — see the SQL's own comment above for
 * the full reasoning. The null guard fires only when NEITHER table has a
 * matching debit; non-Pro byte-identity holds because a non-Pro user never
 * has a pro_bucket_ledger row at all, so `bucketNetCosts` is always empty
 * for them and this collapses to exactly the pre-#246 ledger-only value. */
function resolveThreadRowCreditsCharged(row: QueryResultRow, bucketNetCosts: Map<string, number>): number | null {
  const ledgerNet = Number(row.ledger_net);
  const ledgerHasDebit = Boolean(row.ledger_has_debit);
  let bucketNet = 0;
  let bucketHasDebit = false;
  if (row.request_id !== null && row.request_id !== undefined) {
    const requestId = String(row.request_id);
    for (const candidate of [
      requestId,
      deriveAddonRequestId(requestId, 'websearch'),
      deriveAddonRequestId(requestId, 'dataset'),
    ]) {
      const net = bucketNetCosts.get(candidate);
      if (net !== undefined) {
        bucketHasDebit = true;
        bucketNet += net;
      }
    }
  }
  if (!ledgerHasDebit && !bucketHasDebit) return null;
  return ledgerNet + bucketNet;
}
