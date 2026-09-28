// Breadth step 4, Task 2 — pure input builder for the table-scoped parser
// (docs/superpowers/plans/2026-09-28-breadth-step-4-table-parser.md, Task 2;
// spec docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md D2).
//
// Turns ONE table's raw CBS metadata (CbsTableSchema + its dimensions' full
// code lists) into the closed-choice menu Task 3's prompt offers the model:
// which numeric measures exist, which breakdown dimensions are offered (and
// with which members, deterministically pre-filtered when a dimension is
// large), which period grains the table actually publishes, and whether the
// table has any region axis at all. Pure and synchronous: no db, no
// ingestion import, no LLM call (principle a) — the caller (Task 3) is the
// only thing that talks to a model.
//
// Dimension routing reuses step 3's OWN classifyDimension/findGrandTotal
// (src/query/breakdowns.ts) rather than re-deriving a routing rule here:
// 'time' and 'geo' dimensions are never offered as breakdowns (the period
// spec and region names cover them); 'margins' dimensions resolve by step
// 3's own convention and are never offered either; 'geo_like' dimensions set
// `hasRegions` and are excluded too. Only 'breakdown'-classified dimensions
// reach the model. Measured 2026-09-28 against the committed fixtures
// (tests/fixtures/tableparse/schemas/): a region-CODED dimension does not
// automatically classify as 'geo_like' — the 0.8 threshold is a real gate,
// not a formality (85004NED's RegioS at 16% region-coded members and
// 82291NED's CaribischNederland at 75% both fall under it and are offered as
// ordinary breakdowns instead). Places named in a question are then checked
// against those breakdown members by parse.ts's validator (final-review F1),
// never silently dropped.
//
// Every refusal here is the typed TableParseIneligibleTableError: the table
// can never be served through the table-scoped path (no numeric measure, no
// TimeDimension, or a dimension whose code list is missing — a missing code
// list must never become a zero-member breakdown or empty period grains).
import type { CbsCode, CbsDimension, CbsTableSchema } from '../../cbs-adapter/types.ts';
import { classifyDimension, findGrandTotal, type BreakdownDimension, type BreakdownMember } from '../../query/breakdowns.ts';
import { parsePeriodCode } from '../../ingestion/periods.ts';
import type { PeriodGrain } from '../../query/types.ts';
import {
  REGION_MEMBER_CODE,
  memberPlaceKey,
  normalizeQuestionForPlaceMatch,
  placeKeyNamedInQuestion,
} from './places.ts';

/** Thrown when a table can never be offered to the table-scoped parser —
 * the caller refuses the question for this table, it is never a partial
 * menu. */
export class TableParseIneligibleTableError extends Error {
  readonly tableId: string;

  constructor(tableId: string, reason: string) {
    super(`buildTableParseSchema: table '${tableId}' ${reason} — never offered`);
    this.name = 'TableParseIneligibleTableError';
    this.tableId = tableId;
  }
}

/** A breakdown dimension larger than this is pre-filtered deterministically
 * before it ever reaches the model (Global Constraints, plan doc). */
export const MEMBER_PROMPT_CAP = 40;

export interface TableParseMeasure {
  code: string;
  title: string;
  unit: string;
  description: string;
  /** CBS's own MeasureGroups titles, root -> leaf, verbatim, carried straight
   * from CbsMeasure.groupPath (breadth step 4b, Task 1/2). `[]` when CBS has
   * no group for this measure. Distinguishes measures that otherwise share a
   * bare title (measured: 80590ned's four "Niet-seizoengecorrigeerd"
   * measures) — see parse.ts's measureFingerprint and prompt line. */
  groupPath: string[];
}

export interface TableParseBreakdown {
  name: string;
  /** CBS's own dimension title, or the dimension's `name` when CBS has none
   * (never invented — same fallback shape as breakdowns.ts's own
   * dimensionLabel, re-derived here since that helper is module-private). */
  title: string;
  /** What the model may pick, in CBS order. */
  members: { code: string; title: string }[];
  truncated: boolean;
  /** How many members the dimension actually has (may exceed members.length
   * when truncated). */
  totalMembers: number;
}

