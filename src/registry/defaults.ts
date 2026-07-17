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
    everydayTerms: ['koopwoningprijs', 'huizenprijs', 'verkoopprijs woningen', 'huizenmarkt'],
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
];
