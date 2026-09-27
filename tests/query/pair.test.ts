// Two-measure scatter (spec 2026-09-27), Task 1: the pure pair-intent rule and
// the region join. Synthetic results — only the fields pair.ts reads are real.
import { describe, expect, it } from 'vitest';
import { legIntents, pairIntentProblem, pairRegions } from '../../src/query/index.ts';
import type { ResultCell, StructuredIntent, ValidatedResult } from '../../src/query/index.ts';

const base: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
  regionSet: { kind: 'all_provincies' },
  period: { kind: 'codes', codes: ['2024JJ00'] },
  derivation: 'none',
  pairWith: { kind: 'canonical', key: 'population_on_1_january' },
};

function cell(tableId: string, regionCode: string, value: number | null, attr = 'None'): ResultCell {
  return {
    resultId: `${tableId}:M:${regionCode}:2024JJ00:-`,
    tableId,
    measure: 'M',
    measureTitle: 'm',
    regionCode,
    regionLabel: `Label ${regionCode}`,
    periodCode: '2024JJ00',
    periodLabel: '2024',
    grain: 'JJ',
    dims: {},
    dimLabels: {},
    value,
    unit: 'x',
    decimals: 0,
    status: 'Definitief',
    provisional: false,
    valueAttribute: attr,
    batchId: 1,
  };
}

function result(
  tableId: string,
  cells: ResultCell[],
  buckets: { notApplicable?: string[]; withheld?: string[]; missing?: string[] } = {},
): ValidatedResult {
  const withheld = buckets.withheld ?? [];
  const missing = buckets.missing ?? [];
  return {
    shape: 'region_set',
    cells,
    regionSet: {
      scope: { kind: 'all_provincies' },
      rosterSize: cells.length + (buckets.notApplicable ?? []).length + missing.length,
      notApplicable: buckets.notApplicable ?? [],
      withheld,
      missing,
      complete: withheld.length === 0 && missing.length === 0,
    },
  } as unknown as ValidatedResult;
}

describe('pairIntentProblem', () => {
  it('accepts the one supported shape', () => {
    expect(pairIntentProblem(base)).toBeNull();
  });
  it.each([
    ['no pairWith', { ...base, pairWith: undefined }],
    ['no region class', { ...base, regionSet: undefined }],
    ['explicit regions', { ...base, regions: ['PV20'] }],
    ['two periods', { ...base, period: { kind: 'codes', codes: ['2023JJ00', '2024JJ00'] } }],
    ['a range', { ...base, period: { kind: 'range', from: '2023JJ00', to: '2024JJ00' } }],
    ['a derivation', { ...base, derivation: 'max' }],
    ['an explicit target', { ...base, target: { kind: 'explicit', tableId: '83625NED', measure: 'M001534' } }],
    ['the same measure twice', { ...base, pairWith: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' } }],
  ] as [string, StructuredIntent][])('refuses %s', (_name, intent) => {
    expect(pairIntentProblem(intent)).not.toBeNull();
  });
});

describe('legIntents', () => {
  it('y is the asked-about measure, x the added one; neither leg carries pairWith', () => {
    const { y, x } = legIntents(base);
    expect(y.target).toEqual(base.target);
    expect(x.target).toEqual(base.pairWith);
    expect('pairWith' in y).toBe(false);
    expect('pairWith' in x).toBe(false);
    expect(x.regionSet).toEqual(base.regionSet);
    expect(x.period).toEqual(base.period);
  });
});

describe('pairRegions', () => {
  it('pairs a region only when both legs carry a value, in y cell order', () => {
    const y = result('Y', [cell('Y', 'B', 2), cell('Y', 'A', 1)]);
    const x = result('X', [cell('X', 'A', 10), cell('X', 'B', 20)]);
    const p = pairRegions(y, x);
    expect(p.pairs.map((r) => r.regionCode)).toEqual(['B', 'A']);
    expect(p.pairs[0].y.value).toBe(2);
    expect(p.pairs[0].x.value).toBe(20);
    expect(p.pairs[0].regionLabel).toBe('Label B');
    expect(p.leftOut).toEqual([]);
    expect(p.complete).toBe(true);
  });

  it('a withheld cell on one side leaves the region out, with the side state and its cell', () => {
    const y = result('Y', [cell('Y', 'A', 1), cell('Y', 'B', null, 'Secret')], { withheld: ['B'] });
    const x = result('X', [cell('X', 'A', 10), cell('X', 'B', 20)]);
    const p = pairRegions(y, x);
    expect(p.pairs.map((r) => r.regionCode)).toEqual(['A']);
    expect(p.leftOut).toHaveLength(1);
    expect(p.leftOut[0].regionCode).toBe('B');
    expect(p.leftOut[0].y.state).toBe('withheld');
    expect(p.leftOut[0].y.cell?.valueAttribute).toBe('Secret');
    expect(p.leftOut[0].x.state).toBe('value');
    expect(p.complete).toBe(false);
  });

  it('a region absent from the other leg entirely is left out as missing on that side', () => {
    const y = result('Y', [cell('Y', 'A', 1), cell('Y', 'C', 3)]);
    const x = result('X', [cell('X', 'A', 10)]);
    const p = pairRegions(y, x);
    expect(p.leftOut.map((r) => [r.regionCode, r.y.state, r.x.state])).toEqual([['C', 'value', 'missing']]);
    expect(p.leftOut[0].regionLabel).toBe('Label C');
  });

  it('not applicable on one side and no value on the other is not a member: skipped, not left out', () => {
    const y = result('Y', [cell('Y', 'A', 1)], { notApplicable: ['D'] });
    const x = result('X', [cell('X', 'A', 10)]);
    const p = pairRegions(y, x);
    expect(p.notApplicable).toEqual(['D']);
    expect(p.leftOut).toEqual([]);
    expect(p.complete).toBe(true);
  });

  it('not applicable on one side but a value on the other is disclosed, never dropped silently', () => {
    const y = result('Y', [cell('Y', 'A', 1)], { notApplicable: ['E'] });
    const x = result('X', [cell('X', 'A', 10), cell('X', 'E', 50)]);
    const p = pairRegions(y, x);
    expect(p.notApplicable).toEqual([]);
    expect(p.leftOut.map((r) => [r.regionCode, r.y.state, r.x.state])).toEqual([['E', 'not_applicable', 'value']]);
    expect(p.leftOut[0].regionLabel).toBe('Label E');
  });

  it('accounts for every region of both legs exactly once', () => {
    const y = result('Y', [cell('Y', 'A', 1), cell('Y', 'B', null, 'Secret')], { withheld: ['B'], missing: ['F'], notApplicable: ['D'] });
    const x = result('X', [cell('X', 'A', 10), cell('X', 'G', 7)]);
    const p = pairRegions(y, x);
    const all = [...p.pairs.map((r) => r.regionCode), ...p.leftOut.map((r) => r.regionCode), ...p.notApplicable];
    expect([...all].sort()).toEqual(['A', 'B', 'D', 'F', 'G']);
    expect(new Set(all).size).toBe(all.length);
  });
});