export interface TableParseSchema {
  tableId: string;
  title: string;
  /** Numeric only — a String-typed CBS measure (a code/name/label column) is
   * never offered (breadth step 2 convention: text measures are never
   * servable numbers). */
  measures: TableParseMeasure[];
  /** classifyDimension === 'breakdown' only, in table (dimensions array)
   * order. Time, geo, geo_like and margins dimensions never appear here. */
  breakdowns: TableParseBreakdown[];
  /** Grains actually present in the time dimension's own codes
   * (parsePeriodCode), sorted coarsest-first: JJ, KW, MM. A code
   * parsePeriodCode cannot read is silently ignored here — step 5's period
   * resolver is the thing that refuses an unreadable period code, not this
   * builder. */
  periodGrains: PeriodGrain[];
  /** True when the table has any 'geo' or 'geo_like' dimension (region terms
   * are meaningful on this table). */
  hasRegions: boolean;
}

/** Coarsest-to-finest — the order `periodGrains` is reported in. */
const GRAIN_ORDER: PeriodGrain[] = ['JJ', 'KW', 'MM'];

/** Dimension title, falling back to its name when CBS's own title is empty
 * or whitespace-only — mirrors breakdowns.ts's private `dimensionLabel`
 * (not exported from there, so re-derived here rather than reaching into
 * that module's internals). Never invents a DIFFERENT word: the dimension's
 * own stable `name` is not a guess. */
function dimensionLabel(d: Pick<CbsDimension, 'name' | 'title'>): string {
  return d.title.trim().length > 0 ? d.title : d.name;
}

/** The pre-filter's word normalization (Global Constraints, plan doc):
 * lowercase, diacritics stripped, split on non-letters/digits. A token is a
 * match word when it has at least 4 characters (a shared short word like
 * "van" or "wat" is not a meaningful topic match) OR is a pure digit run of
 * at least 2 digits (final-review F8: an age band such as "65 tot 80 jaar"
 * must be reachable by a question naming "65" or "80"; a lone digit is
 * noise). Used both for the question itself and, identically, for each
 * candidate member's title below — a member matches when it shares at least
 * one such normalized word with the question. */
function normalizedWords(text: string): Set<string> {
  const flattened = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const tokens = flattened
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 || (t.length >= 2 && /^[0-9]+$/.test(t)));
  return new Set(tokens);
}

/** The question's match words (see normalizedWords). Exported for this
 * module's own tests. */
export function questionWords(question: string): Set<string> {
  return normalizedWords(question);
}

function sharesWord(title: string, qWords: Set<string>): boolean {
  for (const word of normalizedWords(title)) {
    if (qWords.has(word)) return true;
  }
  return false;
}

/**
 * Builds one breakdown dimension's offered member list. Dimensions with at
 * most MEMBER_PROMPT_CAP members are offered in full. Larger dimensions are
 * pre-filtered deterministically: CBS's own grand total (step 3's
 * findGrandTotal, when one exists) first, then every OTHER member that
 * EITHER shares a normalized word with the question OR — breadth step 4b,
 * Task 3, controller ruling — is a REGION-CODED member (REGION_MEMBER_CODE)
 * whose place key (memberPlaceKey) is named in the question
 * (placeKeyNamedInQuestion), in CBS order, the combined (deduped) list capped
 * at MEMBER_PROMPT_CAP. The place-aware rule catches what the generic word
 * rule alone misses: an alias ("Den Haag" names the "'s-Gravenhage" member —
 * "haag" shares no word with "gravenhage") and every look-alike member a
 * bare place name refers to (e.g. "Groningen" on 85004NED names all three of
 * "Groningen (PV)"/"(ES)"/"(ET)", so F1's several-members-match "anders" rule
 * downstream sees every one of them, not just whichever the word rule
 * happened to also catch). A non-region-coded member is never added by this
 * rule, even when its title happens to equal a place name (the follow-up
 * ruling's birth-country "Nederland" case). When there is no grand total and
 * nothing matches either rule, the dimension is still offered (truncated,
 * with zero members) — the model then has only `niet_genoemd` / `anders` for
 * it, never a silently guessed member.
 */
