// Breadth step 4b, Task 3 — shared place/region-matching helpers for the
// table-scoped parser (spec docs/superpowers/specs/2026-09-28-breadth-any-
// cbs-table-design.md; plan docs/superpowers/plans/2026-09-29-breadth-step-
// 4b-pre-recording.md, whose Global Constraints state the reader-side
// normalization rule).
//
// A small module of its own (rather than living in either parse.ts or
// input.ts) so BOTH can import the same REGION_MEMBER_CODE rule and place-key
// normalization without an import cycle: parse.ts already imports
// TableParseSchema/TableParseBreakdown TYPES from input.ts, so input.ts
// cannot also import VALUES back from parse.ts.
import { REGION_NAME_ALIASES, baseLabel, normalizeRegionName } from '../../sources/region-names.ts';
import type { RegionKind } from '../intent/types.ts';

/** Only a member whose CODE carries a CBS region prefix counts as a place for
 * the region checks (follow-up ruling): a birth-country-like member titled
 * "Nederland" but coded e.g. 1012600 is a population characteristic, not the
 * place Nederland. Measured on the committed fixtures: 85004NED RegioS uses
 * NL/PV/ES/ET codes, 82291NED CaribischNederland uses CN/GM codes; LD/CR/WK/BU
 * complete CBS's own region code families (landsdeel, COROP, wijk, buurt).
 * Deliberately local to the table-scoped parser — src/query/breakdowns.ts's
 * geo-like classification is not changed. Moved here unchanged from parse.ts
 * (breadth step 4b, Task 3) so input.ts's pre-filter can use the same rule. */
export const REGION_MEMBER_CODE = /^(NL|PV|GM|LD|CR|WK|BU|CN|ES|ET)\d/;

/** Every CBS region-code prefix REGION_MEMBER_CODE accepts — kept in step
 * with that regex (a test pins the two against each other). */
const REGION_CODE_PREFIXES = ['NL', 'PV', 'GM', 'LD', 'CR', 'WK', 'BU', 'CN', 'ES', 'ET'] as const;

/** A member title reduced to the place name a reader would write: CBS's
 * trailing disambiguation dropped ("Groningen (PV)" → "Groningen"), then the
 * shared region-name normalization (src/sources/region-names.ts). The
 * MEMBER-side key — unchanged (breadth step 4b, Task 3 constraint). */
export function memberPlaceKey(title: string): string {
  return normalizeRegionName(baseLabel(title));
}

/** One leading Dutch "kind word" a reader may prefix a bare place name with
 * ("provincie Groningen", "gemeente Utrecht") — stripped so the remainder
 * keys the same as the member side. Case-insensitive; at most one such word
 * is stripped (Global Constraints). */
const LEADING_KIND_WORD = /^(provincie|gemeente|regio|landsdeel)\s+/i;

/** The READER-side place key (Global Constraints, constraints.md): `baseLabel`
 * (so a reader typing a CBS-style "Groningen (PV)" verbatim keys the same as
 * the member title it names), then strip one leading Dutch kind word
 * ("provincie Groningen" -> "Groningen"), then the shared
 * `normalizeRegionName` (case/diacritics/whitespace + the
 * `REGION_NAME_ALIASES` whole-string substitution, e.g. "Den Haag" ->
 * "'s-gravenhage") — the same normalization the member side ends with, so a
 * named region compares equal to `memberPlaceKey` on the matching member. */
export function readerPlaceKey(name: string): string {
  const withoutKindWord = baseLabel(name).replace(LEADING_KIND_WORD, '');
  return normalizeRegionName(withoutKindWord);
}

/** The kind of place a reader's words say a named place is (final-review C1,
 * breadth step 4b fix wave). The curated resolver's four kinds plus 'regio'
 * (the Dutch word for a region that is neither a province nor a
 * municipality) and CBS's own 'ES'/'ET' region families, which a reader can
 * only state by copying a CBS title suffix verbatim ("Groningen (ES)"). */
export type ReaderPlaceKind = Exclude<RegionKind, 'onbekend'> | 'regio' | 'ES' | 'ET';

const LEADING_KIND_WORD_KIND: Record<string, ReaderPlaceKind> = {
  provincie: 'provincie',
  gemeente: 'gemeente',
  regio: 'regio',
  landsdeel: 'landsdeel',
};

/** A trailing parenthetical's text (lowercased, trimmed) → the kind it
 * states. Anything else in trailing parentheses states no kind (baseLabel
 * still strips it from the key, exactly as before). */
const SUFFIX_KIND: Record<string, ReaderPlaceKind> = {
  pv: 'provincie',
  provincie: 'provincie',
  gm: 'gemeente',
  gemeente: 'gemeente',
  ld: 'landsdeel',
  landsdeel: 'landsdeel',
  es: 'ES',
  et: 'ET',
};

