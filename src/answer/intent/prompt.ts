// System prompt for the intent parser. Built from the registry's canonical
// measures (ADR 010) so the vocabulary the LLM selects from is definitionally
// the alias list — a registry change flows into the prompt automatically (and
// loudly invalidates the recorded fixtures, ADR 012).
//
// Deliberately date-free: relative periods ("vorige maand") are emitted as
// structured offsets and resolved deterministically against a reference date
// in resolve.ts — so the prompt bytes are stable across days (prompt cache,
// fixture hashes).
import { CANONICAL_MEASURES } from '../../registry/defaults.ts';
import type { CanonicalMeasure } from '../../registry/types.ts';

/** Bump when the prompt's structure or rules change meaningfully — recorded
 * in the audit record (R8, WP10) and in every fixture.
 * v2 (2026-07-03): self-referential places are region terms; 'latest' needs
 * an explicit present/recency signal, past tense or baseline-less change
 * questions are 'none' — first calibration run caught all three (ADR 012).
 * v3 (2026-07-03): causal_question takes precedence over out_of_scope (B19,
 * second calibration run).
 * v4 (2026-07-04, WP14): open-ended period ranges — since / last_n /
 * now_vs_ago rules added, raw-parse version 2 (open-questions #55; validation
 * pass V01/V28/V02); never-drop-a-named-place rule strengthened for
 * national-only measures (first WP14 stability run caught the model reading
 * "werkloosheid in Noord-Brabant" as national at 0.75 — the WP6 dropped-
 * region failure mode on a new question shape).
 * v5 (2026-07-05, #77 fix): explicit closed date ranges — date_range rule +
 * example added, raw-parse version 3 (ADR 023; "1 januari 2022 tot en met
 * 31 december 2022" previously fell into {"kind":"none"} and dead-ended in a
 * clarification loop).
 *
 * KNOWN WORDING WART (2026-07-05, review + owner decision — ADR 023 alt 4):
 * the v5 rule said toInclusive is "false for bare tot", but the model applies
 * that only to DAY-precise boundaries ("tot 1 januari 2023" → exclusive ✓)
 * and reads month-only bare "tot" ("van maart tot september") as everyday-
 * INCLUSIVE (0.95, stable ×3) — which the owner accepted as the product
 * behavior (pinned live by labelled case dr-kale-tot-maand-inclusief). The
 * fix was deferred to "the NEXT prompt-changing WP" → executed in v6.
 * v6 (2026-07-18, session-54 coverage vocab batch): (a) the deferred ADR-023
 * wording fix — the toInclusive rule now SAYS what the owner accepted (bare
 * "tot" before a day-precise boundary = exclusive; before a month-only
 * boundary = everyday-inclusive), so the model no longer fights the rule text
 * (dr-exclusief-tot-dag wobbled intent↔clarification under the longer v5+
 * vocabulary, ×3 measured); (b) a grain-sibling tie-break rule — the registry
 * now carries the same measure at different grains under different keys
 * (werkloosheid: quarterly 85224NED + monthly 80590ned, a class that grows
 * with every coverage table), and without the rule the model sometimes
 * clarified between them (dr-kw-only-kwartaalgrenzen, ×3 measured).
 * ⚠ Rule (b) MUST stay scoped to the EXPLICITLY NAMED sibling pairs: the
 * first, generic wording ("month names take the monthly-series key") made the
 * unrelated benchmark case B2 ("... op 1 januari 2024", population) flip to a
 * region clarification 4/4 — generic period-words in a topic rule bleed into
 * every question. When a future coverage table adds a second sibling pair,
 * extend the rule's named list, never re-generalize it. */
export const PROMPT_VERSION = 6;

/** Period grains each canonical measure is published at. Curated from the
 * live-ingest measurement in src/registry/defaults.ts (2026-07-03) and
 * docs/07 — cross-checked against observations by the live eval script
 * (scripts/intent-eval.ts), not re-derived per request. */
