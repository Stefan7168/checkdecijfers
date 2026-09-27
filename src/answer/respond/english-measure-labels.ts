// ADR 058 phase 2 (#332), Task 1: hand-written English siblings of the
// registry's Dutch canonical-measure vocabulary (src/registry/defaults.ts,
// CANONICAL_MEASURES). Principle (a)/(c): these are NOT machine translations
// — each entry is a person reading the Dutch `definitionLabel` (the same
// text the Dutch refusal/clarification prose names a topic by) and
// `everydayTerms`/`measureTitle`/`notes` for context, then writing the
// natural English phrase that carries the same meaning, nothing added,
// nothing guessed. A coverage test (tests/answer/english-helpers.test.ts)
// pins that every CANONICAL_MEASURES key has an entry in BOTH maps below and
// that neither map carries an extra, orphaned key — so a new canonical
// measure that ships without its English sibling fails CI loudly instead of
// silently falling back to englishMeasureLabel's generic 'these figures'.
//
// ENGLISH_MEASURE_LABELS: a full lowercase noun phrase for use mid-sentence
// ("I don't have {label} for that period") — mirrors definitionLabel's
// meaning exactly, including a digit ONLY where the Dutch definitionLabel
// itself already carries one (a base-year index like '2021=100', or the '1
// January' snapshot date) — never a new digit introduced by translation.
//
// ENGLISH_TOPIC_TERMS: a short everyday English noun/noun-phrase (mirrors
// everydayTerms[0]) — used for the compact "my sources cover: …" scope list
// (loadedTopicsCompactEn in english.ts).

export const ENGLISH_MEASURE_LABELS: Readonly<Record<string, string>> = {
  population_on_1_january: 'the population on 1 January',
  cpi_yearly_inflation: 'inflation (year-on-year change in the consumer price index, all spending categories)',
  unemployment_rate_seasonally_adjusted: 'the seasonally adjusted unemployment rate',
  housing_stock_start_of_year: 'the housing stock on 1 January',
  average_existing_home_sale_price: 'the average sale price of existing owner-occupied homes',
  bankruptcies_businesses: 'bankruptcies of businesses and institutions',
  solar_electricity_production: 'gross electricity production from solar power',
  consumer_confidence_seasonally_adjusted: 'the seasonally adjusted consumer confidence',
  economic_climate_seasonally_adjusted:
    'the seasonally adjusted assessment of the economic climate (a consumer confidence sub-indicator)',
  willingness_to_buy_seasonally_adjusted:
    'the seasonally adjusted willingness to buy (a consumer confidence sub-indicator)',
  average_disposable_household_income: 'the average disposable income of households',
  gdp_growth_yoy_volume: 'economic growth: GDP volume growth compared with a year earlier',
  gdp_growth_qoq_volume: 'GDP volume growth compared with the previous quarter (quarter-on-quarter)',
  producer_prices_yoy: 'producer prices (total sales): change compared with a year earlier',
  import_prices_yoy: 'industrial import prices: change compared with a year earlier',
  producer_price_index_level: 'the producer price index (level, 2021=100), total sales',
  retail_turnover_yoy: 'retail turnover growth (value compared with a year earlier, unadjusted)',
  supermarket_turnover_yoy:
    'supermarket and department store turnover growth (value compared with a year earlier, unadjusted)',
  household_consumption_growth:
    'household consumption: volume change compared with a year earlier, adjusted for shopping-day differences',
  goods_imports_value: 'the total import value of goods (million euros)',
  goods_exports_value: 'the total export value of goods (million euros)',
  goods_imports_yoy: 'the year-on-year change in the import value (compared with the same period a year earlier)',
  goods_exports_yoy: 'the year-on-year change in the export value (compared with the same period a year earlier)',
  house_price_index_regional: 'the price index of existing owner-occupied homes (2020=100), nationwide',
  monthly_unemployment_seasonally_adjusted: 'the monthly seasonally adjusted unemployment rate',
  average_home_sale_price_by_gemeente:
    'the average sale price of existing owner-occupied homes, by municipality/province (annual figure)',
};

export const ENGLISH_TOPIC_TERMS: Readonly<Record<string, string>> = {
  population_on_1_january: 'population',
  cpi_yearly_inflation: 'inflation',
  unemployment_rate_seasonally_adjusted: 'unemployment',
  housing_stock_start_of_year: 'housing stock',
  average_existing_home_sale_price: 'house prices',
  bankruptcies_businesses: 'bankruptcies',
  solar_electricity_production: 'solar power',
  consumer_confidence_seasonally_adjusted: 'consumer confidence',
  economic_climate_seasonally_adjusted: 'economic climate',
  willingness_to_buy_seasonally_adjusted: 'willingness to buy',
  average_disposable_household_income: 'household income',
  gdp_growth_yoy_volume: 'economic growth',
  gdp_growth_qoq_volume: 'quarter-on-quarter growth',
  producer_prices_yoy: 'producer prices',
  import_prices_yoy: 'import prices',
  producer_price_index_level: 'producer price index',
  retail_turnover_yoy: 'retail turnover',
  supermarket_turnover_yoy: 'supermarket turnover',
  household_consumption_growth: 'household consumption',
  goods_imports_value: 'goods imports',
  goods_exports_value: 'goods exports',
  goods_imports_yoy: 'import growth',
  goods_exports_yoy: 'export growth',
  house_price_index_regional: 'house price index',
  monthly_unemployment_seasonally_adjusted: 'monthly unemployment',
  average_home_sale_price_by_gemeente: 'house prices by municipality',
};
