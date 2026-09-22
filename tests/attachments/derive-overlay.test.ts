// deriveChartOverlay — the own-data addDerivedOverlay math (ADR 056 phases
// 4/6's own-data analog). Pure function over dataset.cells + an already-
// validated instruction: no LLM, no db. Every test proves a returned value
// traces to real stored cells (R1) via its rowRef, that a mean skips a
// missing value exactly the way execute.ts's own aggregatePoints does, and
// that a selection which cannot resolve to a value refuses cleanly
// (OverlaySelectionError) rather than fabricating or silently defaulting.
import { describe, expect, it } from 'vitest';
import { deriveChartOverlay, OverlaySelectionError, type OverlaySelection } from '../../src/attachments/derive-overlay.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import type { ChartInstruction, UserDataset } from '../../src/attachments/types.ts';

// Two municipalities' yearly Omzet, seriesBy-grouped (the common "one line
// per series" own-data chart shape). Amsterdam's 2021 cell is blank — the
// "missing value in the middle" case; Utrecht's two cells are blank/
// unparseable — the "every value missing" case.
const CELLS = [
  ['Jaar', 'Gemeente', 'Omzet'],
  ['2020', 'Amsterdam', '100'],
  ['2021', 'Amsterdam', ''],
  ['2022', 'Amsterdam', '140'],
  ['2020', 'Rotterdam', '50'],
  ['2021', 'Rotterdam', '70'],
  ['2020', 'Utrecht', ''],
  ['2021', 'Utrecht', 'n.v.t.'],
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
    seriesBy: 'c1',
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

describe('deriveChartOverlay — mean', () => {
  it('averages a series, skipping a missing value in the middle (matches execute.ts aggregatePoints exactly)', () => {
    const result = deriveChartOverlay(dataset(), instruction(), { calcKind: 'mean', seriesLabel: 'Amsterdam' });
    expect(result.value).toBe(120); // (100 + 140) / 2 — the empty 2021 cell excluded, not counted
    expect(result.decimals).toBe(2);
    // Every member's ref is listed, INCLUDING the missing one (U1/U11) — row
    // indices: r1=2020, r2=2021 (blank), r3=2022, all column c2 (Omzet).
    expect(result.rowRef).toBe('agg:mean:r1:c2+r2:c2+r3:c2');
  });

  it('refuses when every value in the series is missing (OverlaySelectionError, not a fabricated/zero value)', () => {
    expect(() => deriveChartOverlay(dataset(), instruction(), { calcKind: 'mean', seriesLabel: 'Utrecht' })).toThrow(
      OverlaySelectionError,
    );
  });
});

describe('deriveChartOverlay — difference', () => {
  it('computes later minus earlier between two named points, with a joined der:difference rowRef', () => {
    const result = deriveChartOverlay(dataset(), instruction(), {
      calcKind: 'difference',
      seriesLabel: 'Amsterdam',
      pointLabels: ['2020', '2022'],
    });
    expect(result.value).toBe(40); // 140 - 100
    expect(result.decimals).toBe(0);
    expect(result.rowRef).toBe('der:difference:r1:c2|r3:c2');
  });

  it('is order-independent — naming the later point first never sign-flips the result', () => {
    const result = deriveChartOverlay(dataset(), instruction(), {
      calcKind: 'difference',
      seriesLabel: 'Amsterdam',
      pointLabels: ['2022', '2020'],
    });
    expect(result.value).toBe(40);
    expect(result.rowRef).toBe('der:difference:r1:c2|r3:c2');
  });

  it('refuses when one of the two named points has no value', () => {
    const selection: OverlaySelection = { calcKind: 'difference', seriesLabel: 'Amsterdam', pointLabels: ['2020', '2021'] };
    expect(() => deriveChartOverlay(dataset(), instruction(), selection)).toThrow(OverlaySelectionError);
  });
});

describe('deriveChartOverlay — refusal paths', () => {
  it('refuses an unknown series label', () => {
    expect(() =>
      deriveChartOverlay(dataset(), instruction(), { calcKind: 'mean', seriesLabel: 'Den Haag' }),
    ).toThrow(OverlaySelectionError);
  });

  it('refuses an unknown point label', () => {
    expect(() =>
      deriveChartOverlay(dataset(), instruction(), { calcKind: 'difference', seriesLabel: 'Amsterdam', pointLabels: ['2020', '2099'] }),
    ).toThrow(OverlaySelectionError);
  });
});

describe('deriveChartOverlay — series label without seriesBy (the y-column-header case)', () => {
  const SIMPLE = [
    ['Jaar', 'Omzet'],
    ['2020', '10'],
    ['2021', '20'],
  ];

  it('resolves the series by the y column header when no seriesBy is set', () => {
    const result = deriveChartOverlay(
      dataset(SIMPLE),
      instruction({ y: ['c1'], seriesBy: null }),
      { calcKind: 'difference', seriesLabel: 'Omzet', pointLabels: ['2020', '2021'] },
    );
    expect(result.value).toBe(10);
    expect(result.rowRef).toBe('der:difference:r1:c1|r2:c1');
  });
});

describe('deriveChartOverlay — series label matches the aggregate-decorated display label', () => {
  it('matches "Sum of Omzet", not the raw column header, when instruction.aggregate is set', () => {
    const cells = [
      ['Jaar', 'Gemeente', 'Omzet'],
      ['2020', 'Amsterdam', '10'],
      ['2020', 'Rotterdam', '5'],
      ['2021', 'Amsterdam', '20'],
      ['2021', 'Rotterdam', '15'],
    ];
    const result = deriveChartOverlay(
      dataset(cells),
      instruction({ x: 'c0', y: ['c2'], seriesBy: null, aggregate: { fn: 'sum' } }),
      { calcKind: 'difference', seriesLabel: 'Sum of Omzet', pointLabels: ['2020', '2021'] },
    );
    expect(result.value).toBe(20); // (20+15) - (10+5)
    expect(result.rowRef).toBe('der:difference:agg:sum:r1:c2+r2:c2|agg:sum:r3:c2+r4:c2');
  });
});
