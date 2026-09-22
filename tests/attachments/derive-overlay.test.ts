// deriveChartOverlay — the own-data addDerivedOverlay math (ADR 056 phases
// 4/6's own-data analog). Pure function over dataset.cells + an already-
// validated instruction: no LLM, no db. Selections are by ROWREF (the shape
// web/lib/chart-commands.ts's shared DerivedOverlayRequest.resultIds
// already uses, and what src/attachments/copilot/map.ts's chat mapper
// already resolves a typed label DOWN to before a command is ever stored —
// this function is never handed a label). Every test proves a returned
// value traces to real stored cells (R1) via its rowRef, that a mean skips
// a missing value exactly the way execute.ts's own aggregatePoints does,
// and that a selection which cannot resolve to a value refuses cleanly
// (OverlaySelectionError) rather than fabricating or silently defaulting.
import { describe, expect, it } from 'vitest';
import { deriveChartOverlay, OverlaySelectionError, type OverlaySelection } from '../../src/attachments/derive-overlay.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import type { ChartInstruction, UserDataset } from '../../src/attachments/types.ts';

// Two municipalities' yearly Omzet, seriesBy-grouped (the common "one line
// per series" own-data chart shape). Amsterdam's 2021 cell is blank — the
// "missing value in the middle" case; Utrecht's two cells are blank/
// unparseable — the "every value missing" case. Row indices below follow
// this array's own order (header excluded): r1=Amsterdam 2020, r2=Amsterdam
// 2021, r3=Amsterdam 2022, r4=Rotterdam 2020, r5=Rotterdam 2021, r6/r7=Utrecht.
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
    // Amsterdam's three own rowRefs (all column c2, the Omzet column).
    const result = deriveChartOverlay(dataset(), instruction(), { calcKind: 'mean', resultIds: ['r1:c2', 'r2:c2', 'r3:c2'] });
    expect(result.value).toBe(120); // (100 + 140) / 2 — the empty 2021 cell excluded, not counted
    expect(result.decimals).toBe(2);
    // Every member's ref is listed, INCLUDING the missing one (U1/U11), in
    // the order the caller supplied them.
    expect(result.rowRef).toBe('agg:mean:r1:c2+r2:c2+r3:c2');
  });

  it('refuses when every value in the series is missing (OverlaySelectionError, not a fabricated/zero value)', () => {
    // Utrecht's two own rowRefs (r6/r7, both blank/unparseable).
    expect(() => deriveChartOverlay(dataset(), instruction(), { calcKind: 'mean', resultIds: ['r6:c2', 'r7:c2'] })).toThrow(
      OverlaySelectionError,
    );
  });

  it('refuses fewer than two resultIds — a single point has nothing to average against', () => {
    expect(() => deriveChartOverlay(dataset(), instruction(), { calcKind: 'mean', resultIds: ['r1:c2'] })).toThrow(
      OverlaySelectionError,
    );
  });
});

describe('deriveChartOverlay — difference', () => {
  it('computes later minus earlier between two named points, with a joined der:difference rowRef', () => {
    const result = deriveChartOverlay(dataset(), instruction(), { calcKind: 'difference', resultIds: ['r1:c2', 'r3:c2'] });
    expect(result.value).toBe(40); // 140 - 100
    expect(result.decimals).toBe(0);
    expect(result.rowRef).toBe('der:difference:r1:c2|r3:c2');
  });

  it('is order-independent — naming the later point first never sign-flips the result', () => {
    const result = deriveChartOverlay(dataset(), instruction(), { calcKind: 'difference', resultIds: ['r3:c2', 'r1:c2'] });
    expect(result.value).toBe(40);
    expect(result.rowRef).toBe('der:difference:r1:c2|r3:c2');
  });

  it('refuses when one of the two named points has no value', () => {
    const selection: OverlaySelection = { calcKind: 'difference', resultIds: ['r1:c2', 'r2:c2'] }; // r2 is Amsterdam's blank 2021 cell
    expect(() => deriveChartOverlay(dataset(), instruction(), selection)).toThrow(OverlaySelectionError);
  });

  it('refuses the same rowRef named twice', () => {
    expect(() => deriveChartOverlay(dataset(), instruction(), { calcKind: 'difference', resultIds: ['r1:c2', 'r1:c2'] })).toThrow(
      OverlaySelectionError,
    );
  });

  it('refuses a resultIds length other than two', () => {
    expect(() =>
      deriveChartOverlay(dataset(), instruction(), { calcKind: 'difference', resultIds: ['r1:c2', 'r3:c2', 'r4:c2'] }),
    ).toThrow(OverlaySelectionError);
  });
});

describe('deriveChartOverlay — refusal paths', () => {
  it('refuses an unknown rowRef', () => {
    expect(() => deriveChartOverlay(dataset(), instruction(), { calcKind: 'mean', resultIds: ['r1:c2', 'r99:c2'] })).toThrow(
      OverlaySelectionError,
    );
  });
});

describe('deriveChartOverlay — resolving points without seriesBy (the y-column-header case)', () => {
  const SIMPLE = [
    ['Jaar', 'Omzet'],
    ['2020', '10'],
    ['2021', '20'],
  ];

  it('resolves each point under its own y column when no seriesBy is set', () => {
    const result = deriveChartOverlay(dataset(SIMPLE), instruction({ y: ['c1'], seriesBy: null }), {
      calcKind: 'difference',
      resultIds: ['r1:c1', 'r2:c1'],
    });
    expect(result.value).toBe(10);
    expect(result.rowRef).toBe('der:difference:r1:c1|r2:c1');
  });
});

describe('deriveChartOverlay — resultIds naming an already-computed (aggregate) point', () => {
  it('resolves an aggregate-mode rowRef verbatim, exactly as executeInstruction produced it', () => {
    const cells = [
      ['Jaar', 'Gemeente', 'Omzet'],
      ['2020', 'Amsterdam', '10'],
      ['2020', 'Rotterdam', '5'],
      ['2021', 'Amsterdam', '20'],
      ['2021', 'Rotterdam', '15'],
    ];
    // Row order above: r1/r2 are 2020's two municipalities, r3/r4 are
    // 2021's — aggregatePoints (execute.ts) groups by x and lists every
    // group member's own ref in its own agg:sum: rowRef, which is exactly
    // what a caller (the chat mapper, or a future on-screen picker reading
    // the already-drawn aggregated chart's own point refs) would name here.
    const result = deriveChartOverlay(dataset(cells), instruction({ x: 'c0', y: ['c2'], seriesBy: null, aggregate: { fn: 'sum' } }), {
      calcKind: 'difference',
      resultIds: ['agg:sum:r1:c2+r2:c2', 'agg:sum:r3:c2+r4:c2'],
    });
    expect(result.value).toBe(20); // (20+15) - (10+5)
    expect(result.rowRef).toBe('der:difference:agg:sum:r1:c2+r2:c2|agg:sum:r3:c2+r4:c2');
  });
});
