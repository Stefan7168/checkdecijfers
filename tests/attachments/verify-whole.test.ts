// verifyDatasetWhole — own-data's "verified whole" check (plan 2026-09-22,
// Task 4; the own-data analog of tests/query/whole-verification.test.ts).
// Pure function over dataset.cells + an already-validated instruction: no
// LLM, no db, no round trip. Mirrors derive-overlay.test.ts's own fixture
// style (a real UserDataset built from CSV-shaped cells, a real
// ChartInstruction) and whole-verification.test.ts's own four cases (a
// genuine match, a genuine mismatch, a null part, a null whole) —
// verifyPartsSumToWhole itself is reused UNCHANGED (tests/query/whole-
// verification.test.ts already proves its own tolerance/boundary math in
// full; this file proves only that rowRefs resolve to the SAME real cells
// executeInstruction would draw, exactly like deriveChartOverlay does).
import { describe, expect, it } from 'vitest';
import { verifyDatasetWhole } from '../../src/attachments/verify-whole.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import type { ChartInstruction, UserDataset } from '../../src/attachments/types.ts';

// One year's regional breakdown plus the reader's OWN "Totaal" row (a real
// row in their file, never a value this product invents) and one blank cell
// (the withheld/missing case). Row indices below follow this array's own
// order (header excluded): r1=Noord, r2=Zuid, r3=Oost, r4=Totaal, r5=Leeg —
// all in column c2 (Omzet). Noord+Zuid+Oost = 998, within tolerance of
// Totaal's 1000 (max(0.5, 0.5%*1000) = 5, same rule whole-verification.ts
// itself is tested against).
const CELLS = [
  ['Jaar', 'Regio', 'Omzet'],
  ['2020', 'Noord', '400'],
  ['2020', 'Zuid', '350'],
  ['2020', 'Oost', '248'],
  ['2020', 'Totaal', '1000'],
  ['2020', 'Leeg', ''],
];

function dataset(cells: string[][] = CELLS): UserDataset {
  return {
    id: 1,
    userId: 'u1',
    sourceKind: 'file_csv',
    displayName: 'omzet.csv',
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
    kind: 'bar',
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

describe('verifyDatasetWhole', () => {
  it('a genuine match: parts within tolerance of the reader-designated whole verify', () => {
    const outcome = verifyDatasetWhole(dataset(), instruction(), 'r4:c2', ['r1:c2', 'r2:c2', 'r3:c2']);
    expect(outcome).toEqual({ verified: true }); // 400+350+248 = 998, within 5 of 1000
  });

  it('a genuine mismatch: parts far from the whole refuse with sum_mismatch', () => {
    const outcome = verifyDatasetWhole(dataset(), instruction(), 'r4:c2', ['r1:c2', 'r2:c2']);
    expect(outcome).toEqual({ verified: false, reason: 'sum_mismatch' }); // 400+350 = 750 vs 1000
  });

  it('a null part (a blank cell among the parts) refuses with withheld_member — unknown is never zero', () => {
    const outcome = verifyDatasetWhole(dataset(), instruction(), 'r4:c2', ['r1:c2', 'r5:c2']);
    expect(outcome).toEqual({ verified: false, reason: 'withheld_member' });
  });

  it('a null whole (the designated cell itself is blank) refuses with missing_whole, never sum_mismatch', () => {
    const outcome = verifyDatasetWhole(dataset(), instruction(), 'r5:c2', ['r1:c2', 'r2:c2', 'r3:c2']);
    expect(outcome).toEqual({ verified: false, reason: 'missing_whole' });
  });

  // Own-data-specific: a rowRef that does not resolve to any point on THIS
  // chart at all (a stale designation over a dataset that changed since, or
  // a garbled request) — verify-whole.ts's own job (Step 2), distinct from
  // whole-verification.ts's pure boundary tests, which never see an
  // "unknown ref" at all (every PartCell there is hand-built).
  it('an unknown wholeRowRef (not on this chart) is treated as missing, never thrown', () => {
    const outcome = verifyDatasetWhole(dataset(), instruction(), 'r99:c2', ['r1:c2', 'r2:c2', 'r3:c2']);
    expect(outcome).toEqual({ verified: false, reason: 'missing_whole' });
  });

  it('an unknown partRowRef (not on this chart) is treated as withheld, never thrown', () => {
    const outcome = verifyDatasetWhole(dataset(), instruction(), 'r4:c2', ['r1:c2', 'r99:c2']);
    expect(outcome).toEqual({ verified: false, reason: 'withheld_member' });
  });

  it('an empty parts list never verifies against a non-zero whole', () => {
    const outcome = verifyDatasetWhole(dataset(), instruction(), 'r4:c2', []);
    expect(outcome).toEqual({ verified: false, reason: 'sum_mismatch' });
  });

  it('resolves an already-computed (aggregate) rowRef verbatim for both the whole and a part', () => {
    const cells = [
      ['Jaar', 'Regio', 'Omzet'],
      ['2020', 'Noord', '10'],
      ['2020', 'Zuid', '5'],
      ['2021', 'Noord', '20'],
      ['2021', 'Zuid', '15'],
    ];
    // Grouped by Regio (x), summed over Jaar: agg:sum:r1:c2+r3:c2 (Noord,
    // 10+20=30) and agg:sum:r2:c2+r4:c2 (Zuid, 5+15=20) — the SAME rowRef
    // shape executeInstruction/deriveChartOverlay already produce and a
    // pie/stack click would read off the rendered cell.
    const outcome = verifyDatasetWhole(
      dataset(cells),
      instruction({ x: 'c1', y: ['c2'], seriesBy: null, aggregate: { fn: 'sum' } }),
      'agg:sum:r1:c2+r3:c2',
      ['agg:sum:r2:c2+r4:c2'],
    );
    // 30 vs 20: tolerance is max(0.5, 0.5%*30) = 0.5 — far outside, a real mismatch.
    expect(outcome).toEqual({ verified: false, reason: 'sum_mismatch' });
  });
});
