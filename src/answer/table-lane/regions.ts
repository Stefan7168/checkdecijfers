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
//   - a region class (`regionScope`) is `table_lane_region_class`.
import type { RegionScopeKind, RegionTerm } from '../intent/types.ts';
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
  toQuestion,
  type BreakdownDimension,
  type BreakdownMember,
  type BreakdownQuestion,
  type StatedDefault,
} from '../../query/breakdowns.ts';
import type { TableLaneChoice } from './types.ts';
import type { TableLaneTable } from './plan.ts';

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

function dimensionLabel(d: Pick<BreakdownDimension, 'name' | 'title'>): string {
  return d.title.trim().length > 0 ? d.title : d.name;
}

function stated(d: BreakdownDimension, m: BreakdownMember): StatedDefault {
  return { dimension: d.name, dimensionTitle: dimensionLabel(d), code: m.code, memberTitle: m.title };
}

function refuse(
  reason: 'region_unknown' | 'region_unavailable' | 'table_lane_region_class',
  detail: string,
): TableRegionResolution {
  return { ok: false, reason, detail };
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
  const takeChoice = (dim: BreakdownDimension): BreakdownMember | null => {
    const code = queue.get(dim.name)?.shift();
    return code === undefined ? null : dim.members.find((m) => m.code === code)!;
  };

  const coordinates: Record<string, string[]> = {};
  const defaults: StatedDefault[] = [];
  const named: StatedDefault[] = [];

  if (terms.length === 0) {
    for (const dim of regionDims) {
      const chosen = takeChoice(dim);
      if (chosen) {
        coordinates[dim.name] = [chosen.code];
        named.push(stated(dim, chosen));
        continue;
      }
      const nationals = dim.members.filter((m) => NATIONAL_MEMBER_CODE.test(m.code));
      if (nationals.length === 1) {
        coordinates[dim.name] = [nationals[0]!.code];
        defaults.push(stated(dim, nationals[0]!));
        continue;
      }
      return { ok: false, question: toQuestion(nationals.length === 0 ? dim : { ...dim, members: nationals }) };
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
    const matches = dim.members.filter(
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
      const chosen = takeChoice(dim);
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
