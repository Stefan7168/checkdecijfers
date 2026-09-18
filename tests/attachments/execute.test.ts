// executeInstruction — the selection/ordering/limiting half of the H1
// boundary (D7). Pure function over dataset.cells: no LLM, no db. Every
// test proves a plotted point traces to a real stored cell (U1) and that
// caps/zero-rows are refusals, never silent truncation/omission.
import { describe, expect, it } from 'vitest';
import { NoRowsError, TooManyPointsError, executeInstruction } from '../../src/attachments/execute.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import type { ChartInstruction, UserDataset } from '../../src/attachments/types.ts';

const CELLS = [
  ['Jaar', 'Gemeente', 'Omzet'],
  ['2020', 'Amsterdam', '120,5'],
  ['2020', 'Rotterdam', '80,0'],
  ['2021', 'Amsterdam', '150,0'],
  ['2021', 'Rotterdam', ''],
  ['2022', 'Amsterdam', 'n.v.t.'],
];

function dataset(cells: string[][] = CELLS): UserDataset {
  return {
    id: 1,
    userId: 'u1',
    sourceKind: 'file_csv',
    displayName: 'test.csv',
    sourceUrl: null,
    cells,
    profile: buildDatasetProfile(cells),
    status: 'ready',
    contentSha256: 'deadbeef',
    createdAt: '2026-09-06T00:00:00Z',
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

describe('executeInstruction — traceability (U1)', () => {
  it('every point rowRef points at the exact row/column the value came from', () => {
    const points = executeInstruction(dataset(), instruction({ y: ['c2'] }));
    const first = points.find((p) => p.xRaw === '2020' && p.seriesLabel === 'Omzet');
    // "2020" first appears at data-row offset 0 -> rowIndex 1 in the full
    // cells array (row 0 is the header) — rowRef assembly itself (r{row}:c{col})
    // is chart.ts's job, tested there; this proves execute.ts hands it the
    // right row index and the right raw cell text to assemble it from.
    expect(first?.rowIndex).toBe(1);
    expect(first?.yRaw).toBe('120,5');
  });
});

describe('executeInstruction — no implicit row dropping for missing y values (U11)', () => {
  it('keeps a row with an empty y cell (chart.ts renders it as a gap, never omits it)', () => {
    const points = executeInstruction(dataset(), instruction());
    const rotterdam2021 = points.find((p) => p.xRaw === '2021' && p.rowIndex === 4);
    expect(rotterdam2021?.yRaw).toBe('');
  });

  it('keeps a row with an unparseable y cell ("n.v.t.")', () => {
    const points = executeInstruction(dataset(), instruction());
    const found = points.find((p) => p.yRaw === 'n.v.t.');
    expect(found).toBeDefined();
  });
});

describe('executeInstruction — filters', () => {
  it('"in" filter keeps only matching rows', () => {
    const points = executeInstruction(
      dataset(),
      instruction({ filters: [{ column: 'c1', op: 'in', values: ['Amsterdam'] }] }),
    );
    expect(points.every((p) => p.rowIndex === 1 || p.rowIndex === 3 || p.rowIndex === 5)).toBe(true);
    expect(points).toHaveLength(3);
  });

  it('"between" filter keeps only rows inside the numeric range', () => {
    const points = executeInstruction(
      dataset(),
      instruction({ filters: [{ column: 'c0', op: 'between', from: 2021, to: 2022 }] }),
    );
    expect(points.every((p) => p.xRaw === '2021' || p.xRaw === '2022')).toBe(true);
  });

  it('throws NoRowsError when a filter matches nothing (fixed in review: a real clarification, not a confusing empty chart)', () => {
    expect(() =>
      executeInstruction(dataset(), instruction({ filters: [{ column: 'c1', op: 'in', values: ['Den Haag'] }] })),
    ).toThrow(NoRowsError);
  });
});

describe('executeInstruction — seriesBy grouping (only y[0] used, execute.ts\'s documented choice)', () => {
  it('groups points into one series per distinct seriesBy value', () => {
    const points = executeInstruction(dataset(), instruction({ seriesBy: 'c1' }));
    const labels = new Set(points.map((p) => p.seriesLabel));
    expect(labels).toEqual(new Set(['Amsterdam', 'Rotterdam']));
  });
});

describe('executeInstruction — multiple y columns without seriesBy', () => {
  it('one series per y column, each labeled by its own header', () => {
    const cells = [
      ['Jaar', 'Omzet', 'Kosten'],
      ['2020', '100', '50'],
      ['2021', '120', '60'],
    ];
    const points = executeInstruction(
      dataset(cells),
      instruction({ y: ['c1', 'c2'] }),
    );
    const labels = new Set(points.map((p) => p.seriesLabel));
    expect(labels).toEqual(new Set(['Omzet', 'Kosten']));
    expect(points).toHaveLength(4); // 2 rows x 2 y columns
  });
});

describe('executeInstruction — duplicate column headers do not merge distinct y columns (fixed in review)', () => {
  it('gives two same-headed y columns distinct seriesKeys even though their seriesLabel matches', () => {
    const cells = [
      ['Jaar', 'Waarde', 'Waarde'],
      ['2020', '100', '200'],
    ];
    const points = executeInstruction(dataset(cells), instruction({ y: ['c1', 'c2'] }));
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.seriesKey).sort()).toEqual(['c1', 'c2']);
    expect(points.every((p) => p.seriesLabel === 'Waarde')).toBe(true);
  });
});

