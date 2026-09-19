// Chart co-pilot phase 5b Task 1 — the "verified whole" check (spec §11),
// pure and hermetic: no database, no fixtures. Every number below is a
// SYNTHETIC test value, chosen for clean arithmetic, never a real CBS figure.
//
// What this proves:
//  - parentCellRef is exhaustive over the REAL RegionScope union (four
//    variants, not the three the plan first assumed) and maps
//    'all_gemeenten' to null rather than to a guessed parent.
//  - the tolerance is the LARGER of half-a-unit-at-precision and 0.5% of the
//    total, symmetric in sign.
//  - verifyPartsSumToWhole refuses on a withheld member and on a missing
//    whole even when the remaining arithmetic would have "worked", and its
//    boundary is inclusive (<=) by design, not by accident.
import { describe, expect, it } from 'vitest';
import type { RegionScope } from '../../src/query/types.ts';
import {
  parentCellRef,
  verifyPartsSumToWhole,
  wholeSumTolerance,
  type PartCell,
} from '../../src/query/whole-verification.ts';

/** A published cell: value present, CBS's own "nothing to report" attribute. */
function cell(value: number, decimals = 0): PartCell {
  return { value, decimals, valueAttribute: 'None' };
}

/** A withheld cell: null value WITH a CBS reason (R11). */
function withheld(decimals = 0): PartCell {
  return { value: null, decimals, valueAttribute: 'Onbekend' };
}

describe('parentCellRef — which cell is the roster\'s real total', () => {
  it('all_provincies → the national total group NL', () => {
    expect(parentCellRef({ kind: 'all_provincies' })).toEqual({ kind: 'group', group: 'NL' });
  });

  it('all_landsdelen → the national total group NL', () => {
    expect(parentCellRef({ kind: 'all_landsdelen' })).toEqual({ kind: 'group', group: 'NL' });
  });

  it('gemeenten_in_provincie → the named province\'s OWN code, never the national total', () => {
    expect(parentCellRef({ kind: 'gemeenten_in_provincie', parent: 'PV26' })).toEqual({ kind: 'code', code: 'PV26' });
    expect(parentCellRef({ kind: 'gemeenten_in_provincie', parent: 'PV20' })).toEqual({ kind: 'code', code: 'PV20' });
  });

  it('all_gemeenten → null: the GM<pv> union excludes group OVERIG, so NL is not its verified whole', () => {
    expect(parentCellRef({ kind: 'all_gemeenten' })).toBeNull();
  });

  it('a kind this build does not know (read back from a stored spec) → null, never a throw or a guess', () => {
    const foreign = { kind: 'all_corop' } as unknown as RegionScope;
    expect(parentCellRef(foreign)).toBeNull();
  });
});

describe('wholeSumTolerance — the larger of half a unit at precision and 0.5% of the total', () => {
  it('a large integer total is governed by the 0.5% rule', () => {
    // half unit at 0 decimals = 0.5; 0.5% of 1000 = 5 → 5
    expect(wholeSumTolerance(1000, 0)).toBe(5);
  });

  it('a small integer total is governed by the half-unit rule', () => {
    // half unit = 0.5; 0.5% of 10 = 0.05 → 0.5
    expect(wholeSumTolerance(10, 0)).toBe(0.5);
  });

  it('precision shrinks the half-unit slack, so the 0.5% rule wins sooner', () => {
    // half unit at 1 decimal = 0.05; 0.5% of 12.5 = 0.0625 → 0.0625
    expect(wholeSumTolerance(12.5, 1)).toBeCloseTo(0.0625, 10);
    // half unit at 2 decimals = 0.005; 0.5% of 3.2 = 0.016 → 0.016
    expect(wholeSumTolerance(3.2, 2)).toBeCloseTo(0.016, 10);
    // half unit at 2 decimals = 0.005; 0.5% of 0.4 = 0.002 → 0.005
    expect(wholeSumTolerance(0.4, 2)).toBeCloseTo(0.005, 10);
  });

  it('is symmetric in sign — a negative net total gets the same slack', () => {
    expect(wholeSumTolerance(-200, 0)).toBe(1);
    expect(wholeSumTolerance(200, 0)).toBe(1);
  });

  it('a zero total still keeps the half-unit rounding slack', () => {
    expect(wholeSumTolerance(0, 0)).toBe(0.5);
  });
});

