import { describe, expect, it } from 'vitest';
import { specCellsByResultId } from './spec-cells.ts';
import type { ChartSpec } from './types.ts';

const spec: ChartSpec = {
  schemaVersion: 1, kind: 'line', title: 't', dims: {}, dimLabels: {}, unit: 'aantal',
  series: [{ label: 'Rotterdam', regionCode: 'GM0599', points: [
    { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
    { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: 20, formattedValue: '20', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
  ] }],
  provisionalNote: null, nullNotes: [], definitionLine: null, attributionLine: '', attribution: {} as ChartSpec['attribution'],
};

describe('specCellsByResultId', () => {
  it('flattens every series/point into a cell keyed by resultId, carrying the series regionCode and the spec unit', () => {
    const cells = specCellsByResultId(spec);
    expect(cells.get('r1')).toEqual({ resultId: 'r1', periodCode: '2019', regionCode: 'GM0599', unit: 'aantal', value: 10, valueAttribute: 'None' });
    expect(cells.size).toBe(2);
  });

  it('preserves valueAttribute for null-valued cells, so derivation refusal messages are accurate', () => {
    const specWithNull: ChartSpec = {
      schemaVersion: 1, kind: 'line', title: 't', dims: {}, dimLabels: {}, unit: 'aantal',
      series: [{ label: 'x', regionCode: 'GM0599', points: [
        { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
        { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: null, formattedValue: null, decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'DataNotAvailable' },
      ] }],
      provisionalNote: null, nullNotes: [], definitionLine: null, attributionLine: '', attribution: {} as ChartSpec['attribution'],
    };
    const cells = specCellsByResultId(specWithNull);
    expect(cells.get('r2')).toEqual({ resultId: 'r2', periodCode: '2020', regionCode: 'GM0599', unit: 'aantal', value: null, valueAttribute: 'DataNotAvailable' });
  });
});
