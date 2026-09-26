// The hand-written English-name literal tables backing
// src/registry/english-names.ts — moved out of web/lib/i18n/cbs-words.ts
// (ADR 058) so the chart (web) and the English-answer translator
// (src/answer/translate) read the SAME list, never two lists that could
// drift apart. This file stays pure data (no functions; its only import is
// its own generated sibling, see below) so it can be imported from anywhere
// without pulling in logic. See english-names.ts's own header for the shared
// "never guess — return the input unchanged when no entry exists" contract
// every reader of these tables follows.
//
// ADR 058 Task 3 Fix round 1: every exported map here is now composed as
// `{ ...CBS_X, ...HAND_X }` from src/registry/english-names.cbs.generated.ts
// (CBS's own words, written by `npm run english-names:fetch` — never
// hand-edit that file) and this file's own HAND_X literal below (a session's
// hand-written English, read from the Dutch table's own definition text,
// for a Dutch string CBS never published a matching English form for, or a
// deliberate override of a CBS-derived value — see OVERRIDDEN_BY_HAND).
// HAND_X always wins on a shared key. This file and the generated file are
// both pure "table modules" in the sense that matters for the web bundle:
// neither pulls in any src/answer/-style logic, only each other's literals.
import {
  CBS_DIM_LABELS,
  CBS_MEASURE_TITLES,
  CBS_REGIONS,
  CBS_TABLE_TITLES,
} from './english-names.cbs.generated.ts';

