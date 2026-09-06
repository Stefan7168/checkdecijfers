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
    version: 1,
    kind: 'line',
    x: 'c0',
    y: ['c2'],
    seriesBy: null,
    filters: [],
    sort: null,
    limit: null,
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
