// table_lane_requests store (migration 038, breadth step 5): the queue behind the
// table lane's background job. Typed create / claim / reclaim / finish-and-settle
// / read primitives. The SQL shape and the money live here (the money side
// composes the existing ledger primitives — it never invents a new debit
// reason, and never touches src/answer).
//
// Money model (mirrors src/billing/gate.ts chargeAndRun, split in two halves
// because the job runs later, outside the request):
//   - createTableLaneRequest reserves the normal 'simple' question price and
//     inserts the row in ONE transaction. A failed insert rolls the debit back
//     with it, so an orphaned charge cannot exist.
//   - finishTableLaneRequest sets the terminal status and settles in ONE
//     transaction: answer keeps the price, clarification refunds down to the
//     'clarification' price, refusal / failure / give-up refunds in full. A
//     terminal row is never finished again (no double refund).
//
// The ledger request id for the debit is DERIVED from the row's request id
// (deriveAddonRequestId(requestId, 'table-lane')): the routing turn that queued
// this row was itself a question_cost debit on the raw request id (and was
// refunded), and question_cost is unique per (user_id, request_id).
import {
  compensateSplitInTx,
  deriveAddonRequestId,
  getActionClassPrice,
  getCurrentGrantId,
  getSpendableBalance,
  QUESTION_DEBIT,
  splitDebit,
  type SplitDebitResult,
} from '../billing/ledger.ts';
import type { TableLaneChoice } from '../answer/table-lane/types.ts';
import type { Db, QueryResultRow } from '../db/types.ts';

export type { TableLaneChoice };

export type TableLaneStatus = 'pending' | 'running' | 'done' | 'failed';
export type TableLaneOutcomeKind = 'answer' | 'clarification' | 'refusal';

/** A running row untouched for this long is presumed dead (a crashed or
 * timed-out job invocation) and may be claimed again. */
export const TABLE_LANE_STALE_MS = 5 * 60 * 1000;
/** A row is attempted at most this many times; the job fails the rest. */
export const TABLE_LANE_MAX_ATTEMPTS = 2;

export interface TableLaneRow {
  id: number;
  userId: string;
  requestId: string;
  threadId: number | null;
  lang: 'nl' | 'en';
  question: string;
  tableId: string;
  finderConfidence: number;
  /** Set for a button reply / follow-up that continues an earlier lane row. */
  parentId: number | null;
  /** Follow-up context (Task 7). */
  previousQuestion: string | null;
  /** Accumulated reader answers to breakdown/region questions. */
  choices: TableLaneChoice[];
  status: TableLaneStatus;
  attempts: number;
  /** The credit_transactions leg of the question debit. NULL when the Pro
   * monthly bucket paid the whole price (the bucket leg is recorded in the
   * row's debit_bucket_entry_id; migration 038 header explains why). */
  debitTransactionId: number | null;
  auditId: number | null;
  outcomeKind: TableLaneOutcomeKind | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  failureSummary: string | null;
}

interface RawRow extends QueryResultRow {
  id: number | string;
  user_id: string;
  request_id: string;
  thread_id: number | string | null;
  lang: 'nl' | 'en';
  question: string;
  table_id: string;
  finder_confidence: number | string;
  parent_id: number | string | null;
  previous_question: string | null;
  choices: unknown;
  status: TableLaneStatus;
  attempts: number | string;
  debit_transaction_id: number | string | null;
  debit_bucket_entry_id: number | string | null;
  debit_from_bucket: number | string;
  debit_from_ledger: number | string;
  audit_id: number | string | null;
  outcome_kind: TableLaneOutcomeKind | null;
  failure_summary: string | null;
  created_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
}

const numOrNull = (v: number | string | null): number | null => (v === null ? null : Number(v));
const dateOrNull = (v: string | Date | null): Date | null => (v === null ? null : new Date(v));

function parseChoices(value: unknown): TableLaneChoice[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((c) => ({
    dimension: String((c as TableLaneChoice).dimension),
    code: String((c as TableLaneChoice).code),
  }));
}