describe('executeInstruction — ordering', () => {
  it('a line chart ALWAYS orders by x ascending, ignoring any sort field (D7)', () => {
    const points = executeInstruction(
      dataset(),
      instruction({ kind: 'line', seriesBy: 'c1', sort: { by: 'x', direction: 'desc' } }),
    );
    const amsterdamXs = points.filter((p) => p.seriesLabel === 'Amsterdam').map((p) => p.xRaw);
    expect(amsterdamXs).toEqual(['2020', '2021', '2022']);
  });

  it('a bar chart honors an explicit sort direction', () => {
    const points = executeInstruction(
      dataset(),
      instruction({ kind: 'bar', x: 'c1', y: ['c2'], sort: { by: 'x', direction: 'desc' } }),
    );
    // x = Gemeente (text) here; desc alphabetical means Rotterdam before Amsterdam.
    expect(points[0]!.xRaw).toBe('Rotterdam');
  });

  it('a bar chart with no sort preserves file order (never guesses an ordering)', () => {
    const points = executeInstruction(dataset(), instruction({ kind: 'bar', x: 'c1', y: ['c2'], seriesBy: null }));
    expect(points.map((p) => p.rowIndex)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('executeInstruction — limit', () => {
  it('applies limit AFTER ordering', () => {
    const points = executeInstruction(dataset(), instruction({ limit: 2, filters: [{ column: 'c1', op: 'in', values: ['Amsterdam'] }] }));
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.xRaw)).toEqual(['2020', '2021']);
  });
});

describe('executeInstruction — the points cap is a refusal, never silent truncation (D7)', () => {
  it('throws TooManyPointsError over the cap', () => {
    const header = ['Jaar', 'Omzet'];
    const rows = Array.from({ length: 501 }, (_, i) => [`${1600 + i}`, `${i}`]);
    const bigDataset = dataset([header, ...rows]);
    expect(() => executeInstruction(bigDataset, instruction({ y: ['c1'] }))).toThrow(TooManyPointsError);
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
describe('aggregate (fixed set)', () => {
  it('sum per x groups rows and traces every source cell', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'sum' } }));
    expect(points.map((p) => [p.xRaw, p.computed?.value])).toEqual([['2020', 150], ['2021', 180]]);
    expect(points[0]!.computed!.rowRef).toBe('agg:sum:r1:c2+r2:c2');
    expect(points[1]!.computed!.rowRef).toBe('agg:sum:r3:c2+r4:c2+r5:c2'); // the empty cell is listed, not counted
  });
  it('mean uses 2 decimals, count counts rows, min/max pick', () => {
    const mean = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'mean' } }));
    expect(mean.map((p) => [p.computed?.value, p.computed?.decimals])).toEqual([[75, 2], [90, 2]]);
    const count = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'count' } }));
    expect(count.map((p) => p.computed?.value)).toEqual([2, 3]);
    const max = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], aggregate: { fn: 'max' } }));
    expect(max.map((p) => [p.xRaw, p.computed?.value])).toEqual([['Amsterdam', 150], ['Rotterdam', 50], ['Utrecht', 30]]);
  });
  it('aggregate with seriesBy groups per (series, x)', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'line', x: 'c0', y: ['c2'], seriesBy: 'c1', aggregate: { fn: 'sum' } }));
    expect(points.map((p) => [p.seriesKey, p.xRaw, p.computed?.value])).toEqual([
      ['Amsterdam', '2020', 100], ['Rotterdam', '2020', 50], ['Amsterdam', '2021', 150], ['Rotterdam', '2021', null], ['Utrecht', '2021', 30],
    ]);
  });
  it('sort by value desc + limit orders aggregated bars', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], aggregate: { fn: 'sum' }, sort: { by: 'value', direction: 'desc' }, limit: 2 }));
    expect(points.map((p) => [p.xRaw, p.computed?.value])).toEqual([['Amsterdam', 250], ['Rotterdam', 50]]);
  });
});
describe('derived (fixed set)', () => {
  it('difference a − b per row with a joined rowRef', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], filters: [{ column: 'c0', op: 'in', values: ['2020'] }], derived: { op: 'difference', b: 'c3' } }));
    expect(points.map((p) => [p.xRaw, p.computed?.value, p.computed?.rowRef])).toEqual([['Amsterdam', 40, 'der:difference:r1:c2|r1:c3'], ['Rotterdam', 30, 'der:difference:r2:c2|r2:c3']]);
  });
  it('ratio: b = 0 gives a null with reason geen getal', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], filters: [{ column: 'c0', op: 'in', values: ['2021'] }], derived: { op: 'ratio', b: 'c3' } }));
    expect(points.map((p) => [p.xRaw, p.computed?.value, p.computed?.reason])).toEqual([['Amsterdam', 150 / 90, undefined], ['Rotterdam', null, 'geen getal'], ['Utrecht', null, 'geen getal']]);
  });
  it('share_of_total sums non-null values of the series', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], filters: [{ column: 'c0', op: 'in', values: ['2020'] }], derived: { op: 'share_of_total', b: null } }));
    expect(points.map((p) => p.computed?.value)).toEqual([100 / 150 * 100, 50 / 150 * 100]);
    expect(points[0]!.computed!.decimals).toBe(1);
  });
  it('percent_change: first point null with reason geen vorige waarde, then (a−prev)/|prev|×100', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'line', x: 'c0', y: ['c2'], filters: [{ column: 'c1', op: 'in', values: ['Amsterdam'] }], derived: { op: 'percent_change', b: null } }));
    expect(points.map((p) => [p.computed?.value, p.computed?.reason])).toEqual([[null, 'geen vorige waarde'], [50, undefined]]);
  });
  it('aggregate then derive: share of total over yearly sums', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'sum' }, derived: { op: 'share_of_total', b: null } }));
    expect(points.map((p) => p.computed?.value)).toEqual([150 / 330 * 100, 180 / 330 * 100]);
  });
});

