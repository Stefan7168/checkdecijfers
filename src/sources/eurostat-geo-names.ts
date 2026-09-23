// Eurostat E2a (docs/superpowers/specs/2026-09-23-eurostat-e2a-country-answers-design.md
// §4.2): a maintained, reviewed Dutch word list for every geo code the
// Eurostat adapter can emit — never machine translation (the ADR 040
// word-list precedent). Used in two places: RESOLUTION (the intent resolver
// matches a reader's Dutch place name against this list for `eurostat:`
// tables, in addition to the table's own English `dimension_labels`) and
// DISPLAY (the answer/chart say "Duitsland", never "Germany").
//
// Closed and pinned by test: every code `EU_EFTA_STAND_IN_GEO_CODES` can
// emit has exactly one entry here, and no alias is shared by two codes.
import { EU_EFTA_STAND_IN_GEO_CODES } from '../eurostat-adapter/jsonstat.ts';
import { normalizeRegionName } from '../answer/intent/resolve.ts';

export interface EurostatGeoNameEntry {
  /** The Dutch name shown to a reader (answers, charts, citations). */
  display: string;
  /** Additional spellings a reader might type — matched via
   * `normalizeRegionName`, never string-equal, so diacritics/case never
   * matter. Deliberately does NOT include `display` itself. */
  aliases: readonly string[];
}

/**
 * Every code `EU_EFTA_STAND_IN_GEO_CODES` can emit, and nothing else
 * (pinned by test). EU27_2020/EA/EA19/EA20/EFTA each keep a DISTINCT
 * display string (including the "(n landen)" qualifier) and only EA20 gets
 * the bare "eurozone"/"de eurozone" aliases — EA and EA19 deliberately do
 * NOT, so normalizeRegionName('eurozone') resolves to exactly one code
 * (R2: aliases must stay unique AFTER normalizeRegionName, and
 * normalizeRegionName does NOT strip a trailing "(...)" the way
 * resolve.ts's `baseLabel` does for CBS labels — this list's matching never
 * calls `baseLabel`, precisely so "de eurozone (19 landen)" and "de eurozone
 * (20 landen)" stay distinct strings instead of collapsing together).
 */
export const EUROSTAT_GEO_NAMES_NL: Readonly<Record<string, EurostatGeoNameEntry>> = {
  // EU-27
  BE: { display: 'België', aliases: ['Belgie'] },
  BG: { display: 'Bulgarije', aliases: [] },
  CZ: { display: 'Tsjechië', aliases: ['Tsjechie', 'Tsjechische Republiek', 'Czechië'] },
  DK: { display: 'Denemarken', aliases: [] },
  DE: { display: 'Duitsland', aliases: [] },
  EE: { display: 'Estland', aliases: [] },
  IE: { display: 'Ierland', aliases: [] },
  // Eurostat uses EL (not ISO's GR) for Greece.
  EL: { display: 'Griekenland', aliases: [] },
  ES: { display: 'Spanje', aliases: [] },
  FR: { display: 'Frankrijk', aliases: [] },
  HR: { display: 'Kroatië', aliases: ['Kroatie'] },
  IT: { display: 'Italië', aliases: ['Italie'] },
  CY: { display: 'Cyprus', aliases: [] },
  LV: { display: 'Letland', aliases: [] },
  LT: { display: 'Litouwen', aliases: [] },
  LU: { display: 'Luxemburg', aliases: [] },
  HU: { display: 'Hongarije', aliases: [] },
  MT: { display: 'Malta', aliases: [] },
  NL: { display: 'Nederland', aliases: [] },
  AT: { display: 'Oostenrijk', aliases: [] },
  PL: { display: 'Polen', aliases: [] },
  PT: { display: 'Portugal', aliases: [] },
  RO: { display: 'Roemenië', aliases: ['Roemenie'] },
  SI: { display: 'Slovenië', aliases: ['Slovenie'] },
  SK: { display: 'Slowakije', aliases: [] },
  FI: { display: 'Finland', aliases: [] },
  SE: { display: 'Zweden', aliases: [] },
  // EFTA
  IS: { display: 'IJsland', aliases: ['Ijsland'] },
  LI: { display: 'Liechtenstein', aliases: [] },
  NO: { display: 'Noorwegen', aliases: [] },
  CH: { display: 'Zwitserland', aliases: [] },
  // Aggregates — never a single country.
  EU27_2020: { display: 'de EU (27 landen)', aliases: ['EU', 'de EU', 'Europese Unie', 'EU-27', 'EU27'] },
  EA: { display: 'het eurogebied (wisselende samenstelling)', aliases: [] },
  EA19: { display: 'de eurozone (19 landen)', aliases: [] },
  EA20: { display: 'de eurozone (20 landen)', aliases: ['eurozone', 'de eurozone', 'eurogebied', 'het eurogebied'] },
  EFTA: { display: 'de EFTA-landen', aliases: ['EFTA'] },
};

/** Lazily built the first time it's needed — never at module load, so this
 * module's circular relationship with resolve.ts (which imports THIS
 * module's lookup functions, while this module imports resolve.ts's
 * `normalizeRegionName`) can never race a not-yet-initialized binding. */
let normalizedLookup: Map<string, string> | null = null;

function buildLookup(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [code, entry] of Object.entries(EUROSTAT_GEO_NAMES_NL)) {
    for (const alias of [entry.display, ...entry.aliases]) {
      map.set(normalizeRegionName(alias), code);
    }
  }
  return map;
}

/** Reader's Dutch spelling -> Eurostat geo code, or null when the name is
 * not one of this list's ~40 entries (a country/aggregate outside the
 * licence-exception allow-list, e.g. "Japan", "de VS", refuses honestly
 * rather than guessing — principle c). Normalizes with the SAME
 * `normalizeRegionName` the CBS resolver uses, so casing/diacritics/
 * whitespace never matter on either side. */
export function eurostatGeoCodeForDutchName(name: string): string | null {
  normalizedLookup ??= buildLookup();
  return normalizedLookup.get(normalizeRegionName(name)) ?? null;
}

/** Eurostat geo code -> Dutch display name, or null when the code is not in
 * this list (should not happen for a code the adapter actually emitted). */
export function dutchDisplayNameForGeo(code: string): string | null {
  return EUROSTAT_GEO_NAMES_NL[code]?.display ?? null;
}

/** Membership of `EU_EFTA_STAND_IN_GEO_CODES` — used by the resolver's
 * source-aware `kind: 'land'` filter on a Eurostat table, replacing the
 * CBS-only `NL` prefix check (§4.3). */
export function isEurostatCountryOrAggregateCode(code: string): boolean {
  return EU_EFTA_STAND_IN_GEO_CODES.has(code);
}
