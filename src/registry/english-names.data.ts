// The hand-written English-name literal tables backing
// src/registry/english-names.ts — moved out of web/lib/i18n/cbs-words.ts
// (ADR 058) so the chart (web) and the English-answer translator
// (src/answer/translate) read the SAME list, never two lists that could
// drift apart. This file stays pure data (no functions, no imports) so it
// can be imported from anywhere without pulling in logic. See
// english-names.ts's own header for the shared "never guess — return the
// input unchanged when no entry exists" contract every reader of these
// tables follows.

// --- units -------------------------------------------------------------------
// Real CBS `Unit` values, read from tests/fixtures/cbs/*/measure-codes.json
// before writing this table (e.g. 85773NED: 'aantal', 'euro'; 85224NED:
// 'x 1 000'; 83693NED: 'gemiddelde saldo van de deelvragen', the actual unit
// of the curated Consumentenvertrouwen chart). Units already neutral in
// English ('%', 'x 1 000', an index base like '2025=100') need no entry —
// they pass through the "no match" default unchanged, matching the design's
// own "'x 1 000' stays, '%' stays" examples.
export const UNITS: Record<string, string> = {
  aantal: 'number',
  euro: 'euros',
  'mln euro': 'million euros',
  personen: 'persons',
  // Space-grouped, not 'per 1,000 inhabitants': a comma would MERGE the two
  // digit tokens '1'/'000' into one '1,000' token under the digit-invariance
  // regex (\d[\d.,]*) — found by that very test. Keeping the Dutch grouping
  // convention (already internationally legible) keeps every digit token
  // byte-identical, never introducing a formatting choice CBS didn't make.
  'per 1 000 inwoners': 'per 1 000 inhabitants',
  procentpunt: 'percentage point',
  promille: 'per mille',
  'gemiddelde saldo van de deelvragen': 'average balance of the sub-questions',
};

// --- regions -------------------------------------------------------------------
// 'Nederland' plus the three of the twelve provinces with an established
// English exonym (design §4). The other nine (Drenthe, Flevoland, Friesland,
// Gelderland, Groningen, Limburg, Overijssel, Utrecht, Zeeland) already read
// identically in English — no entry needed, the "no match" default covers
// them and every municipality automatically (municipalities never change).
export const REGIONS: Record<string, string> = {
  Nederland: 'the Netherlands',
  'Noord-Brabant': 'North Brabant',
  'Noord-Holland': 'North Holland',
  'Zuid-Holland': 'South Holland',
};

// --- measure titles ------------------------------------------------------------
// Seeded from the Ontdek curated set (src/chart/curated.ts's ONTDEK_CHARTS —
// each canonicalKey's `measureTitle`, src/registry/defaults.ts): the five
// titles a reader sees on the homepage today, i.e. `ChartSpec.title`
// (src/chart/build.ts: `title: firstCell.measureTitle`) for those five
// tables. An unseeded title (any measure outside this curated set) stays
// Dutch — expand this table as usage surfaces more, never guess a title.
export const MEASURE_TITLES: Record<string, string> = {
  Consumentenvertrouwen: 'Consumer confidence',
  'Bruto binnenlands product': 'Gross domestic product',
  'Jaarmutatie CPI': 'Annual change in CPI',
  'Gemiddelde verkoopprijs': 'Average sale price',
  Werkloosheidspercentage: 'Unemployment rate',
};

// --- table titles ----------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3 fills this): CBS's own table
// titles (`ValidatedResult.attribution.tableTitle`), keyed on the exact
// Dutch title string. Empty to start — same never-guess contract, an
// unseeded title stays Dutch.
export const TABLE_TITLES: Record<string, string> = {};

// --- dimension labels --------------------------------------------------------
// ADR 058 phase 1 (Task 3 fills this): CBS's own non-region dimension value
// labels (`ResultCell.dimLabels`), keyed on the exact Dutch label string.
// Empty to start — same never-guess contract, an unseeded label stays Dutch.
export const DIM_LABELS: Record<string, string> = {};