describe('aggregate/sort-by-value edge cases (fix round 1)', () => {
  it('multi-y + aggregate: each y column aggregates independently as its own series', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2', 'c3'], aggregate: { fn: 'sum' } }));
    const bySeries = new Map<string, [string, number | null, string | undefined][]>();
    for (const p of points) {
      const arr = bySeries.get(p.seriesKey) ?? [];
      arr.push([p.xRaw, p.computed?.value ?? null, p.computed?.rowRef]);
      bySeries.set(p.seriesKey, arr);
    }
    expect(bySeries.get('c2')).toEqual([
      ['2020', 150, 'agg:sum:r1:c2+r2:c2'],
      ['2021', 180, 'agg:sum:r3:c2+r4:c2+r5:c2'],
    ]);
    expect(bySeries.get('c3')).toEqual([
      ['2020', 80, 'agg:sum:r1:c3+r2:c3'],
      ['2021', 100, 'agg:sum:r3:c3+r4:c3+r5:c3'],
    ]);
  });

  it('sort by value with a null group: the null point is last in both directions, non-null points ordered correctly', () => {
    const cells = [
      ['Jaar', 'Gemeente', 'Omzet'],
      ['2020', 'Amsterdam', '100'],
      ['2020', 'Rotterdam', '50'],
      ['2020', 'Den Haag', ''],
    ];
    const asc = executeInstruction(
      dataset(cells),
      instruction({ kind: 'bar', x: 'c1', y: ['c2'], aggregate: { fn: 'max' }, sort: { by: 'value', direction: 'asc' } }),
    );
    expect(asc.map((p) => [p.xRaw, p.computed?.value])).toEqual([
      ['Rotterdam', 50],
      ['Amsterdam', 100],
      ['Den Haag', null],
    ]);

    const desc = executeInstruction(
      dataset(cells),
      instruction({ kind: 'bar', x: 'c1', y: ['c2'], aggregate: { fn: 'max' }, sort: { by: 'value', direction: 'desc' } }),
    );
    expect(desc.map((p) => [p.xRaw, p.computed?.value])).toEqual([
      ['Amsterdam', 100],
      ['Rotterdam', 50],
      ['Den Haag', null],
    ]);
  });
});
