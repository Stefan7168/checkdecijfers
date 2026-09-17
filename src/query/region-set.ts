// #253 — region-class ROSTER resolution: "all provincies", "all gemeenten",
// "the gemeenten in <province>" → the actual CBS region codes, read from the
// database, per table.
//
// Membership source: `dimension_labels.dimension_group` — CBS's own
// `DimensionGroupId` from the `{Dim}Codes` metadata, parsed by
// src/cbs-adapter/parse-v4.ts and written by src/ingestion/pipeline.ts since
// migration 001. Verified against both geo fixtures: group 'PV' = the 12
// provinces, 'LD' = the 4 landsdelen, 'NL' = the national total,
// 'GMPV20'…'GMPV31' = the gemeenten GROUPED BY their province, 'CRPV##' =
// COROP regions, and 'OVERIG' = GM0997 "Centraal persoonsregister" — which is
// exactly why "alle gemeenten" selects on the GROUP and never on the 'GM' code
// prefix.
//
// Invariants this file serves:
//  - principle (c) / "never guess a roster": the 'GM' + <province code> group
//    name is a composition read off the DATA, not a CBS contract, so it is
//    VERIFIED on every call. A group that yields zero codes REFUSES; there is
//    no prefix-scan fallback anywhere in this file.
//    **Assumption** (mirrored in docs/open-questions.md): CBS keeps naming a
//    province's gemeente group 'GM' + the province's own code. An ingestion
//    conformance check asserts this per registered geo table, so a CBS rename
//    fails loudly at sync time rather than silently at answer time.
//  - R5: class membership is a CBS FACT this layer reads; nothing here
//    computes or infers a member.
//  - docs/05's "outside the loaded slice" vs "not published" split: a roster
//    whose members are all outside the table's registered geo slice refuses
//    with its own reason, distinct from an empty/unverifiable roster.
import type { Db } from '../db/types.ts';
import type { RegionScope } from './types.ts';

/** The CBS dimension group holding the provinces. */
const PROVINCE_GROUP = 'PV';
/** The CBS dimension group holding the landsdelen. */
const LANDSDEEL_GROUP = 'LD';

/** The gemeente group for one province — composed, then VERIFIED non-empty by
 * every caller below (never assumed; see the file header). */
function gemeenteGroupFor(provinceCode: string): string {
  return `GM${provinceCode}`;
}

export type RegionSetOutcome =
  | {
      ok: true;
      /** The roster members we can actually serve, in CBS's own sort order. */
      codes: string[];
      /** Roster members that exist for this table but sit OUTSIDE its
       * registered geo slice. Present (usually empty) so the caller can record
       * them as a coverage gap: a class answer that silently dropped members
       * we never ingested would be a ranking claim the data cannot support. */
      excludedBySlice: string[];
    }
  | { ok: false; reason: 'empty_roster' | 'outside_slice'; detail: string };

/** Reads the codes of one or more CBS dimension groups, in CBS's own order
 * (`sort_index`, then code for rows CBS left unindexed). */
async function codesInGroups(
  db: Db,
  tableId: string,
  dimension: string,
  groups: string[],
): Promise<string[]> {
  if (groups.length === 0) return [];
  const { rows } = await db.query(
    `select code from dimension_labels
      where table_id = $1 and dimension = $2 and dimension_group = any($3::text[])
      order by coalesce(sort_index, 2147483647), code`,
    [tableId, dimension, groups],
  );
  return rows.map((r) => r.code as string);
}

/**
 * Resolves a region CLASS to the region codes of ONE table.
 *
 * Per table, deliberately: 03759ned carries 892 region codes and 83625NED 745,
 * and they disagree on which gemeenten exist (PV26 has 54 in the first and 42
 * in the second). A single global list would be wrong for one of them, which
 * is the whole reason this reads CBS's per-table metadata instead.
 *
 * @param slicePrefixes the table's registered geo-slice prefixes
 *   (`slice.dimensionPrefixes[geoDimension]`), or null/undefined when the full
 *   region dimension is ingested.
 */