function fromRow(row: QueryResultRow): TableLaneRow {
  const r = row as RawRow;
  return {
    id: Number(r.id),
    userId: r.user_id,
    requestId: r.request_id,
    threadId: numOrNull(r.thread_id),
    lang: r.lang,
    question: r.question,
    tableId: r.table_id,
    finderConfidence: Number(r.finder_confidence),
    parentId: numOrNull(r.parent_id),
    previousQuestion: r.previous_question,
    choices: parseChoices(r.choices),
    status: r.status,
    attempts: Number(r.attempts),
    debitTransactionId: numOrNull(r.debit_transaction_id),
    auditId: numOrNull(r.audit_id),
    outcomeKind: r.outcome_kind,
    createdAt: new Date(r.created_at),
    startedAt: dateOrNull(r.started_at),
    finishedAt: dateOrNull(r.finished_at),
    failureSummary: r.failure_summary,
  };
}

/** The debit split recorded on a row, rebuilt for the ledger's refund
 * primitives (the exact inverse of what createTableLaneRequest took). */
function splitFromRow(r: RawRow): SplitDebitResult {
  return {
    fromBucket: Number(r.debit_from_bucket),
    fromLedger: Number(r.debit_from_ledger),
    bucketEntry: r.debit_bucket_entry_id === null ? null : { id: Number(r.debit_bucket_entry_id) },
    ledgerEntry: r.debit_transaction_id === null ? null : { id: Number(r.debit_transaction_id) },
  };
}

export type CreateTableLaneResult =
  | { kind: 'created'; row: TableLaneRow }
  | { kind: 'duplicate'; row: TableLaneRow } // same (user_id, request_id) — idempotent
  | { kind: 'insufficient'; balance: number; required: number };

export interface CreateTableLaneInput {
  userId: string;
  requestId: string;
  threadId: number | null;
  lang: 'nl' | 'en';
  question: string;
  tableId: string;
  finderConfidence: number;
  parentId?: number | null;
  previousQuestion?: string | null;
  choices?: TableLaneChoice[];
}

/** Reserves the normal question price and queues the row, atomically.
 *
 * Composes the ledger primitives inline (advisory lock, spendable balance,
 * splitDebit) instead of calling reserveDebit, for the same reason
 * triggerOnboarding does: withTransaction cannot nest, and reserveDebit opens
 * its own. Doing it in one transaction is stronger than debit-then-compensate:
 * a failed row insert (e.g. a bad thread id) rolls the debit back with it, so
 * there is no window in which credits are held without a row. The Pro bucket
 * is spent first, exactly like chargeAndRun's debit. */
export async function createTableLaneRequest(db: Db, input: CreateTableLaneInput): Promise<CreateTableLaneResult> {
  const required = await getActionClassPrice(db, 'simple');
  const ledgerRequestId = deriveAddonRequestId(input.requestId, 'table-lane');
  return db.withTransaction(async (tx): Promise<CreateTableLaneResult> => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [input.userId]);

    // Idempotent retry: report the existing row before any balance check, so a
    // duplicate is never turned into "insufficient" by the first charge itself.
    const existing = await tx.query('select * from table_lane_requests where user_id = $1 and request_id = $2', [
      input.userId,
      input.requestId,
    ]);
    if (existing.rows[0] !== undefined) return { kind: 'duplicate', row: fromRow(existing.rows[0]) };

    const grantId = await getCurrentGrantId(tx, input.userId);
    const balance = await getSpendableBalance(tx, input.userId, grantId);
    if (balance < required) return { kind: 'insufficient', balance, required };

    const split = await splitDebit(tx, input.userId, ledgerRequestId, required, QUESTION_DEBIT, 'table-lane debit', grantId);
    if (split.bucketEntry === null && split.ledgerEntry === null) {
      // A debit under this derived id exists but no row does. Create writes the
      // debit and the row in one transaction, so the only way here is
      // retention: it hard-deletes finished rows while the ledger keeps the
      // debit, and the same (user, requestId) was then resubmitted. That is a
      // client retry after a history deletion; fail safe (no charge, no job)
      // rather than run the job for an already-settled charge.
      throw new Error(`table-lane debit ${ledgerRequestId} already exists without a request row`);
    }

    const { rows } = await tx.query(
      `insert into table_lane_requests
         (user_id, request_id, thread_id, lang, question, table_id, finder_confidence,
          parent_id, previous_question, choices,
          debit_transaction_id, debit_bucket_entry_id, debit_from_bucket, debit_from_ledger)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
       returning *`,
      [
        input.userId,
        input.requestId,
        input.threadId,
        input.lang,
        input.question,
        input.tableId,
        input.finderConfidence,
        input.parentId ?? null,
        input.previousQuestion ?? null,
        JSON.stringify(input.choices ?? []),
        split.ledgerEntry?.id ?? null,
        split.bucketEntry?.id ?? null,
        split.fromBucket,
        split.fromLedger,
      ],
    );
    return { kind: 'created', row: fromRow(rows[0]!) };
  });
}