describe('verifyPartsSumToWhole', () => {
  it('a genuine match: parts within tolerance of the whole verify', () => {
    // 400 + 350 + 248 = 998; whole 1000 at 0 decimals → tolerance 5.
    const outcome = verifyPartsSumToWhole([cell(400), cell(350), cell(248)], cell(1000));
    expect(outcome).toEqual({ verified: true });
  });

  it('an exact match verifies', () => {
    expect(verifyPartsSumToWhole([cell(250), cell(750)], cell(1000))).toEqual({ verified: true });
  });

  it('a genuine mismatch: one part doubled refuses with sum_mismatch', () => {
    // 800 + 350 + 248 = 1398 vs 1000 — far outside any rounding slack.
    const outcome = verifyPartsSumToWhole([cell(800), cell(350), cell(248)], cell(1000));
    expect(outcome).toEqual({ verified: false, reason: 'sum_mismatch' });
  });

  it('a withheld member refuses even though the OTHER parts sum exactly to the whole', () => {
    // 400 + 600 = 1000 already — but the null member is "unknown", not zero,
    // so the roster cannot be vouched for.
    const outcome = verifyPartsSumToWhole([cell(400), cell(600), withheld()], cell(1000));
    expect(outcome).toEqual({ verified: false, reason: 'withheld_member' });
  });

  it('a null whole (parent cell not fetched) refuses with missing_whole', () => {
    expect(verifyPartsSumToWhole([cell(400), cell(600)], null)).toEqual({ verified: false, reason: 'missing_whole' });
  });

  it('a fetched whole whose own value is withheld refuses with missing_whole, not sum_mismatch', () => {
    expect(verifyPartsSumToWhole([cell(400), cell(600)], withheld())).toEqual({ verified: false, reason: 'missing_whole' });
  });

  it('a missing whole is reported before a withheld member', () => {
    expect(verifyPartsSumToWhole([cell(400), withheld()], null)).toEqual({ verified: false, reason: 'missing_whole' });
  });

  it('the boundary is inclusive: exactly at tolerance verifies, one unit past it refuses', () => {
    // whole 1000 at 0 decimals → tolerance 5 (0.5% rule). Integers keep the
    // subtraction exact, so this pins the <= deliberately.
    expect(verifyPartsSumToWhole([cell(600), cell(405)], cell(1000))).toEqual({ verified: true });
    expect(verifyPartsSumToWhole([cell(600), cell(395)], cell(1000))).toEqual({ verified: true });
    expect(verifyPartsSumToWhole([cell(600), cell(406)], cell(1000))).toEqual({ verified: false, reason: 'sum_mismatch' });
    expect(verifyPartsSumToWhole([cell(600), cell(394)], cell(1000))).toEqual({ verified: false, reason: 'sum_mismatch' });
  });

  it('the tolerance is taken from the WHOLE\'s own precision, not the parts\'', () => {
    // whole 10.0 at 1 decimal → half unit 0.05, 0.5% = 0.05 → tolerance 0.05.
    // Parts at 2 decimals summing to 10.04 sit inside it; 10.10 does not.
    expect(verifyPartsSumToWhole([cell(4.02, 2), cell(6.02, 2)], cell(10, 1))).toEqual({ verified: true });
    expect(verifyPartsSumToWhole([cell(4.05, 2), cell(6.05, 2)], cell(10, 1))).toEqual({ verified: false, reason: 'sum_mismatch' });
  });

  it('an empty roster never verifies against a non-zero whole', () => {
    expect(verifyPartsSumToWhole([], cell(1000))).toEqual({ verified: false, reason: 'sum_mismatch' });
  });
});
