// Breadth step 4b, Task 3 — shared place/region-matching helpers for the
// table-scoped parser (spec docs/superpowers/specs/2026-09-28-breadth-any-
// cbs-table-design.md; brief .superpowers/sdd/2026-09-29-breadth-step-4b-
// pre-recording/task-3-brief.md; normalization rule in that plan's
// constraints.md).
//
// A small module of its own (rather than living in either parse.ts or
// input.ts) so BOTH can import the same REGION_MEMBER_CODE rule and place-key
// normalization without an import cycle: parse.ts already imports
// TableParseSchema/TableParseBreakdown TYPES from input.ts, so input.ts
// cannot also import VALUES back from parse.ts.
import { REGION_NAME_ALIASES, baseLabel, normalizeRegionName } from '../../sources/region-names.ts';

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