/** Claims exactly one row for the job: the oldest `pending` row, or a `running`
 * row whose attempt went stale (started_at older than TABLE_LANE_STALE_MS) and
 * has attempts left. FOR UPDATE SKIP LOCKED makes concurrent job invocations
 * safe — they never claim the same row. Returns null when nothing is
 * claimable. A stale row that has used up TABLE_LANE_MAX_ATTEMPTS is NOT
 * returned here; findExhaustedTableLaneRequests lists those so the job can
 * fail and refund them. */
export async function claimTableLaneRequest(db: Db, now: Date = new Date()): Promise<TableLaneRow | null> {
  const { rows } = await db.query(
    `update table_lane_requests
        set status = 'running', started_at = $1::timestamptz, attempts = attempts + 1
      where id = (
        select id from table_lane_requests
         where status = 'pending'
            or (status = 'running'
                and started_at < $1::timestamptz - ($2::int * interval '1 millisecond')
                and attempts < $3::int)
         order by created_at, id
         limit 1
         for update skip locked
      )
      returning *`,
    [now.toISOString(), TABLE_LANE_STALE_MS, TABLE_LANE_MAX_ATTEMPTS],
  );
  return rows[0] === undefined ? null : fromRow(rows[0]);
}

/** Stale `running` rows that have already used every attempt. They are not
 * claimable; the job finishes each with `failed` (audited refusal + full
 * refund) so a paid question never silently disappears. */
export async function findExhaustedTableLaneRequests(db: Db, now: Date = new Date()): Promise<TableLaneRow[]> {
  const { rows } = await db.query(
    `select * from table_lane_requests
      where status = 'running'
        and started_at < $1::timestamptz - ($2::int * interval '1 millisecond')
        and attempts >= $3::int
      order by created_at, id`,
    [now.toISOString(), TABLE_LANE_STALE_MS, TABLE_LANE_MAX_ATTEMPTS],
  );
  return rows.map(fromRow);
}

/** Takes ownership of ONE row findExhaustedTableLaneRequests listed, before
 * the job writes its give-up audit (fix round 1, Important 1): moves its
 * stale clock to `now` only while it is still `running`, stale, at exactly
 * `expectedAttempts` and at the cap. A concurrent job invocation that listed
 * the same row then gets null here and skips it — so the give-up is audited
 * once. `attempts` is NOT incremented (the row never runs again; the finish
 * fences on this same value). Returns the owned row, or null. */
export async function claimExhaustedTableLaneRequest(
  db: Db,
  rowId: number,
  expectedAttempts: number,
  now: Date = new Date(),
): Promise<TableLaneRow | null> {
  const { rows } = await db.query(
    `update table_lane_requests
        set started_at = $3::timestamptz
      where id = $1 and status = 'running' and attempts = $2 and attempts >= $5::int
        and started_at < $3::timestamptz - ($4::int * interval '1 millisecond')
      returning *`,
    [rowId, expectedAttempts, now.toISOString(), TABLE_LANE_STALE_MS, TABLE_LANE_MAX_ATTEMPTS],
  );
  return rows[0] === undefined ? null : fromRow(rows[0]);
}

