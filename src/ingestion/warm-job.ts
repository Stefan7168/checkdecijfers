// The warm job (ADR 065 step 2; design 2026-09-30-one-route-warm-slices-design.md
// D1, D2, D4, D6): fills and refreshes a PINNED slice-cache table's declared scope
// (cbs_tables.slice) through bounded slice requests — each one validated, stored
// and dated by the slice store's own machinery (ensureSlice / fetchSlice), never a
// second write path. One CBS schema read per table per run (precheckSliceSchema);
// every planned request still runs the full per-request checks.
//
// Expected failures (CBS unreachable, a timeout, a validation refusal, a planning
// refusal) are RESULTS, never throws; only programming/database errors throw.
import type { CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { BUDGET_ENDED_PHRASE } from '../sources/fetch-with-timeout.ts';
import { CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../sources/registry.ts';
import { lagOfPeriodCode } from './data-end-lag.ts';
import { failBatch } from './pipeline.ts';
import { ensureSlice, precheckSliceSchema, sliceFilterKey, type SliceRequest } from './slice-cache.ts';
import { loadWarmScope, planWarmSlices, type WarmPlan } from './warm-plan.ts';

/** Most cells per warm request. CBS latency is per request, not per cell
 * (measured 2026-09-30), so the job asks for fewer, bigger slices than a
 * reader's question may (SLICE_MAX_CELLS). The planner's filter-length cap still
 * bounds every request's address. */
export const WARM_MAX_CELLS = 25_000;

export interface WarmTableResult {
  tableId: string;
  outcome: 'complete' | 'partial' | 'failed' | 'skipped';
  /** Requests in the plan. */
  planned: number;
  /** Stored or re-fetched this run. */
  fetched: number;
  /** Already stored and still current (no data request made). */
  confirmed: number;
  /** Planned requests not done in this run (not reached before the deadline,
   * or — on a failure — the failed request and everything after it). */
  remaining: number;
  failure?: { stage: string; summary: string; quarantined: boolean };
  skippedReason?: string;
}

interface WarmOptions {
  /** Epoch ms: no new request (or table) starts at or after this moment. */
  deadline: number;
  now?: () => number;
}

/** True when a failure summary says the request was cut, or refused to start, because the run's time
 * budget was spent (the adapter's `stopAt`). That is "not done, the next run continues" — not a failure of
 * CBS or of the data. A cut request stored nothing (fetchSlice keeps every page in memory and writes only
 * after all of them arrived and passed every check), so no partial request can be served. */
function endedByBudget(summary: string): boolean {
  return summary.includes(BUDGET_ENDED_PHRASE);
}

function skipped(tableId: string, reason: string): WarmTableResult {
  return { tableId, outcome: 'skipped', planned: 0, fetched: 0, confirmed: 0, remaining: 0, skippedReason: reason };
}

async function isQuarantined(db: Db, tableId: string): Promise<boolean> {
  const row = (await db.query('select status from cbs_tables where id = $1', [tableId])).rows[0];
  return row?.status === 'needs_review';
}

function toTime(value: unknown): number | null {
  if (value == null) return null;
  const time = new Date(value as string | Date).getTime();
  return Number.isNaN(time) ? null : time;
}

/** The declared scope as a Cartesian product: the union of the plan's chunks per
 * axis (the planner chunks each axis, so this union is exactly the scope). */
function scopeAxes(plan: WarmPlan) {
  const measures = new Set<string>();
  const periods = new Set<string>();
  const members = new Map<string, Set<string>>();
  for (const req of plan.requests) {
    for (const m of req.measures) measures.add(m);
    for (const p of req.periods) periods.add(p);
    for (const [dim, codes] of Object.entries(req.members)) {
      let set = members.get(dim);
      if (!set) members.set(dim, (set = new Set()));
      for (const c of codes) set.add(c);
    }
  }
  return { measures, periods, members };
}

/** True when every coordinate of the stored request lies inside the scope:
 * every measure, every period, and every member of every dimension — and it
 * names exactly the scope's dimensions. */
function insideScope(filter: SliceRequest, axes: ReturnType<typeof scopeAxes>): boolean {
  if (!filter.measures.every((m) => axes.measures.has(m))) return false;
  if (!filter.periods.every((p) => axes.periods.has(p))) return false;
  const dims = Object.keys(filter.members);
  if (dims.length !== axes.members.size) return false;
  return dims.every((dim) => {
    const allowed = axes.members.get(dim);
    return allowed !== undefined && (filter.members[dim] ?? []).every((c) => allowed.has(c));
  });
}

type FinishResult = { ok: true; deleted: number } | { ok: false; summary: string };

/**
 * After a COMPLETE run: stamp last_sync_at and delete this table's obsolete
 * slice_fetches rows, in one transaction under the per-table lock the slice
 * writes use.
 *
 * Why deleting cannot uncover a cell: a row is deleted only when it lies
 * entirely inside the declared scope, and every cell inside the scope is covered
 * by exactly one request of the current plan — which this run just fetched or
 * confirmed, and which is re-verified below to be stored and current, against a
 * plan recomputed from the registry as it is NOW. A row outside the scope (a
 * reader's question about other coordinates) is never touched. Why no cell's
 * date gets OLDER: a cell is dated by the latest checked_at among its covering
 * rows, and a row is deleted only when its checked_at is no later than the
 * EARLIEST checked_at of the plan's rows — so the plan row that still covers
 * the cell dates it at least as late. (A reader confirmation that lands after
 * that just keeps its row until a later run.) That is why this runs only after
 * `complete`: a partial run leaves some scope cells covered only by old rows.
 */
async function finishCompleteRun(
  db: Db,
  tableId: string,
  plan: WarmPlan,
  checkTakenAt: string,
): Promise<FinishResult> {
  return db.withTransaction(async (tx): Promise<FinishResult> => {
    // Same key and bound as fetchSlice's write lock.
    await tx.query("set local lock_timeout = '180s'");
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [tableId]);

    const reg = (
      await tx.query('select ingest_mode, status, schema_cbs_modified from cbs_tables where id = $1 for update', [
        tableId,
      ])
    ).rows[0];
    if (!reg || reg.ingest_mode !== 'slice_cache' || reg.status !== 'active') {
      return { ok: false, summary: `Table "${tableId}" is no longer an active slice-cache table.` };
    }

    // The plan must still describe the scope as the registry holds it now (a
    // concurrent schema refresh could have added a period).
    const planKeys = plan.requests.map(sliceFilterKey);
    let currentKeys: string[];
    try {
      currentKeys = planWarmSlices(await loadWarmScope(tx, tableId), { maxCells: WARM_MAX_CELLS }).requests.map(
        sliceFilterKey,
      );
    } catch (err) {
      return { ok: false, summary: `The scope can no longer be planned: ${err instanceof Error ? err.message : String(err)}` };
    }
    const planKeySet = new Set(planKeys);
    if (currentKeys.length !== planKeys.length || !currentKeys.every((k) => planKeySet.has(k))) {
      return { ok: false, summary: `The table's code lists changed while the run was working; the plan is out of date.` };
    }

    const rows = (
      await tx.query('select id, filter_key, filter, cbs_modified, checked_at from slice_fetches where table_id = $1', [
        tableId,
      ])
    ).rows;
    const byKey = new Map(rows.map((r) => [r.filter_key as string, r]));
    const schemaModified = toTime(reg.schema_cbs_modified);
    let earliestPlanCheck: number | null = null;
    for (const key of planKeys) {
      const row = byKey.get(key);
      const rowModified = row ? toTime(row.cbs_modified) : null;
      const checked = row ? toTime(row.checked_at) : null;
      if (!row || checked === null || rowModified === null || (schemaModified !== null && rowModified < schemaModified)) {
        return { ok: false, summary: `A planned slice is missing or no longer current; nothing was cleaned up.` };
      }
      if (earliestPlanCheck === null || checked < earliestPlanCheck) earliestPlanCheck = checked;
    }

    const axes = scopeAxes(plan);
    const obsolete: number[] = [];
    for (const row of rows) {
      if (planKeySet.has(row.filter_key as string)) continue;
      const filter = (typeof row.filter === 'string' ? JSON.parse(row.filter) : row.filter) as SliceRequest;
      const checked = toTime(row.checked_at);
      if (checked === null || earliestPlanCheck === null || checked > earliestPlanCheck) continue;
      if (insideScope(filter, axes)) obsolete.push(Number(row.id));
    }
    if (obsolete.length > 0) {
      await tx.query('delete from slice_fetches where id = any($1::bigint[])', [obsolete]);
    }

    // The time the run's CBS check was taken — never a later now(), which
    // would claim a confirmation CBS did not give. greatest(): never backwards.
    await tx.query('update cbs_tables set last_sync_at = greatest(last_sync_at, $2::timestamptz) where id = $1', [
      tableId,
      checkTakenAt,
    ]);
    return { ok: true, deleted: obsolete.length };
  });
}

/**
 * Fills and refreshes one pinned slice-cache table's declared scope. Only for
 * `ingest_mode = 'slice_cache'`, `pinned`, `status = 'active'`; anything else is
 * skipped with the reason (a whole-table table is never converted here).
 */
export async function warmTable(
  db: Db,
  source: CbsSource,
  tableId: string,
  opts: WarmOptions,
): Promise<WarmTableResult> {
  const now = opts.now ?? Date.now;

  const reg = (
    await db.query('select ingest_mode, pinned, status, needs_review_reason from cbs_tables where id = $1', [tableId])
  ).rows[0];
  if (!reg) return skipped(tableId, 'not registered');
  if (reg.ingest_mode !== 'slice_cache') {
    return skipped(tableId, 'whole-table table (ingest_mode full); the warm job never converts one');
  }
  if (reg.pinned !== true) return skipped(tableId, 'not pinned (an on-demand slice table is filled per question)');
  if (reg.status !== 'active') {
    return skipped(tableId, `quarantined (needs_review): ${String(reg.needs_review_reason ?? 'reason not recorded')}`);
  }
  if (now() >= opts.deadline) return skipped(tableId, 'deadline');

  const failed = (
    counts: { planned: number; fetched: number; confirmed: number },
    stage: string,
    summary: string,
    quarantined: boolean,
  ): WarmTableResult => ({
    tableId,
    outcome: 'failed',
    ...counts,
    remaining: counts.planned - counts.fetched - counts.confirmed,
    failure: { stage, summary, quarantined },
  });

  // One CBS schema read for the whole run; a moved Modified is applied here,
  // so the scope loaded next already holds CBS's new periods.
  const pre = await precheckSliceSchema(db, source, tableId);
  if (!pre.ok) {
    // The budget ended during the one schema read: nothing was planned or done; the next run starts over.
    if (endedByBudget(pre.summary)) return skipped(tableId, 'deadline');
    return failed({ planned: 0, fetched: 0, confirmed: 0 }, pre.stage, pre.summary, await isQuarantined(db, tableId));
  }
  const prechecked = pre.prechecked;

  const scope = await loadWarmScope(db, tableId);

  // ADR 048's 2026-09-30 addendum: Eurostat retires a dataset without notice, and a frozen one never looks
  // changed — this job would re-confirm it as current every day. Its newest period (after the schema
  // refresh above) must be recent enough for its grain, or the table is quarantined before any slice is
  // confirmed, so its figures are refused rather than served as the latest (principle c). Only a person
  // can find the replacement dataset. CBS tables are not judged this way (their cadences vary too much).
  if (sourceKeyForTableId(tableId) === EUROSTAT_SOURCE_KEY) {
    const timeDim = scope.dimensions.find((d) => d.kind === 'TimeDimension')?.name;
    const newest = [...(timeDim ? (scope.codes[timeDim] ?? []) : [])].sort().at(-1);
    const lag = newest === undefined ? null : lagOfPeriodCode(newest, new Date(now()));
    if (lag === null || lag.frozen) {
      const summary =
        lag === null
          ? `Table "${tableId}" has no stored period this job can date (newest: ${newest ?? 'none'}); refusing ` +
            `to confirm it as current.`
          : `Table "${tableId}"'s newest period is ${newest}, ${lag.lag} ${lag.unit}(s) ago — older than a ` +
            `${lag.unit === 'year' ? 'annual' : `${lag.unit}ly`} dataset should be. Eurostat may have retired it ` +
            `(as it did prc_hicp_manr); find the replacement before re-baselining.`;
      const batch = await db.query(`insert into ingestion_batches (table_id, outcome) values ($1, 'running') returning id`, [
        tableId,
      ]);
      await failBatch(db, Number(batch.rows[0]!.id), tableId, 'period_parsing', summary, null, null, true);
      return failed({ planned: 0, fetched: 0, confirmed: 0 }, 'period_parsing', summary, true);
    }
  }

  let plan: WarmPlan;
  try {
    plan = planWarmSlices(scope, { maxCells: WARM_MAX_CELLS });
  } catch (err) {
    // Our configuration (the declared scope), not CBS changing: never quarantined.
    return failed({ planned: 0, fetched: 0, confirmed: 0 }, 'plan', err instanceof Error ? err.message : String(err), false);
  }

  const planned = plan.requests.length;
  let fetched = 0;
  let confirmed = 0;
  // Newest periods first (the planner's order), so the latest figure lands first.
  for (const req of plan.requests) {
    if (now() >= opts.deadline) {
      return { tableId, outcome: 'partial', planned, fetched, confirmed, remaining: planned - fetched - confirmed };
    }
    const result = await ensureSlice(db, source, tableId, req, { maxCells: WARM_MAX_CELLS, prechecked });
    if (!result.ok) {
      // Cut by the run's time budget mid-request: not done, so it counts as remaining and the next run
      // repeats it; every request already stored stays stored.
      if (endedByBudget(result.summary)) {
        return { tableId, outcome: 'partial', planned, fetched, confirmed, remaining: planned - fetched - confirmed };
      }
      // Already-stored requests stay stored; the next run resumes (they confirm cheaply).
      return failed({ planned, fetched, confirmed }, result.stage, result.summary, await isQuarantined(db, tableId));
    }
    if (result.cached) confirmed += 1;
    else fetched += 1;
  }

  const finish = await finishCompleteRun(db, tableId, plan, prechecked.checkedAt);
  if (!finish.ok) {
    return failed(
      { planned, fetched, confirmed },
      'finish',
      `${finish.summary} Every planned slice was stored, but last_sync_at was not stamped and no old slice ` +
        `record was removed; the next run finishes it.`,
      false,
    );
  }
  return { tableId, outcome: 'complete', planned, fetched, confirmed, remaining: 0 };
}

/**
 * Warms every pinned, active slice-cache table of a source it has an adapter for (or the given ids), one at a
 * time: never-warmed first, then the oldest `last_sync_at`, ties by id. No new
 * table starts once the deadline has passed (those are skipped: 'deadline').
 * One table's failure never stops the others.
 */
export async function warmPinnedTables(
  db: Db,
  source: CbsSource,
  opts: WarmOptions & {
    tableIds?: string[];
    /** Adapters for the other sources, by source key (ADR 065, #358 item 4: `eurostat`). `source` is the
     * CBS adapter; a table whose source has no adapter here is skipped ('not a CBS table'), as before. */
    sources?: Readonly<Record<string, CbsSource>>;
  },
): Promise<WarmTableResult[]> {
  const sourceFor = (tableId: string): CbsSource | null => {
    const key = sourceKeyForTableId(tableId);
    return key === CBS_SOURCE_KEY ? source : (opts.sources?.[key] ?? null);
  };
  const now = opts.now ?? Date.now;
  const rows = opts.tableIds
    ? (await db.query('select id, last_sync_at from cbs_tables where id = any($1::text[])', [opts.tableIds])).rows
    : (
        await db.query(
          `select id, last_sync_at from cbs_tables
            where ingest_mode = 'slice_cache' and pinned and status = 'active'`,
        )
      ).rows;
  const lastSync = new Map(rows.map((r) => [String(r.id), toTime(r.last_sync_at)]));
  const ids = opts.tableIds
    ? [...new Set(opts.tableIds)]
    : [...lastSync.keys()].filter((id) => sourceFor(id) !== null);
  ids.sort((a, b) => {
    const ta = lastSync.get(a) ?? null;
    const tb = lastSync.get(b) ?? null;
    if (ta === null && tb !== null) return -1;
    if (tb === null && ta !== null) return 1;
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const results: WarmTableResult[] = [];
  for (const tableId of ids) {
    const tableSource = sourceFor(tableId);
    if (tableSource === null) {
      results.push(skipped(tableId, 'not a CBS table'));
      continue;
    }
    if (now() >= opts.deadline) {
      results.push(skipped(tableId, 'deadline'));
      continue;
    }
    try {
      results.push(await warmTable(db, tableSource, tableId, { deadline: opts.deadline, now }));
    } catch (err) {
      results.push({
        tableId,
        outcome: 'failed',
        planned: 0,
        fetched: 0,
        confirmed: 0,
        remaining: 0,
        failure: { stage: 'threw', summary: err instanceof Error ? err.message : String(err), quarantined: false },
      });
    }
  }
  return results;
}
