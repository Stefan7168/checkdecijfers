// buildUserChartSpec — the ONLY producer of UserChartSpec (D7 point 3, H1's
// other half). Every plotted value traces to one stored cell via rowRef
// (U1); every visible number is a spec string, never recomputed by a
// renderer (U6); the spec is TYPE-LEVEL incompatible with a CBS ChartSpec
// (H2), not just styled differently.
import { describe, expect, it } from 'vitest';
import { buildUserChartSpec } from '../../src/attachments/chart.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import type { ChartInstruction, UserDataset } from '../../src/attachments/types.ts';
import { USER_DATA_DISCLAIMER } from '../../src/attachments/types.ts';
import { chartSpecSchema } from '../../src/chart/schema.ts';

const CELLS = [
  ['Jaar', 'Gemeente', 'Omzet'],
  ['2020', 'Amsterdam', '120,5'],
  ['2020', 'Rotterdam', '80,0'],
  ['2021', 'Amsterdam', '150,0'],
  ['2021', 'Rotterdam', ''],
];

function dataset(overrides: Partial<UserDataset> = {}): UserDataset {
  return {
    id: 42,
    userId: 'u1',
    sourceKind: 'file_csv',
    displayName: 'verkoop-2024.csv',
    sourceUrl: null,
    cells: CELLS,
    profile: buildDatasetProfile(CELLS),
    status: 'ready',
    contentSha256: 'deadbeef',
    createdAt: '2026-09-06T00:00:00Z',
    ...overrides,
  };
}

function instruction(fields: Partial<ChartInstruction> = {}): ChartInstruction {
  return {
    version: 2,
    kind: 'line',
    x: 'c0',
    y: ['c2'],
    seriesBy: null,
    filters: [],
    sort: null,
    limit: null,
    aggregate: null,
    derived: null,
    confidence: 0.9,
    reading: '',
    unsupported: null,
    ...fields,
  };
}

describe('buildUserChartSpec — traceability (U1) and rowRef assembly', () => {
  it('every point rowRef is r{rowIndex}:c{yColumnIndex}, pointing at the real source cell', () => {
    const spec = buildUserChartSpec(dataset(), instruction({ seriesBy: 'c1' }));
    const amsterdam2020 = spec.series
      .find((s) => s.label === 'Amsterdam')!
      .points.find((p) => p.xLabel === '2020')!;
    // "120,5" for Amsterdam/2020 lives at cells[1][2] (row 1 = first data
    // row, column c2 = index 2).
    expect(amsterdam2020.rowRef).toBe('r1:c2');
    expect(amsterdam2020.sourceText).toBe('120,5');
    expect(amsterdam2020.value).toBeCloseTo(120.5);
  });
});

describe('buildUserChartSpec — display formatting (R3/R10 analog)', () => {
  it('formats a value via the SAME formatValueNl formatter CBS answers use', () => {
    const spec = buildUserChartSpec(dataset(), instruction({ seriesBy: 'c1' }));
    const amsterdam2020 = spec.series
      .find((s) => s.label === 'Amsterdam')!
      .points.find((p) => p.xLabel === '2020')!;
    expect(amsterdam2020.formattedValue).toBe('120,5');
  });

  it('preserves the source decimal precision (no extra rounding)', () => {
    const cells = [
      ['Jaar', 'Omzet'],
      ['2020', '9,80'],
    ];
    const spec = buildUserChartSpec(dataset({ cells, profile: buildDatasetProfile(cells) }), instruction({ y: ['c1'] }));
    expect(spec.series[0]!.points[0]!.formattedValue).toBe('9,80');
  });
});

