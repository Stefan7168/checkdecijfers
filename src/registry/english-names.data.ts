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
// ADR 058 phase 1 (English answers, Task 3): every registered CBS canonical
// measure's `measureTitle` (src/registry/defaults.ts CANONICAL_MEASURES),
// filled from CBS's own ENG sibling table where one exists
// (scripts/english-names-fetch.ts, run 2026-09-25 — see task-3-report.md for
// the full per-table trace) and by hand — reading the Dutch definition text
// — for the four tables with no ENG sibling (03759ned, 82235NED, 83932NED,
// 85224NED) and the two composite "TopicGroup / … / Topic" breadcrumb titles
// a past session hand-assembled for 80590ned and 85828NED (never a literal
// single CBS field — see the two composite entries' own comments below).
// Hand-written entries are listed in CURATED. An unseeded title (a future
// canonical measure not yet run through the fetch script) stays Dutch — the
// never-guess default, never treat a gap here as a bug to paper over.
//
// Two labels the fetch script's own conflict check flagged as read
// differently at their OTHER occurrence, and how each was resolved (rule 3 —
// never silently pick a side; document the choice instead):
//  - 'Gemiddelde verkoopprijs' reads identically ("Average purchase price")
//    at all three tables that register it (85773NED, 83625NED) plus its
//    unregistered 85792NED occurrence — no real conflict, confirmed by cross-
//    checking every occurrence, not assumed from one.
//  - 'Prijsindex verkoopprijzen' is registered ONLY for 85792NED
//    (house_price_index_regional); 85773NED happens to carry an unrelated
//    Topic with the exact same Dutch title, translated differently there
//    ("Price index selling prices.") — this entry is 85792NED's own English
//    word, not a guess, and 85773NED's homonym is simply never looked up
//    under this key (85773NED's own registered title is 'Gemiddelde
//    verkoopprijs', a different string).
export const MEASURE_TITLES: Record<string, string> = {
  'Beginstand voorraad': 'Opening stock',
  'Bevolking op 1 januari': 'Population on 1 January',
  'Bruto binnenlands product': 'Gross domestic product',
  'Bruto elektriciteitsproductie': 'Gross production of electricity',
  Consumentenvertrouwen: 'Consumer confidence',
  'Economisch klimaat': 'Economic climate',
  'Gemiddeld inkomen': 'Average income',
  'Gemiddelde verkoopprijs': 'Average purchase price',
  'Jaarmutatie CPI': 'Annual rate of change CPI',
  'Jaarmutatie invoerwaarde': 'Annual change in import value',
  // CBS's own English wording for this specific measure ("producentenprijzen
  // (afzet totaal)", position 5 of 85770NED/ENG) reads as a generic
  // methodological label rather than a literal translation of "Jaarmutatie
  // PPI" — verified against the table's own description (both languages
  // describe the same Producer Price Index table) and kept verbatim per
  // principle (c): CBS's own words, even when they surprise a literal
  // reading, beat a session's guess.
  'Jaarmutatie PPI': 'Year-on-year development',
  'Jaarmutatie uitvoerwaarde': 'Annual change in export value',
  Koopbereidheid: 'Willingness to buy',
  'Prijsindex verkoopprijzen': 'Price index purchase prices',
  // Same CBS-own-wording note as 'Jaarmutatie PPI' above (position 3 of the
  // same table).
  'Producentenprijsindex (PPI)': 'Price index numbers excluding excise',
  'Totale invoerwaarde': 'Total import value',
  'Totale uitvoerwaarde': 'Total export value',
  'Uitgesproken faillissementen': 'Pronounced bankruptcies',
  'Volumemutaties, koopdaggecorrigeerd': 'Volume changes shoppingday adjusted',
  // Composed, not fetched verbatim: retail_turnover_yoy/supermarket_turnover_
  // yoy's measureTitle (85828NED) is a session-assembled breadcrumb over a
  // 4-level CBS TopicGroup hierarchy ('Omzet' > 'Waarde' > 'Ontwikkeling
  // t.o.v. een jaar eerder' > 'Ongecorrigeerd', position 5 of 85828NED/ENG)
  // that drops the top 'Omzet'/'Turnover' level and elides "een" — so it
  // never matches a single CBS Title field. Every WORD here is still CBS's
  // own (its two surviving TopicGroup titles + the leaf Topic title,
  // 'Value'/'Development compared to a year earlier'/'Uncorrected
  // production/turnover' — scripts/english-names-fetch.ts's report), just
  // assembled by a session mirroring the same abbreviation the Dutch
  // original used — hence CURATED, unlike the exact structural mirror below.
  'Waarde / Ontwikkeling t.o.v. jaar eerder / Ongecorrigeerd':
    'Value / Development compared to a year earlier / Uncorrected production/turnover',
  Werkloosheidspercentage: 'Unemployment rate',
  // Composed like the entry above, but an EXACT structural mirror (one
  // TopicGroup + its leaf Topic, no level dropped, no word elided) — CBS's
  // own 'Werkloosheidspercentage' TopicGroup title and 'Seizoengecorrigeerd'
  // Topic title (80590NED/ENG position 10) joined the same way the Dutch
  // composite already was. Not CURATED: unlike the entry above, nothing here
  // required a session judgment call about which levels to keep.
  'Werkloosheidspercentage / Seizoengecorrigeerd': 'Unemployment rate / Seasonally adjusted',
};

