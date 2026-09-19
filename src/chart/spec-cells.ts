// Flattens an already-built, already-audited ChartSpec back into minimal,
// derivation-ready cells (co-pilot phase 4, #274). This is NOT a new query —
// it re-reads values this chart's own answer already fetched and validated;
// it exists only so an on-demand derivation (difference/mean, requested from
// the chart-editing UI after the fact) can call the SAME registered
// derivation functions the answer pipeline uses, over the SAME cells,
// without a second, hand-rolled arithmetic path (R5).
import type { ResultCell } from '../query/types.ts';
import type { ChartSpec } from './types.ts';

export type DerivationCell = Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' | 'value' | 'valueAttribute'>;

export function specCellsByResultId(spec: Pick<ChartSpec, 'unit' | 'series'>): Map<string, DerivationCell> {
  const out = new Map<string, DerivationCell>();
  for (const s of spec.series) {
    for (const p of s.points) {
      out.set(p.resultId, { resultId: p.resultId, periodCode: p.periodCode, regionCode: s.regionCode, unit: spec.unit, value: p.value, valueAttribute: p.valueAttribute });
    }
  }
  return out;
}
