// Registry work package data: default_coordinates + period_semantics per table
// (cbs_tables columns, migration 001) and canonical_measures (migration 002,
// ADR 010). This is curated content, not measured from the CBS API — each entry
// documents the source of its judgment call.
//
// default_coordinates vs canonical_measures — the split that matters here:
// default_coordinates pins dimensions that are *incidental* to every question on
// a table (nobody ever asks to break population down by Geslacht unless they say
// so). canonical_measures pins dimensions that ARE the semantic content of an
// everyday term (seasonally-adjusted-or-not IS what "werkloosheid" means) — an
// invariant-R7 "registry-internal variant choice", always stated transparently
// via definitionLabel (docs/05-data-rules.md, canonical defaults).
//
// Period grains present per table, measured 2026-07-03 against the live ingest
// (`select distinct table_id, period_grain from observations`): 03759ned/JJ,
// 86141NED/JJ+MM, 85224NED/JJ+KW, 82235NED/JJ, 85773NED/JJ+KW+MM, 82242NED/JJ+KW+MM,
// 83932NED/JJ, 82610NED/JJ.
import type { CanonicalMeasure, TableRegistryDefaults } from './types.ts';

export const TABLE_REGISTRY_DEFAULTS: TableRegistryDefaults[] = [
  {
    tableId: '03759ned',
    // Matches the ingestion slice (src/ingestion/registry-seed.ts) — these are
    // the only coordinates the table carries, so "default" and "only" coincide.
    defaultCoordinates: { Geslacht: 'T001038', Leeftijd: '10000', BurgerlijkeStaat: 'T001019' },
    periodSemantics: {
      JJ: 'Measure-afhankelijk: voor M000352 (Bevolking op 1 januari) is dit een standcijfer per 1 januari van het genoemde jaar (B13\'s groei-in-2024 leunt hierop); voor M000365 (Gemiddelde bevolking) is het jaargemiddelde.',
    },
  },
  {
    tableId: '86141NED',
    defaultCoordinates: { Bestedingscategorieen: 'T001112' },
    periodSemantics: {
      JJ: 'Jaargemiddelde: voor de mutatiematen (M000238/M000239) het jaargemiddelde mutatiepercentage; voor de indexmaten (M000215/M000216) het jaargemiddelde indexniveau. Nooit een standcijfer.',
      MM: 'Cijfer voor de genoemde kalendermaand (voor de mutatiematen: t.o.v. dezelfde maand een jaar eerder).',
    },
  },
  {
    tableId: '85224NED',
    defaultCoordinates: {},
    periodSemantics: {
      JJ: 'Jaargemiddelde over de vier kwartalen.',
      KW: 'Kwartaalcijfer voor het genoemde kwartaal.',
    },
  },
  {
    tableId: '82235NED',
    defaultCoordinates: {},
    periodSemantics: {
      JJ: 'Measure-afhankelijk: Beginstand voorraad (D002936) = stand per 1 januari van het genoemde jaar; Eindstand Voorraad (D002968) = stand per 31 december; overige measures (Nieuwbouw, Sloop, Correctie, Saldo, ...) zijn mutaties gedurende het jaar, geen standcijfers. B6\'s ambiguity is exactly this split — see open-questions #35.',
    },
  },
  {
    tableId: '85773NED',
    defaultCoordinates: {},
    periodSemantics: {
      JJ: 'Jaargemiddelde verkoopprijs over alle transacties in het genoemde jaar (geen standcijfer op één datum).',
      KW: 'Kwartaalgemiddelde.',
      MM: 'Maandgemiddelde; nieuwe cijfers ongeveer 22 dagen na afloop van de maand (docs/07).',
    },
  },
  {
    tableId: '82242NED',
    defaultCoordinates: {},
    periodSemantics: {
      JJ: 'Jaartotaal: som van de uitgesproken faillissementen in het genoemde jaar (geen jaargemiddelde, geen 12-maands optelling nodig — CBS levert het jaartotaal direct).',
      KW: 'Kwartaaltotaal.',
      MM: 'Maandtotaal.',
    },
  },
  {
    tableId: '83932NED',
    defaultCoordinates: { Inkomensklassen: 'T001226', KenmerkenVanHuishoudens: '1050010' },
    periodSemantics: {
      JJ: 'Cijfer voor het genoemde inkomstenjaar. Inkomensstatistieken hebben vertraagde definitieve vaststelling (docs/07: 2023JJ00 Definitief, 2024JJ00 nog Voorlopig ten tijde van deze ingest) — status altijd meegeven, nooit aannemen dat het meest recente jaar al definitief is.',
    },
  },
  {
    tableId: '82610NED',
    defaultCoordinates: {},
    periodSemantics: {
      JJ: 'Jaartotaal: productie/vermogen voor het genoemde jaar (bijv. Bruto elektriciteitsproductie is een jaartotaal, geen jaargemiddelde).',
    },
  },
  {
    // Coverage sprint table #1 (docs/11-coverage-table-set.md). Monthly-only
    // grain (measured 2026-07-17: all 483 period keys are YYYYMMnn, v3+v4).
    tableId: '83693NED',
    defaultCoordinates: {},
    periodSemantics: {
      MM: 'Seizoengecorrigeerd saldo voor de genoemde kalendermaand (gemeten in de eerste helft van die maand; CBS publiceert het cijfer rond de 22e van dezelfde maand). Geen jaar- of kwartaalreeks in deze tabel.',
    },
  },
  {
    // Coverage sprint table #3 (specs doc 2026-07-17). Slice pins the ProdCom
    // total; the Afzetgebieden flavor (totaal vs invoer) is semantic content
    // for the canonical keys (session-50 vocab batch).
    tableId: '85770NED',
    defaultCoordinates: {},
    periodSemantics: {
      MM: 'Cijfer voor de genoemde kalendermaand (voor de mutatiematen: t.o.v. dezelfde maand een jaar eerder); de laatste vijf maanden zijn Voorlopig.',
      JJ: 'Jaargemiddelde over de genoemde kalenderjaar-maanden.',
    },
  },
  {
    // Coverage sprint table #2 (specs doc 2026-07-17; owner slice decision =
    // full ingest, session 50). The SoortMutaties flavor (volume/waarde/prijs ×
    // jaar-op-jaar/periode-op-periode) is semantic content pinned per canonical
    // key — there is no meaningful table-wide default coordinate.
    tableId: '85880NED',
    defaultCoordinates: {},
    periodSemantics: {
      KW: 'Procentuele verandering in het genoemde kwartaal, t.o.v. hetzelfde kwartaal een jaar eerder (jaar-op-jaarmaten) of het voorgaande kwartaal (kwartaal-op-kwartaalmaten). Eerste raming (flash) ~30 dagen na kwartaaleinde; recente kwartalen zijn Voorlopig en worden later bijgesteld.',
      JJ: 'Procentuele verandering in het genoemde kalenderjaar t.o.v. het voorgaande jaar (beide mutatiesoorten vallen op jaarbasis samen).',
    },
  },
  {
    // Coverage sprint table #4 (85828NED omzet detailhandel; measured
    // 2026-07-17, session 53 prep). The branch is topical content per future
    // canonical key, but the everyday retail ask anchors on SBI 47 — the
    // topical total, mirroring 86141NED's alle-bestedingen default. Slice keeps
    // 371600 + its 7 direct subgroups (SBI 473/478 don't exist in this table).
    tableId: '85828NED',
    defaultCoordinates: { BedrijfstakkenBranchesSBI2008: '371600' },
    periodSemantics: {
      MM: 'Maandcijfer. Mutatiematen "t.o.v. jaar eerder": t.o.v. dezelfde maand een jaar eerder; indexmaten: maandniveau (2021=100). 2026-periodes zijn Voorlopig.',
      KW: 'Kwartaalcijfer (mutatiematen t.o.v. hetzelfde kwartaal een jaar eerder, of t.o.v. de voorgaande periode — per maat).',
      JJ: 'Jaarcijfer: indexmaten het jaargemiddelde indexniveau (2021=100); mutatiematen de jaarmutatie t.o.v. het voorgaande jaar.',
    },
  },
  {
    // Coverage sprint table #5 (85937NED consumptie huishoudens; measured
    // 2026-07-17). Default = binnenlandse consumptie totaal (A047812),
    // mirroring 86141NED's headline-category default. Koopdaggecorrigeerde
    // maat (M005269) bestaat voor 6 van de 14 categorieën — gedocumenteerd in
    // docs/11; de gewone volumemutatie (M000282) is overal dicht.
    tableId: '85937NED',
    defaultCoordinates: { ConsumptieveBestedingen: 'A047812' },
    periodSemantics: {
      MM: 'Maandcijfer; volumemutaties t.o.v. dezelfde maand een jaar eerder (koopdaggecorrigeerd waar de maattitel dat zegt).',
      KW: 'Kwartaalcijfer; mutaties t.o.v. hetzelfde kwartaal een jaar eerder.',
      JJ: 'Jaarcijfer; mutaties t.o.v. het voorgaande jaar. Cijfers vanaf 2021 zijn Voorlopig (gemeten Status-veld — breder dan CBS\'s eigen tabelomschrijving "2022-2025" zegt).',
    },
  },
  {
    // Coverage sprint table #6 (85429NED internationale goederenhandel;
    // measured 2026-07-17). Slice = totalen (Landen T001047 × SITC T001082) —
    // default and only coincide, the 03759ned pattern.
    tableId: '85429NED',
    defaultCoordinates: { Landen: 'T001047', SITC: 'T001082' },
    periodSemantics: {
      MM: 'Maandtotaal (waardematen: mln euro). Jaarmutaties: t.o.v. dezelfde maand een jaar eerder; die ontbreken volledig voor 2015 (geen basisjaar) en 2021 (methodebreuk 2020/2021 — CBS publiceert bewust geen jaar-op-jaarcijfers over de breuk heen; afwezige rijen).',
      JJ: 'Jaartotaal — LET OP: het lopende jaar staat in deze tabel als cumulatief deel-jaar (2026JJ00 heet "2026 januari-april", gemeten 2026-07-17), geen vol jaarcijfer; het periodelabel benoemt de maanden. Jaarmutatie-jaarcijfers ontbreken voor 2015 en 2021 (zie MM).',
    },
  },
  {
    // Coverage sprint table #7 (85792NED huizenprijzen per regio; measured
    // 2026-07-17). RegioS is Kind="Dimension" (NOT GeoDimension) — treated as
    // a plain dimension with the national aggregate as default; the 4 cities /
    // 12 provinces are reachable via explicit dims or future canonical keys
    // (specs-doc design note). All periods are "direct definitief".
    tableId: '85792NED',
    defaultCoordinates: { RegioS: 'NL01' },
    periodSemantics: {
      KW: 'Kwartaalcijfer voor het genoemde kwartaal; cijfers zijn bij publicatie direct definitief (geen reguliere revisiecyclus).',
      JJ: 'Jaarcijfer, measure-afhankelijk: prijsindex en gemiddelde verkoopprijs zijn jaargemiddelden; verkochte woningen is een jaartotaal.',
    },
  },
  {
    // Coverage sprint table #8 (80590ned werkloosheid per maand — LOWERCASE
    // id, docs/07 quirk #1; measured 2026-07-17). Slice pins totaal × 15-75
    // jaar — default and only coincide. The quarterly 85224NED keeps the
    // "werkloosheid" canonical default; this table's own terms come with the
    // staged vocab batch (#165 discipline).
    tableId: '80590ned',
    defaultCoordinates: { Geslacht: 'T001038', Leeftijd: '52052' },
    periodSemantics: {
      MM: 'Maandcijfer (seizoengecorrigeerde maten: voor seizoensinvloeden gecorrigeerd maandniveau). Alle periodes zijn Definitief (gemeten 2026-07-17).',
      KW: 'Kwartaalcijfer.',
      JJ: 'Jaargemiddelde — alleen de niet-seizoengecorrigeerde maten hebben een jaarwaarde; seizoengecorrigeerde maten staan op jaarperiodes als lege cel met CBS-reden "Impossible" (seizoenscorrectie bestaat niet op jaarbasis).',
    },
  },
  {
    // Coverage sprint table #9 (83625NED gemiddelde verkoopprijzen per
    // gemeente; measured 2026-07-17). RegioS is a real GeoDimension (745
    // codes: NL01 + 4 LD + 12 PV + 728 GM incl. opgeheven gemeenten) — geo
    // resolution applies, so no RegioS default here (the geo path requires an
    // explicit region or clarifies, the 03759ned pattern).
    tableId: '83625NED',
    defaultCoordinates: {},
    periodSemantics: {
      JJ: 'Jaargemiddelde verkoopprijs over de transacties in het genoemde jaar; jaarlijkse publicatie (nieuw jaar ~februari), revisies alleen bij uitzondering. Opgeheven gemeenten houden rijen met lege waarde en CBS-reden "Impossible" voor jaren na hun opheffing.',
    },
  },
];