// --- table titles ----------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3): every registered table's own
// title (`ValidatedResult.attribution.tableTitle`, TableInfos' `Title`
// field), keyed on the exact Dutch title string — CBS's own ENG sibling
// where one exists, hand-curated (CURATED) for the four with none.
export const TABLE_TITLES: Record<string, string> = {
  'Arbeidsdeelname en werkloosheid per maand': 'Monthly labour participation and unemployment',
  'Arbeidsdeelname; kerncijfers seizoengecorrigeerd': 'Labour participation; key figures, seasonally adjusted',
  'Bbp, productie en bestedingen; kwartalen, mutaties, nationale rekeningen':
    'GDP, output and expenditures; changes, Quarterly National Accounts',
  'Bestaande koopwoningen; gemiddelde verkoopprijzen, regio': 'Existing own homes; average purchase prices, region',
  'Bestaande koopwoningen; verkoopprijzen prijsindex 2020=100': 'Existing own homes; purchase prices, price indices 2020=100',
  'Bestaande koopwoningen; verkoopprijzen, prijsindex 2020=100, regio':
    'Existing own homes; purchase prices, price index 2020=100, region',
  'Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio':
    'Population on 1 January and average; sex, age and region',
  'Consumentenprijzen; CPI 2025=100, index en mutaties': 'Consumer prices; CPI 2025=100, index and rates of change',
  'Consumentenvertrouwen, economisch klimaat en koopbereidheid; gecorrigeerd':
    'Consumer confidence, economic climate and willingness to buy',
  'Consumptieve bestedingen door huishoudens; nationale rekeningen, 2021=100':
    'Consumption expenditure of households; National accounts, 2021=100',
  'Faillissementen; kerncijfers': 'Bankruptcies; key figures',
  'Handel en diensten; omzet- en productieontwikkeling, index 2021=100':
    'Trade and services; turnover and production changes, index 2021=100',
  'Hernieuwbare elektriciteit; productie en vermogen': 'Renewable electricity; production and capacity',
  'Inkomen van huishoudens; inkomensklassen, huishoudenskenmerken':
    'Income of households; income brackets, household characteristics',
  'Internationale goederenhandel; grensoverschrijding, kerncijfers':
    'International trade in goods; border crossing, key figures',
  'Producentenprijzen (PPI); afzet-, invoer-, verbruiksprijzen, index 2021=100':
    'Producer Price Index (PPI); output and importprices by product, 2021=100',
  'Voorraad woningen; standen en mutaties vanaf 1921': 'Housing stock; levels and changes since 1921',
};

