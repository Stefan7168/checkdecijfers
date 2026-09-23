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
// E2a step 5 (2026-09-23, per the sibling-datasets research doc):
// `EUROSTAT_SIBLINGS_REVIEWED`/`EUROSTAT_SIBLING_MEASURES_REVIEWED` hold the
// three owner-approved-topic (D4), person-reviewed pairs (unemployment,
// inflation, GDP growth) — reviewed in the sense that a person picked the
// dataset/filters/grain match per pair (see the research doc's §1-3), NOT
// that the Dutch `definitionLabel` wording below is owner-signed: it is the
// research draft, carried over verbatim. **Assumption:** the owner may
// reword any of the three `definitionLabel`s before step 6 (the runtime
// flip) — mirrored in docs/open-questions.md #313.
//
// The RUNTIME-ACTIVE map (what the resolver, the offer-side gate and the
// click trust boundary all fall back to when a caller doesn't inject a test
// override) is gated behind `EUROSTAT_SIBLINGS_ENABLED` — step 6, the
// owner-signed flip (docs/RUNBOOK.md, "E2a step 5"). Until that env var is
// exactly '1', `activeEurostatSiblings()` returns an EMPTY map, so this file
// shipping the three reviewed pairs above changes NOTHING a reader can
// reach: `registry:apply` (step 5) may already upsert the reviewed Eurostat
// measures into `canonical_measures` (once their tables are registered —
// src/registry/apply.ts), but no code path outside this file's own gate
// function ever reads those rows without going through
// `activeEurostatSiblings()` first.
import type { CbsSlice } from '../cbs-adapter/types.ts';
import type { CanonicalMeasure } from '../registry/types.ts';

/** The three owner-approved-topic (§7 D4), person-reviewed sibling pairs:
 * CBS canonical key -> Eurostat sibling canonical key. Reviewed dataset/
 * filter/grain choice (research doc §1-3); Dutch wording NOT yet owner-signed
 * (see the module comment above and #313). Registered into
 * `canonical_measures` by `registry:apply` (src/registry/apply.ts) once each
 * measure's Eurostat table exists — but never RUNTIME-active until
 * `EUROSTAT_SIBLINGS_ENABLED='1'` (`activeEurostatSiblings()` below). */
export const EUROSTAT_SIBLINGS_REVIEWED: Readonly<Record<string, string>> = {
  unemployment_rate_seasonally_adjusted: 'eu_unemployment_rate_harmonised',
  cpi_yearly_inflation: 'eu_hicp_annual_rate',
  gdp_growth_yoy_volume: 'eu_gdp_growth_yoy_volume',
};

/** The Eurostat side of every reviewed pair above — a `CanonicalMeasure`
 * (`tableId: 'eurostat:…'`) kept in this SIBLING-ONLY list, **never** in
 * `CANONICAL_MEASURES` (src/registry/defaults.ts) — see ruling R7 on
 * `eurostatSiblingTargetKeys` below for why. Content: the three drafts from
 * docs/superpowers/specs/2026-09-23-eurostat-e2a-step5-sibling-datasets.md
 * §4, carried over verbatim (dataset/filter choices reviewed; Dutch wording
 * not yet owner-signed, see the module comment). */