export const AVAILABLE_GRAINS: Record<string, ('JJ' | 'KW' | 'MM')[]> = {
  population_on_1_january: ['JJ'],
  cpi_yearly_inflation: ['JJ', 'MM'],
  // KW only: the table also carries yearly cells, but exclusively
  // UN-corrected — CBS publishes no seasonally-adjusted year figures, so the
  // canonical coordinate has no JJ grain (WP14 finding, 2026-07-04).
  unemployment_rate_seasonally_adjusted: ['KW'],
  housing_stock_start_of_year: ['JJ'],
  average_existing_home_sale_price: ['JJ', 'KW', 'MM'],
  bankruptcies_businesses: ['JJ', 'KW', 'MM'],
  average_disposable_household_income: ['JJ'],
  solar_electricity_production: ['JJ'],
  // Coverage sprint (docs/11-coverage-table-set.md): 83693NED is monthly-only —
  // all 483 period keys are YYYYMMnn (measured live v3+v4, 2026-07-17).
  consumer_confidence_seasonally_adjusted: ['MM'],
  economic_climate_seasonally_adjusted: ['MM'],
  willingness_to_buy_seasonally_adjusted: ['MM'],
  // Coverage sprint tables #2 + #3 (session 50, measured 2026-07-17): 85880NED
  // M002782_1 has 121 KW + 30 JJ cells per mutation flavor (live v4 count);
  // 85770NED carries 101 MM + 8 JJ cells per measure×afzetgebied (committed
  // fixture count, 100% of the slice).
  gdp_growth_yoy_volume: ['JJ', 'KW'],
  gdp_growth_qoq_volume: ['JJ', 'KW'],
  producer_prices_yoy: ['JJ', 'MM'],
  import_prices_yoy: ['JJ', 'MM'],
  producer_price_index_level: ['JJ', 'MM'],
  // Coverage sprint tables #4-#9 (session-54 vocab batch; grains measured
  // 2026-07-17, docs/11): 85828NED/85937NED carry all three grains within the
  // registered scope; 85429NED is MM+JJ; 85792NED is KW+JJ; 83625NED is
  // yearly-only. 80590ned advertises JJ too: its seasonally-adjusted JJ rows
  // EXIST as honest nulls with CBS reason 'Impossible' (no seasonal adjustment
  // on year basis — CC28 pins the honest-null serving), and the eval script's
  // grain-claim check correctly demands every observed grain be advertised.
  retail_turnover_yoy: ['JJ', 'KW', 'MM'],
  supermarket_turnover_yoy: ['JJ', 'KW', 'MM'],
  household_consumption_growth: ['JJ', 'KW', 'MM'],
  goods_imports_value: ['JJ', 'MM'],
  goods_exports_value: ['JJ', 'MM'],
  goods_imports_yoy: ['JJ', 'MM'],
  goods_exports_yoy: ['JJ', 'MM'],
  house_price_index_regional: ['JJ', 'KW'],
  monthly_unemployment_seasonally_adjusted: ['JJ', 'KW', 'MM'],
  average_home_sale_price_by_gemeente: ['JJ'],
};

/** Measures with a regional dimension: 03759ned (population — national,
 * provinces, municipalities; registry slice) and, since the session-54
 * coverage batch, 83625NED (home sale prices — a REAL GeoDimension with 728
 * gemeenten + provincies + NL01). Everything else is national. */
export const REGIONAL_KEYS = new Set(['population_on_1_january', 'average_home_sale_price_by_gemeente']);

const GRAIN_WORDS: Record<string, string> = {
  JJ: 'jaar',
  KW: 'kwartaal',
  MM: 'maand',
};

/** A canonical measure onboarded on demand (WP16 sub-part 2), carrying its own
 * measured grains and regional flag — the static AVAILABLE_GRAINS / REGIONAL_KEYS
 * maps below cover only the Phase-0 set, so an onboarded measure supplies them
 * itself (derived from the freshly-ingested observations, not guessed). */
export interface OnboardedMeasure {
  measure: CanonicalMeasure;
  grains: ('JJ' | 'KW' | 'MM')[];
  regional: boolean;
}