// --- dimension labels --------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3): CBS's own non-region dimension
// value labels (`ResultCell.dimLabels`'s values) for the specific codes the
// registry actually uses — a table's default_coordinates, a canonical
// measure's own `dims`, and its `alternates[].dims` (task-3-brief.md rule 4:
// "only labels the product can show are needed"). CBS's own ENG sibling
// where one exists; hand-curated (not in CURATED — see that set's own
// comment) for the four no-sibling tables' codes.
//
// Deliberately NOT covered here (each verified, not assumed — see
// task-3-report.md for the full trace):
//  - the bare word 'Totaal' (03759ned's Leeftijd default 10000, 80590ned's
//    Geslacht default T001038, 83932NED's Inkomensklassen default T001226):
//    CBS's own ENG for 80590ned's occurrence is 'Total sex' — correct THERE,
//    but 'Totaal' alone is used across many unrelated dimensions in this
//    registry and a flat Dutch-string map can't hold a different English
//    word per table for the same bare key. Left Dutch everywhere rather than
//    risk a wrong translation in a context 'Total sex' doesn't fit.
//  - 80590ned's Leeftijd code 52052 ('15 tot 75 jaar'): CBS's own English
//    label is '15 to 74 years' — a genuine EN/NL boundary-convention
//    difference (Dutch "tot" here reads as inclusive-sounding, English
//    states the true inclusive upper bound), not a translation error, but
//    the digit literally differs — exactly what the digit-invariance test
//    exists to catch. Left Dutch; flagged to the owner (open-questions).
//  - 85792NED's RegioS default NL01 ('Nederland'): CBS's OWN English table
//    for this dimension leaves it as 'Nederland', unchanged (confirmed by
//    fetching it directly — this table's RegioS is even typed inconsistently
//    between NED (`Dimension`) and ENG (`GeoDimension`), a CBS metadata
//    quirk) — a different table's REGIONS entry translates 'Nederland' via a
//    different code path (geo, not this one), so there is no conflict, just
//    nothing to add here.
export const DIM_LABELS: Record<string, string> = {
  '000000 Alle bestedingen': '000000 All items',
  '47 Detailhandel (niet in auto\'s)': '47 Retail trade (not in motor vehicles)',
  '471 Supermarkten en warenhuizen': '471 Non-specialised retail sales.',
  'B-E Nijverheid (geen bouw) en energie': 'B-E Industry (except construction)',
  'Bedrijven en instellingen': 'Companies and institutions',
  'Besteedbaar inkomen': 'Disposable income',
  'Binnenlandse consumptie huishoudens': 'Domestic consumption by households',
  'Bruto inkomen': 'Gross income',
  'Gestandaardiseerd inkomen': 'Standardised income',
  Invoerprijzen: 'Consumption of foreign products',
  'Oorspronkelijke, ongecorrigeerde cijfers': 'Original, unadjusted figures',
  'Particuliere huishoudens': 'Private households',
  'Primair inkomen': 'Primary income',
  'Seizoengecorrigeerde cijfers': 'Seasonally adjusted figures',
  'Totaal afzetprijzen': 'Total sales',
  'Totaal burgerlijke staat': 'Total marital status',
  'Totaal goederen': 'Total goods',
  'Totaal landen': 'Total countries',
  'Totaal mannen en vrouwen': 'Total men and women',
  'Totaal rechtsvormen Nederland/buitenland': 'Total legal forms all nationalities',
  'Volume, t.o.v. voorgaande periode': 'Volume, on previous period (q/q)',
  'Volume, t.o.v. zelfde periode vorig jaar': 'Volume, on corresponding period (y/y)',
  'Waarde, t.o.v. zelfde periode vorig jaar': 'Value, on corresponding period (y/y)',
  Zonnestroom: 'Solar photovoltaic',
};

// --- curated ---------------------------------------------------------------
// ADR 058 phase 1 (English answers, Task 3): the Dutch labels whose English
// form was WRITTEN BY A SESSION (reading the Dutch table's own definition
// text), not taken verbatim from a CBS-published English field — principle
// (c)'s "never guess" made auditable: anyone can grep this set and know
// exactly which entries above are a session's judgment call versus CBS's own
// words. Scoped to MEASURE_TITLES and TABLE_TITLES only, matching what
// consumes this set today (tests/registry/english-names-data.test.ts,
// task-3-brief.md's own test) — DIM_LABELS' hand-written entries are
// documented inline above instead (four no-sibling tables' codes); extend
// this set's scope in the same change if a future consumer needs curated
// dim labels tracked too.
export const CURATED: ReadonlySet<string> = new Set([
  'Arbeidsdeelname; kerncijfers seizoengecorrigeerd',
  'Beginstand voorraad',
  'Bevolking op 1 januari',
  'Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio',
  'Gemiddeld inkomen',
  'Inkomen van huishoudens; inkomensklassen, huishoudenskenmerken',
  'Voorraad woningen; standen en mutaties vanaf 1921',
  'Waarde / Ontwikkeling t.o.v. jaar eerder / Ongecorrigeerd',
  'Werkloosheidspercentage',
]);