export const EUROSTAT_SIBLING_MEASURES_REVIEWED: readonly CanonicalMeasure[] = [
  {
    key: 'eu_unemployment_rate_harmonised',
    tableId: 'eurostat:une_rt_q',
    measure: 'une_rt_q|PC_ACT',
    measureTitle: 'Unemployment by sex and age - quarterly data',
    // `freq` (fix round 1, independent review finding #1): every REAL
    // Eurostat dataset carries a `freq` dimension (research doc's own
    // `"id":["freq","s_adj",...]`), classified a plain `Dimension` by the
    // adapter (src/eurostat-adapter/jsonstat.ts) exactly like `s_adj`/`age`/
    // `sex`. There is no `TABLE_REGISTRY_DEFAULTS` entry for this table (that
    // list is CBS-only), so `cbs_tables.default_coordinates` stays NULL —
    // this `dims` entry is the ONLY place `freq` gets pinned. Without it,
    // `src/query/resolve.ts` refuses every query against this table with
    // "dimension(s) freq carry no coordinate", silently, right after step 6.
    dims: { freq: 'Q', s_adj: 'SA', age: 'Y15-74', sex: 'T' },
    // **Assumption:** owner may reword before step 6 (see #313).
    definitionLabel: 'geharmoniseerd werkloosheidspercentage (Eurostat, seizoengecorrigeerd, 15-74 jaar)',
    everydayTerms: [], // sibling-only: never enters the parser vocabulary (§4.1)
    notes:
      'Sibling of CBS unemployment_rate_seasonally_adjusted (85224NED). Grain match: quarterly-quarterly ' +
      '(CBS canonical default is quarterly, not une_rt_m\'s monthly). Definitional difference for the ' +
      'confirm chip: EU harmonised LFS methodology, ages 15-74, vs. CBS\'s own national beroepsbevolking ' +
      'survey, ages 15-75. Verified live 2026-09-23: filtered slice (s_adj=SA, age=Y15-74, sex=T, ' +
      'unit=PC_ACT, EU/EFTA geo list, since 2010) = 2,112 cells; fully unfiltered (pre-fix adapter request ' +
      'shape) = 675,108 cells, over the 500k sync cap — resolved by the adapter\'s server-side filtering fix ' +
      '(branch eurostat-server-filter, #313).',
  },
  {
    key: 'eu_hicp_annual_rate',
    tableId: 'eurostat:prc_hicp_manr',
    measure: 'prc_hicp_manr|RCH_A',
    measureTitle: 'HICP - monthly data (annual rate of change)',
    // `freq` (fix round 1) — see the unemployment sibling's comment above for
    // the full account; this dataset is monthly ('M'), not quarterly.
    dims: { freq: 'M', coicop: 'CP00' },
    // **Assumption:** owner may reword before step 6 (see #313).
    definitionLabel: 'geharmoniseerde inflatie (Eurostat HICP, jaarmutatie, alle bestedingen)',
    everydayTerms: [],
    notes:
      'Sibling of CBS cpi_yearly_inflation (86141NED). Grain match: monthly-monthly. Definitional ' +
      'difference for the confirm chip: EU-harmonised COICOP basket vs. CBS\'s own national CPI basket. ' +
      'Verified live 2026-09-23: filtered slice (coicop=CP00, EU/EFTA geo list, since 2015) = 4,488 cells, ' +
      'zero flagged cells found (no status field in the response at all). Fully unfiltered size was ' +
      'unverified live (download exceeded a 180s timeout at 36MB) but near-certainly far over the 500k cap ' +
      'by extrapolation — same adapter fix as above resolves it.',
  },
  {
    key: 'eu_gdp_growth_yoy_volume',
    tableId: 'eurostat:namq_10_gdp',
    measure: 'namq_10_gdp|CLV_PCH_SM',
    measureTitle: 'Gross domestic product (GDP) and main components (output, expenditure and income) - quarterly data',
    // `freq` (fix round 1) — see the unemployment sibling's comment above;
    // quarterly ('Q'), like une_rt_q.
    dims: { freq: 'Q', na_item: 'B1GQ', s_adj: 'SCA' },
    // **Assumption:** owner may reword before step 6 (see #313).
    definitionLabel: 'bbp-volumegroei t.o.v. een jaar eerder (Eurostat, kwartaalcijfers)',
    everydayTerms: [],
    notes:
      'Sibling of CBS gdp_growth_yoy_volume (85880NED). Grain match: quarterly-quarterly. unit=CLV_PCH_SM ' +
      'chosen (not CLV_PCH_PRE) to match CBS\'s A045299 "t.o.v. een jaar eerder" (YoY, not QoQ). Verified ' +
      'live 2026-09-23: filtered slice (na_item=B1GQ, unit=CLV_PCH_SM, s_adj=SCA, EU/EFTA geo list, since ' +
      '2010) = 2,244 cells, only \'p\' (provisional) flags found (109 cells), zero \'b\' break flags for ' +
      'any of the 34 geos including NL/DE/BE. Fully unfiltered = 8,191,372 cells (ADR 048 second as-built ' +
      'addendum) — 16x over the 500k cap; the adapter filtering fix (above) is a hard prerequisite, applied.',
  },
];

/** Registration input for `scripts/register-eurostat-siblings.ts` — the ONE
 * place both that script and its test read the three tables' `CbsSlice`
 * (dimension pins + period floor), so the script can never drift from what
 * was actually reviewed/verified live (research doc §1-3). `geo` is
 * deliberately absent from every `dimensionEquals` here: the adapter applies
 * the structural EU/EFTA geo restriction itself and REFUSES a per-slice
 * `geo` pin (`src/eurostat-adapter/statistics-api.ts`'s `buildRequestUrl`).
 * `periodFloor` is expressed in CBS-format period codes (this repo's own
 * grammar, `src/ingestion/periods.ts`), matching every other `CbsSlice` in
 * the codebase — the adapter converts it to Eurostat's own
 * `sinceTimePeriod` grammar (`sinceTimePeriodFor`). */
export interface EurostatSiblingRegistration {
  /** Full tableId incl. the 'eurostat:' prefix — matches the corresponding
   * entry's `tableId` in `EUROSTAT_SIBLING_MEASURES_REVIEWED`. */
  tableId: string;
  slice: CbsSlice;
  updateCadence: string;
}