/** Puts a `running` row back to `pending` after a transient failure, keeping
 * the summary for the operator. `attempts` is left as is (the next claim adds
 * one). Throws unless the row is `running` with exactly `expectedAttempts`
 * (fencing: a superseded, since-reclaimed invocation must not release the
 * row), and throws when the row has already used TABLE_LANE_MAX_ATTEMPTS: the
 * caller must then finish it as `failed` (refund + audited refusal), so no row
 * is ever attempted more than the cap while the reader's credits are held. */
export async function releaseForRetry(
  db: Db,
  rowId: number,
  expectedAttempts: number,
  summary: string,
): Promise<void> {
  if (expectedAttempts >= TABLE_LANE_MAX_ATTEMPTS) {
    throw new Error(
      `table-lane row ${rowId} has used ${expectedAttempts} of ${TABLE_LANE_MAX_ATTEMPTS} attempts; finish it as failed instead of releasing it`,
    );
  }
  const { rows } = await db.query(
    `update table_lane_requests
        set status = 'pending', failure_summary = $3
      where id = $1 and status = 'running' and attempts = $2
      returning id`,
    [rowId, expectedAttempts, summary],
  );
  if (rows[0] === undefined) {
    throw new Error(`table-lane row ${rowId} is not running at attempt ${expectedAttempts}; cannot release it for retry`);
  }
}

export type TableLaneOutcome =
  | { kind: TableLaneOutcomeKind; auditId: number | null }
  | { kind: 'failed'; summary: string; auditId: number | null };

/** Ends a `running` row and settles the question price, in ONE transaction:
 *   answer         -> row done, price kept
 *   clarification  -> row done, refund down to the 'clarification' price
 *   refusal        -> row done, full refund
 *   failed         -> row failed (+ failure_summary), full refund
 * Refunds go bucket first (the inverse of the debit's order), each capped at
 * what that leg actually took. If the settlement throws, the transaction rolls
 * back and the row stays `running`. Throws when the row is unknown, not
 * `running` (already finished, or never claimed), or not at `expectedAttempts`
 * (a superseded invocation), settling nothing — the
 * ledger's one-compensation-per-debit index is only the backstop behind this
 * check. */
export async function finishTableLaneRequest(
  db: Db,
  rowId: number,
  expectedAttempts: number,
  outcome: TableLaneOutcome,
): Promise<void> {
  await db.withTransaction(async (tx) => {
    const locked = await tx.query('select * from table_lane_requests where id = $1 for update', [rowId]);
    const raw = locked.rows[0] as RawRow | undefined;
    if (raw === undefined) throw new Error(`table-lane row ${rowId} does not exist`);
    if (raw.status !== 'running') {
      throw new Error(`table-lane row ${rowId} is ${raw.status}, not running; refusing to finish or settle it again`);
    }
    // Fencing: only the invocation that holds the CURRENT attempt may finish. A
    // superseded (stale, reclaimed) invocation throws here, before it settles.
    if (Number(raw.attempts) !== expectedAttempts) {
      throw new Error(
        `table-lane row ${rowId} is at attempt ${Number(raw.attempts)}, not ${expectedAttempts}; a newer invocation owns it`,
      );
    }
    const split = splitFromRow(raw);
    const paid = split.fromBucket + split.fromLedger;

    let refund = 0;
    if (outcome.kind === 'clarification') {
      // Never charge more than was debited: only ever a refund, by construction.
      refund = Math.max(0, paid - (await getActionClassPrice(tx, 'clarification')));
    } else if (outcome.kind === 'refusal' || outcome.kind === 'failed') {
      refund = paid;
    }
    if (refund > 0) await compensateSplitInTx(tx, raw.user_id, split, refund, outcome.auditId);

    await tx.query(
      `update table_lane_requests
          set status = $2, outcome_kind = $3, audit_id = $4, failure_summary = $5, finished_at = now()
        where id = $1`,
      [
        rowId,
        outcome.kind === 'failed' ? 'failed' : 'done',
        outcome.kind === 'failed' ? null : outcome.kind,
        outcome.auditId,
        outcome.kind === 'failed' ? outcome.summary : raw.failure_summary,
      ],
    );
  });
}

