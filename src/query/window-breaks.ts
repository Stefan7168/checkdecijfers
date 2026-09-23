// #316 — extracted out of run.ts's local `eurostatWindowBreaks` so the SAME
// window-break lookup runs for both callers, never a second hand-rolled copy
// (R5): run.ts's own query path (unchanged behaviour) AND the chart
// co-pilot's on-demand re-derivation (web/app/chart-derivation-actions.ts),
// which re-derives a difference over an already-audited chart's own stored
// cells and needs the identical "is there a break BETWEEN these two periods"
// check before the flip that makes Eurostat charts reader-reachable (E2a
// step 6).
//
// ADR 048 D5b / ruling R8: the derivations only see the cells in the RESULT,
// but a non-contiguous selection (an explicit period pair, a difference
// between two arbitrary chart points) leaves the periods strictly between
// them out of `cells` entirely — a 'b' flagged on an unsampled period would
// pass the cell-level check in derivations.ts. So this reads the WHOLE window
// straight from `observations`: the same table/measure/dims/regions/grain,
// period strictly after the first compared period up to and including the
// last (a break flagged ON the first period marks its boundary with the
// period BEFORE the window, the same exemption checkNoSeriesBreak makes) —
// and returns, per region, the refusal reason for the first break found.
// Empty map for every other source and for a single-period window: CBS pays
// no query and is untouched.
import type { Db } from '../db/types.ts';
import { parsePeriodCode } from '../ingestion/periods.ts';
import { EUROSTAT_SOURCE_KEY, resolveSource, sourceKeyForTableId } from '../sources/registry.ts';
import { isEurostatBreakFlag } from './derivations.ts';

export async function findEurostatWindowBreaks(
  db: Db,
  q: { tableId: string; measure: string; dims: Record<string, string>; regionCodes: string[]; periodCodes: string[] },
): Promise<Map<string, string>> {
  const breaks = new Map<string, string>();
  if (sourceKeyForTableId(q.tableId) !== EUROSTAT_SOURCE_KEY || q.periodCodes.length < 2) return breaks;
  const first = q.periodCodes[0]!;
  const last = q.periodCodes[q.periodCodes.length - 1]!;
  const grain = parsePeriodCode(first)?.grain;
  if (grain === undefined) return breaks;
  // Period codes of one grain are fixed-width (2021JJ00, 2021KW03,
  // 2021MM11), so text order IS period order within the grain.
  const { rows } = await db.query(
    `select region_code, period_code, status
       from observations
      where table_id = $1 and measure = $2 and dims = $3::jsonb
        and region_code = any($4::text[]) and period_grain = $5
        and period_code > $6 and period_code <= $7
        and status <> all($8::text[])
      order by region_code, period_code`,
    [
      q.tableId,
      q.measure,
      JSON.stringify(q.dims),
      q.regionCodes,
      grain,
      first,
      last,
      [...resolveSource(EUROSTAT_SOURCE_KEY).definitiveStatuses],
    ],
  );
  for (const row of rows) {
    const regionCode = row.region_code as string;
    const status = row.status as string;
    if (breaks.has(regionCode) || !isEurostatBreakFlag(status)) continue;
    breaks.set(
      regionCode,
      `Eurostat observation for region ${regionCode} at period ${row.period_code as string} (inside the compared window ${first}–${last}) marks a break in series — a trend cannot be compared across it`,
    );
  }
  return breaks;
}