export const EUROSTAT_SIBLING_REGISTRATIONS: readonly EurostatSiblingRegistration[] = [
  {
    tableId: 'eurostat:une_rt_q',
    slice: {
      // `freq: 'Q'` (fix round 1) — matches the measure's own `dims.freq`
      // above; harmless for the request (this dataset's native code is
      // already quarterly-only) but keeps the registered slice and the
      // measure's coordinate pin in obvious agreement, and is genuinely
      // load-bearing for any Eurostat dataset that ever DOES publish more
      // than one frequency under one native code.
      dimensionEquals: { freq: 'Q', s_adj: 'SA', age: 'Y15-74', sex: 'T', unit: 'PC_ACT' },
      periodFloor: '2010KW01', // since 2010 Q1 (research doc §1.4)
    },
    updateCadence: 'quarterly',
  },
  {
    tableId: 'eurostat:prc_hicp_manr',
    slice: {
      dimensionEquals: { freq: 'M', coicop: 'CP00', unit: 'RCH_A' },
      periodFloor: '2015MM01', // since 2015-01 (research doc §2.4)
    },
    updateCadence: 'monthly',
  },
  {
    tableId: 'eurostat:namq_10_gdp',
    slice: {
      dimensionEquals: { freq: 'Q', na_item: 'B1GQ', unit: 'CLV_PCH_SM', s_adj: 'SCA' },
      periodFloor: '2010KW01', // since 2010 Q1 (research doc §3.4)
    },
    updateCadence: 'quarterly',
  },
];

/** Step 6, the owner-signed runtime flip (docs/RUNBOOK.md, "E2a step 5" /
 * "step 6"): '1' (exactly) makes the three reviewed pairs above RUNTIME
 * reachable — anything else (unset, '0', 'true', …) keeps the resolver, the
 * offer-side gate and the click trust boundary dark, byte-identical to
 * before step 5. Read at CALL TIME (a plain function, not a module-load-time
 * constant) — the same shape as web/app/actions.ts's `clickOptionsEnabled`/
 * `answerFirstEnabled` (WP26/ADR 024), except this flag has exactly one
 * consumer (the map below) instead of being threaded as a boolean through
 * the whole intent pipeline, so the gate lives here, next to the map it
 * gates, rather than in web/app/actions.ts. */
export function eurostatSiblingsEnabled(): boolean {
  return process.env.EUROSTAT_SIBLINGS_ENABLED === '1';
}

/** THE single source of truth for "which sibling pairs are active in
 * production right now" — `resolveCandidate`'s default (src/answer/intent/
 * resolve.ts), and (via `eurostatSiblingTargetKeys` below) both the
 * offer-side gate (`buildClickOptions`/`isClickTakeableIntent`,
 * src/answer/intent/policy.ts) and the click trust boundary
 * (src/answer/respond/validate-pending.ts) all fall back to THIS function's
 * return value when a caller doesn't inject a test override — so the three
 * can never disagree about what is live. Empty unless
 * `eurostatSiblingsEnabled()`. */
export function activeEurostatSiblings(): Readonly<Record<string, string>> {
  return eurostatSiblingsEnabled() ? EUROSTAT_SIBLINGS_REVIEWED : {};
}

/** Ruling R7 (E2a final-review fix wave, I4/C1): the Eurostat side of every
 * pair above is a canonical measure that lives in the sibling-only list
 * above — NEVER in `CANONICAL_MEASURES` (src/registry/defaults.ts). That
 * list feeds the intent parser's prompt vocabulary and its raw-parse key
 * enum (src/answer/intent/prompt.ts, schema.ts): a Eurostat measure there
 * could be picked by the parser directly, so "werkloosheid in Duitsland" (or
 * even "in Nederland") would switch source silently, with no chip — exactly
 * the source switch principle (c) forbids — and every recorded fixture's
 * prompt bytes would shift. Kept here instead, a sibling key is reachable
 * ONLY as the target of an offered chip, and the click trust boundary
 * (src/answer/respond/validate-pending.ts) accepts it by membership in the
 * active map's VALUES, separately from the parser vocabulary.
 *
 * `registry:apply` (src/registry/apply.ts) seeds `EUROSTAT_SIBLING_MEASURES_
 * REVIEWED`'s rows into `canonical_measures` (skipping any whose table isn't
 * registered yet) independently of `EUROSTAT_SIBLINGS_ENABLED` — a row can
 * exist in the database before the runtime flip; it just isn't RESOLVABLE
 * (no caller ever looks it up) until the flag is '1'. */
export function eurostatSiblingTargetKeys(
  siblings: Readonly<Record<string, string>> = activeEurostatSiblings(),
): ReadonlySet<string> {
  return new Set(Object.values(siblings));
}
