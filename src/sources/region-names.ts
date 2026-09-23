// Region-NAME matching helpers — a LEAF module (zero imports) so every layer
// that matches a reader's place name against stored labels can share ONE
// normalisation without importing the answer layer.
//
// Moved here from src/answer/intent/resolve.ts (E2a final-review fix wave,
// minor M1): src/query/run.ts displays Eurostat regions through
// src/sources/eurostat-geo-names.ts, and that list (and the Eurostat
// adapter's jsonstat.ts) needed these two functions. Importing them from
// resolve.ts made src/query depend on src/answer — a new edge and an import
// cycle (run.ts -> eurostat-geo-names -> answer/intent/resolve.ts ->
// query/index.ts -> run.ts) across the ADR 001 module boundaries that are the
// future split seam. resolve.ts re-exports both, so its callers are unchanged.

/** Everyday-name → official CBS base name. CBS labels Den Haag as
 * 's-Gravenhage (docs/07 quirk); users overwhelmingly say Den Haag. */
const REGION_NAME_ALIASES: Record<string, string> = {
  'den haag': "'s-gravenhage",
};

/** Matching normalization: lowercase, straight apostrophes, no diacritics,
 * collapsed whitespace. Display strings always use the original CBS label. */
export function normalizeRegionName(name: string): string {
  const flattened = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return REGION_NAME_ALIASES[flattened] ?? flattened;
}

/** CBS disambiguates colliding names with a trailing parenthetical:
 * "Utrecht (gemeente)", "Utrecht (PV)". The base name is what users say.
 * Exported for the WP15 context builder (code→name round-trip, ADR 021). */
export function baseLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '');
}