const TRAILING_PARENTHETICAL = /\(([^)]*)\)\s*$/;

/**
 * Every place kind the reader's words state for a named place (final-review
 * C1): (a) the leading kind word readerPlaceKey strips ("gemeente Utrecht"),
 * (b) a trailing parenthetical ("Utrecht (PV)", "Utrecht (gemeente)"), and
 * (c) the model's own `kind` for the region when it is not 'onbekend'.
 * Deduplicated: `[]` = no kind known, one entry = the kind, two or more =
 * the sources CONFLICT (the caller refuses — a conflict is never resolved by
 * picking one).
 */
export function readerPlaceKinds(name: string, statedKind: RegionKind): ReaderPlaceKind[] {
  const kinds = new Set<ReaderPlaceKind>();
  const leading = LEADING_KIND_WORD.exec(baseLabel(name));
  if (leading) kinds.add(LEADING_KIND_WORD_KIND[leading[1]!.toLowerCase()]!);
  const suffix = TRAILING_PARENTHETICAL.exec(name);
  if (suffix) {
    const kind = SUFFIX_KIND[suffix[1]!.trim().toLowerCase()];
    if (kind) kinds.add(kind);
  }
  if (statedKind !== 'onbekend') kinds.add(statedKind);
  return [...kinds];
}

/** Which CBS region-code prefixes each reader place kind may resolve to.
 * The four curated kinds mirror src/answer/intent/resolve.ts's
 * KIND_CODE_PREFIX (the curated pipeline's one prefix table — a test pins
 * this map against its exported regionKindForCode); defined here rather than
 * imported so this leaf module does not pull the curated resolver (and its
 * query/registry imports) into the table-scoped parser. 'regio' allows every
 * region family EXCEPT province and municipality: a reader who says "regio
 * Utrecht" is not asking about the province or the municipality. */
const KIND_ALLOWED_PREFIXES: Record<ReaderPlaceKind, readonly string[]> = {
  land: ['NL'],
  landsdeel: ['LD'],
  provincie: ['PV'],
  gemeente: ['GM'],
  ES: ['ES'],
  ET: ['ET'],
  regio: REGION_CODE_PREFIXES.filter((p) => p !== 'PV' && p !== 'GM'),
};

/** Whether a member `code` can be the place a reader of `kind` named — only
 * ever used to REJECT a match (final-review C1), never to choose between
 * several look-alike matches. A code that is not region-coded fits no kind. */
export function placeKindAllowsCode(kind: ReaderPlaceKind, code: string): boolean {
  const prefix = REGION_MEMBER_CODE.exec(code)?.[1];
  return prefix !== undefined && KIND_ALLOWED_PREFIXES[kind].includes(prefix);
}

/** Whole-word/sequence containment, bounded by start/end of string or a
 * non-letter/digit boundary on each side (controller ruling) — a substring
 * hit inside a longer word never counts. `haystack` and `needle` are both
 * expected to already be normalized (lowercase, diacritics stripped). */
function occursAsWholeWordSequence(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(haystack);
}

/** The question text normalized for place matching — `normalizeRegionName`
 * applied to the WHOLE question (controller ruling). `normalizeRegionName`'s
 * own alias substitution only fires when its ENTIRE input equals an alias key
 * exactly, which a full question sentence never does — the alias check below
 * is therefore done explicitly against this normalized text, not by this
 * function. Exported so a caller (buildBreakdown) normalizes the question
 * once per dimension rather than once per candidate member. */
export function normalizeQuestionForPlaceMatch(question: string): string {
  return normalizeRegionName(question);
}

/**
 * Whether a member's place `key` (from `memberPlaceKey`) should be treated as
 * "named in the question" for the pre-filter's place-aware addition rule
 * (controller ruling, breadth step 4b Task 3): true when `key` itself occurs
 * as a whole word/sequence in `normalizedQuestion` (e.g. "Groningen" names
 * every member whose key is "groningen"), OR when some `REGION_NAME_ALIASES`
 * key occurs as a whole word/sequence in `normalizedQuestion` AND that
 * alias's TARGET equals `key` (e.g. "Den Haag" in the question names the
 * member keyed "'s-gravenhage", the alias's target).
 */
export function placeKeyNamedInQuestion(normalizedQuestion: string, key: string): boolean {
  if (occursAsWholeWordSequence(normalizedQuestion, key)) return true;
  for (const [alias, target] of Object.entries(REGION_NAME_ALIASES)) {
    if (target === key && occursAsWholeWordSequence(normalizedQuestion, alias)) return true;
  }
  return false;
}