export async function resolveRegionSet(
  db: Db,
  tableId: string,
  geoDimension: string,
  scope: RegionScope,
  slicePrefixes: string[] | null | undefined,
): Promise<RegionSetOutcome> {
  let roster: string[];
  let describe: string;

  switch (scope.kind) {
    case 'all_provincies': {
      roster = await codesInGroups(db, tableId, geoDimension, [PROVINCE_GROUP]);
      describe = `dimension group "${PROVINCE_GROUP}"`;
      break;
    }
    case 'all_landsdelen': {
      roster = await codesInGroups(db, tableId, geoDimension, [LANDSDEEL_GROUP]);
      describe = `dimension group "${LANDSDEEL_GROUP}"`;
      break;
    }
    case 'gemeenten_in_provincie': {
      // Verify the parent is a real PROVINCE of this table before composing a
      // group name from it — an unknown or non-province code must refuse, not
      // produce a group name nobody can vouch for.
      const provinces = await codesInGroups(db, tableId, geoDimension, [PROVINCE_GROUP]);
      if (!provinces.includes(scope.parent)) {
        return {
          ok: false,
          reason: 'empty_roster',
          detail: `"${scope.parent}" is not a province of table "${tableId}" (dimension "${geoDimension}", group "${PROVINCE_GROUP}")`,
        };
      }
      const group = gemeenteGroupFor(scope.parent);
      roster = await codesInGroups(db, tableId, geoDimension, [group]);
      if (roster.length === 0) {
        return {
          ok: false,
          reason: 'empty_roster',
          detail: `dimension group "${group}" is empty for table "${tableId}" — the gemeenten of ${scope.parent} cannot be established from CBS's own metadata, and this layer does not guess a roster`,
        };
      }
      describe = `dimension group "${group}"`;
      break;
    }
    case 'all_gemeenten': {
      const provinces = await codesInGroups(db, tableId, geoDimension, [PROVINCE_GROUP]);
      if (provinces.length === 0) {
        return {
          ok: false,
          reason: 'empty_roster',
          detail: `dimension group "${PROVINCE_GROUP}" is empty for table "${tableId}" — "alle gemeenten" is the union over the provinces, so it cannot be established`,
        };
      }
      const groups = provinces.map(gemeenteGroupFor);
      // Verified per province, not in bulk: a union that silently loses one
      // province would answer for eleven of twelve and still call itself
      // "alle gemeenten".
      const perGroup = await Promise.all(
        groups.map(async (group) => ({ group, codes: await codesInGroups(db, tableId, geoDimension, [group]) })),
      );
      const emptyGroup = perGroup.find((g) => g.codes.length === 0);
      if (emptyGroup) {
        return {
          ok: false,
          reason: 'empty_roster',
          detail: `dimension group "${emptyGroup.group}" is empty for table "${tableId}" — "alle gemeenten" would be missing a whole province, so the roster is refused rather than served incomplete`,
        };
      }
      roster = perGroup.flatMap((g) => g.codes);
      describe = `dimension groups ${groups.join(', ')}`;
      break;
    }
    default: {
      const unknown = scope as { kind: string };
      return { ok: false, reason: 'empty_roster', detail: `unknown region scope "${unknown.kind}"` };
    }
  }

  if (roster.length === 0) {
    return {
      ok: false,
      reason: 'empty_roster',
      detail: `${describe} is empty for table "${tableId}" (dimension "${geoDimension}") — no roster to answer over`,
    };
  }

  if (!slicePrefixes || slicePrefixes.length === 0) {
    return { ok: true, codes: roster, excludedBySlice: [] };
  }
  const inSlice = roster.filter((code) => slicePrefixes.some((p) => code.startsWith(p)));
  const kept = new Set(inSlice);
  if (inSlice.length === 0) {
    return {
      ok: false,
      reason: 'outside_slice',
      detail: `every member of ${describe} is outside the loaded slice of table "${tableId}" (loaded: ${slicePrefixes.map((p) => `${p}…`).join(', ')}) — CBS publishes these regions, but they are outside our ingested slice`,
    };
  }
  return {
    ok: true,
    codes: inSlice,
    excludedBySlice: roster.filter((code) => !kept.has(code)),
  };
}
