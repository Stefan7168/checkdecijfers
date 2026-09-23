// Eurostat E2a (docs/superpowers/specs/2026-09-23-eurostat-e2a-country-
// answers-design.md §4.1): a reviewed, code-level map from a CBS canonical
// measure KEY to the Eurostat canonical measure KEY that measures the same
// concept for other countries. A code map, not a `canonical_measures` column
// (cheapest mechanism first, CLAUDE.md): no migration, no live DDL — promote
// it to a column only if pairs ever need editing without a deploy.
//
// Reviewed by a PERSON per pair — same discipline as
// `PERIOD_CHANGE_ELIGIBLE_KEYS` (ADR precedent for a hand-curated,
// person-reviewed allowlist). The Eurostat side's `definitionLabel` is always
// shown to the reader on the confirm chip before they click (§4.4): this map
// only says "these two measures are worth OFFERING side by side," never
// "these two definitions are identical" — CBS's national definition and
// Eurostat's harmonised one can differ, and principle (c) means the reader
// decides, never the code silently.
//
// SHIPS EMPTY: dark in production. Step 5 of the E2a build plan (§6) adds the
// three owner-approved pairs (unemployment -> harmonised unemployment rate,
// inflation -> HICP annual rate, GDP growth) in the SAME change that
// registers their Eurostat sibling tables via `registry:apply` (an owner
// step) — never widened ahead of that.
import type { CanonicalMeasure } from '../registry/types.ts';

export const EUROSTAT_SIBLINGS: Readonly<Record<string, string>> = {};

/** Ruling R7 (E2a final-review fix wave, I4/C1): the Eurostat side of every
 * pair above is a canonical measure that lives in THIS sibling-only list —
 * NEVER in `CANONICAL_MEASURES` (src/registry/defaults.ts). That list feeds
 * the intent parser's prompt vocabulary and its raw-parse key enum
 * (src/answer/intent/prompt.ts, schema.ts): a Eurostat measure there could be
 * picked by the parser directly, so "werkloosheid in Duitsland" (or even "in
 * Nederland") would switch source silently, with no chip — exactly the
 * source switch principle (c) forbids — and every recorded fixture's prompt
 * bytes would shift. Kept here instead, a sibling key is reachable ONLY as
 * the target of an offered chip, and the click trust boundary
 * (src/answer/respond/validate-pending.ts) accepts it by membership in
 * `EUROSTAT_SIBLINGS`'s values, separately from the parser vocabulary.
 *
 * `registry:apply` (src/registry/apply.ts) seeds these rows into
 * `canonical_measures` together with `CANONICAL_MEASURES`, so step 5 adds a
 * pair here + its value in `EUROSTAT_SIBLINGS` in one change and the owner's
 * usual `registry:apply` makes it resolvable. SHIPS EMPTY, same as the map. */
export const EUROSTAT_SIBLING_MEASURES: readonly CanonicalMeasure[] = [];

/** The canonical keys a clarification chip may target on a sibling switch —
 * the values of the sibling map (default: the production map). The click
 * trust boundary takes its allowlist from here, so a test injecting a pair
 * through `resolveCandidate`'s `eurostatSiblings` option can inject the same
 * map into the validator. */
export function eurostatSiblingTargetKeys(
  siblings: Readonly<Record<string, string>> = EUROSTAT_SIBLINGS,
): ReadonlySet<string> {
  return new Set(Object.values(siblings));
}