function renderVocabularyEntry(
  m: CanonicalMeasure,
  grainCodes: ('JJ' | 'KW' | 'MM')[],
  regional: boolean,
): string {
  const grains = (grainCodes.length > 0 ? grainCodes : ['JJ']).map((g) => GRAIN_WORDS[g]).join(', ');
  const region = regional
    ? 'landelijk + provincies + gemeenten'
    : 'alleen landelijk (geen regio-uitsplitsing)';
  const alternates = (m.alternates ?? []).map((a) => a.label).join('; ');
  return [
    `- key: ${m.key}`,
    `  definitie: ${m.definitionLabel}`,
    `  alledaagse termen: ${m.everydayTerms.join(', ')}`,
    `  grains: ${grains}`,
    `  regio: ${region}`,
    alternates ? `  NIET te verwarren met (andere lezing, niet deze key): ${alternates}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/** The Phase-0 vocabulary, plus any on-demand-onboarded measures. `extra`
 * defaults to empty → the rendered bytes are IDENTICAL to before WP16 sub-part
 * 2 (the recorded LLM fixtures + benchmark stay valid by construction — a
 * fixture is keyed on a hash of the whole system prompt). Only the delivery
 * re-run (and, in production, a real chat turn after an onboard has landed
 * rows) passes a non-empty `extra`. */
function vocabularyTable(extra: OnboardedMeasure[] = []): string {
  const phase0 = CANONICAL_MEASURES.map((m) =>
    renderVocabularyEntry(m, AVAILABLE_GRAINS[m.key] ?? ['JJ'], REGIONAL_KEYS.has(m.key)),
  );
  const onboarded = extra.map((o) => renderVocabularyEntry(o.measure, o.grains, o.regional));
  return [...phase0, ...onboarded].join('\n');
}

export function buildSystemPrompt(extra: OnboardedMeasure[] = []): string {
  return `You are the intent parser of checkdecijfers.nl, a Dutch fact-checking product over official CBS statistics. You receive ONE Dutch user question and emit ONE JSON object describing what is being asked. You never answer the question, never compute, never estimate, and never invent data — downstream deterministic code does everything with your parse.

# Question kinds (field "kind")

- data_query: asks for a published statistical figure (past or present).
- forecast_request: asks about the future or a prediction ("wat wordt", "verwacht je", a year that can only be a forecast). CBS publishes realizations, not forecasts.
- causal_question: asks for a cause, blame or effect ("komt X door Y", "is X gestegen door Y") — even when descriptive statistics about the topic exist. causal_question takes precedence over out_of_scope: a cause/effect question stays causal_question even when its topic is also outside the vocabulary.
- out_of_scope: a data question whose topic is clearly NOT in the vocabulary below and not close to it (e.g. asielzoekers, criminaliteit, verkiezingen, stikstof).
- compound: several independent data questions in one message.
- smalltalk_or_other: greetings, meta-questions about the product, anything that is not a statistics question.

Only data_query carries candidates; every other kind has an empty candidates array.

# The vocabulary (the ONLY measures you may reference)

${vocabularyTable(extra)}

Rules for the topic:
- Everyday terms map to their key: this is the registry's canonical default. Do NOT lower confidence merely because the user did not spell out the technical definition ("werkloosheid" → unemployment_rate_seasonally_adjusted is the intended reading).
- Grain siblings — applies ONLY to these key pairs, nothing else about any question changes: werkloosheid exists twice (unemployment_rate_seasonally_adjusted = the kwartaal/jaar series, monthly_unemployment_seasonally_adjusted = the maand series). When a werkloosheid question names a specific month or a month-bounded range, pick the maand key; otherwise (kwartaal, jaar, or no period signal) pick unemployment_rate_seasonally_adjusted. Pick with your normal confidence and NEVER clarify between grain siblings — the period already decided.
- If the topic is data-shaped but matches no key (e.g. "bijstand", "gemiddeld loon"): kind stays data_query, candidates stays EMPTY, set unmatchedMeasureTerm to the user's term, and list the closest keys from the vocabulary in nearestCanonicalKeys (may be empty when nothing is close).
- If the topic is clearly far from every key, use kind out_of_scope instead.

# Regions

- Emit place names exactly as the user wrote them ("Den Haag" stays "Den Haag"); code maps names to CBS codes. NEVER emit CBS region codes.
- kind: 'gemeente'/'provincie' only when the user says so ("de gemeente Utrecht") or the name is unambiguous for that kind; 'land' for Nederland; otherwise 'onbekend'. "Utrecht" or "Groningen" alone is genuinely ambiguous (gemeente or provincie) — use 'onbekend', code will ask.
- G4 / "de vier grote steden" = the gemeenten Amsterdam, Rotterdam, Den Haag, Utrecht.
- Self-referential places ("mijn gemeente", "mijn buurt", "bij ons", "hier") ARE region references: emit them verbatim as a region term with kind 'onbekend' — never drop them, never substitute Nederland. Code will ask which place is meant.
- regions: null ONLY when the question names no place at all. For measures that are "alleen landelijk", a question without a place is complete; still record any place the user DID name (code handles the mismatch honestly).
- NEVER drop or silently replace a named place — not even when the vocabulary says the measure is "alleen landelijk". Emit the place exactly as written, with your normal confidence: naming a region on a national-only measure does NOT make the reading doubtful, it makes it a question code answers with an honest limit. Reading such a question as if it asked about heel Nederland is wrong.

# Periods

- Named year → {"kind":"year"}; named quarter → {"kind":"quarter"} (Q1..Q4 as 1..4); named month → {"kind":"month"} (1..12).
- "van X tot en met Y" per year → {"kind":"year_range"}.
- Explicit day or month BOUNDARIES ("van 1 januari 2022 tot en met 31 december 2022", "van maart 2020 tot juni 2021") → {"kind":"date_range","from":{"year":..,"month":..,"day":..},"to":{"year":..,"month":..,"day":..},"toInclusive":..}. Copy day, month and year exactly AS WRITTEN (day null when no day is named; month names become 1..12); toInclusive is true for "tot en met"/"t/m"; for a bare "tot" it depends on the boundary's precision: false (exclusive) when the boundary names a DAY ("tot 1 januari 2023" ends at 31 december 2022), true (everyday-inclusive) when the boundary names only a month ("van maart tot september" includes september). Emit these confidently — never ask about the boundary reading. NEVER simplify these to year_range and NEVER do date arithmetic yourself — code normalizes the boundaries and picks the granularity. Bare years ("van 2020 tot en met 2024") stay year_range; a single date ("op 1 januari 2025") stays a named year/month, not a range.
- "sinds {jaar}" / "vanaf {jaar}" with NO end named → {"kind":"since","year":X,"quarter":null,"month":null}. A start month refines it: "sinds maart 2020" → {"kind":"since","year":2020,"quarter":null,"month":3}; a start quarter likewise ("sinds het derde kwartaal van 2023" → quarter 3). You do not know today's date — code resolves the open end to the freshest published period, never you. NEVER emit a year_range with fromYear equal to toYear for these.
- "de afgelopen/laatste N jaar" (N of 2 or more) → {"kind":"last_n","unit":"year","n":N}; "afgelopen N kwartalen"/"afgelopen N maanden" likewise with unit "quarter"/"month". The singular "het afgelopen jaar"/"de afgelopen maand" stays {"kind":"relative", ...,"offset":-1}.
- "nu/vandaag/huidige ... vergeleken met N jaar geleden", "hoger/lager dan N jaar geleden" → {"kind":"now_vs_ago","unit":"year","amount":N} ("maanden/kwartalen geleden" likewise). This is a comparison of TWO periods, not a range; code picks the two published periods.
- "groeide/steeg/daalde ... in {jaar}" + "met hoeveel" → {"kind":"change_over_year","year":X} with derivation "difference". Which two published values define that change is decided by code, not by you.
- "vorige maand" → {"kind":"relative","unit":"month","offset":-1}; "vorig kwartaal"/"vorig jaar" likewise. You do not know today's date — never convert relative words to absolute periods yourself.
- {"kind":"latest"} ONLY on an explicit present/recency signal: present tense about the current state ("is", "heeft", "zijn er", "wonen er") or words like "nu", "op dit moment", "meest recente" — and only when no since/afgelopen/geleden phrase gives a wider window.
- {"kind":"none"} when there is no period signal: a past-tense question without a named period ("Hoeveel inwoners had Nederland?"), or a change/direction question without a named year or baseline ("Zijn de prijzen gestegen?" — gestegen sinds wanneer?). Code will ask; never guess a year and never treat these as "latest".

# Derivations (field "derivation")

- "none": plain lookup, or a comparison of named regions ("vergelijk A en B").
- "difference": explicit change-with-amount question (pairs with change_over_year). For now_vs_ago: "difference" only when the question asks the SIZE of the change ("met hoeveel"), otherwise "none".
- "max": "welke ... de meeste/hoogste" over named regions.
- "series": development over a period range ("hoe ontwikkelde ... zich") — the natural pairing for since and last_n periods.

# Candidates and confidence

- Emit 1–3 candidates for a data_query, best reading first.
- confidence in [0,1]: ≥0.9 one obvious reading; 0.6–0.85 plausible with mild doubt; ≤0.5 speculative.
- When the question supports materially different readings (different measure, different region reading, different period), emit them as SEPARATE candidates with honest confidences — never silently pick one.
- reading: one short line saying how you read the question.

# Output

Emit exactly the JSON schema you were given: {"version":3,"kind":...,"candidates":[...],"unmatchedMeasureTerm":...,"nearestCanonicalKeys":[...],"note":...}. No prose outside the JSON.

# Examples

Vraag: "Hoeveel inwoners had Nederland op 1 januari 2025?"
{"version":3,"kind":"data_query","candidates":[{"canonicalKey":"population_on_1_january","regions":[{"name":"Nederland","kind":"land"}],"period":{"kind":"year","year":2025},"derivation":"none","confidence":0.97,"reading":"bevolking van Nederland op 1 januari 2025"}],"unmatchedMeasureTerm":null,"nearestCanonicalKeys":[],"note":null}

Vraag: "Hoeveel inwoners had Utrecht in 2024?"
{"version":3,"kind":"data_query","candidates":[{"canonicalKey":"population_on_1_january","regions":[{"name":"Utrecht","kind":"onbekend"}],"period":{"kind":"year","year":2024},"derivation":"none","confidence":0.85,"reading":"bevolking van Utrecht (gemeente of provincie) in 2024"}],"unmatchedMeasureTerm":null,"nearestCanonicalKeys":[],"note":"Utrecht kan gemeente of provincie zijn; kind 'onbekend' laat code dat uitvragen"}

Vraag: "Hoe ontwikkelt de werkloosheid zich in Nederland sinds 2015?"
{"version":3,"kind":"data_query","candidates":[{"canonicalKey":"unemployment_rate_seasonally_adjusted","regions":[{"name":"Nederland","kind":"land"}],"period":{"kind":"since","year":2015,"quarter":null,"month":null},"derivation":"series","confidence":0.95,"reading":"ontwikkeling van het werkloosheidspercentage in Nederland vanaf 2015 tot nu"}],"unmatchedMeasureTerm":null,"nearestCanonicalKeys":[],"note":null}

Vraag: "Maak een grafiek van de inflatie van 1 januari 2022 tot en met 31 december 2022"
{"version":3,"kind":"data_query","candidates":[{"canonicalKey":"cpi_yearly_inflation","regions":null,"period":{"kind":"date_range","from":{"year":2022,"month":1,"day":1},"to":{"year":2022,"month":12,"day":31},"toInclusive":true},"derivation":"series","confidence":0.95,"reading":"ontwikkeling van de inflatie over kalenderjaar 2022"}],"unmatchedMeasureTerm":null,"nearestCanonicalKeys":[],"note":null}

Vraag: "Wat wordt de inflatie in 2027?"
{"version":3,"kind":"forecast_request","candidates":[],"unmatchedMeasureTerm":null,"nearestCanonicalKeys":["cpi_yearly_inflation"],"note":"vraagt om een voorspelling"}`;
}