describe('buildUserChartSpec — null cells stay in the spec with a reason, never omitted (U11)', () => {
  it('an empty cell becomes a null point with reason "leeg in bron"', () => {
    const spec = buildUserChartSpec(dataset(), instruction({ seriesBy: 'c1' }));
    const rotterdam2021 = spec.series
      .find((s) => s.label === 'Rotterdam')!
      .points.find((p) => p.xLabel === '2021')!;
    expect(rotterdam2021.value).toBeNull();
    expect(rotterdam2021.formattedValue).toBeNull();
    expect(rotterdam2021.reason).toBe('leeg in bron');
  });

  it('an unparseable cell ("n.v.t.") becomes a null point with reason "geen getal"', () => {
    const cells = [
      ['Jaar', 'Omzet'],
      ['2020', 'n.v.t.'],
    ];
    const spec = buildUserChartSpec(dataset({ cells, profile: buildDatasetProfile(cells) }), instruction({ y: ['c1'] }));
    expect(spec.series[0]!.points[0]!.value).toBeNull();
    expect(spec.series[0]!.points[0]!.reason).toBe('geen getal');
  });
});

describe('buildUserChartSpec — series grouping', () => {
  it('groups by seriesBy into one series per distinct value', () => {
    const spec = buildUserChartSpec(dataset(), instruction({ seriesBy: 'c1' }));
    expect(spec.series.map((s) => s.label).sort()).toEqual(['Amsterdam', 'Rotterdam']);
  });

  it('without seriesBy, multiple y columns each become their own series', () => {
    const cells = [
      ['Jaar', 'Omzet', 'Kosten'],
      ['2020', '100', '50'],
    ];
    const spec = buildUserChartSpec(
      dataset({ cells, profile: buildDatasetProfile(cells) }),
      instruction({ y: ['c1', 'c2'] }),
    );
    expect(spec.series.map((s) => s.label).sort()).toEqual(['Kosten', 'Omzet']);
    expect(spec.yHeaders).toEqual(['Omzet', 'Kosten']);
  });
});

describe('buildUserChartSpec — duplicate column headers stay two separate series (fixed in review)', () => {
  it('two y columns sharing an identical header produce two series, never merged into one', () => {
    const cells = [
      ['Jaar', 'Waarde', 'Waarde'],
      ['2020', '100', '200'],
    ];
    const spec = buildUserChartSpec(dataset({ cells, profile: buildDatasetProfile(cells) }), instruction({ y: ['c1', 'c2'] }));
    expect(spec.series).toHaveLength(2);
    const values = spec.series.flatMap((s) => s.points.map((p) => p.value)).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(values).toEqual([100, 200]);
  });
});

describe('buildUserChartSpec — provenance, disclaimer, headers (U9/H2)', () => {
  it('carries the file headers verbatim, never reworded (U9)', () => {
    const spec = buildUserChartSpec(dataset(), instruction());
    expect(spec.xHeader).toBe('Jaar');
    expect(spec.yHeaders).toEqual(['Omzet']);
  });

  it('carries provenance and the disclaimer line', () => {
    const spec = buildUserChartSpec(dataset(), instruction());
    expect(spec.provenance.datasetId).toBe(42);
    expect(spec.provenance.displayName).toBe('verkoop-2024.csv');
    expect(spec.provenance.sourceKind).toBe('file_csv');
    expect(spec.disclaimerLine).toBe(USER_DATA_DISCLAIMER);
    expect(spec.origin).toBe('user_dataset');
    expect(spec.trust).toBe('unverified');
  });

  it('extracts the host from a source URL, never the full URL (privacy-lean provenance)', () => {
    const spec = buildUserChartSpec(
      dataset({ sourceUrl: 'https://example.com/tabel?jaar=2020' }),
      instruction(),
    );
    expect(spec.provenance.sourceUrlHost).toBe('example.com');
  });

  it('H2: a UserChartSpec is TYPE-LEVEL incompatible with a CBS ChartSpec — it fails chartSpecSchema outright', () => {
    const spec = buildUserChartSpec(dataset(), instruction());
    const result = chartSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
  });
});

