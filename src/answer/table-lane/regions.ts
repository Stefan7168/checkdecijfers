// Breadth step 5, Task 2 — the table lane's region resolver (plan
// docs/superpowers/plans/2026-09-29-breadth-step-5-table-lane-wiring.md,
// "Settled design choices" 5–7; open-questions #339 (5), (8)).
//
// Turns the table parser's region terms into CBS region codes on ONE table's
// own region dimension(s) — geo (CBS kind GeoDimension) and geo-like (a plain
// Dimension whose members are ≥ 80 % region-coded, step 3's classifier) are
// treated alike. Pure and synchronous: no db, no LLM call (principle a).
// Every non-happy branch is a button question or a typed refusal, never a
// nearest match (principle c):
//   - a named place matches on memberPlaceKey (normalizeRegionName(baseLabel(
//     title))) over the dimension's own labels, filtered by the reader's place
//     kind (placeKindAllowsCode); 0 matches → `region_unknown`; several → a
//     question over exactly those matches;
//   - no place named → the dimension's single `NL…` member, stated as a
//     default; none or several → a question;
//   - a table with BOTH a region dimension AND region-coded breakdown members
//     refuses any named place (`region_unavailable`, the safe side);
//   - a national-only table (no region dimension, no region-coded breakdown
//     member) absorbs "Nederland"/"heel Nederland" — unless its title says
//     "Caribisch" — and states "Regio: Nederland (landelijke tabel)"; any
//     other place there is `region_unavailable`;
//   - a region class (`regionScope`) is resolved by resolveTableRegionClass
//     below (2026-10-01, #340) BEFORE this resolver runs; resolveTableRegions
//     itself still refuses a non-null class (`table_lane_region_class`), so a
//     caller that skips the class step can never answer a class as places.
import { eurostatGeoCodeForDutchName, isEurostatCountryOrAggregateCode } from '../../sources/eurostat-geo-names.ts';
import { EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../../sources/registry.ts';
import type { RegionScopeKind, RegionTerm } from '../intent/types.ts';
import { regionRoster } from '../../query/region-set.ts';
import type { RegionScope } from '../../query/types.ts';
import {
  REGION_MEMBER_CODE,
  memberPlaceKey,
  placeKindAllowsCode,
  readerPlaceKey,
  readerPlaceKinds,
} from '../table-parse/places.ts';
import { normalizeRegionName } from '../../sources/region-names.ts';
import {
  classifyDimension,
  dimensionLabel,
  toQuestion,
  type BreakdownDimension,
  type BreakdownMember,
  type BreakdownQuestion,
  type StatedDefault,
} from '../../query/breakdowns.ts';
import type { TableLaneChoice, TableLaneTable } from './types.ts';

export type TableRegionResolution =
  | {
      ok: true;
      coordinates: Record<string, string[]>;
      defaults: StatedDefault[];
      named: StatedDefault[];
      /** Present-only: "Nederland" was absorbed by a national-only table
       * (Settled design choice 5) — rendered as its own selection line. */
      nationalTable?: true;
    }
  | { ok: false; question: BreakdownQuestion }
  | { ok: false; reason: 'region_unknown' | 'region_unavailable' | 'table_lane_region_class'; detail: string };

/** The curated resolver's own "the whole country" test
 * (src/answer/intent/resolve.ts): "Nederland" or "heel Nederland". */
const NATIONAL_NAME = /^(heel )?nederland$/;

export function isNationalTerm(term: RegionTerm): boolean {
  return NATIONAL_NAME.test(normalizeRegionName(term.name));
}

/** A CBS national member: the NL region family ("NL01"). */
const NATIONAL_MEMBER_CODE = /^NL\d/;

function stated(d: BreakdownDimension, m: BreakdownMember): StatedDefault {
  return { dimension: d.name, dimensionTitle: dimensionLabel(d), code: m.code, memberTitle: m.title };
}

function refuse(
  reason: 'region_unknown' | 'region_unavailable' | 'table_lane_region_class',
  detail: string,
): TableRegionResolution {
  return { ok: false, reason, detail };
}

/**
 * Session 153 (Eurostat study step 4): a named place on a EUROSTAT table — the
 * same rule as the curated Eurostat answers (src/answer/intent/resolve.ts):
 * a Dutch country name ("Duitsland") through the reviewed Dutch name list
 * first, else the member's own English label ("Germany"); a place kind other
 * than "land" can never match (Eurostat answers countries and aggregates only).
 */
function eurostatPlaceMatches(dim: BreakdownDimension, term: RegionTerm, kind: string | null): BreakdownMember[] {
  const code = eurostatGeoCodeForDutchName(term.name);
  let matches =
    code !== null && dim.members.some((m) => m.code === code)
      ? dim.members.filter((m) => m.code === code)
      : dim.members.filter((m) => memberPlaceKey(m.title) === readerPlaceKey(term.name));
  if (kind !== null) matches = kind === 'land' ? matches.filter((m) => isEurostatCountryOrAggregateCode(m.code)) : [];
  return matches;
}

export function resolveTableRegions(input: {
  terms: RegionTerm[];
  regionScope: RegionScopeKind | null;
  table: TableLaneTable;
  regionDims: BreakdownDimension[];
  hasRegionCodedBreakdownMember: boolean;
  choices: TableLaneChoice[];
}): TableRegionResolution {
  const { terms, regionScope, table, regionDims, hasRegionCodedBreakdownMember, choices } = input;

  // Defence in depth: planTableLane resolves a region class through
  // resolveTableRegionClass first and calls this resolver with null (or with
  // the named places, when those win); kept so a direct caller cannot answer
  // a class as if it were places.
  if (regionScope !== null) {
    return refuse('table_lane_region_class', `the question asks about the region class '${regionScope}'`);
  }

  // --- No region dimension ----------------------------------------------------
  if (regionDims.length === 0) {
    if (terms.length === 0) return { ok: true, coordinates: {}, defaults: [], named: [] };
    if (hasRegionCodedBreakdownMember) {
      // The parser already bound every named place to a region-coded
      // breakdown member (or refused) — validateTableParseOutput's
      // checkRegionsOnRegionlessTable. The breakdown coordinate carries it.
      return { ok: true, coordinates: {}, defaults: [], named: [] };
    }
    const other = terms.filter((t) => !isNationalTerm(t));
    if (other.length > 0) {
      return refuse(
        'region_unavailable',
        `table '${table.schema.tableId}' has no region dimension; named place(s): ${other.map((t) => t.name).join(', ')}`,
      );
    }
    if (/caribisch/i.test(table.schema.title)) {
      return refuse(
        'region_unavailable',
        `"Nederland" named on table '${table.schema.tableId}', whose title names Caribisch Nederland — not absorbed`,
      );
    }
    return { ok: true, coordinates: {}, defaults: [], named: [], nationalTable: true };
  }

  // --- Region dimension(s) ------------------------------------------------------
  const regionDimNames = new Set(regionDims.map((d) => d.name));
  const queue = new Map<string, string[]>();
  for (const choice of choices) {
    if (!regionDimNames.has(choice.dimension)) continue;
    const dim = regionDims.find((d) => d.name === choice.dimension)!;
    if (!dim.members.some((m) => m.code === choice.code)) {
      throw new Error(
        `resolveTableRegions: choice '${choice.code}' is not a member of region dimension '${choice.dimension}' — ` +
          'choices are validated against the full member list before they are stored',
      );
    }
    const list = queue.get(choice.dimension) ?? [];
    list.push(choice.code);
    queue.set(choice.dimension, list);
  }
  // A reader's pick is bound to the question it answers by MEMBERSHIP, never
  // by queue position: the parse is re-run every button round and may list
  // the places in another order, so the first queued code that is one of
  // THIS question's options is consumed; none → the question is asked again.
  // A queued code that fits no open question is never applied.
  const takeChoice = (dim: BreakdownDimension, allowed: BreakdownMember[]): BreakdownMember | null => {
    const list = queue.get(dim.name);
    if (!list) return null;
    const index = list.findIndex((code) => allowed.some((m) => m.code === code));
    if (index === -1) return null;
    const [code] = list.splice(index, 1);
    return allowed.find((m) => m.code === code)!;
  };

  const coordinates: Record<string, string[]> = {};
  const defaults: StatedDefault[] = [];
  const named: StatedDefault[] = [];

  if (terms.length === 0) {
    for (const dim of regionDims) {
      const nationals = dim.members.filter((m) => NATIONAL_MEMBER_CODE.test(m.code));
      if (nationals.length === 1) {
        // No question is ever asked here, so no stored choice applies.
        coordinates[dim.name] = [nationals[0]!.code];
        defaults.push(stated(dim, nationals[0]!));
        continue;
      }
      // The question offered the several NL members, or (none) the full list.
      const options = nationals.length === 0 ? dim.members : nationals;
      const chosen = takeChoice(dim, options);
      if (chosen) {
        coordinates[dim.name] = [chosen.code];
        named.push(stated(dim, chosen));
        continue;
      }
      return { ok: false, question: toQuestion({ ...dim, members: options }) };
    }
    return { ok: true, coordinates, defaults, named };
  }

  if (hasRegionCodedBreakdownMember) {
    return refuse(
      'region_unavailable',
      `table '${table.schema.tableId}' has a region dimension AND region-coded breakdown members — a named place is ` +
        'not resolved on such a table',
    );
  }
  if (regionDims.length > 1) {
    // **Assumption:** no measured CBS table has two region dimensions; which
    // one a place belongs to would be a guess, so a named place is refused.
    return refuse(
      'region_unavailable',
      `table '${table.schema.tableId}' has ${regionDims.length} region dimensions — a named place is not resolved`,
    );
  }

  const dim = regionDims[0]!;
  const isGeo = classifyDimension(dim) === 'geo';
  const isEurostatTable = sourceKeyForTableId(table.schema.tableId) === EUROSTAT_SOURCE_KEY;
  const codes: string[] = [];
  for (const term of terms) {
    const kinds = readerPlaceKinds(term.name, term.kind);
    if (kinds.length > 1) {
      return refuse(
        'region_unavailable',
        `named place '${term.name}' carries conflicting place kinds (${kinds.join(', ')}) — never resolved by picking one`,
      );
    }
    const kind = kinds[0] ?? null;
    const key = isNationalTerm(term) ? 'nederland' : readerPlaceKey(term.name);
    const matches = isEurostatTable
      ? eurostatPlaceMatches(dim, term, kind)
      : dim.members.filter(
          (m) =>
            memberPlaceKey(m.title) === key &&
            // A geo-like dimension may carry a few non-region members; only its
            // region-coded members can be the place (places.ts's rule).
            (isGeo || REGION_MEMBER_CODE.test(m.code)) &&
            (kind === null || placeKindAllowsCode(kind, m.code)),
        );
    let picked: BreakdownMember;
    if (matches.length === 0) {
      return refuse('region_unknown', `no member of '${dim.name}' matches the named place '${term.name}'`);
    } else if (matches.length === 1) {
      picked = matches[0]!;
    } else {
      const chosen = takeChoice(dim, matches);
      if (!chosen) return { ok: false, question: toQuestion({ ...dim, members: matches }) };
      picked = chosen;
    }
    if (!codes.includes(picked.code)) {
      codes.push(picked.code);
      named.push(stated(dim, picked));
    }
  }

  if (!isGeo && codes.length > 1) {
    // A geo-like dimension is a plain dimension: an explicit intent carries
    // exactly one coordinate per plain dimension (StructuredIntent.target.dims).
    return refuse(
      'region_unavailable',
      `${codes.length} places on '${dim.name}', a region-coded ordinary dimension — one place per question there`,
    );
  }
  coordinates[dim.name] = codes;
  return { ok: true, coordinates, defaults, named };
}

export type TableRegionClassResolution =
  /** Named places win over a class (the curated rule): the caller resolves
   * the terms as places, exactly as without a class. */
  | { kind: 'places' }
  /** The class, as the query layer's additive `regionSet`, plus the roster
   * the slice must hold — read from CBS's own dimension groups with the query
   * layer's own rule (src/query/region-set.ts regionRoster), so the stored
   * slice and the query's roster are the same codes. */
  | { kind: 'class'; scope: RegionScope; dimension: string; codes: string[] }
  | { kind: 'ask'; question: BreakdownQuestion }
  | { kind: 'refuse'; reason: 'region_unknown' | 'region_unavailable' | 'table_lane_region_class'; detail: string };

/**
 * A region CLASS on the table lane (#340, 2026-10-01) — the curated
 * resolver's rules (src/answer/intent/resolve.ts resolveRegionScope), over
 * one table's own code lists instead of the registry:
 *
 *  - a class next to places the reader NAMED (other than Nederland itself) →
 *    the named places win (`places`);
 *  - gemeenten_in_provincie → exactly one named place, resolved as a
 *    provincie on this table (resolveTableRegions, kind forced to provincie);
 *    only "Nederland" named → every gemeente; no place or several → refused
 *    `region_unknown` (the lane has no free-text region question);
 *  - the class is served only over the table's ONE CBS GeoDimension: the
 *    query layer reads a roster from a GeoDimension only, and a geo-like
 *    plain dimension carries one coordinate per question — refused
 *    `table_lane_region_class` otherwise;
 *  - the roster comes from CBS's dimension groups (regionRoster); a group
 *    that is missing or empty refuses — never a prefix scan, never a guess.
 *
 * No db, no LLM: the roster rule runs over the in-memory code lists.
 */
export async function resolveTableRegionClass(input: {
  scope: RegionScopeKind;
  terms: RegionTerm[];
  table: TableLaneTable;
  regionDims: BreakdownDimension[];
  hasRegionCodedBreakdownMember: boolean;
  choices: TableLaneChoice[];
}): Promise<TableRegionClassResolution> {
  const { scope, terms, table, regionDims, hasRegionCodedBreakdownMember, choices } = input;
  const tableId = table.schema.tableId;
  const places = terms.filter((t) => !isNationalTerm(t));

  if (scope !== 'gemeenten_in_provincie' && places.length > 0) return { kind: 'places' };

  if (regionDims.length !== 1 || classifyDimension(regionDims[0]!) !== 'geo') {
    return {
      kind: 'refuse',
      reason: 'table_lane_region_class',
      detail:
        `the region class '${scope}' is served only over one CBS GeoDimension; table '${tableId}' has ` +
        `${regionDims.length} region dimension(s)${regionDims.length === 1 ? ' that is not a GeoDimension' : ''}`,
    };
  }
  const dim = regionDims[0]!;

  let regionScope: RegionScope;
  if (scope !== 'gemeenten_in_provincie') {
    regionScope = { kind: scope };
  } else if (places.length === 0 && terms.length > 0) {
    // "de gemeenten in Nederland" — every gemeente (the curated rule).
    regionScope = { kind: 'all_gemeenten' };
  } else if (places.length !== 1) {
    return {
      kind: 'refuse',
      reason: 'region_unknown',
      detail:
        places.length === 0
          ? 'the question asks about the gemeenten of a provincie but names no provincie'
          : `the question asks about the gemeenten of one provincie but names ${places.length} places: ` +
            places.map((t) => `"${t.name}"`).join(', '),
    };
  } else {
    // The class itself says the place is a provincie, so "gemeenten in
    // Utrecht" is never gemeente-vs-provincie ambiguous.
    const parent = resolveTableRegions({
      terms: [{ name: places[0]!.name, kind: 'provincie' }],
      regionScope: null,
      table,
      regionDims,
      hasRegionCodedBreakdownMember,
      choices,
    });
    if (!parent.ok) {
      if ('question' in parent) return { kind: 'ask', question: parent.question };
      return { kind: 'refuse', reason: parent.reason, detail: parent.detail };
    }
    regionScope = { kind: 'gemeenten_in_provincie', parent: parent.coordinates[dim.name]![0]! };
  }

  // CBS's own dimension groups, in CBS's own order (Index, then code — the
  // query layer's codesInGroups order over the same metadata).
  const codeList = table.codeLists[dim.name] ?? [];
  const codesIn = (groups: string[]): string[] =>
    codeList
      .filter((c) => c.dimensionGroup !== null && groups.includes(c.dimensionGroup))
      .sort(
        (a, b) =>
          (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER) || a.code.localeCompare(b.code),
      )
      .map((c) => c.code);
  const roster = await regionRoster(codesIn, tableId, dim.name, regionScope);
  if (!roster.ok) return { kind: 'refuse', reason: 'table_lane_region_class', detail: roster.detail };
  return { kind: 'class', scope: regionScope, dimension: dim.name, codes: roster.codes };
}
