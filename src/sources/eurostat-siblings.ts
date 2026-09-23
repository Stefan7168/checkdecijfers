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
export const EUROSTAT_SIBLINGS: Readonly<Record<string, string>> = {};