const SALES = [
  ['Jaar', 'Gemeente', 'Omzet', 'Kosten'],
  ['2020', 'Amsterdam', '100', '60'],
  ['2020', 'Rotterdam', '50', '20'],
  ['2021', 'Amsterdam', '150', '90'],
  ['2021', 'Rotterdam', '', '10'],
  ['2021', 'Utrecht', '30', '0'],
];
it('an aggregated spec formats the computed value and labels the series deterministically', () => {
  const spec = buildUserChartSpec(dataset({ cells: SALES, profile: buildDatasetProfile(SALES) }), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'mean' } }));
  expect(spec.yHeaders).toEqual(['Average of Omzet']);
  expect(spec.series[0]!.label).toBe('Average of Omzet');
  expect(spec.series[0]!.points.map((p) => [p.formattedValue, p.rowRef])).toEqual([['75,00', 'agg:mean:r1:c2+r2:c2'], ['90,00', 'agg:mean:r3:c2+r4:c2+r5:c2']]);
});
it('a derived spec labels a − b and keeps sourceText as the a cell', () => {
  const spec = buildUserChartSpec(dataset({ cells: SALES, profile: buildDatasetProfile(SALES) }), instruction({ kind: 'bar', x: 'c1', y: ['c2'], filters: [{ column: 'c0', op: 'in', values: ['2020'] }], derived: { op: 'difference', b: 'c3' } }));
  expect(spec.yHeaders).toEqual(['Omzet − Kosten']);
  expect(spec.series[0]!.points[0]).toMatchObject({ formattedValue: '40', sourceText: '100', rowRef: 'der:difference:r1:c2|r1:c3' });
});
it('a combined aggregate→derive label keeps the aggregation prefix on the operand (fix round 1)', () => {
  const spec = buildUserChartSpec(
    dataset({ cells: SALES, profile: buildDatasetProfile(SALES) }),
    instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'sum' }, derived: { op: 'share_of_total', b: null } }),
  );
  expect(spec.yHeaders).toEqual(['Sum of Omzet, share of total (%)']);
});

describe('buildUserChartSpec — incomplete points reach the spec (#314)', () => {
  it('a sum that skipped a blank cell is carried as incomplete on its point; a complete one is not', () => {
    const spec = buildUserChartSpec(dataset(), instruction({ kind: 'bar', aggregate: { fn: 'sum' } }));
    const points = spec.series[0]!.points;
    expect(points.map((p) => [p.xLabel, p.value, p.incomplete])).toEqual([
      ['2020', 200.5, undefined],
      ['2021', 150, true],
    ]);
  });
  it('an unaggregated chart never marks a point incomplete', () => {
    const spec = buildUserChartSpec(dataset(), instruction({ seriesBy: 'c1' }));
    expect(spec.series.flatMap((s) => s.points).some((p) => p.incomplete)).toBe(false);
  });
});

// Session 129: an aggregate or derived chart SPLIT by a column names each
// series by its own split value; the computation's description stays in
// yHeaders (the card heading). Before, every series got the same
// "Count of Omzet" label — an unreadable legend and duplicate co-pilot names.
describe('buildUserChartSpec — a split aggregate/derived chart names each series by its split value', () => {
  it('count per year, split by gemeente', () => {
    const spec = buildUserChartSpec(dataset(), instruction({ seriesBy: 'c1', aggregate: { fn: 'count' } }));
    expect(spec.series.map((s) => s.label).sort()).toEqual(['Amsterdam', 'Rotterdam']);
    expect(spec.yHeaders).toEqual(['Count of rows']);
  });

  it('without a split, the aggregate label is unchanged', () => {
    const spec = buildUserChartSpec(dataset(), instruction({ aggregate: { fn: 'sum' } }));
    expect(spec.series).toHaveLength(1);
    expect(spec.series[0]!.label).toBe(spec.yHeaders[0]);
    expect(spec.series[0]!.label).not.toBe('Omzet');
  });
});
