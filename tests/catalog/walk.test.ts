// #172 step 0: candidateWalk — the deliverability walk's pure semantics.
// The invariants at stake: the model chain rides FIRST and VERBATIM (it
// carries the rerank's judgment, incl. a deliberately-historical alternate),
// the extension covers the FULL current remainder of the shortlist in
// shortlist order (any smaller cap provably misses the measured bijstand
// class — position 22/24), and non-current / unknown-source rows are never
// auto-walked (principle c: the extension bypasses the rerank's historical
// judgment, so it must not resurrect discontinued tables).
import { describe, expect, it } from 'vitest';
import { candidateWalk } from '../../src/catalog/walk.ts';
import type { CatalogCandidate, FindTableOutcome } from '../../src/catalog/types.ts';

function cand(tableId: string, status: string | null, rank = 0.5): CatalogCandidate {
  return { tableId, title: `t-${tableId}`, summary: '', status, datasetType: 'Numeric', rank };
}

function confident(
  pick: string,
  alternativeIds: string[],
  candidates: CatalogCandidate[],
): Extract<FindTableOutcome, { kind: 'confident' }> {
  return {
    kind: 'confident',
    pick: cand(pick, 'Regulier'),
    confidence: 0.9,
    reading: 'stub',
    alternativeIds,
    candidates,
  };
}

describe('candidateWalk (#172 step 0)', () => {
  it('walks pick, then alternates verbatim, then the FULL current remainder in shortlist order', () => {
    const shortlist = [
      cand('A', 'Regulier'),
      cand('B', 'Regulier'),
      cand('C', 'Regulier'),
      cand('D', 'Regulier'),
      cand('E', 'Regulier'),
    ];
    expect(candidateWalk(confident('B', ['D'], shortlist))).toEqual(['B', 'D', 'A', 'C', 'E']);
  });

  it('extension skips non-current and null-status rows — but keeps a HISTORICAL alternate (the model judged it)', () => {
    const shortlist = [
      cand('OLD1', 'Gediscontinueerd'),
      cand('A', 'Regulier'),
      cand('OLD2', 'Gediscontinueerd'),
      cand('NUL', null),
      cand('B', 'Regulier'),
    ];
    // OLD2 rides as a model alternate (verbatim); OLD1/NUL are never
    // auto-walked by the extension.
    expect(candidateWalk(confident('A', ['OLD2'], shortlist))).toEqual(['A', 'OLD2', 'B']);
  });

  it('extension skips an unknown-source prefixed id (the buildIsCurrentPredicate else-false direction, not the A1 display fallback)', () => {
    const shortlist = [cand('A', 'Regulier'), cand('xx:123', 'Regulier'), cand('B', 'Regulier')];
    expect(candidateWalk(confident('A', [], shortlist))).toEqual(['A', 'B']);
  });

  it('never duplicates: chain members already in the shortlist appear once, chain order wins', () => {
    const shortlist = [cand('A', 'Regulier'), cand('B', 'Regulier'), cand('C', 'Regulier')];
    expect(candidateWalk(confident('C', ['B'], shortlist))).toEqual(['C', 'B', 'A']);
  });

  it('the measured bijstand shape: a deliverable table DEEP in the shortlist is walked even when the model chain dropped it (the s54 drift class)', () => {
    // Mirrors the live measurement (2026-07-18): chain = 85585NED +
    // [82015NED, 85692NED]; 37789ksz far down the current remainder. A cap-6
    // walk misses it; the full walk must contain it.
    const shortlist = [
      cand('old-1', 'Gediscontinueerd', 0.5),
      cand('old-2', 'Gediscontinueerd', 0.42),
      cand('85615NED', 'Regulier', 0.3),
      cand('82015NED', 'Regulier', 0.29),
      cand('85617NED', 'Regulier', 0.24),
      cand('82020NED', 'Regulier', 0.17),
      cand('85585NED', 'Regulier', 0.15),
      cand('r-1', 'Regulier', 0.14),
      cand('r-2', 'Regulier', 0.13),
      cand('r-3', 'Regulier', 0.13),
      cand('85692NED', 'Regulier', 0.12),
      cand('r-4', 'Regulier', 0.12),
      cand('r-5', 'Regulier', 0.12),
      cand('37789ksz', 'Regulier', 0.076),
      cand('r-6', 'Regulier', 0.076),
    ];
    const walk = candidateWalk(confident('85585NED', ['82015NED', '85692NED'], shortlist));
    expect(walk.slice(0, 3)).toEqual(['85585NED', '82015NED', '85692NED']);
    expect(walk).toContain('37789ksz');
    expect(walk).not.toContain('old-1');
    expect(walk).not.toContain('old-2');
    // The walk is the full current shortlist: 13 current rows, no more.
    expect(walk).toHaveLength(13);
  });
});
