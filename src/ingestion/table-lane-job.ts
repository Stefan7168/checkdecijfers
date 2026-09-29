// The table lane's background job (breadth step 5, Task 4; spec
// docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md D5). One
// invocation drains the table_lane_requests queue (src/ingestion/
// table-lane-store.ts) until it is empty or the time budget is spent. Per
// claimed row:
//   1. load the table's live CBS schema + code lists (once — registration
//      reuses them),
//   2. registerSchemaOnly (layout only; a refusal → table_lane_ineligible),
//   3. planTableLane (the table-scoped parse + every safety gate),
//   4. a fetch plan → ensureSlice, OUTSIDE any lock (retry once after 2 s on
//      a CBS fetch failure; then a < 24 h cached slice, else cbs_unreachable),
//   5. respondTableLane → exactly ONE audited response,
//   6. attach it to the reader's thread (Ruling R3: the thread id is written
//      back onto the row),
//   7. finishTableLaneRequest → terminal status + settlement in one
//      transaction (answer keeps the price, clarification refunds down to the
//      clarification price, refusal / failure refunds in full).
// A thrown error in 1–5 releases the row for one retry; the last attempt
// gives up with an audited `table_lane_failed` refusal + full refund, so a
// paid question never silently disappears.
//
// Principle (b): this job (the route handler that runs it) is the ONLY place
// the table lane contacts CBS. Principle (c): every non-answer is a typed
// refusal or a question. The #336 (1) rule: ensureSlice / registerSchemaOnly
// are never called while resolveIntent's shared per-table lock is held — they
// run strictly before respondTableLane (whose runQuery takes that lock).
//
// Logs never contain the question text (GDPR): row id, table id, attempt and
// the error's class name only. The full error text goes to the row's
// failure_summary (the same table that already holds the question).
import type { AuditedRespondOptions, AuditedResponse } from '../answer/audit/respond-audited.ts';
import type { LlmClient } from '../answer/llm/client.ts';
import { planTableLane, type TableLanePlan } from '../answer/table-lane/plan.ts';
import { respondTableLane, type RespondTableLaneInput } from '../answer/table-lane/respond.ts';
import type { TableLaneTable } from '../answer/table-lane/types.ts';
import type { CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { attachOrCreateThread } from '../threads/index.ts';
import { fetchAllCodeLists } from './pipeline.ts';
import { ensureSlice, registerSchemaOnly, sliceFilterKey, type SliceRequest } from './slice-cache.ts';
import {
  claimTableLaneRequest,
  findExhaustedTableLaneRequests,
  finishTableLaneRequest,
  releaseForRetry,
  setTableLaneThread,
  TABLE_LANE_MAX_ATTEMPTS,
  type TableLaneRow,
} from './table-lane-store.ts';

/** Stop claiming new rows after this long (the route's maxDuration is 300 s;
 * one row can take tens of seconds — CBS fetch + parse + compose). */
export const TABLE_LANE_JOB_BUDGET_MS = 240_000;
/** Settled choice 2: one retry of a CBS fetch failure, after this pause. */
export const TABLE_LANE_CBS_RETRY_MS = 2_000;
/** Settled choice 1: a stored slice confirmed within this window may answer
 * when CBS is unreachable. **Assumption** — mirrors the curated daily sync. */
export const TABLE_LANE_CACHED_SLICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface TableLaneJobDeps {
  db: Db;
  source: CbsSource;
  /** The table-parse client (the parser's own model constant lives in tableParse). */
  parseClient: LlmClient;
  /** Compose / semantic-check / translate clients for one row's language —
   * built by the route exactly like a live chat turn's. */
  respondOptions: (lang: 'nl' | 'en') => AuditedRespondOptions;
  /** YYYY-MM-DD, 'today' in the product's timezone. */
  referenceDate: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Default TABLE_LANE_JOB_BUDGET_MS — stop claiming new rows after this. */
  budgetMs?: number;
}

export interface TableLaneJobSummary {
  /** Rows handled this invocation (a claim, or an exhausted row finished). A
   * row retried within the same invocation counts once per claim. */
  processed: number;
  answered: number;
  asked: number;
  refused: number;
  failed: number;
}

type RowResult = 'answer' | 'clarification' | 'refusal' | 'failed' | 'retry' | 'error';

interface Ctx {
  deps: TableLaneJobDeps;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorSummary(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** One log line per failure — row id + table id (+ attempt, error class);
 * never the question, never the error message (it may quote model output). */
function logFailure(row: TableLaneRow, what: string, error: unknown): void {
  console.error(
    `table-lane-job: row ${row.id} table ${row.tableId} attempt ${row.attempts}: ${what} (${errorName(error)})`,
  );
}

/** The live schema + every dimension's code list, fetched once per row. */
async function loadTable(source: CbsSource, tableId: string): Promise<TableLaneTable> {
  const schema = await source.fetchTableSchema(tableId);
  const codeLists = await fetchAllCodeLists(source, tableId, schema.dimensions);
  return { schema, codeLists };
}

function refusePlan(
  reason: 'table_lane_ineligible' | 'table_lane_failed',
  detail: string,
  from?: TableLanePlan,
): TableLanePlan {
  return { kind: 'refuse', reason, detail, parse: from?.parse ?? null, parseAudit: from?.parseAudit ?? null };
}

type SliceOutcome =
  | { kind: 'stored'; fetch: NonNullable<RespondTableLaneInput['fetch']> }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'ineligible'; detail: string };

/** Step 4. Never called under a lock: ensureSlice takes the EXCLUSIVE
 * per-table lock itself, and this job holds no transaction around it. */
async function ensureWithFallback(ctx: Ctx, tableId: string, slice: SliceRequest): Promise<SliceOutcome> {
  const { db, source } = ctx.deps;
  let result = await ensureSlice(db, source, tableId, slice);
  if (!result.ok && result.stage === 'fetch') {
    // Settled choice 2: a transient outage, or CBS briefly serving an older
    // 'Modified' — one retry after a short pause.
    await ctx.sleep(TABLE_LANE_CBS_RETRY_MS);
    result = await ensureSlice(db, source, tableId, slice);
  }
  if (result.ok) return { kind: 'stored', fetch: { ok: true, filterKey: result.filterKey, fromCache: false } };
  if (result.stage === 'fetch') {
    // Settled choice 1: answer from this exact slice only when it was
    // confirmed against CBS within the last 24 h. The answer is dated by the
    // row's own checked_at (the query layer already shows it).
    const filterKey = sliceFilterKey(slice);
    const since = new Date(ctx.now().getTime() - TABLE_LANE_CACHED_SLICE_MAX_AGE_MS).toISOString();
    const cached = await db.query(
      `select 1 from slice_fetches
        where table_id = $1 and filter_key = $2 and checked_at > $3::timestamptz`,
      [tableId, filterKey, since],
    );
    if (cached.rows.length > 0) return { kind: 'stored', fetch: { ok: true, filterKey, fromCache: true } };
    return { kind: 'unreachable', detail: result.summary };
  }
  return { kind: 'ineligible', detail: `${result.stage}: ${result.summary}` };
}

/** Steps 1–5 for one claimed row: exactly one audited response. Throws on
 * anything unexpected (the caller retries or gives up). `seen` receives the
 * table title and the plan as soon as they exist, so a give-up after them
 * still names the table and records the parse. */
async function produce(
  ctx: Ctx,
  row: TableLaneRow,
  seen: { title: string | null; plan: TableLanePlan | null },
): Promise<AuditedResponse> {
  const { db, source, parseClient, referenceDate } = ctx.deps;
  const table = await loadTable(source, row.tableId);
  seen.title = table.schema.title;
  const respond = (extra: Pick<RespondTableLaneInput, 'plan' | 'fetch' | 'refusalOverride' | 'startedAt'>) =>
    respondTableLane(db, {
      row,
      referenceDate,
      respondOptions: ctx.deps.respondOptions(row.lang),
      tableTitle: table.schema.title,
      ...extra,
    });

  const registered = await registerSchemaOnly(db, source, row.tableId, table);
  if (!registered.ok) {
    // registered_as_full cannot occur (the finder never routes a held
    // table); if it does, it is refused the same way.
    return respond({ plan: refusePlan('table_lane_ineligible', `${registered.reason}: ${registered.summary}`), fetch: null });
  }

  const startedAt = performance.now();
  const plan = await planTableLane({
    question: row.question,
    previousQuestion: row.previousQuestion,
    table,
    choices: row.choices,
    referenceDate,
    client: parseClient,
  });
  seen.plan = plan;
  if (plan.kind !== 'fetch') return respond({ plan, fetch: null, startedAt });

  const slice = await ensureWithFallback(ctx, row.tableId, plan.slice);
  switch (slice.kind) {
    case 'stored':
      return respond({ plan, fetch: slice.fetch, startedAt });
    case 'unreachable':
      return respond({ plan, fetch: null, refusalOverride: { reason: 'cbs_unreachable', detail: slice.detail }, startedAt });
    case 'ineligible':
      return respond({ plan: refusePlan('table_lane_ineligible', slice.detail, plan), fetch: null, startedAt });
  }
}

/** Ruling R3: attach the audited response to the row's thread (creating one
 * for a first question in a new chat) and write the thread id back. A failed
 * attach never blocks the settlement: the answer stays audited, threadless
 * (the same degrade actions.ts uses). */
async function attachThread(ctx: Ctx, row: TableLaneRow, auditId: number, existingThreadId: number | null): Promise<void> {
  const { db } = ctx.deps;
  try {
    const threadId = existingThreadId ?? (await attachOrCreateThread(db, row.userId, row.threadId, auditId));
    await setTableLaneThread(db, row.id, threadId);
  } catch (error) {
    logFailure(row, 'thread attach failed (answer kept, threadless)', error);
  }
}

function resultOf(kind: string, refusalReason: string | null): 'answer' | 'clarification' | 'refusal' | 'failed' {
  if (kind === 'answer' || kind === 'clarification') return kind;
  return refusalReason === 'table_lane_failed' ? 'failed' : 'refusal';
}

/** Steps 6–7: thread + settlement for an audited response. */
async function deliver(ctx: Ctx, row: TableLaneRow, audited: AuditedResponse, failureSummary: string | null): Promise<RowResult> {
  const response = audited.response;
  const result = resultOf(response.kind, response.kind === 'refusal' ? response.reason : null);
  if (audited.auditId !== null) await attachThread(ctx, row, audited.auditId, null);
  await finishTableLaneRequest(
    ctx.deps.db,
    row.id,
    row.attempts,
    result === 'failed'
      ? { kind: 'failed', summary: failureSummary ?? 'table-lane: gave up', auditId: audited.auditId }
      : { kind: result, auditId: audited.auditId },
  );
  return result;
}

/** The lane audit row an earlier attempt of THIS row already wrote (a crash
 * between the audit write and the settlement), if any. Matched on the row's
 * own id in the envelope — the routing turn's audit row shares the request
 * id but carries no `tableLane`. */
async function findLaneAudit(
  db: Db,
  row: TableLaneRow,
): Promise<{ id: number; kind: string; refusalReason: string | null; threadId: number | null } | null> {
  if (!UUID.test(row.requestId)) return null; // audit_answers.request_id is a uuid: nothing can match
  const { rows } = await db.query(
    `select id, kind, refusal_reason, thread_id from audit_answers
      where user_id = $1 and request_id = $2::uuid and response->'tableLane'->>'rowId' = $3
      order by id desc limit 1`,
    [row.userId, row.requestId, String(row.id)],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: Number(r.id),
    kind: String(r.kind),
    refusalReason: (r.refusal_reason as string | null) ?? null,
    threadId: r.thread_id === null || r.thread_id === undefined ? null : Number(r.thread_id),
  };
}

/** Settles a row from an audit row an earlier attempt wrote — never a second
 * audited response for the same row, never a refund of a delivered answer. */
async function finishFromAudit(
  ctx: Ctx,
  row: TableLaneRow,
  audit: NonNullable<Awaited<ReturnType<typeof findLaneAudit>>>,
): Promise<RowResult> {
  const result = resultOf(audit.kind, audit.refusalReason);
  await attachThread(ctx, row, audit.id, audit.threadId);
  await finishTableLaneRequest(
    ctx.deps.db,
    row.id,
    row.attempts,
    result === 'failed'
      ? { kind: 'failed', summary: row.failureSummary ?? 'table-lane: gave up', auditId: audit.id }
      : { kind: result, auditId: audit.id },
  );
  return result;
}

/** The give-up: ONE audited `table_lane_failed` refusal + full refund. The
 * plan is a minimal refusal (only the parse + its audit carried over, so the
 * spend stays recorded) — none of the plan-derived envelope fields that could
 * have thrown the first time are rebuilt. */
async function giveUp(
  ctx: Ctx,
  row: TableLaneRow,
  summary: string,
  seen: { title: string | null; plan: TableLanePlan | null },
): Promise<RowResult> {
  const { db, referenceDate } = ctx.deps;
  const earlier = await findLaneAudit(db, row);
  if (earlier !== null) return finishFromAudit(ctx, row, earlier);
  const detail = `gave up after ${row.attempts} attempt(s): ${summary}`;
  const audited = await respondTableLane(db, {
    row,
    plan: refusePlan('table_lane_failed', detail, seen.plan ?? undefined),
    fetch: null,
    refusalOverride: { reason: 'table_lane_failed', detail },
    referenceDate,
    respondOptions: ctx.deps.respondOptions(row.lang),
    tableTitle: seen.title,
  });
  return deliver(ctx, row, audited, summary);
}

async function processClaimed(ctx: Ctx, row: TableLaneRow): Promise<RowResult> {
  const seen: { title: string | null; plan: TableLanePlan | null } = { title: null, plan: null };
  try {
    const earlier = await findLaneAudit(ctx.deps.db, row);
    if (earlier !== null) return await finishFromAudit(ctx, row, earlier);
    const audited = await produce(ctx, row, seen);
    return await deliver(ctx, row, audited, null);
  } catch (error) {
    logFailure(row, 'failed', error);
    const summary = errorSummary(error);
    try {
      if (row.attempts < TABLE_LANE_MAX_ATTEMPTS) {
        await releaseForRetry(ctx.deps.db, row.id, row.attempts, summary);
        return 'retry';
      }
      return await giveUp(ctx, row, summary, seen);
    } catch (finalError) {
      // The row stays `running`; once stale it is reclaimed, or (at the cap)
      // listed by findExhaustedTableLaneRequests and given up again.
      logFailure(row, 'could not release or give up (row left running)', finalError);
      return 'error';
    }
  }
}

function tally(summary: TableLaneJobSummary, result: RowResult): void {
  if (result === 'answer') summary.answered += 1;
  else if (result === 'clarification') summary.asked += 1;
  else if (result === 'refusal') summary.refused += 1;
  else if (result === 'failed') summary.failed += 1;
}

export async function runTableLaneJob(deps: TableLaneJobDeps): Promise<TableLaneJobSummary> {
  const ctx: Ctx = {
    deps,
    now: deps.now ?? (() => new Date()),
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  const budgetMs = deps.budgetMs ?? TABLE_LANE_JOB_BUDGET_MS;
  const startedAt = ctx.now().getTime();
  const summary: TableLaneJobSummary = { processed: 0, answered: 0, asked: 0, refused: 0, failed: 0 };

  // Rows a crashed invocation left running at the attempt cap: fail + refund
  // each (per-row isolation — one bad row never wedges the queue).
  for (const row of await findExhaustedTableLaneRequests(deps.db, ctx.now())) {
    summary.processed += 1;
    try {
      tally(summary, await giveUp(ctx, row, row.failureSummary ?? 'the job stopped before finishing (stale)', { title: null, plan: null }));
    } catch (error) {
      logFailure(row, 'exhausted row could not be failed + refunded (retried next run)', error);
    }
  }

  while (ctx.now().getTime() - startedAt < budgetMs) {
    const row = await claimTableLaneRequest(deps.db, ctx.now());
    if (row === null) break;
    summary.processed += 1;
    tally(summary, await processClaimed(ctx, row));
  }
  return summary;
}