/** Ruling R3: records the thread the job attached this row's answer to
 * (the row's own thread, or the one attachOrCreateThread just created for a
 * first question in a new chat), so the poll can hand it to the client and
 * child rows (button replies, follow-ups) inherit it. Never moves a row to a
 * DIFFERENT thread: a row that already carries another thread id throws, and
 * writing the thread it already has is a no-op. */
export async function setTableLaneThread(db: Db, rowId: number, threadId: number): Promise<void> {
  const { rows } = await db.query(
    `update table_lane_requests set thread_id = $2
      where id = $1 and (thread_id is null or thread_id = $2)
      returning id`,
    [rowId, threadId],
  );
  if (rows[0] === undefined) {
    throw new Error(`table-lane row ${rowId} is unknown or already belongs to another thread; not setting thread ${threadId}`);
  }
}

/** One row, only for its owner (the poll reads through this): another user's
 * row id reads as absent, indistinguishable from an unknown id. */
export async function readTableLaneRequest(db: Db, rowId: number, userId: string): Promise<TableLaneRow | null> {
  const { rows } = await db.query('select * from table_lane_requests where id = $1 and user_id = $2', [rowId, userId]);
  return rows[0] === undefined ? null : fromRow(rows[0]);
}

/** Task 5 (pollTableLane): what this row's question debit has settled to —
 * the debit it took (bucket + ledger legs, as recorded on the row) minus every
 * compensation that reversed either leg. The same debit-minus-compensations
 * arithmetic chargeAndRun's netCost mirrors, read back from the ledgers
 * because the settlement happened later, in the job. Scoped to the owner:
 * another user's row or an unknown id reads as null. */
export async function readTableLaneNetCost(db: Db, rowId: number, userId: string): Promise<number | null> {
  const { rows } = await db.query(
    `select
       r.debit_from_bucket + r.debit_from_ledger
       - coalesce((
           select sum(c.delta) from credit_transactions c
            where r.debit_transaction_id is not null
              and c.related_transaction_id = r.debit_transaction_id
              and c.reason = 'compensation'
         ), 0)
       - coalesce((
           select sum(b.delta) from pro_bucket_ledger b
            where r.debit_bucket_entry_id is not null
              and b.related_entry_id = r.debit_bucket_entry_id
              and b.reason = 'compensation'
         ), 0) as net
     from table_lane_requests r
     where r.id = $1 and r.user_id = $2`,
    [rowId, userId],
  );
  return rows[0] === undefined ? null : Number(rows[0].net);
}

/** Task 5: the audited response (the stored envelope, as jsonb) and the thread
 * the job attached it to, for a row's audit id — owner-scoped: another user's
 * audit row or an unknown id reads as null. The job attaches the thread AFTER
 * settling, so `threadId` can briefly be null on a row that is already done. */
export async function readTableLaneAuditResult(
  db: Db,
  auditId: number,
  userId: string,
): Promise<{ response: unknown; threadId: number | null } | null> {
  const { rows } = await db.query('select response, thread_id from audit_answers where id = $1 and user_id = $2', [
    auditId,
    userId,
  ]);
  const row = rows[0];
  if (row === undefined) return null;
  const response = typeof row.response === 'string' ? JSON.parse(row.response) : row.response;
  return { response, threadId: numOrNull(row.thread_id as number | string | null) };
}

/** Task 5 (replyToTableLane): ALL stored members of one dimension of a table,
 * from `dimension_labels` (the job's registerSchemaOnly wrote CBS's full code
 * lists there), in CBS order. A typed or clicked reply is checked against
 * this full list — never only the options a question showed. */
export async function readTableLaneDimensionMembers(
  db: Db,
  tableId: string,
  dimension: string,
): Promise<{ code: string; title: string }[]> {
  const { rows } = await db.query(
    `select code, label from dimension_labels
      where table_id = $1 and dimension = $2
      order by sort_index nulls last, code`,
    [tableId, dimension],
  );
  return rows.map((r) => ({ code: String(r.code), title: String(r.label) }));
}
