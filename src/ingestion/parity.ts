// Read-only parity report (ADR 065 step 2, decision D7 of
// docs/superpowers/specs/2026-09-30-one-route-warm-slices-design.md): for one table, what CBS
// returns for the planned warm-slice requests against the cells stored today. Run before a
// pinned table is converted to slice storage, to prove the two hold the same numbers.
//
// WRITES NOTHING: SELECT statements and the adapter's GETs only — no batch row, no slice row,
// no registry change. The row conversion is the ingestion pipeline's own `buildStagedRows` (the
// function fetchSlice stores from), so region, period, dims, status and value attribute are
// never re-interpreted here; only its database write half (stageRows onward) is left out.
import type { CbsObservationRow, CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { buildStagedRows, type StagedRow } from './pipeline.ts';
import type { RegistryUnits } from './validate.ts';
import type { SliceRequest } from './slice-cache.ts';
import { loadWarmScope, planWarmSlices } from './warm-plan.ts';

export type ParityDiffKind = 'value_differs' | 'status_differs' | 'missing_in_store' | 'missing_at_source';

interface CellSide {
  value: number | null;
  status: string | null;
  valueAttribute: string | null;
}

export interface ParityCellDiff {
  kind: ParityDiffKind;
  measure: string;
  /** null when the table has no region dimension. */
  regionCode: string | null;
  periodCode: string;
  dims: Record<string, string>;
  stored?: CellSide;
  fetched?: CellSide;
  /** missing_at_source only: the stored cell is marked retained (CBS withdrew it earlier). */
  retained?: boolean;
  note?: string;
}

export interface ParityReport {
  tableId: string;
  /** Planned slice requests. */
  requests: number;
  /** Requests actually fetched and compared before the deadline / a failure. */
  requestsFetched: number;
  /** Stored cells inside the coordinates of the requests compared. */
  storedCells: number;
  fetchedCells: number;
  identical: number;
  /** Of the missing_at_source cells: how many are stored with the retained marking — an
   * expected difference, told apart from a surprising one. */
  retained: number;
  /** At most maxDiffs; diffCounts always holds the full counts. */
  diffs: ParityCellDiff[];
  diffCounts: Record<ParityDiffKind, number>;
  /** false when the deadline stopped the comparison or something failed. */
  complete: boolean;
  error?: string;
}

export interface ParityOptions {
  /** Epoch milliseconds (as `now` counts them); checked before every request. */
  deadline: number;
  /** Cap per request, passed to the warm-scope planner (its default when absent). */
  maxCells?: number;
  maxDiffs?: number;
  now?: () => number;
}

const DEFAULT_MAX_DIFFS = 50;

/** jsonb round-trips as a string over the real pg driver and as an object over PGlite. */
function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** A numeric column comes back as a string from pg and may as a number elsewhere; the fetched
 * side is a JS number, so both sides are compared as numbers. NULL stays null. */
function asNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function dimsKey(dims: Record<string, string>): string {
  return JSON.stringify(Object.entries(dims).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function cellKey(measure: string, regionCode: string, periodCode: string, dims: Record<string, string>): string {
  return JSON.stringify([measure, regionCode, periodCode, dimsKey(dims)]);
}

interface StoredCell {
  side: CellSide;
  measure: string;
  regionCode: string;
  periodCode: string;
  dims: Record<string, string>;
  /** observations.last_seen_batch_id (migration 021): non-null = retained. */
  lastSeenBatchId: number | null;
}

export async function compareTableWithSource(
  db: Db,
  source: CbsSource,
  tableId: string,
  opts: ParityOptions,
): Promise<ParityReport> {
  const now = opts.now ?? Date.now;
  const maxDiffs = opts.maxDiffs ?? DEFAULT_MAX_DIFFS;
  const report: ParityReport = {
    tableId,
    requests: 0,
    requestsFetched: 0,
    storedCells: 0,
    fetchedCells: 0,
    identical: 0,
    retained: 0,
    diffs: [],
    diffCounts: { value_differs: 0, status_differs: 0, missing_in_store: 0, missing_at_source: 0 },
    complete: false,
  };
  const addDiff = (diff: ParityCellDiff): void => {
    report.diffCounts[diff.kind] += 1;
    if (report.diffs.length < maxDiffs) report.diffs.push(diff);
  };

  try {
    const scope = await loadWarmScope(db, tableId);
    const plan = planWarmSlices(scope, { maxCells: opts.maxCells });
    report.requests = plan.requests.length;

    const timeDim = scope.dimensions.find((d) => d.kind === 'TimeDimension')!.name;
    const geoDim = scope.dimensions.find((d) => d.kind === 'GeoDimension')?.name ?? null;
    const otherDims = scope.dimensions.map((d) => d.name).filter((n) => n !== timeDim && n !== geoDim);

    // What fetchSlice reads from the registry and the stored labels before it converts rows.
    const unitsRow = await db.query('select units from cbs_tables where id = $1', [tableId]);
    const units = parseJsonb<RegistryUnits>(unitsRow.rows[0]?.units, {});
    const periodLabels = await db.query('select code, status from dimension_labels where table_id = $1 and dimension = $2', [
      tableId,
      timeDim,
    ]);
    const periodStatusByCode = new Map<string, string>();
    for (const label of periodLabels.rows) {
      if (label.status != null) periodStatusByCode.set(label.code as string, label.status as string);
    }
    const schema = await source.fetchTableSchema(tableId);
    const dimensionNames = schema.dimensions.map((d) => d.name);

    for (const [index, req] of plan.requests.entries()) {
      if (now() >= opts.deadline) {
        report.error = `The deadline was reached after ${index} of ${plan.requests.length} request(s).`;
        return report;
      }

      let staged: StagedRow[];
      try {
        // Exactly the CbsSlice fetchSlice sends for this request.
        const rows: CbsObservationRow[] = [];
        for await (const page of source.fetchObservations(
          tableId,
          { measures: req.measures, dimensionIn: req.members, periodIn: { dimension: timeDim, codes: req.periods } },
          dimensionNames,
        )) {
          rows.push(...page);
        }
        const outside = rows.filter((r) => isOutside(r, req, timeDim));
        if (outside.length > 0) {
          throw new Error(`${outside.length} fetched row(s) fall outside the requested slice — the server-side filter did not hold`);
        }
        staged = buildStagedRows(rows, schema.dimensions, units, periodStatusByCode, tableId);
      } catch (err) {
        report.error = `Request ${index + 1} of ${plan.requests.length} failed: ${err instanceof Error ? err.message : String(err)}`;
        return report;
      }

      const stored = await readStored(db, tableId, req, geoDim, otherDims);
      const fetchedByKey = new Map<string, StagedRow>();
      for (const row of staged) fetchedByKey.set(cellKey(row.measure, row.region_code, row.period_code, row.dims), row);
      const storedKeys = new Set<string>();

      report.requestsFetched += 1;
      report.storedCells += stored.length;
      report.fetchedCells += staged.length;

      const regionOf = (code: string): string | null => (geoDim ? code : null);
      for (const cell of stored) {
        const key = cellKey(cell.measure, cell.regionCode, cell.periodCode, cell.dims);
        storedKeys.add(key);
        const row = fetchedByKey.get(key);
        const base = { measure: cell.measure, regionCode: regionOf(cell.regionCode), periodCode: cell.periodCode, dims: cell.dims };
        if (!row) {
          const retained = cell.lastSeenBatchId !== null;
          if (retained) report.retained += 1;
          addDiff({
            kind: 'missing_at_source',
            ...base,
            stored: cell.side,
            retained,
            ...(retained
              ? { note: `retained: the sync kept this cell after CBS stopped returning it (last seen in batch ${cell.lastSeenBatchId})` }
              : {}),
          });
          continue;
        }
        const fetched: CellSide = { value: row.value, status: row.status, valueAttribute: row.value_attribute };
        // A different value attribute (the reason behind a null, or a flag on a value) is a
        // different value; only a status change on an otherwise equal cell is status_differs.
        if (cell.side.value !== fetched.value || cell.side.valueAttribute !== fetched.valueAttribute) {
          addDiff({ kind: 'value_differs', ...base, stored: cell.side, fetched });
        } else if (cell.side.status !== fetched.status) {
          addDiff({ kind: 'status_differs', ...base, stored: cell.side, fetched });
        } else {
          report.identical += 1;
        }
      }
      for (const [key, row] of fetchedByKey) {
        if (storedKeys.has(key)) continue;
        addDiff({
          kind: 'missing_in_store',
          measure: row.measure,
          regionCode: regionOf(row.region_code),
          periodCode: row.period_code,
          dims: row.dims,
          fetched: { value: row.value, status: row.status, valueAttribute: row.value_attribute },
        });
      }
    }
    report.complete = true;
    return report;
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    return report;
  }
}

/** fetchSlice's own guard: CBS must return only the coordinates asked for. */
function isOutside(row: CbsObservationRow, req: SliceRequest, timeDim: string): boolean {
  if (!req.measures.includes(row.measure) || !req.periods.includes(row.coordinates[timeDim] ?? '')) return true;
  return Object.entries(req.members).some(([dim, codes]) => !codes.includes(row.coordinates[dim] ?? ''));
}

/** The stored cells inside one request's coordinates — the same predicate
 * markUnseenCellsRetained uses for a slice, as a SELECT. */
async function readStored(
  db: Db,
  tableId: string,
  req: SliceRequest,
  geoDim: string | null,
  otherDims: string[],
): Promise<StoredCell[]> {
  const dimsIn: Record<string, string[]> = {};
  for (const dim of otherDims) dimsIn[dim] = req.members[dim] ?? [];
  const params: unknown[] = [tableId, req.measures, req.periods];
  let regionSql = '';
  if (geoDim) {
    params.push(req.members[geoDim] ?? []);
    regionSql = `and o.region_code = any($${params.length}::text[])`;
  }
  params.push(JSON.stringify(dimsIn));
  const result = await db.query(
    `select o.measure, o.region_code, o.period_code, o.dims, o.value, o.status, o.value_attribute, o.last_seen_batch_id
       from observations o
      where o.table_id = $1
        and o.measure = any($2::text[])
        and o.period_code = any($3::text[])
        ${regionSql}
        and not exists (
          select 1 from jsonb_each($${params.length}::jsonb) f
          where not coalesce(jsonb_exists(f.value, o.dims ->> f.key), false)
        )`,
    params,
  );
  return result.rows.map((r) => ({
    measure: r.measure as string,
    regionCode: r.region_code as string,
    periodCode: r.period_code as string,
    dims: parseJsonb<Record<string, string>>(r.dims, {}),
    side: {
      value: asNumber(r.value),
      status: (r.status as string | null) ?? null,
      valueAttribute: (r.value_attribute as string | null) ?? null,
    },
    lastSeenBatchId: r.last_seen_batch_id == null ? null : Number(r.last_seen_batch_id),
  }));
}
