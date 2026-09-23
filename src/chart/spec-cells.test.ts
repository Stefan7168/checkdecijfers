import { describe, expect, it } from 'vitest';
import { specCellsByResultId } from './spec-cells.ts';
import type { ChartSpec } from './types.ts';

const spec: ChartSpec = {
  schemaVersion: 1, kind: 'line', title: 't', dims: {}, dimLabels: {}, unit: 'aantal',
  series: [{ label: 'Rotterdam', regionCode: 'GM0599', points: [
    { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
    { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: 20, formattedValue: '20', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
  ] }],
  provisionalNote: null, nullNotes: [], definitionLine: null, attributionLine: '', attribution: { tableId: '85984NED' } as ChartSpec['attribution'],
};

describe('specCellsByResultId', () => {
  it('flattens every series/point into a cell keyed by resultId, carrying the series regionCode, the spec unit, and (#316) each point\'s tableId/status', () => {
    const cells = specCellsByResultId(spec);
    expect(cells.get('r1')).toEqual({ resultId: 'r1', periodCode: '2019', regionCode: 'GM0599', unit: 'aantal', value: 10, valueAttribute: 'None', tableId: '85984NED', status: 'Definitief' });
    expect(cells.size).toBe(2);
  });

  it('preserves valueAttribute for null-valued cells, so derivation refusal messages are accurate', () => {
    const specWithNull: ChartSpec = {
      schemaVersion: 1, kind: 'line', title: 't', dims: {}, dimLabels: {}, unit: 'aantal',
      series: [{ label: 'x', regionCode: 'GM0599', points: [
        { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
        { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: null, formattedValue: null, decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'DataNotAvailable' },
      ] }],
      provisionalNote: null, nullNotes: [], definitionLine: null, attributionLine: '', attribution: { tableId: '85984NED' } as ChartSpec['attribution'],
    };
    const cells = specCellsByResultId(specWithNull);
    expect(cells.get('r2')).toEqual({ resultId: 'r2', periodCode: '2020', regionCode: 'GM0599', unit: 'aantal', value: null, valueAttribute: 'DataNotAvailable', tableId: '85984NED', status: 'Definitief' });
  });

  it('#316: carries a Eurostat cell\'s status verbatim (a break flag), so deriveDifference\'s cell-level checkNoSeriesBreak can see it', () => {
    const eurostatSpec: ChartSpec = {
      schemaVersion: 1, kind: 'line', title: 't', dims: {}, dimLabels: {}, unit: 'aantal',
      series: [{ label: 'DE', regionCode: 'DE', points: [
        { resultId: 'r1', periodCode: '2020JJ00', periodLabel: '2020', value: 10, formattedValue: '10', decimals: 0, status: 'Published', provisional: false, valueAttribute: 'None' },
        { resultId: 'r2', periodCode: '2021JJ00', periodLabel: '2021', value: 20, formattedValue: '20', decimals: 0, status: 'b', provisional: false, valueAttribute: 'None' },
      ] }],
      provisionalNote: null, nullNotes: [], definitionLine: null, attributionLine: '', attribution: { tableId: 'ei_bsin_q_r2' } as ChartSpec['attribution'],
    };
    const cells = specCellsByResultId(eurostatSpec);
    expect(cells.get('r2')).toEqual({ resultId: 'r2', periodCode: '2021JJ00', regionCode: 'DE', unit: 'aantal', value: 20, valueAttribute: 'None', tableId: 'ei_bsin_q_r2', status: 'b' });
  });

  it('leaves tableId undefined when the spec carries no attribution at all (hand-built fixtures, existing unit tests) — the cell-level break check simply skips such a cell rather than throwing', () => {
    const noAttributionSpec = {
      unit: 'aantal',
      series: [{ label: 'x', regionCode: 'GM0599', points: [
        { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
      ] }],
    } as unknown as Pick<ChartSpec, 'unit' | 'series' | 'attribution'>;
    const cells = specCellsByResultId(noAttributionSpec);
    expect(cells.get('r1')?.tableId).toBeUndefined();
  });
});
