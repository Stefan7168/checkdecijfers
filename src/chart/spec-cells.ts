// Flattens an already-built, already-audited ChartSpec back into minimal,
// derivation-ready cells (co-pilot phase 4, #274). This is NOT a new query —
// it re-reads values this chart's own answer already fetched and validated;
// it exists only so an on-demand derivation (difference/mean, requested from
// the chart-editing UI after the fact) can call the SAME registered
// derivation functions the answer pipeline uses, over the SAME cells,
// without a second, hand-rolled arithmetic path (R5).
//
// #316: also carries `tableId` (from the spec's own attribution — ADR 007's
// "attribution inside the spec so no rendering path can drop it", R4) and
// `status` (already on every ChartPoint, R11) so deriveDifference's existing
// cell-level `checkNoSeriesBreak` (src/query/derivations.ts) can see a
// Eurostat break-in-series flag on these cells too, the same as it does for
// every run.ts-built ResultCell. `spec.attribution` is optional chained
// rather than assumed present: existing unit tests and hand-built fixtures
// construct a spec without one, and a cell with no tableId is simply skipped
// by the cell-level check's own source-key gate (unaffected, not refused).
import type { ResultCell } from '../query/types.ts';
import type { ChartSpec } from './types.ts';

export type DerivationCell = Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' | 'value' | 'valueAttribute'> &
  Partial<Pick<ResultCell, 'tableId' | 'status'>>;

export function specCellsByResultId(spec: Pick<ChartSpec, 'unit' | 'series' | 'attribution'>): Map<string, DerivationCell> {
  const out = new Map<string, DerivationCell>();
  const tableId = spec.attribution?.tableId;
  for (const s of spec.series) {
    for (const p of s.points) {
      out.set(p.resultId, {
        resultId: p.resultId,
        periodCode: p.periodCode,
        regionCode: s.regionCode,
        unit: spec.unit,
        value: p.value,
        valueAttribute: p.valueAttribute,
        tableId,
        status: p.status,
      });
    }
  }
  return out;
}