export const CANONICAL_MEASURES: CanonicalMeasure[] = [
  {
    key: 'population_on_1_january',
    tableId: '03759ned',
    measure: 'M000352',
    measureTitle: 'Bevolking op 1 januari',
    dims: {},
    definitionLabel: 'bevolking op 1 januari',
    everydayTerms: ['inwoners', 'bevolking', 'inwonertal', 'inwoneraantal'],
    alternates: [{ measure: 'M000365', label: 'Gemiddelde bevolking (jaargemiddelde, geen standcijfer)' }],
  },
  {
    key: 'cpi_yearly_inflation',
    tableId: '86141NED',
    measure: 'M000238',
    measureTitle: 'Jaarmutatie CPI',
    dims: {},
    definitionLabel: 'inflatie (jaarmutatie CPI, alle bestedingen)',
    everydayTerms: ['inflatie', 'cpi', 'consumentenprijzen', 'prijsstijging'],
    alternates: [{ measure: 'M000215', label: 'CPI indexniveau (2025=100), geen mutatiepercentage' }],
  },
  {
    key: 'unemployment_rate_seasonally_adjusted',
    tableId: '85224NED',
    measure: 'M001906',
    measureTitle: 'Werkloosheidspercentage',
    dims: { SeizoenEnWerkdagcorrectie: 'A050903' },
    definitionLabel: 'werkloosheidspercentage, seizoengecorrigeerd',
    everydayTerms: ['werkloosheid', 'werkloosheidspercentage', 'werkloosheidscijfer'],
    alternates: [
      { dims: { SeizoenEnWerkdagcorrectie: 'A042501' }, label: 'oorspronkelijke, ongecorrigeerde cijfers' },
    ],
    notes: 'Policy source: docs/05-data-rules.md canonical-default example ("werkloosheid" -> seasonally-adjusted headline series). Already decided, not a new assumption.',
  },
  {
    key: 'housing_stock_start_of_year',
    tableId: '82235NED',
    measure: 'D002936',
    measureTitle: 'Beginstand voorraad',
    dims: {},
    definitionLabel: 'woningvoorraad per 1 januari',
    everydayTerms: ['woningen', 'woningvoorraad', 'aantal woningen'],
    alternates: [{ measure: 'D002968', label: 'stand per 31 december (Eindstand Voorraad)' }],
    notes: '**Assumption** (open-questions #35, benchmark-key freeze WP3): pinned to 1 januari to match the population table\'s snapshot convention. Owner may override.',
  },
  {
    key: 'average_existing_home_sale_price',
    tableId: '85773NED',
    measure: 'M001534',
    measureTitle: 'Gemiddelde verkoopprijs',
    dims: {},
    definitionLabel: 'gemiddelde verkoopprijs van bestaande koopwoningen',
    // 'huizenprijzen' (plural) added session 54: with the index key
    // (house_price_index_regional) in the vocabulary, the bare plural made the
    // model clarify between the two readings on a follow-up (measured,
    // f-merge-topic-switch-national record 1) — the canonical default owns
    // both number forms explicitly.
    everydayTerms: ['koopwoningprijs', 'huizenprijs', 'huizenprijzen', 'verkoopprijs woningen', 'huizenmarkt'],
    alternates: [
      { measure: 'M001505_2', label: 'prijsindex verkoopprijzen (marktontwikkeling, niet composition-adjusted vs. de gemiddelde prijs)' },
    ],
  },
  {
    key: 'bankruptcies_businesses',
    tableId: '82242NED',
    measure: 'M001327',
    measureTitle: 'Uitgesproken faillissementen',
    dims: { TypeGefailleerde: 'A047597' },
    definitionLabel: 'faillissementen van bedrijven en instellingen',
    everydayTerms: ['faillissementen', 'faillissementencijfer'],
    alternates: [
      { dims: { TypeGefailleerde: 'T001243' }, label: 'totaal rechtsvormen (incl. particuliere faillissementen)' },
    ],
    notes: '**Assumption** (open-questions #36, benchmark-key freeze WP3): pinned to businesses-only per docs/07\'s note that press coverage usually cites this reading. Owner may override.',
  },
  {
    key: 'solar_electricity_production',
    tableId: '82610NED',
    measure: 'M002264_1',
    measureTitle: 'Bruto elektriciteitsproductie',
    dims: { BronTechniek: 'E006590' },
    definitionLabel: 'bruto elektriciteitsproductie uit zonnestroom',
    everydayTerms: ['zonnestroom', 'zonne-energie', 'elektriciteit uit zonnepanelen', 'zonnepanelen'],
    notes: 'Not a canonical-default choice: "zonnestroom" names the BronTechniek directly (Zonnestroom = E006590), no ambiguity to resolve.',
  },
  {
    key: 'consumer_confidence_seasonally_adjusted',
    tableId: '83693NED',
    measure: 'M001093',
    measureTitle: 'Consumentenvertrouwen',
    dims: {},
    definitionLabel: 'consumentenvertrouwen, seizoengecorrigeerd',
    everydayTerms: ['consumentenvertrouwen', 'vertrouwen van consumenten', 'consumentenvertrouwenscijfer'],
    notes:
      'Canonical-default choice mirroring the werkloosheid precedent (docs/05-data-rules.md canonical defaults): the everyday term maps to the SEASONALLY ADJUSTED headline series (83693NED), not the uncorrected sibling table 83694NED. CBS itself leads its persbericht with this corrected figure. Coverage sprint #163(3), docs/11-coverage-table-set.md.',
  },
  {
    key: 'economic_climate_seasonally_adjusted',
    tableId: '83693NED',
    measure: 'D001095',
    measureTitle: 'Economisch klimaat',
    dims: {},
    definitionLabel: 'oordeel economisch klimaat (deelindicator consumentenvertrouwen), seizoengecorrigeerd',
    everydayTerms: ['economisch klimaat', 'oordeel economisch klimaat'],
    notes:
      'Sub-indicator of consumentenvertrouwen (same CBS persbericht family); own key so the persberichtdag question shapes answer deterministically instead of routing to the WP16 finder. Not a canonical-default choice: the term names the measure directly.',
  },
  {
    key: 'willingness_to_buy_seasonally_adjusted',
    tableId: '83693NED',
    measure: 'M001128',
    measureTitle: 'Koopbereidheid',
    dims: {},
    definitionLabel: 'koopbereidheid (deelindicator consumentenvertrouwen), seizoengecorrigeerd',
    everydayTerms: ['koopbereidheid'],
    notes:
      'Sub-indicator of consumentenvertrouwen (same CBS persbericht family); own key so the persberichtdag question shapes answer deterministically instead of routing to the WP16 finder. Not a canonical-default choice: the term names the measure directly.',
  },
  {
    key: 'average_disposable_household_income',
    tableId: '83932NED',
    measure: 'M003239',
    measureTitle: 'Gemiddeld inkomen',
    dims: { Inkomensbegrippen: 'A043966' },
    definitionLabel: 'gemiddeld besteedbaar inkomen van huishoudens',
    everydayTerms: ['besteedbaar inkomen', 'huishoudinkomen'],
    alternates: [
      { dims: { Inkomensbegrippen: 'A043964' }, label: 'primair inkomen' },
      { dims: { Inkomensbegrippen: 'A043965' }, label: 'bruto inkomen' },
      { dims: { Inkomensbegrippen: 'A043967' }, label: 'gestandaardiseerd inkomen' },
    ],
    notes: 'Not a canonical-default choice: "besteedbaar inkomen" names the Inkomensbegrip directly, no ambiguity to resolve.',
  },
  {
    // Coverage sprint table #2 (85880NED BBP flash, session 50, 2026-07-17).
    // Canonical default: the everyday "economische groei"/"bbp" ask maps to
    // CBS's own persbericht headline — VOLUME growth vs the same period a year
    // earlier (A045299). The measure title exists on FOUR codes in this table;
    // M002782_1 is pinned by CODE (specs doc conclusion 3 — never map by title).
    key: 'gdp_growth_yoy_volume',
    tableId: '85880NED',
    measure: 'M002782_1',
    measureTitle: 'Bruto binnenlands product',
    dims: { SoortMutaties: 'A045299' },
    definitionLabel: 'economische groei: bbp-volumegroei t.o.v. een jaar eerder',
    everydayTerms: ['economische groei', 'bbp', 'bruto binnenlands product', 'groei van de economie'],
    alternates: [
      { dims: { SoortMutaties: 'A045300' }, label: 'groei t.o.v. het voorgaande kwartaal (eigen key: gdp_growth_qoq_volume)' },
      { dims: { SoortMutaties: 'A045301' }, label: 'waardegroei (nominaal, niet voor inflatie gecorrigeerd)' },
    ],
    notes:
      'Flash estimate ~30 dagen na kwartaaleinde; recente kwartalen Voorlopig en worden bij de tweede raming bijgesteld (R11). Full ingest (owner decision session 50) — de waarde-/prijssmaken en de inkomenskant-maten zitten in de tabel maar hebben (nog) geen eigen vocabulaire.',
  },
  {
    key: 'gdp_growth_qoq_volume',
    tableId: '85880NED',
    measure: 'M002782_1',
    measureTitle: 'Bruto binnenlands product',
    dims: { SoortMutaties: 'A045300' },
    definitionLabel: 'bbp-volumegroei t.o.v. het voorgaande kwartaal (kwartaal-op-kwartaal)',
    everydayTerms: ['kwartaal-op-kwartaalgroei', 'groei ten opzichte van het vorige kwartaal'],
    alternates: [{ dims: { SoortMutaties: 'A045299' }, label: 'groei t.o.v. een jaar eerder (de headline; eigen key: gdp_growth_yoy_volume)' }],
    notes:
      'Op jaarperiodes (JJ) vallen beide mutatiesoorten samen: t.o.v. het voorgaande jaar. Not a canonical-default choice: de term benoemt de kwartaal-op-kwartaallezing direct.',
  },
  {
    // Coverage sprint table #3 (85770NED PPI, session 50, 2026-07-17).
    // Canonical default: "producentenprijzen"/"ppi" maps to CBS's persbericht
    // headline — the YEAR-ON-YEAR mutation for totaal afzet × ProdCom-totaal
    // (A052584, the hierarchy root). Registered slice carries exactly totaal
    // afzet + invoer.
    key: 'producer_prices_yoy',
    tableId: '85770NED',
    measure: 'M003288',
    measureTitle: 'Jaarmutatie PPI',
    dims: { Afzetgebieden: 'A044074', AlleProdComCoderingen: 'A052584' },
    definitionLabel: 'producentenprijzen (afzet totaal): verandering t.o.v. een jaar eerder',
    everydayTerms: ['producentenprijzen', 'ppi', 'afzetprijzen industrie'],
    alternates: [
      { dims: { Afzetgebieden: 'A044077', AlleProdComCoderingen: 'A052584' }, label: 'invoerprijzen (eigen key: import_prices_yoy)' },
    ],
    notes:
      'Index 2021=100 (basisjaarbreuk t.o.v. oudere PPI-reeksen — R11/#26); de jaarmutatie ontbreekt in het eerste seriejaar (geen basisjaar, afwezige cellen); laatste ~5 maanden Voorlopig.',
  },
  {
    key: 'import_prices_yoy',
    tableId: '85770NED',
    measure: 'M003288',
    measureTitle: 'Jaarmutatie PPI',
    dims: { Afzetgebieden: 'A044077', AlleProdComCoderingen: 'A052584' },
    definitionLabel: 'invoerprijzen industrie (import): verandering t.o.v. een jaar eerder',
    everydayTerms: ['invoerprijzen', 'importprijzen'],
    notes: 'Zelfde maat als producer_prices_yoy maar voor het afzetgebied invoer (A044077). Not a canonical-default choice: de term benoemt de invoerlezing direct.',
  },
  {
    key: 'producer_price_index_level',
    tableId: '85770NED',
    measure: 'M003367',
    measureTitle: 'Producentenprijsindex (PPI)',
    dims: { Afzetgebieden: 'A044074', AlleProdComCoderingen: 'A052584' },
    definitionLabel: 'producentenprijsindex (niveau, 2021=100), afzet totaal',
    everydayTerms: ['producentenprijsindex'],
    notes:
      'Het indexNIVEAU (2021=100), volledig dicht (geen ontbrekende cellen). De alledaagse vraag "wat deden de producentenprijzen" hoort bij producer_prices_yoy; deze key is voor expliciete indexstand-vragen.',
  },
  {
    // Coverage sprint table #4 (85828NED, session-54 vocab batch — the staged
    // brief 2026-07-17-coverage-4-9-vocab-batch-staged.md is the design
    // record). Headline: retail turnover YoY for SBI 47 (branch pinned per
    // key; the value family, uncorrected — CBS's own press-release reading).
    key: 'retail_turnover_yoy',
    tableId: '85828NED',
    measure: 'A042501_2',
    measureTitle: 'Waarde / Ontwikkeling t.o.v. jaar eerder / Ongecorrigeerd',
    dims: { BedrijfstakkenBranchesSBI2008: '371600' },
    definitionLabel: 'omzetontwikkeling detailhandel (waarde t.o.v. een jaar eerder, ongecorrigeerd)',
    everydayTerms: ['omzet detailhandel', 'detailhandelsomzet', 'winkelomzet'],
    alternates: [
      { measure: 'A042501_1', label: 'het indexNIVEAU (2021 = 100), geen mutatiepercentage' },
      { measure: 'A052581_2', label: 'kalendergecorrigeerde variant' },
      { dims: { BedrijfstakkenBranchesSBI2008: '371700' }, label: 'alleen supermarkten en warenhuizen (eigen key: supermarket_turnover_yoy)' },
    ],
    notes:
      '2026-periodes zijn Voorlopig (R11). Slice = SBI 47 + de 7 directe subgroepen (473/478 bestaan niet in deze tabel — docs/11).',
  },
  {
    key: 'supermarket_turnover_yoy',
    tableId: '85828NED',
    measure: 'A042501_2',
    measureTitle: 'Waarde / Ontwikkeling t.o.v. jaar eerder / Ongecorrigeerd',
    dims: { BedrijfstakkenBranchesSBI2008: '371700' },
    definitionLabel: 'omzetontwikkeling supermarkten en warenhuizen (waarde t.o.v. een jaar eerder, ongecorrigeerd)',
    everydayTerms: ['omzet supermarkten', 'supermarktomzet'],
    alternates: [
      { dims: { BedrijfstakkenBranchesSBI2008: '371600' }, label: 'de hele detailhandel (eigen key: retail_turnover_yoy)' },
    ],
    notes: 'Not a canonical-default choice: de term benoemt de supermarktlezing direct. Zelfde maat als retail_turnover_yoy, andere branche.',
  },
  {
    // Coverage sprint table #5 (85937NED, session-54 vocab batch). Headline:
    // koopdaggecorrigeerde volumemutatie, binnenlandse consumptie totaal
    // (A047812 — also the table default). M005269 exists for only 6 of 14
    // categories (docs/11); the pinned default category is one of the 6.
    key: 'household_consumption_growth',
    tableId: '85937NED',
    measure: 'M005269',
    measureTitle: 'Volumemutaties, koopdaggecorrigeerd',
    dims: {},
    definitionLabel: 'consumptie huishoudens: volumemutatie t.o.v. een jaar eerder, koopdaggecorrigeerd',
    everydayTerms: ['consumptie huishoudens', 'huishoudconsumptie', 'bestedingen huishoudens', 'consumptiegroei'],
    alternates: [
      { measure: 'M000282', label: 'gewone volumemutatie (niet koopdaggecorrigeerd; wel dicht over alle 14 categorieën)' },
      { measure: 'M001288_1', label: 'het indexNIVEAU (2021=100)' },
    ],
    notes:
      'Cijfers vanaf 2021 zijn Voorlopig (gemeten Status-veld, breder dan CBS\'s eigen omschrijving — docs/11). Canonical default mirroring 86141NED: de kale consumptievraag = binnenlandse consumptie totaal (default-coördinaat A047812).',
  },
  {
    // Coverage sprint table #6 (85429NED, session-54 vocab batch). Value keys
    // + CBS's own YoY mutation keys (R5: never self-compute). Dims {} — the
    // table defaults pin the totals slice (Landen T001047 x SITC T001082).
    key: 'goods_imports_value',
    tableId: '85429NED',
    measure: 'D001607',
    measureTitle: 'Totale invoerwaarde',
    dims: {},
    definitionLabel: 'totale invoerwaarde van goederen (mln euro)',
    everydayTerms: ['invoerwaarde', 'goedereninvoer', 'invoer van goederen'],
    alternates: [
      { measure: 'M001608', label: 'de jaarmutatie in % (eigen key: goods_imports_yoy)' },
      { measure: 'M007895', label: 'doorvoerwaarde inkomend (aparte maat, geen invoer)' },
    ],
    notes:
      'LET OP het lopende jaar: 2026JJ00 is een cumulatief deel-jaar ("2026 januari-april") — geen vol jaarcijfer (period semantics + periodelabel zeggen dit). Prijsvragen ("invoerprijzen") horen bij import_prices_yoy (85770NED), niet hier.',
  },
  {
    key: 'goods_exports_value',
    tableId: '85429NED',
    measure: 'D001636',
    measureTitle: 'Totale uitvoerwaarde',
    dims: {},
    definitionLabel: 'totale uitvoerwaarde van goederen (mln euro)',
    everydayTerms: ['uitvoerwaarde', 'goederenuitvoer', 'uitvoer van goederen', 'export van goederen'],
    alternates: [
      { measure: 'M001609', label: 'de jaarmutatie in % (eigen key: goods_exports_yoy)' },
      { measure: 'M001648', label: 'wederuitvoerwaarde (aparte maat)' },
    ],
    notes: 'Zelfde tabel/vallen als goods_imports_value (deel-jaar 2026JJ00; methodebreuk bij de mutatiematen).',
  },
  {
    key: 'goods_imports_yoy',
    tableId: '85429NED',
    measure: 'M001608',
    measureTitle: 'Jaarmutatie invoerwaarde',
    dims: {},
    definitionLabel: 'jaarmutatie van de invoerwaarde (t.o.v. dezelfde periode een jaar eerder)',
    everydayTerms: ['jaarmutatie invoer', 'groei van de invoer'],
    alternates: [{ measure: 'D001607', label: 'de invoerwaarde zelf in mln euro (eigen key: goods_imports_value)' }],
    notes:
      'CBS\'s EIGEN mutatiemaat (R5: nooit zelf rekenen). Ontbreekt volledig voor 2015 (geen basisjaar) en 2021 (methodebreuk 2020/2021) — afwezige rijen, eerlijke no_data-weigering (CC21-patroon).',
  },
  {
    key: 'goods_exports_yoy',
    tableId: '85429NED',
    measure: 'M001609',
    measureTitle: 'Jaarmutatie uitvoerwaarde',
    dims: {},
    definitionLabel: 'jaarmutatie van de uitvoerwaarde (t.o.v. dezelfde periode een jaar eerder)',
    everydayTerms: ['jaarmutatie uitvoer', 'groei van de uitvoer'],
    alternates: [{ measure: 'D001636', label: 'de uitvoerwaarde zelf in mln euro (eigen key: goods_exports_value)' }],
    notes: 'Zelfde methodebreuk-gaten als goods_imports_yoy (2015 en 2021 afwezig).',
  },
  {
    // Coverage sprint table #7 (85792NED, session-54 vocab batch). RegioS is a
    // PLAIN dimension here (not GeoDimension) — the national default (NL01,
    // table default-coordinate) answers with the R7 transparent-default line;
    // named-region asks on THIS table have no canonical route yet (recorded
    // design point, staged brief). Gemeente-level price asks belong to
    // average_home_sale_price_by_gemeente (83625NED, a REAL geo table).
    key: 'house_price_index_regional',
    tableId: '85792NED',
    measure: 'M001505_2',
    measureTitle: 'Prijsindex verkoopprijzen',
    dims: {},
    definitionLabel: 'prijsindex bestaande koopwoningen (2020=100), landelijk',
    everydayTerms: ['prijsindex koopwoningen', 'huizenprijsindex', 'prijsindex bestaande koopwoningen'],
    alternates: [
      { measure: 'M005355', label: 'de jaarmutatie van de index in %' },
      { measure: 'M001534', label: 'de gemiddelde verkoopprijs in euro (landelijk actueel: key average_existing_home_sale_price)' },
      { measure: 'M001532_2', label: 'het aantal verkochte woningen' },
    ],
    notes:
      'Cijfers zijn bij publicatie direct definitief (geen revisiecyclus). De kale term "huizenprijs" blijft bij average_existing_home_sale_price (85773NED, maandelijks landelijk) — #165-discipline.',
  },
  {
    // Coverage sprint table #8 (80590ned — LOWERCASE id, session-54 vocab
    // batch). #165 discipline: the bare term "werkloosheid" STAYS with
    // unemployment_rate_seasonally_adjusted (85224NED, quarterly) — this key
    // carries month-flavored terms only.
    key: 'monthly_unemployment_seasonally_adjusted',
    tableId: '80590ned',
    measure: 'M004210',
    measureTitle: 'Werkloosheidspercentage / Seizoengecorrigeerd',
    dims: {},
    // No '(15-75 jaar)' suffix: the quarterly sibling key never names the age
    // range either (same underlying population), and the suffix measurably
    // destabilized breakdown follow-ups ("voor jongeren" flipped to
    // out_of_scope refusal — session-54 record rounds 1/4 vs 3).
    definitionLabel: 'maandcijfer werkloosheidspercentage, seizoengecorrigeerd',
    everydayTerms: ['maandwerkloosheid', 'werkloosheid per maand', 'maandelijkse werkloosheid'],
    alternates: [
      { measure: 'M001906_2', label: 'niet-seizoengecorrigeerd (heeft wél jaarcijfers)' },
    ],
    notes:
      'De kale term "werkloosheid" hoort bij unemployment_rate_seasonally_adjusted (85224NED, kwartaal — de canonical default), NIET bij deze key. Seizoengecorrigeerde jaarcijfers bestaan per definitie niet: JJ-periodes zijn lege cellen met CBS-reden "Impossible" (R11, CC28).',
  },
  {
    // Coverage sprint table #9 (83625NED, session-54 vocab batch). A REAL
    // GeoDimension (745 codes: NL01 + 4 LD + 12 PV + 728 GM incl. opgeheven
    // gemeenten) — regions travel through the intent's regions field, the
    // population-table way; REGIONAL_KEYS lists this key.
    key: 'average_home_sale_price_by_gemeente',
    tableId: '83625NED',
    measure: 'M001534',
    measureTitle: 'Gemiddelde verkoopprijs',
    dims: {},
    definitionLabel: 'gemiddelde verkoopprijs van bestaande koopwoningen, per gemeente/provincie (jaarcijfer)',
    everydayTerms: ['huizenprijs per gemeente', 'verkoopprijs per gemeente', 'gemiddelde verkoopprijs per gemeente'],
    alternates: [
      { measure: 'M001534', label: 'de landelijke maandactuele lezing: key average_existing_home_sale_price (85773NED)' },
    ],
    notes:
      'Jaarcijfers 1995-2025, alle Definitief; opgeheven gemeenten houden lege cellen met reden "Impossible" na hun opheffing (R11). De kale term "huizenprijs" blijft bij average_existing_home_sale_price (85773NED) — deze key is de per-gemeente/regionale lezing (#160(b)).',
  },
];
