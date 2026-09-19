// Chart co-pilot phase 5b — the "verified whole" check behind pie / stacked /
// 100%-stacked (docs/superpowers/specs/2026-09-17-chart-copilot-design.md
// §11). Those forms draw a whole (a full circle, a full bar) that the visible
// parts are claimed to add up to. This file is the ONE place that claim gets
// checked — and only for the one case where the data to check it already
// exists: a region-class roster (src/query/region-set.ts) whose parent total
// CBS publishes as its own cell.
//
// Two pure pieces, no database, no React:
//  - parentCellRef: which cell IS the roster's real total, per RegionScope.
//    A scope with no defined parent-total concept maps to null — never to a
//    guessed parent (principle (c)).
//  - verifyPartsSumToWhole: do already-fetched parts genuinely sum to that
//    already-fetched total, within a rounding tolerance? Any withheld part or
//    a missing whole REFUSES; "unknown" is never treated as zero and "no
//    total" is never treated as "matches anyway".
//
// Invariants this file serves:
//  - principle (a) / R5: nothing here computes a number that gets shown. The
//    sum is an internal check of a claim about cells the app already holds;
//    the caller (the phase 5b server action) re-fetches the parent cell from
//    OUR database and plots only real cells either way.
//  - R11: a null value carries a CBS reason; this layer honours it as
//    "unknown", exactly as derivations.ts's checkComputable does.
import type { RegionScope, ResultCell } from './types.ts';

/** The CBS dimension group holding the national total — same convention as
 * PROVINCE_GROUP ('PV') / LANDSDEEL_GROUP ('LD') in region-set.ts, verified
 * against both geo fixtures there. */
const NATIONAL_TOTAL_GROUP = 'NL';

/** Where the roster's whole lives: a dimension GROUP the caller resolves to
 * its (single) code per table, or one literal region CODE. */
export type ParentCellRef =
  | { kind: 'group'; group: string }
  | { kind: 'code'; code: string };

/**
 * The cell that is a region roster's real, CBS-published total — or null when
 * this phase defines none for the scope.
 *
 * 'all_provincies' and 'all_landsdelen' both partition the country, so their
 * whole is the national total (the 'NL' group). 'gemeenten_in_provincie'
 * partitions ONE province, so its whole is that province's own cell, never
 * the national one.
 *
 * 'all_gemeenten' is deliberately null: region-set.ts builds it as the union
 * over the GM<province> groups, which by construction leaves out group
 * 'OVERIG' (GM0997 "Centraal persoonsregister" on 03759ned) — so it is NOT a
 * partition of the national total on every table, and offering 'NL' as its
 * whole would be a guessed parent. Spec §11 scopes this phase to the PV / LD /
 * GM<pv> rosters; a whole for "alle gemeenten" is a later design if ever
 * wanted.
 *
 * Exhaustive over the REAL RegionScope union via the `never` check below — a
 * new variant fails the typecheck here rather than silently mapping to a
 * parent nobody vouched for. At runtime the same branch returns null: the
 * scope the caller hands in is read back from a STORED chart spec (R8 rows
 * live forever), so a kind this build does not know must refuse the whole,
 * not crash the request — the same graceful degradation region-set.ts's own
 * `default` applies.
 */
export function parentCellRef(scope: RegionScope): ParentCellRef | null {
  switch (scope.kind) {
    case 'all_provincies':
    case 'all_landsdelen':
      return { kind: 'group', group: NATIONAL_TOTAL_GROUP };
    case 'gemeenten_in_provincie':
      return { kind: 'code', code: scope.parent };
    case 'all_gemeenten':
      return null;
    default: {
      const unhandled: never = scope;
      void unhandled;
      return null;
    }
  }
}

/**
 * CBS rounds parts and totals independently, so a genuinely correct roster
 * can still be off from its published total by a small amount. Tolerance is
 * the LARGER of half a unit at the total's own published precision (pure
 * rounding slack) and 0.5% of the total's own value — named and adjustable
 * in exactly one place, per the design's own "not empirically tuned yet"
 * note (spec §11). Symmetric in sign: a negative total (a net figure) gets
 * the same slack as its positive counterpart.
 */
export function wholeSumTolerance(wholeValue: number, wholeDecimals: number): number {
  const halfUnitAtPrecision = 0.5 / 10 ** wholeDecimals;
  const halfPercent = Math.abs(wholeValue) * 0.005;
  return Math.max(halfUnitAtPrecision, halfPercent);
}

/** The slice of a ResultCell this check reads — a Pick so a real ResultCell
 * (or a live-embed/spec cell carrying the same fields) passes as-is. `value`
 * is null only with a CBS reason in `valueAttribute` (R11). */
export type PartCell = Pick<ResultCell, 'value' | 'decimals' | 'valueAttribute'>;

export type VerifyOutcome =
  | { verified: true }
  | { verified: false; reason: 'withheld_member' | 'sum_mismatch' | 'missing_whole' };

/**
 * Does a roster's parts sum to its whole, within wholeSumTolerance?
 *
 * `whole` may be null when the parent cell could not be fetched at all (e.g.
 * CBS hasn't published that period's national total yet), and a fetched
 * whole may itself carry a null value with a CBS reason — both refuse with
 * 'missing_whole'. Any part with `value === null` refuses with
 * 'withheld_member': CBS marking a cell withheld / not-yet-published means
 * "unknown", never "contributes zero" (the same rule phase 5's heatmap guard
 * established for a different case, session 116). Checked in that order, so
 * a roster with both problems reports the whole first — the caller cannot
 * fix a missing total by waiting for a member.
 *
 * The caller is responsible for the coordinate match: the whole must be the
 * same table / measure / period / dims as the parts. This function checks
 * arithmetic, not provenance.
 */
export function verifyPartsSumToWhole(parts: readonly PartCell[], whole: PartCell | null): VerifyOutcome {
  if (whole === null || whole.value === null) return { verified: false, reason: 'missing_whole' };
  if (parts.some((p) => p.value === null)) return { verified: false, reason: 'withheld_member' };
  const sum = parts.reduce((total, p) => total + (p.value as number), 0);
  const tolerance = wholeSumTolerance(whole.value, whole.decimals);
  return Math.abs(sum - whole.value) <= tolerance
    ? { verified: true }
    : { verified: false, reason: 'sum_mismatch' };
}