// --- units -------------------------------------------------------------------
// Real CBS `Unit` values, read from tests/fixtures/cbs/*/measure-codes.json
// before writing this table (e.g. 85773NED: 'aantal', 'euro'; 85224NED:
// 'x 1 000'; 83693NED: 'gemiddelde saldo van de deelvragen', the actual unit
// of the curated Consumentenvertrouwen chart). Units already neutral in
// English ('%', 'x 1 000', an index base like '2025=100') need no entry —
// they pass through the "no match" default unchanged, matching the design's
// own "'x 1 000' stays, '%' stays" examples. (Task 2's own territory —
// untouched by Task 3 / this fix round; see task-3-report.md finding 4 for
// two spots where CBS's own wording doesn't byte-match this table.)
export const UNITS: Record<string, string> = {
  aantal: 'number',
  euro: 'euros',
  'mln euro': 'million euros',
  // Space-grouped for the same digit-token reason as 'per 1 000 inwoners' below.
  // Registered so the masker joins '57,6 1 000 euro' into ONE placeholder
  // (session 134 live recording, B12: unregistered, it split into three loose
  // number placeholders and the translation garbled the sentence).
  '1 000 euro': '1 000 euros',
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
// HAND_REGIONS: 'Nederland' plus the three of the twelve provinces with an
// established English exonym (design §4). The other nine (Drenthe,
// Flevoland, Friesland, Gelderland, Groningen, Limburg, Overijssel, Utrecht,
// Zeeland) and all four landsdelen already read identically in English —
// confirmed against CBS's own English RegioS code list for the one real
// GeoDimension table in the registry (83625NED, task-3-report.md finding 5)
// — no entry needed, the "no match" default covers them and every
// municipality automatically (municipalities never change).
//
// 'Nederland' is in OVERRIDDEN_BY_HAND: CBS's OWN English RegioS list gives
// 'The Netherlands' (CBS_REGIONS, capitalised, standalone) — this hand entry
// deliberately keeps the lowercase 'the Netherlands' the codebase already
// tests (web/lib/i18n/cbs-words.test.ts), for embedding mid-sentence
// ("population of the Netherlands").
export const HAND_REGIONS: Record<string, string> = {
  Nederland: 'the Netherlands',
  'Noord-Brabant': 'North Brabant',
  'Noord-Holland': 'North Holland',
  'Zuid-Holland': 'South Holland',
};
export const REGIONS: Record<string, string> = { ...CBS_REGIONS, ...HAND_REGIONS };

// --- measure titles ------------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3; Fix round 1): every RUNTIME
// measure title a registered CBS canonical measure can put on a ResultCell —
// `normalizeLabel(measureMeta.title)` (src/query/resolve.ts), the raw CBS
// measure-codes Title (src/ingestion/pipeline.ts / src/cbs-adapter/
// parse-v4.ts) for its own `measure` code and every alternate's own
// `measure` code (tests/registry/english-names-data.test.ts's coverage test
// is the bar). CBS's own ENG sibling table fills CBS_MEASURE_TITLES
// (scripts/english-names-fetch.ts); this file's HAND_MEASURE_TITLES covers:
//  - a Dutch string on a table with no CBS English sibling at all (03759ned,
//    82235NED, 83932NED, 85224NED) — read from the Dutch definition text.
//  - a DELIBERATE override of a CBS-derived value that reads correctly IN
//    ITS OWN table context but is unsuitable as a bare, table-agnostic word
//    (OVERRIDDEN_BY_HAND lists exactly which and why).
// An unseeded title (a future canonical measure not yet run through the
// fetch script) stays Dutch — the never-guess default, never treat a gap
// here as a bug to paper over.
export const HAND_MEASURE_TITLES: Record<string, string> = {
  'Beginstand voorraad': 'Opening stock',
  'Bevolking op 1 januari': 'Population on 1 January',
  // housing_stock_start_of_year's alternate (D002968, 82235NED — no CBS
  // English sibling). Pairs with 'Beginstand voorraad'/'Opening stock' above
  // using the same opening/closing-stock accounting convention.
  'Eindstand Voorraad': 'Closing stock',
  'Gemiddeld inkomen': 'Average income',
  // population_on_1_january's alternate (M000365, 03759ned — no CBS English
  // sibling); the fixture's own Title carries a trailing space
  // ('Gemiddelde bevolking '), normalised away here as everywhere else.
  'Gemiddelde bevolking': 'Average population',
  // OVERRIDDEN_BY_HAND: CBS's own English for this exact leaf Topic title
  // (85828NED, reachable via retail_turnover_yoy's alternate A052581_2) is
  // 'Calendar adjusted production/turnover' — correct there, but bakes in
  // that ONE table's noun. 'Kalendergecorrigeerd' is a bare adjective with
  // no implied noun in Dutch; stripping CBS's table-specific noun keeps this
  // flat map entry safe to reuse anywhere the bare word appears.
  Kalendergecorrigeerd: 'Calendar adjusted',
  // OVERRIDDEN_BY_HAND: same reasoning as 'Kalendergecorrigeerd' above —
  // CBS's own English for this leaf Topic (85828NED, reachable via
  // retail_turnover_yoy's own primary measure A042501_2 and its alternate
  // A042501_1) is 'Uncorrected production/turnover'.
  Ongecorrigeerd: 'Uncorrected',
  // Fix round 2 (owner-driven, "just pick one"): this Dutch string is
  // reachable both as house_price_index_regional's own primary measure
  // (M001505_2, 85792NED — CBS: 'Price index purchase prices') and as
  // average_existing_home_sale_price's alternate (same code, 85773NED — CBS:
  // 'Price index selling prices.') — a genuine rule-3 conflict, still
  // reported as such by scripts/english-names-fetch.ts's conflict scan
  // (CONFLICTED no longer lists it — the conflict is resolved here, not
  // hidden). Picked 'Price index purchase prices': BOTH tables' own CBS
  // English TABLE titles use "purchase prices" (85773ENG 'Existing own
  // homes; purchase prices, price indices 2020=100'; 85792ENG 'Existing own
  // homes; purchase prices, price index 2020=100, region') — this measure
  // title is the one that matches the table it's actually shown on either
  // way, per that shared wording.
  'Prijsindex verkoopprijzen': 'Price index purchase prices',
  Werkloosheidspercentage: 'Unemployment rate',
};
export const MEASURE_TITLES: Record<string, string> = { ...CBS_MEASURE_TITLES, ...HAND_MEASURE_TITLES };

// --- table titles ----------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3): every registered table's own
// title (`ValidatedResult.attribution.tableTitle`, TableInfos' `Title`
// field), keyed on the exact Dutch title string. CBS_TABLE_TITLES (CBS's own
// ENG sibling) plus this file's HAND_TABLE_TITLES for the four tables with
// none.
export const HAND_TABLE_TITLES: Record<string, string> = {
  'Arbeidsdeelname; kerncijfers seizoengecorrigeerd': 'Labour participation; key figures, seasonally adjusted',
  'Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio':
    'Population on 1 January and average; sex, age and region',
  'Inkomen van huishoudens; inkomensklassen, huishoudenskenmerken':
    'Income of households; income brackets, household characteristics',
  'Voorraad woningen; standen en mutaties vanaf 1921': 'Housing stock; levels and changes since 1921',
};
export const TABLE_TITLES: Record<string, string> = { ...CBS_TABLE_TITLES, ...HAND_TABLE_TITLES };

// --- dimension labels --------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3): CBS's own non-region dimension
// value labels (`ResultCell.dimLabels`'s values) for the specific codes the
// registry actually uses — a table's default_coordinates, a canonical
// measure's own `dims`, and its `alternates[].dims` (task-3-brief.md rule 4:
// "only labels the product can show are needed"). CBS_DIM_LABELS (CBS's own
// ENG sibling) plus this file's HAND_DIM_LABELS for the four no-sibling
// tables' codes.
//
// 80590ned's four Leeftijd age bands (52052 '15 tot 75 jaar', 53050
// '15 tot 25 jaar', 53310 '25 tot 45 jaar', 53825 '45 tot 75 jaar') ARE
// covered, in CBS_DIM_LABELS, as CBS's own '15 to 74 years' etc. — Fix
// round 2 (owner-driven) established these are NOT a CBS wording error:
// Dutch "tot" is exclusive (the four bands don't overlap), so CBS's English
// states the identical ranges inclusively, one less on the upper bound. The
// digit-invariance checks (this file's own test and
// scripts/english-names-fetch.ts's dim-pairing check) both carry one
// narrowly-scoped exception for exactly this shape — see
// isDutchExclusiveAgeRangePair in either file.
//
// Deliberately NOT covered (each verified, not assumed — see
// task-3-report.md for the full trace):
//  - the bare word 'Totaal' (03759ned's Leeftijd default 10000, 80590ned's
//    Geslacht default T001038, 83932NED's Inkomensklassen default T001226):
//    CBS's own ENG for 80590ned's occurrence is 'Total sex' — correct THERE,
//    but 'Totaal' alone is used across many unrelated dimensions in this
//    registry and a flat Dutch-string map can't hold a different English
//    word per table for the same bare key.
//    scripts/english-names-fetch.ts's own AMBIGUOUS_BARE_WORDS list excludes
//    it from CBS_DIM_LABELS for exactly this reason, so it never even
//    reaches this file to be hand-overridden — left Dutch everywhere.
//  - 85792NED's RegioS default NL01 ('Nederland'): CBS's OWN English table
//    for this dimension leaves it as 'Nederland', unchanged (confirmed by
//    fetching it directly — this table's RegioS is even typed inconsistently
//    between NED (`Dimension`) and ENG (`GeoDimension`), a CBS metadata
//    quirk) — a different table's REGIONS entry translates 'Nederland' via a
//    different code path (geo, not this one), so there is no conflict, just
//    nothing to add here.
export const HAND_DIM_LABELS: Record<string, string> = {
  'Besteedbaar inkomen': 'Disposable income',
  'Bruto inkomen': 'Gross income',
  'Gestandaardiseerd inkomen': 'Standardised income',
  'Oorspronkelijke, ongecorrigeerde cijfers': 'Original, unadjusted figures',
  'Particuliere huishoudens': 'Private households',
  'Primair inkomen': 'Primary income',
  'Seizoengecorrigeerde cijfers': 'Seasonally adjusted figures',
  'Totaal burgerlijke staat': 'Total marital status',
  'Totaal mannen en vrouwen': 'Total men and women',
};
export const DIM_LABELS: Record<string, string> = { ...CBS_DIM_LABELS, ...HAND_DIM_LABELS };

// --- curated ---------------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3): the Dutch labels whose English
// form was WRITTEN BY A SESSION (reading the Dutch table's own definition
// text, or deliberately overriding a CBS-derived value — see
// OVERRIDDEN_BY_HAND), not taken verbatim from a CBS-published English
// field — principle (c)'s "never guess" made auditable: anyone can grep this
// set and know exactly which entries above are a session's judgment call
// versus CBS's own words. Scoped to MEASURE_TITLES and TABLE_TITLES only,
// matching what consumes this set today
// (tests/registry/english-names-data.test.ts, task-3-brief.md's own test) —
// DIM_LABELS' hand-written entries are documented inline above instead
// (four no-sibling tables' codes); extend this set's scope in the same
// change if a future consumer needs curated dim labels tracked too.
export const CURATED: ReadonlySet<string> = new Set([
  'Arbeidsdeelname; kerncijfers seizoengecorrigeerd',
  'Beginstand voorraad',
  'Bevolking op 1 januari',
  'Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio',
  'Eindstand Voorraad',
  'Gemiddeld inkomen',
  'Gemiddelde bevolking',
  'Inkomen van huishoudens; inkomensklassen, huishoudenskenmerken',
  'Kalendergecorrigeerd',
  'Ongecorrigeerd',
  // Fix round 2 (owner-driven): a resolved rule-3 conflict (see the
  // HAND_MEASURE_TITLES entry's own comment and CONFLICTED below) — the
  // owner picked one of CBS's own two disagreeing English forms, so this is
  // a session's (the owner's) judgment call, not a straight CBS derivation.
  'Prijsindex verkoopprijzen',
  'Voorraad woningen; standen en mutaties vanaf 1921',
  'Werkloosheidspercentage',
]);

// --- conflicted --------------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3 Fix round 1): a Dutch string that
// IS reachable from a registered canonical measure (a primary `measure` or
// an alternate's `measure`) but that CBS's OWN English words genuinely
// disagree on across two different reachable contexts (rule 3 — "emit
// neither, list the conflict", never silently pick a side). Checked by
// tests/registry/english-names-data.test.ts's coverage test (a CONFLICTED
// entry is exempted from "must have an English title" — it deliberately has
// none) and by its own sibling test (a CONFLICTED entry must NEVER actually
// gain a MEASURE_TITLES/TABLE_TITLES entry, which would mean the conflict
// was silently resolved one way without this set being updated to match).
//
// Empty as of Fix round 2: 'Prijsindex verkoopprijzen' was this set's one
// entry (house_price_index_regional's own primary measure M001505_2,
// 85792NED, CBS: 'Price index purchase prices' — vs
// average_existing_home_sale_price's alternate, same code M001505_2 but on
// 85773NED, CBS: 'Price index selling prices.') until the owner resolved it
// with an explicit pick ("just pick one" — see HAND_MEASURE_TITLES's own
// comment on that entry). scripts/english-names-fetch.ts's conflict scan is
// UNCHANGED and still reports this exact conflict on every run (the
// generated file still never carries this key) — the hand map is what
// resolves it now, not the detector. Kept (with its own test) for the next
// genuine conflict, rather than deleted now that it happens to be empty.
export const CONFLICTED: ReadonlySet<string> = new Set([]);

// --- overridden by hand --------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3 Fix round 1): every key where a
// HAND_X map's value deliberately differs from what CBS_X (the generated
// file) would derive for the SAME key — the one narrow, explicit exception
// to "a hand map and a CBS map must never disagree on a shared key" (checked
// by tests/registry/english-names-data.test.ts's duplicate-check test).
// Spans every category (measure titles, regions, …), not just CURATED's
// measure/table scope. Add an entry here ONLY alongside a comment on the
// HAND_X entry itself explaining why CBS's own derived value isn't used
// as-is — this set exists so an UNEXPLAINED divergence still fails the test.
export const OVERRIDDEN_BY_HAND: ReadonlySet<string> = new Set([
  'Kalendergecorrigeerd', // HAND_MEASURE_TITLES: strips CBS's table-specific noun.
  'Ongecorrigeerd', // HAND_MEASURE_TITLES: strips CBS's table-specific noun.
  'Nederland', // HAND_REGIONS: keeps lowercase 'the Netherlands' for sentence-flow, CBS's own list gives 'The Netherlands'.
]);
