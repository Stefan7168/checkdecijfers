// pending_table_requests store (migration 012, WP16 sub-part 2, design §1/§3):
// typed create/claim/reclaim/finalize primitives over the on-demand CBS table
// onboarding queue. This module owns the SQL shape; CORE-1 (web-action
// triggerOnboarding) uses createPendingRequest, CORE-2 (the cron job) uses
// everything else. PERIPHERY (design §5-dashboard) uses
// listRequestsForHistory to fold the queue's state into the user's question
// history.
//
// Deliberately thin: no business logic beyond "read/write this row
// correctly, race-free". The fetch/ingest/vocab/delivery decisions live in
// CORE-2's job module (src/ingestion/onboarding.ts), not here.
import type { Db } from '../db/types.ts';

export type PendingRequestStatus = 'pending' | 'running' | 'delivered' | 'failed' | 'unanswerable';

export interface PendingTableRequest {
  id: number;
  userId: string;
  requestId: string;
  questionText: string;
  topicTerm: string;
  tableId: string;
  finderConfidence: number;
  /** WP27 stage B (ADR 027 D2a): the finder's candidate chain (pick first,
   * then sanitized alternativeIds, cap 3). [] on legacy rows AND on rows read
   * from a pre-migration-015 schema — both mean the same thing to stage C's
   * job: exactly today's path, no fit gate (ADR 027 D2c). */
  candidateIds: string[];
  /** WP27 stage C's accepted fit — null until the fit gate accepts a
   * candidate. The job then ingests (resolvedTableId ?? tableId). tableId
   * itself is NEVER mutated: it stays the finder's original pick, the
   * (user, table) dedupe identity (ADR 027 D2a). */
  resolvedTableId: string | null;
  status: PendingRequestStatus;
  claimedAt: Date | null;
  attemptCount: number;
  debitTransactionId: number;
  ackAuditAnswerId: number | null;
  deliveryAuditAnswerId: number | null;
  failureSummary: string | null;
  sliceNote: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

interface PendingRequestRow {
  id: number | string;
  user_id: string;
  request_id: string;
  question_text: string;
  topic_term: string;
  table_id: string;
  finder_confidence: number | string;
  /** OPTIONAL (`?`) deliberately: `select *` on a pre-migration-015 schema
   * returns rows without these keys — the deploy-order-safety window between
   * the stage-B code deploy and stage D's supervised migration apply. jsonb
   * arrives parsed (pg and PGlite both parse json/jsonb by default), but
   * fromRow still tolerates a string for driver-config robustness. */
  candidate_ids?: unknown;
  resolved_table_id?: string | null;
  status: PendingRequestStatus;
  claimed_at: string | null;
  attempt_count: number;
  debit_transaction_id: number | string;
  ack_audit_answer_id: number | string | null;
  delivery_audit_answer_id: number | string | null;
  failure_summary: string | null;
  slice_note: string | null;
  created_at: string;
  finished_at: string | null;
}

/** candidate_ids column → string[]. null/undefined (pre-015 schema or an
 * explicit null) → [] — indistinguishable from a legacy row ON PURPOSE: both
 * must take today's no-fit-gate path (ADR 027 D2c). Anything non-array after
 * parsing also degrades to [] (defensive; the column's writers only ever
 * store a JSON string array). */
function candidateIdsFromColumn(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function fromRow(row: PendingRequestRow): PendingTableRequest {
  return {
    id: Number(row.id),
    userId: row.user_id,
    requestId: row.request_id,
    questionText: row.question_text,
    topicTerm: row.topic_term,
    tableId: row.table_id,
    finderConfidence: Number(row.finder_confidence),
    candidateIds: candidateIdsFromColumn(row.candidate_ids),
    resolvedTableId: row.resolved_table_id ?? null,
    status: row.status,
    claimedAt: row.claimed_at === null ? null : new Date(row.claimed_at),
    attemptCount: row.attempt_count,
    debitTransactionId: Number(row.debit_transaction_id),
    ackAuditAnswerId: row.ack_audit_answer_id === null ? null : Number(row.ack_audit_answer_id),
    deliveryAuditAnswerId: row.delivery_audit_answer_id === null ? null : Number(row.delivery_audit_answer_id),
    failureSummary: row.failure_summary,
    sliceNote: row.slice_note,
    createdAt: new Date(row.created_at),
    finishedAt: row.finished_at === null ? null : new Date(row.finished_at),
  };
}

export interface CreatePendingRequestInput {
  userId: string;
  requestId: string;
  questionText: string;
  topicTerm: string;
  tableId: string;
  finderConfidence: number;
  /** WP27 stage B: the finder's candidate chain to persist. REQUIRED — an
   * optional carrier is how a chain link gets silently skipped (PR-#17
   * review). Callers without a chain (none exist in production; some tests)
   * must say [] explicitly, which is the legacy no-fit-gate path. */
  candidateIds: string[];
  debitTransactionId: number;
  ackAuditAnswerId?: number | null;
}

/** Inserts the pending row. Called from the SAME transaction as the 100-credit
 * onboarding debit (design §0.3/§2: "atomically in ONE transaction") — the
 * caller (CORE-1's triggerOnboarding) passes a `tx` Db here, not the pooled
 * top-level db.
 *
 * Does NOT itself check for an existing active row: migration 012's
 * `pending_one_active_per_user_table` partial unique index is the actual
 * guard (structural, not pattern-based per CLAUDE.md), so a duplicate insert
 * throws a unique-violation the caller must catch and translate into the
 * 'onboarding_already_pending' refusal reason — never a silent second queue
 * entry. */
export async function createPendingRequest(db: Db, input: CreatePendingRequestInput): Promise<PendingTableRequest> {
  // WP27 stage B deploy-order safety: migration 015 is FILE-ONLY until stage
  // D's supervised live step, so this code runs against the pre-015 production
  // schema for a while. An INSERT naming a missing column is a statement error
  // that would abort the WHOLE money transaction (debit included), so probe
  // for the column first — a SELECT can never abort the tx. No caching: the
  // probe is one trivial catalog read per onboarding trigger (a rare,
  // 100-credit event), and cache staleness across the stage-D migration would
  // buy nothing but a test-only reset hook. When the column is absent the
  // chain is dropped for that row — it reads back as [] = the legacy
  // no-fit-gate path, exactly what those rows must do (ADR 027 D2c).
  const probe = await db.query(
    `select 1 from pg_attribute
     where attrelid = 'pending_table_requests'::regclass
       and attname = 'candidate_ids' and not attisdropped`,
  );
  const hasCandidateColumn = probe.rows.length > 0;
  const { rows } = hasCandidateColumn
    ? await db.query(
        `insert into pending_table_requests
           (user_id, request_id, question_text, topic_term, table_id, finder_confidence,
            candidate_ids, debit_transaction_id, ack_audit_answer_id)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         returning *`,
        [
          input.userId,
          input.requestId,
          input.questionText,
          input.topicTerm,
          input.tableId,
          input.finderConfidence,
          JSON.stringify(input.candidateIds),
          input.debitTransactionId,
          input.ackAuditAnswerId ?? null,
        ],
      )
    : await db.query(
        `insert into pending_table_requests
           (user_id, request_id, question_text, topic_term, table_id, finder_confidence,
            debit_transaction_id, ack_audit_answer_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning *`,
        [
          input.userId,
          input.requestId,
          input.questionText,
          input.topicTerm,
          input.tableId,
          input.finderConfidence,
          input.debitTransactionId,
          input.ackAuditAnswerId ?? null,
        ],
      );
  return fromRow(rows[0] as unknown as PendingRequestRow);
}

/** Has this (userId, tableId) got an active (pending/running) row already?
 * Used by CORE-1's trigger flow to decide 'onboarding_pending' (first ask,
 * debit + create) vs 'onboarding_already_pending' (no new debit) BEFORE
 * attempting the debit — the unique index is the structural backstop, this
 * is the cheap pre-check that avoids reserving credits just to roll them
 * back on a duplicate-index hit. */
export async function findActiveRequest(db: Db, userId: string, tableId: string): Promise<PendingTableRequest | null> {
  const { rows } = await db.query(
    `select * from pending_table_requests
     where user_id = $1 and table_id = $2 and status in ('pending', 'running')
     limit 1`,
    [userId, tableId],
  );
  const row = rows[0];
  return row === undefined ? null : fromRow(row as unknown as PendingRequestRow);
}

/** Fetches one row by id (typed). Used by the job's attempt-cap path, which
 * has only an id (from reclaimStaleRunning's exhaustedIds) but needs the full
 * row to refund + notify + finalize. Returns null when the id is gone. */
export async function getPendingRequest(db: Db, id: number): Promise<PendingTableRequest | null> {
  const { rows } = await db.query('select * from pending_table_requests where id = $1', [id]);
  const row = rows[0];
  return row === undefined ? null : fromRow(row as unknown as PendingRequestRow);
}

/** Reclaims stale 'running' rows back to 'pending' (a prior job invocation
 * crashed or exceeded its deadline mid-row) — design §3 step 1. Rows that
 * have already been attempted `maxAttempts` times or more are left alone
 * here; the caller (the job) is responsible for terminally failing +
 * refunding those separately, since that requires the ledger (which this
 * store module does not touch — store stays money-free, per CLAUDE.md's
 * "billing must not leak" boundary applied one level down). Returns the ids
 * reclaimed to pending and the ids that hit the attempt cap (still 'running',
 * untouched — the job's job to finalize). */
export async function reclaimStaleRunning(
  db: Db,
  staleAfterMs: number,
  maxAttempts: number,
): Promise<{ reclaimedIds: number[]; exhaustedIds: number[] }> {
  const exhausted = await db.query(
    `select id from pending_table_requests
     where status = 'running'
       and claimed_at < now() - ($1 || ' milliseconds')::interval
       and attempt_count >= $2`,
    [staleAfterMs, maxAttempts],
  );
  const reclaimed = await db.query(
    `update pending_table_requests
     set status = 'pending', attempt_count = attempt_count + 1
     where status = 'running'
       and claimed_at < now() - ($1 || ' milliseconds')::interval
       and attempt_count < $2
     returning id`,
    [staleAfterMs, maxAttempts],
  );
  return {
    reclaimedIds: reclaimed.rows.map((r) => Number(r.id)),
    exhaustedIds: exhausted.rows.map((r) => Number(r.id)),
  };
}

/** Claims exactly one pending row (FOR UPDATE SKIP LOCKED — design §3 step 2):
 * safe under concurrent cron invocations, never double-claims. Returns null
 * when the queue is empty. */
export async function claimOnePending(db: Db): Promise<PendingTableRequest | null> {
  const { rows } = await db.query(
    `update pending_table_requests
     set status = 'running', claimed_at = now()
     where id = (
       select id from pending_table_requests
       where status = 'pending'
       order by created_at
       limit 1
       for update skip locked
     )
     returning *`,
  );
  const row = rows[0];
  return row === undefined ? null : fromRow(row as unknown as PendingRequestRow);
}

export interface FinalizeDeliveredInput {
  deliveryAuditAnswerId: number;
}

/** Terminal transition: the re-run pipeline produced a real answer. */
export async function finalizeDelivered(db: Db, id: number, input: FinalizeDeliveredInput): Promise<void> {
  await db.query(
    `update pending_table_requests
     set status = 'delivered', delivery_audit_answer_id = $2, finished_at = now()
     where id = $1`,
    [id, input.deliveryAuditAnswerId],
  );
}

/** Terminal transition: the re-run pipeline did not produce an answer
 * (refusal/clarification) — design §0.4's verification gate. The 100-credit
 * refund itself is the job's responsibility (ledger access, not this
 * store's), but MUST be finalized before/alongside this call in practice —
 * see HANDOFF for the compensate() gap this stage found (onboarding_cost
 * debits cannot be reversed by the existing compensate() primitive as-is). */
export async function finalizeUnanswerable(db: Db, id: number, failureSummary: string): Promise<void> {
  await db.query(
    `update pending_table_requests
     set status = 'unanswerable', failure_summary = $2, finished_at = now()
     where id = $1`,
    [id, failureSummary],
  );
}

/** Terminal transition: fetch/ingest/vocab threw, or the attempt cap was hit
 * during reclaim. */
export async function finalizeFailed(db: Db, id: number, failureSummary: string): Promise<void> {
  await db.query(
    `update pending_table_requests
     set status = 'failed', failure_summary = $2, finished_at = now()
     where id = $1`,
    [id, failureSummary],
  );
}

/** Records the slice-estimation note (design §4) on a row still in flight —
 * a diagnostic write only, never a status transition. */
export async function recordSliceNote(db: Db, id: number, sliceNote: string): Promise<void> {
  await db.query(`update pending_table_requests set slice_note = $2 where id = $1`, [id, sliceNote]);
}

/** WP27 stage C (ADR 027 D2a): records the fit gate's ACCEPTED candidate on
 * the row — the DB row AND the in-memory object the job keeps using, so a
 * reclaimed retry resumes at ingest with this table (never a second fit
 * loop) and the current invocation reads the same truth it just wrote.
 * `table_id` is NEVER touched: it stays the finder's original pick, the
 * (user, table) dedupe identity. `fit_note` is diagnostics only (measure code
 * + one-line reading); delivery never consumes it.
 *
 * No pre-015 column probe here (unlike createPendingRequest): this function
 * is only reachable for a row whose candidateIds is non-empty, which on a
 * pre-015 schema never happens (the create-side probe drops the chain, so
 * such rows read back [] = the legacy path that bypasses the fit gate). */
export async function setResolvedTable(
  db: Db,
  row: PendingTableRequest,
  resolvedTableId: string,
  fitNote: string,
): Promise<void> {
  await db.query(`update pending_table_requests set resolved_table_id = $2, fit_note = $3 where id = $1`, [
    row.id,
    resolvedTableId,
    fitNote,
  ]);
  row.resolvedTableId = resolvedTableId;
}

/** One user's onboarding request, shaped for the dashboard history join
 * (design §5-dashboard). `netCredits` is read straight from the ledger here
 * (not recomputed by the caller) so history.ts never needs to know
 * `pending_table_requests`' own columns beyond the ones it already renders --
 * the store keeps owning "how do I find my own money", same boundary as the
 * rest of this module. Sign convention matches getQuestionHistory's own
 * `creditsCharged` (src/billing/history.ts): a positive "amount actually
 * charged", never a signed ledger delta --
 *   - a `pending`/`running` row: 100 (the onboarding debit, not yet reversed)
 *   - a `delivered` row: STILL 100 (the debit stands -- the fetch was worth it)
 *   - a `failed`/`unanswerable` row: 0 (reversed by the job's own
 *     compensate() call, migration 013).
 * A row's own `debit_transaction_id` is unambiguous (one row, one debit,
 * enforced by the FK), so this is a plain per-row scalar subquery, not a
 * join that could fan out. */
export interface OnboardingHistoryRow {
  id: number;
  status: PendingRequestStatus;
  questionText: string;
  tableId: string;
  /** The Dutch free-text topic findTable matched on (e.g. "zonnestroom") --
   * more presentable in the dashboard than the CBS table id, which is an
   * opaque code (e.g. "82235NED") the user never typed. */
  topicTerm: string;
  createdAt: Date;
  finishedAt: Date | null;
  /** Null only if the debit row itself is somehow missing (a FK guarantees
   * it exists, so this is defensive, not an expected case). */
  netCredits: number | null;
  deliveryAuditAnswerId: number | null;
  failureSummary: string | null;
}

interface OnboardingHistoryQueryRow {
  id: number | string;
  status: PendingRequestStatus;
  question_text: string;
  table_id: string;
  topic_term: string;
  created_at: string;
  finished_at: string | null;
  net_credits: number | string | null;
  delivery_audit_answer_id: number | string | null;
  failure_summary: string | null;
}

/** Every onboarding request for `userId`, most recent first, with its net
 * ledger cost pre-joined (design §5-dashboard: "the delivered answer row,
 * its real 100-credit cost caption via the ledger join"). history.ts merges
 * this list with getQuestionHistory's own audit-row-driven entries into one
 * timeline. */
export async function listRequestsForHistory(db: Db, userId: string): Promise<OnboardingHistoryRow[]> {
  const { rows } = await db.query(
    `select
       p.id,
       p.status,
       p.question_text,
       p.table_id,
       p.topic_term,
       p.created_at,
       p.finished_at,
       p.delivery_audit_answer_id,
       p.failure_summary,
       -(debit.delta + coalesce(comp.delta, 0)) as net_credits
     from pending_table_requests p
     join credit_transactions debit on debit.id = p.debit_transaction_id
     left join credit_transactions comp
       on comp.related_transaction_id = p.debit_transaction_id
      and comp.reason = 'compensation'
     where p.user_id = $1
     order by p.created_at desc, p.id desc`,
    [userId],
  );
  return (rows as unknown as OnboardingHistoryQueryRow[]).map((row) => ({
    id: Number(row.id),
    status: row.status,
    questionText: row.question_text,
    topicTerm: row.topic_term,
    tableId: row.table_id,
    createdAt: new Date(row.created_at),
    finishedAt: row.finished_at === null ? null : new Date(row.finished_at),
    netCredits: row.net_credits === null ? null : Number(row.net_credits),
    deliveryAuditAnswerId:
      row.delivery_audit_answer_id === null ? null : Number(row.delivery_audit_answer_id),
    failureSummary: row.failure_summary,
  }));
}