function buildBreakdown(dim: CbsDimension, codes: CbsCode[], question: string): TableParseBreakdown {
  const allMembers: BreakdownMember[] = codes.map((c) => ({ code: c.code, title: c.title }));
  const title = dimensionLabel(dim);

  if (allMembers.length <= MEMBER_PROMPT_CAP) {
    return {
      name: dim.name,
      title,
      members: allMembers,
      truncated: false,
      totalMembers: allMembers.length,
    };
  }

  const total = findGrandTotal(allMembers);
  const qWords = questionWords(question);
  const normalizedQuestionForPlaces = normalizeQuestionForPlaceMatch(question);
  const selected: BreakdownMember[] = [];
  const selectedCodes = new Set<string>();
  if (total) {
    selected.push(total);
    selectedCodes.add(total.code);
  }

  for (const member of allMembers) {
    if (selected.length >= MEMBER_PROMPT_CAP) break;
    if (selectedCodes.has(member.code)) continue;
    const wordMatch = sharesWord(member.title, qWords);
    const placeMatch =
      REGION_MEMBER_CODE.test(member.code) &&
      placeKeyNamedInQuestion(normalizedQuestionForPlaces, memberPlaceKey(member.title));
    if (wordMatch || placeMatch) {
      selected.push(member);
      selectedCodes.add(member.code);
    }
  }

  return {
    name: dim.name,
    title,
    members: selected.slice(0, MEMBER_PROMPT_CAP),
    truncated: true,
    totalMembers: allMembers.length,
  };
}

/**
 * Builds the table-scoped parser's input from raw CBS metadata. Throws
 * TableParseIneligibleTableError when the table has no numeric measure, no
 * TimeDimension at all, or a dimension without a code-list entry — each
 * means this table can never be answered through the table-scoped path and
 * must never be offered to a reader question (measured refuse cases:
 * 83052NED's `Perioden` is kind `Dimension`, not `TimeDimension`; 86116NED
 * has no Perioden dimension whatsoever).
 */
export function buildTableParseSchema(
  schema: CbsTableSchema,
  codeLists: Record<string, CbsCode[]>,
  question: string,
): TableParseSchema {
  const measures: TableParseMeasure[] = schema.measures
    .filter((m) => m.dataType !== 'String')
    .map((m) => ({ code: m.code, title: m.title, unit: m.unit, description: m.description, groupPath: m.groupPath }));

  if (measures.length === 0) {
    throw new TableParseIneligibleTableError(schema.tableId, 'has no numeric measure');
  }

  const timeDim = schema.dimensions.find((d) => d.kind === 'TimeDimension');
  if (!timeDim) {
    throw new TableParseIneligibleTableError(schema.tableId, 'has no TimeDimension');
  }

  // Final-review F6: a dimension without a code-list entry is a capture gap,
  // not an empty dimension — refuse the table rather than offer a
  // zero-member breakdown (or derive empty periodGrains from nothing).
  for (const dim of schema.dimensions) {
    if (!Object.prototype.hasOwnProperty.call(codeLists, dim.name)) {
      throw new TableParseIneligibleTableError(
        schema.tableId,
        `has no code list for dimension '${dim.name}'`,
      );
    }
  }

  let hasRegions = false;
  const breakdowns: TableParseBreakdown[] = [];

  for (const dim of schema.dimensions) {
    const codes = codeLists[dim.name]!;
    const members: BreakdownMember[] = codes.map((c) => ({ code: c.code, title: c.title }));
    const asBreakdownDimension: BreakdownDimension = {
      name: dim.name,
      title: dim.title,
      kind: dim.kind,
      members,
    };
    const cls = classifyDimension(asBreakdownDimension);

    if (cls === 'geo' || cls === 'geo_like') {
      hasRegions = true;
      continue;
    }
    if (cls === 'time' || cls === 'margins') {
      continue;
    }
    // cls === 'breakdown'
    breakdowns.push(buildBreakdown(dim, codes, question));
  }

  const timeCodes = codeLists[timeDim.name]!;
  const grainsPresent = new Set<PeriodGrain>();
  for (const code of timeCodes) {
    const parsed = parsePeriodCode(code.code);
    if (parsed) grainsPresent.add(parsed.grain);
    // An unreadable code is silently ignored here (see periodGrains doc
    // comment) — step 5's period resolver refuses it, not this builder.
  }
  const periodGrains = GRAIN_ORDER.filter((g) => grainsPresent.has(g));

  return {
    tableId: schema.tableId,
    title: schema.title,
    measures,
    breakdowns,
    periodGrains,
    hasRegions,
  };
}
