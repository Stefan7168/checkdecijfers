// Live Eurostat SourceAdapter (ADR 048 D1/D6): the Statistics API for
// observations/schema, the Catalogue API for fetchCatalog. JSON-stat 2.0
// over REST, synchronous only (D6 — the async submit-and-poll API is
// deliberately NOT implemented; a dataset over SYNC_CELL_THRESHOLD refuses
// loudly via AsyncApiRequiredError instead of hanging or truncating).
//
// CONSTRAINT 0 (WP30c/E1 brief, session 101 continuation) resolved session
// 107 (2026-09-16): the owner confirmed "no real Eurostat API spend" meant
// money, not any live call — Eurostat's API is free/public/read-only. Every
// unit test in this file still injects `fetchFn` (a stub, never a live
// network call — that discipline doesn't change), but the URL shapes below
// and both response shapes (jsonstat.ts's dataset AND catalog parsers) are
// now VERIFIED against real captured responses (session 107), not guessed —
// see tests/fixtures/eurostat/'s `"synthetic": false` fixtures and
// ADR 048's As-built section.
import type {
  CbsCatalogEntry,
  CbsCode,
  CbsObservationRow,
  CbsSlice,
  CbsSource,
  CbsTableSchema,
} from '../cbs-adapter/types.ts';
import { parsePeriodCode } from '../ingestion/periods.ts';
import { BUDGET_ENDED_PHRASE, fetchAndRead, shortUrl } from '../sources/fetch-with-timeout.ts';
import { classifyFailedResponse, classifyOkBody, EurostatPermanentError, isRetryableStatus } from './errors.ts';
import {
  EU_EFTA_STAND_IN_GEO_CODES,
  maxDecimals,
  parseJsonStatCatalog,
  parseJsonStatDataset,
  type ParsedEurostatDataset,
} from './jsonstat.ts';
import {
  DECIMALS_PROBE_MAX_READS,
  DECIMALS_PROBE_SETTLING_VALUES,
  decimalsProbeSlice,
  eurostatLayoutFromStructure,
  EurostatLayoutRefusalError,
  fitEurostatStructure,
  readEurostatStructure,
  type EurostatLayout,
  type EurostatStructure,
} from './sdmx-structure.ts';

/** VERIFIED live (session 107, 2026-09-16) — Eurostat's real Statistics API
 * dissemination endpoint. */
const STATISTICS_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
/** VERIFIED live (session 107, 2026-09-16) — Eurostat's real Catalogue API
 * "table of contents" endpoint; see parseJsonStatCatalog's own doc comment
 * in ./jsonstat.ts for the tab-separated TEXT (not JSON) shape this returns. */
const CATALOGUE_URL = 'https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt?lang=EN';
/** VERIFIED live (2026-09-30, #357 step 1) — Eurostat's SDMX 2.1 structure endpoints (SDMX-ML only; no JSON
 * rendering carries code lists, see ./xml.ts). */
const SDMX_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1';

/** The two structure requests for one dataset (see ./sdmx-structure.ts for what each returns). The dataflow
 * is always version 1.0 at Eurostat and references the CURRENT data structure (verified: une_rt_q's 1.0
 * dataflow references data structure 57.0); a data structure is never requested by a pinned version. Only
 * main-server dataset codes are accepted (letters, digits, underscore) — the Comext `DS-*` collections live
 * on another server and are not read. */
export function structureUrls(nativeCode: string): { dataflow: string; constraint: string } {
  if (!/^[A-Za-z0-9_]+$/.test(nativeCode)) {
    throw new Error(`Eurostat adapter: '${nativeCode}' is not a main-server dataset code — refusing to build a structure request.`);
  }
  const code = nativeCode.toUpperCase();
  return {
    dataflow: `${SDMX_BASE}/dataflow/ESTAT/${code}/1.0?references=descendants&detail=referencepartial`,
    constraint: `${SDMX_BASE}/contentconstraint/ESTAT/${code}/1.0`,
  };
}

const FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1500;

/**
 * Time limits (#357, study step 0 defect 1). Two kinds of call, each with a limit PER ATTEMPT and one TOTAL
 * deadline per call that covers every attempt and retry wait (the old single 300 s x 3 attempts let one hung
 * call use ~15 minutes, far past the table-lane job's 240 s budget, ADR 062).
 *
 * - `data`: a server-filtered slice request (one `CbsSlice`: the store route's <= 2,000-cell slices and the
 *   registered sibling slices). Responses are small JSON documents; the connector study runs the same calls
 *   on a 30 s limit. 30 s per attempt, 60 s per call: two full attempts fit, a third only follows a fast
 *   failure. One call can then never take more than a quarter of the 240 s job budget, and ADR 062's rule of
 *   claiming no new row with under 120 s left always leaves room for one whole call.
 * - `bulk`: the catalogue "table of contents" file (several MB) and a whole-dataset read with no slice (the
 *   legacy whole-table path, up to SYNC_CELL_THRESHOLD cells). Legitimately slower, so 120 s per attempt
 *   (the study's limit for structure/bulk calls), 240 s per call (two attempts).
 *
 * The run budget (`stopAt`) still wins over both: a call never outlives it, and a call cut by it fails with
 * BUDGET_ENDED_PHRASE (not a source failure), while one that used up its own total fails as an ordinary error.
 */
export type EurostatCallKind = 'data' | 'bulk';
export const CALL_LIMITS: Readonly<Record<EurostatCallKind, { attemptMs: number; totalMs: number }>> = {
  data: { attemptMs: 30_000, totalMs: 60_000 },
  bulk: { attemptMs: 120_000, totalMs: 240_000 },
};

export interface StatisticsApiSourceOptions {
  /** Per-attempt limit for every request (body read included); replaces both kinds' defaults (CALL_LIMITS). */
  timeoutMs?: number;
  /** Total limit for one call, every attempt and retry wait included; replaces both kinds' defaults. */
  totalMs?: number;
  /** Base of the linear retry backoff (attempt n waits n x this). */
  retryBackoffMs?: number;
  /** Epoch ms: the end of the run's time budget (the command line's --budget-seconds), the same contract as
   * `ODataV4SourceOptions.stopAt`: every attempt is limited to the smaller of its own limit and the time left,
   * no attempt or retry wait starts once it has passed, and a request cut that way fails with
   * BUDGET_ENDED_PHRASE in its message (the warm job then counts it as remaining, not failed). Absent: no
   * budget. */
  stopAt?: number;
  /** #357 step 1: read a dataset's layout (`fetchTableSchema`, `fetchCodeList`) from Eurostat's SDMX
   * structure messages instead of downloading its observations — no SYNC_CELL_THRESHOLD, so any dataset that
   * fits can be registered. `decimals` supplies each unit's number of decimals, which no structure message
   * states; a unit it does not know refuses (`EurostatLayoutRefusalError`, reason `decimals_unknown`).
   * #357 (a): `'observed'` learns them from ONE small read per dataset (`observeUnitDecimals`) — the mode for
   * a REGISTRATION; afterwards (the slice-time schema check) the caller passes a function returning the
   * registered decimals, and `fetchSlice` refuses any value carrying more (src/ingestion/validate.ts).
   * The layout is the whole dataset's (every code that occurs, licensed geo only); a `slice` argument does not
   * narrow it. Absent (the default, and every production caller today): the download path, unchanged. */
  structureLayout?: { decimals: ((tableId: string, unitCode: string) => number | undefined) | 'observed' };
}

/** What the decimals read at registration saw (#357 (a)): per unit the most decimals any observed value
 * carried (units with no value in any read are absent), and every read it made. */
export interface ObservedDecimals {
  decimals: Map<string, number>;
  reads: { url: string; cells: number; periods: string[] }[];
}

/** D4: strips the '<key>:' prefix internally (never the caller's job) —
 * a local copy of the same first-colon rule every other module in this
 * source's family implements independently (see jsonstat.ts's own copy). */
function nativeIdFrom(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
}

/**
 * A `JSON.stringify` that recursively sorts object keys (arrays keep their
 * own order — never resorted) so two objects that are DEEPLY equal but were
 * built/serialized with keys in a different order produce the IDENTICAL
 * string. Used only for `loadDataset`'s cache key (see its own comment for
 * why plain `JSON.stringify` is unsafe there: Postgres jsonb does not
 * preserve key order across a round trip).
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalSliceKey(slice: CbsSlice): string {
  return canonicalJson(slice);
}

/**
 * Converts a CBS-format `periodFloor` (e.g. '2015JJ00', '2015KW01',
 * '2015MM01' — `src/ingestion/periods.ts`'s grammar, the same one
 * `CbsSlice.periodFloor` is always expressed in) into Eurostat's OWN
 * `sinceTimePeriod` filter grammar. This is the exact inverse of
 * `mapEurostatPeriod` (jsonstat.ts) in terms of WHICH grain it accepts, but
 * NOT the same target string shape for the ANNUAL/QUARTERLY grains only by
 * coincidence: Eurostat's `sinceTimePeriod` query parameter takes plain
 * 'YYYY' / 'YYYY-Qn' / 'YYYY-MM', and the JSON-stat response's own 'time'
 * category codes use the SAME spellings (verified live 2026-09-30:
 * prc_hicp_minr's `time` index reads ['2026-07', '2026-08']). This comment
 * used to claim the response spelled months 'YYYY-M01' — that was never true
 * and made the first real monthly sync throw; see MONTH_RE in jsonstat.ts. The
 * brief's own research
 * (docs/superpowers/specs/2026-09-23-eurostat-e2a-step5-sibling-datasets.md)
 * only tested the plain-year (annual) shape live; the quarterly and monthly
 * shapes below are now ALSO verified live (independent review, 2026-09-23,
 * against the real public Statistics API — no AI spend, GET only):
 * - `une_rt_q?...&geo=NL&s_adj=SA&age=Y15-74&sex=T&unit=PC_ACT&sinceTimePeriod=2024-Q2`
 *   → 9 periods returned, first `2024-Q2`, last `2026-Q2` (confirms the
 *   quarterly `YYYY-Qn` shape, and that the floor is INCLUSIVE).
 * - `prc_hicp_manr?...&geo=NL&coicop=CP00&unit=RCH_A&sinceTimePeriod=2025-03`
 *   → 10 periods returned, first `2025-03`, last `2025-12` (confirms the
 *   monthly `YYYY-MM` shape — no `M` prefix — and again an inclusive floor;
 *   NB the retired prc_hicp_manr stops at 2025-12, see the sibling
 *   registration's notes in src/sources/eurostat-siblings.ts).
 * - `une_rt_q?...&sinceTimePeriod=2024` (plain year, on a QUARTERLY dataset)
 *   → first period `2024-Q1` (confirms Eurostat accepts the coarser annual
 *   shape as a floor even on a finer-grained dataset, rounding down to that
 *   year's first period — not something this adapter currently exploits,
 *   since `sinceTimePeriodFor` always emits the floor's OWN grain).
 *

 * Throws — never silently drops the floor — for anything `parsePeriodCode`
 * doesn't recognise as a valid CBS period code (principle (c): an
 * unconvertible floor must refuse loudly, not quietly fetch unfiloored data).
 */
function sinceTimePeriodFor(periodFloor: string): string {
  const parsed = parsePeriodCode(periodFloor);
  if (!parsed) {
    throw new Error(
      `Eurostat adapter: periodFloor '${periodFloor}' is not a valid CBS period code (expected ` +
        `'YYYYJJ00' / 'YYYYKWnn' / 'YYYYMMnn') — refusing rather than silently dropping the floor.`,
    );
  }
  switch (parsed.grain) {
    case 'JJ':
      return String(parsed.year);
    case 'KW':
      return `${parsed.year}-Q${parsed.index}`;
    case 'MM':
      return `${parsed.year}-${String(parsed.index).padStart(2, '0')}`;
  }
}

/** The unit codes behind this dataset's measure codes (`<native-code>|<unit>`, jsonstat.ts); throws for a
 * code of another dataset or another shape — never sent as something it is not. */
function unitsOfMeasures(nativeCode: string, measures: string[]): string[] {
  const prefix = `${nativeCode}|`;
  return [...new Set(measures)].map((m) => {
    if (!m.startsWith(prefix) || m.length === prefix.length) {
      throw new Error(`Eurostat adapter: measure '${m}' is not a measure of dataset '${nativeCode}'.`);
    }
    return m.slice(prefix.length);
  });
}

/**
 * Builds the Statistics API request URL for `nativeCode`, applying the
 * `CbsSlice` SERVER-SIDE (ADR 048 D6's "Fetch shape: ... server-side
 * filtered per CbsSlice", which the code did not actually implement until
 * this fix — see the ADR's as-built note).
 *
 * - No `slice` at all → BYTE-IDENTICAL to the pre-fix URL (requirement: a
 *   call with no slice, e.g. the schema/code-list reads in
 *   `src/ingestion/pipeline.ts`, must not change).
 * - `slice.dimensionEquals` → one `<dim>=<code>` param per entry.
 * - The D6 structural geo restriction (`EU_EFTA_STAND_IN_GEO_CODES`) → a
 *   repeated `geo=<code>` param per allowed code, added WHENEVER a slice is
 *   present — these are the only geo codes the adapter ever keeps
 *   (`matchesGeoRestriction`), so narrowing the server request to exactly
 *   this list can never drop a row the client-side filter would have kept.
 * - `slice.periodFloor` → one `sinceTimePeriod=<...>` param (see
 *   `sinceTimePeriodFor`).
 * - `slice.dimensionPrefixes` has no Eurostat server-side equivalent (geo is
 *   already covered above via the structural restriction, not via any
 *   `dimensionPrefixes.geo` the caller might also pass) — stays client-side
 *   only, exactly as before (`matchesSlice` in jsonstat.ts).
 * - `slice.dimensionEquals.geo` — REFUSED (throws): `geo` is handled
 *   exclusively via the structural sweep above, never as a per-slice pin, so
 *   this can never silently coexist with (and corrupt) that sweep.
 *
 * Params are sorted (key, then value) for a deterministic, stable URL/cache
 * key; `format`/`lang` stay first, matching the unsliced shape exactly.
 *
 * Exported (E2a step 5) so `scripts/register-eurostat-siblings.ts`'s dry run
 * can print the EXACT request URL a real registration would send — one
 * source of truth for the URL shape, never a second hand-built copy that
 * could drift from what the adapter actually requests.
 */
export function buildRequestUrl(nativeCode: string, slice: CbsSlice | undefined): string {
  const base = `${STATISTICS_BASE}/${nativeCode}?format=JSON&lang=EN`;
  if (!slice) return base;

  // LOW-effort code-review finding, fixed: `geo` is handled EXCLUSIVELY via
  // the structural EU/EFTA sweep below, never as a per-slice pin — a
  // `dimensionEquals.geo` entry would otherwise silently coexist with (not
  // replace) that ~34-code sweep, producing a request with both the
  // caller's single `geo=<code>` AND every structural geo code, which is not
  // what a caller pinning one country would want. Refuse loudly (principle
  // c) rather than silently building a broken/ambiguous request.
  if (slice.dimensionEquals && 'geo' in slice.dimensionEquals) {
    throw new Error(
      "Eurostat adapter: CbsSlice.dimensionEquals must never pin 'geo' — the D6 structural " +
        'EU/EFTA restriction (EU_EFTA_STAND_IN_GEO_CODES) is the only geo filter this adapter applies.',
    );
  }

  // ADR 065 (#358 item 4): the three lists a slice-store request carries (fetchSlice, the parity report).
  // `measures` are this adapter's own `<native-code>|<unit>` codes, sent as `unit=`; `dimensionIn` lists
  // codes per dimension, sent as repeated params (a `geo` list replaces the structural sweep but must stay
  // inside it); `periodIn` is sent as a `sinceTimePeriod` floor at its earliest code, and the exact list is
  // applied client-side (parseJsonStatDataset), like every other clause.
  const measureUnits = unitsOfMeasures(nativeCode, slice.measures ?? []);
  if (measureUnits.length > 0 && slice.dimensionEquals && 'unit' in slice.dimensionEquals) {
    throw new Error('Eurostat adapter: a slice cannot pin the unit and list measures at the same time.');
  }
  const listed = Object.entries(slice.dimensionIn ?? {}).filter(([, codes]) => codes.length > 0);
  for (const [dim, codes] of listed) {
    if (dim === 'unit' || dim === 'time') {
      throw new Error(`Eurostat adapter: CbsSlice.dimensionIn cannot list '${dim}' (use measures / periodIn).`);
    }
    if (slice.dimensionEquals && dim in slice.dimensionEquals) {
      throw new Error(`Eurostat adapter: a slice cannot both pin and list dimension '${dim}'.`);
    }
    if (dim === 'geo') {
      const outside = codes.filter((c) => !EU_EFTA_STAND_IN_GEO_CODES.has(c));
      if (outside.length > 0) {
        throw new Error(
          `Eurostat adapter: geo code(s) ${outside.join(', ')} are outside the EU/EFTA restriction this adapter applies.`,
        );
      }
    }
  }
  const periodCodes = slice.periodIn?.codes ?? [];
  if (periodCodes.length > 0 && slice.periodIn!.dimension !== 'time') {
    throw new Error(`Eurostat adapter: periodIn must name the 'time' dimension, not '${slice.periodIn!.dimension}'.`);
  }

  const params: Array<[string, string]> = [];
  if (slice.dimensionEquals) {
    for (const [dim, code] of Object.entries(slice.dimensionEquals)) {
      params.push([dim, code]);
    }
  }
  for (const unit of measureUnits) params.push(['unit', unit]);
  const geoList = listed.find(([dim]) => dim === 'geo')?.[1];
  for (const [dim, codes] of listed) {
    if (dim !== 'geo') for (const code of codes) params.push([dim, code]);
  }
  for (const code of geoList ?? EU_EFTA_STAND_IN_GEO_CODES) {
    params.push(['geo', code]);
  }
  // The later of the scope's floor and the request's earliest period (both CBS period codes; one table
  // has one grain, so string order is period order).
  const earliestListed = [...periodCodes].sort()[0];
  const floor = [slice.periodFloor, earliestListed].filter((p): p is string => p !== undefined).sort().at(-1);
  if (floor !== undefined) {
    params.push(['sinceTimePeriod', sinceTimePeriodFor(floor)]);
  }

  params.sort(([keyA, valA], [keyB, valB]) => (keyA === keyB ? valA.localeCompare(valB) : keyA.localeCompare(keyB)));

  const query = params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  return `${base}&${query}`;
}

export type FetchFn = typeof fetch;

export class StatisticsApiSource implements CbsSource {
  private readonly fetchFn: FetchFn;
  /** One JSON-stat fetch+parse per (tableId, slice) — schema, code lists and
   * rows all derive from the SAME response (unlike CBS's four separate
   * endpoints), so caching avoids re-fetching for fetchTableSchema +
   * fetchCodeList + fetchObservationCount + fetchObservations on one table. */
  private readonly cache = new Map<string, Promise<ParsedEurostatDataset>>();

  private readonly timeoutMs: number | undefined;
  private readonly totalMs: number | undefined;
  private readonly retryBackoffMs: number;
  private readonly stopAt: number | undefined;
  private readonly structureLayout: StatisticsApiSourceOptions['structureLayout'];
  /** One structure read (two requests) per dataset; a failed read is not kept. */
  private readonly structureCache = new Map<string, Promise<EurostatStructure>>();
  /** `decimals: 'observed'` only: one layout (so one decimals read) per dataset; a failure is not kept. */
  private readonly observedLayoutCache = new Map<string, Promise<EurostatLayout>>();

  constructor(fetchFn: FetchFn = fetch, options: StatisticsApiSourceOptions = {}) {
    this.fetchFn = fetchFn;
    this.timeoutMs = options.timeoutMs;
    this.totalMs = options.totalMs;
    this.retryBackoffMs = options.retryBackoffMs ?? RETRY_BACKOFF_MS;
    this.stopAt = options.stopAt;
    this.structureLayout = options.structureLayout;
  }

  private budgetEnded(url: string): Error {
    return new Error(`Eurostat request stopped: ${BUDGET_ENDED_PHRASE} for ${shortUrl(url)}`);
  }

  /**
   * One call = up to FETCH_ATTEMPTS attempts under ONE total deadline (the smaller of the call's own total and
   * the run budget). Each attempt is limited to the smallest of its own limit, the time left of the call's total
   * and the time left of the budget. Only transient failures are retried; a permanent one (errors.ts) is thrown
   * at once.
   */
  private async fetchWith<T>(
    url: string,
    headers: Record<string, string>,
    kind: EurostatCallKind,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    type Outcome = { body: T } | { failure: string } | { permanent: EurostatPermanentError };
    const attemptMs = this.timeoutMs ?? CALL_LIMITS[kind].attemptMs;
    const totalMs = this.totalMs ?? CALL_LIMITS[kind].totalMs;
    const callDeadline = Date.now() + totalMs;
    let lastError: unknown;
    let attemptsMade = 0;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      const budgetLeft = this.stopAt === undefined ? Number.POSITIVE_INFINITY : this.stopAt - Date.now();
      if (budgetLeft <= 0) throw this.budgetEnded(url);
      const callLeft = callDeadline - Date.now();
      if (callLeft <= 0) break;
      const ownLimit = Math.min(attemptMs, callLeft);
      // Cut short by the run budget (rather than by the call's own limits): a timeout then means "budget ended".
      const budgetCapped = budgetLeft < ownLimit;
      const limit = budgetCapped ? budgetLeft : ownLimit;
      attemptsMade = attempt;
      try {
        // One time limit per attempt, covering the body read too; a timeout is a failed attempt.
        const outcome = await fetchAndRead<Outcome>(
          url,
          { headers },
          limit,
          async (res) => {
            if (res.ok) return { body: await read(res) };
            // A retryable status (408, 429, 5xx) is repeated without reading its body; any other non-2xx is
            // permanent, and its body only words the summary.
            if (isRetryableStatus(res.status)) {
              return { failure: `Eurostat request failed: ${res.status} ${res.statusText} for ${shortUrl(url)}` };
            }
            let text = '';
            try {
              text = await res.text();
            } catch {
              // an unreadable error body leaves the summary to the status alone
            }
            return { permanent: classifyFailedResponse(res.status, text, url)! };
          },
          this.fetchFn,
        );
        if ('body' in outcome) return outcome.body;
        if ('permanent' in outcome) throw outcome.permanent;
        lastError = new Error(outcome.failure);
      } catch (err) {
        // A permanent failure (from the status or from an error body inside a 200) is never retried.
        if (err instanceof EurostatPermanentError) throw err;
        lastError = err;
      }
      if (this.stopAt !== undefined) {
        const timedOut = lastError instanceof Error && /timed out after/.test(lastError.message);
        if ((budgetCapped && timedOut) || this.stopAt - Date.now() <= 0) throw this.budgetEnded(url);
      }
      if (attempt < FETCH_ATTEMPTS) {
        const wait = this.retryBackoffMs * attempt;
        // A wait that would reach the end of the budget is not started (ODataV4Source's rule); neither is one
        // that would use up the rest of the call's own total.
        if (this.stopAt !== undefined && wait >= this.stopAt - Date.now()) throw this.budgetEnded(url);
        if (wait >= callDeadline - Date.now()) break;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    const why = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `Eurostat request failed after ${attemptsMade} attempt${attemptsMade === 1 ? '' : 's'} ` +
        `(limit for one call: ${totalMs / 1000} s) for ${shortUrl(url)}: ${why}`,
    );
  }

  private fetchJson(url: string, kind: EurostatCallKind): Promise<unknown> {
    return this.fetchWith(url, { Accept: 'application/json' }, kind, async (res) => {
      const body: unknown = await res.json();
      // Eurostat can answer an HTTP 200 whose body is an error (413 warning, "no results"): permanent, not data.
      const refused = classifyOkBody(body, url);
      if (refused) throw refused;
      return body;
    });
  }

  /** The Catalogue "table of contents" endpoint returns tab-separated TEXT,
   * not JSON (verified live, session 107) — a JSON `Accept` header on this
   * one endpoint gets a 406, not a JSON body. No `Accept` header at all,
   * matching what a live capture confirmed the server accepts. */
  private fetchText(url: string): Promise<string> {
    return this.fetchWith(url, {}, 'bulk', (res) => res.text());
  }

  private loadDataset(tableId: string, slice?: CbsSlice): Promise<ParsedEurostatDataset> {
    // Keyed on slice too: E1 fetches the whole dataset and filters
    // CLIENT-SIDE (see fetchAndParse's own note) so two different slices are
    // two different parsed results even though they hit the same URL —
    // keying on tableId alone would silently reuse an unrelated slice.
    //
    // [Important] fix (independent review, 2026-09-23, this branch):
    // `JSON.stringify(slice)` is key-order-sensitive. `registerTables`
    // passes `table.slice` exactly as authored in code, but `syncTable`
    // passes `registry.slice`, read back from the `cbs_tables.slice` JSONB
    // column — and Postgres jsonb does NOT preserve key order. For any
    // multi-key slice (every real E2a sibling's `dimensionEquals`, e.g.
    // `{s_adj, age, sex, unit}`), a register-then-sync flow in one process
    // (`src/ingestion/cli.ts`) could re-serialize the SAME slice with keys
    // in a different order, MISS this cache, and fetch twice — silently
    // contradicting the "one underlying fetch" design this cache exists
    // for. `canonicalSliceKey` below recursively sorts object keys (arrays
    // keep their order — a `dimensionPrefixes` list is meaningfully
    // ordered) so two slices that are semantically identical always
    // produce the identical cache key, regardless of how either one was
    // constructed or round-tripped through jsonb.
    const key = `${tableId} ${slice ? canonicalSliceKey(slice) : ''}`;
    let cached = this.cache.get(key);
    if (!cached) {
      cached = this.fetchAndParse(tableId, slice);
      this.cache.set(key, cached);
    }
    return cached;
  }

  private async fetchAndParse(tableId: string, slice?: CbsSlice): Promise<ParsedEurostatDataset> {
    const nativeCode = nativeIdFrom(tableId);
    // E2a step-5 fix (was: E1's own comment here said the URL never applied
    // the slice server-side — see `buildRequestUrl`'s doc comment for the
    // as-built shape, and ADR 048 D6's as-built note). `parseJsonStatDataset`
    // STILL applies the full slice client-side afterwards (defence in depth —
    // the server filter narrows, the client filter still decides; unchanged).
    const url = buildRequestUrl(nativeCode, slice);
    // A slice-bounded request is a `data` call; with no slice it is the whole dataset (`bulk`).
    const raw = await this.fetchJson(url, slice ? 'data' : 'bulk');
    return parseJsonStatDataset(raw, tableId, slice);
  }

  // E2a step-5 fix (2026-09-23): `slice`, routed through the SAME
  // `loadDataset` (and its per-(tableId, slice) cache) `fetchObservations`
  // uses below — a registered table's schema/code-list read now hits the
  // exact server-filtered request its observations do, instead of always
  // requesting the whole (potentially over-cap) dataset. When the caller
  // (registerTables/syncTable, src/ingestion/pipeline.ts) passes the SAME
  // slice for schema, code lists AND observations, all three come from ONE
  // underlying fetch (the cache key is identical). No slice ⇒ unchanged.
  async fetchTableSchema(tableId: string, slice?: CbsSlice): Promise<CbsTableSchema> {
    if (this.structureLayout) return (await this.loadLayout(tableId)).schema;
    return (await this.loadDataset(tableId, slice)).schema;
  }

  /** A dataset's structure from its two SDMX structure messages — no observations (#357 step 1). */
  fetchStructure(tableId: string): Promise<EurostatStructure> {
    const nativeCode = nativeIdFrom(tableId);
    let cached = this.structureCache.get(nativeCode);
    if (!cached) {
      // One request at a time (ADR 048 D6: Eurostat fetches serialise); a bad code rejects, never throws.
      cached = (async () => {
        const urls = structureUrls(nativeCode);
        const dataflow = await this.fetchText(urls.dataflow);
        const constraint = await this.fetchText(urls.constraint);
        return readEurostatStructure(nativeCode, dataflow, constraint);
      })();
      this.structureCache.set(nativeCode, cached);
      cached.catch(() => this.structureCache.delete(nativeCode));
    }
    return cached;
  }

  private loadLayout(tableId: string): Promise<EurostatLayout> {
    const decimals = this.structureLayout!.decimals;
    if (decimals !== 'observed') {
      return (async () => {
        const layout = eurostatLayoutFromStructure(tableId, await this.fetchStructure(tableId), (unit) => decimals(tableId, unit));
        if (!layout.ok) throw new EurostatLayoutRefusalError(layout);
        return layout;
      })();
    }
    const key = nativeIdFrom(tableId);
    let cached = this.observedLayoutCache.get(key);
    if (!cached) {
      cached = (async () => {
        const structure = await this.fetchStructure(tableId);
        const observed = await this.observeUnitDecimals(tableId);
        const layout = eurostatLayoutFromStructure(tableId, structure, (unit) => observed.decimals.get(unit));
        if (!layout.ok) throw new EurostatLayoutRefusalError(layout);
        return layout;
      })();
      this.observedLayoutCache.set(key, cached);
      cached.catch(() => this.observedLayoutCache.delete(key));
    }
    return cached;
  }

  /**
   * #357 (a): each unit's decimals, from a small read of real values — Eurostat's structure never states them.
   * Read 1 asks for every unit at the LATEST period; a unit it did not settle (no value with decimals and fewer
   * than DECIMALS_PROBE_SETTLING_VALUES whole numbers — a sparse latest period, confidential cells) is asked
   * again over the latest two periods, then three (DECIMALS_PROBE_MAX_READS).
   * Each read is bounded to DECIMALS_PROBE_MAX_CELLS cells (`decimalsProbeSlice`: licensed geography only, other
   * dimensions cut to their first codes, largest first). A unit's decimals = the most any value it saw
   * carries (`maxDecimals`, the download path's own rule). It goes through the SAME request path as a slice —
   * `buildRequestUrl`, the `data` call limits, `parseJsonStatDataset` — keeping only the period filter
   * client-side, so a code Eurostat leaves out of a sparse answer is not an error here (it is for a stored
   * slice). A read Eurostat answers with "no results" counts as seeing nothing; any other failure is thrown.
   *
   * A lower bound by construction: a value published later with MORE decimals than seen here is refused at
   * slice time and the table quarantined for review (src/ingestion/validate.ts `checkObservedDecimals`) — never
   * rounded. A unit no read saw a value for stays absent, and the layout then refuses (`decimals_unknown`).
   */
  async observeUnitDecimals(tableId: string): Promise<ObservedDecimals> {
    const structure = await this.fetchStructure(tableId);
    const fit = fitEurostatStructure(tableId, structure);
    if (!fit.ok) throw new EurostatLayoutRefusalError(fit);
    const nativeCode = nativeIdFrom(tableId);
    const seen = new Map<string, number[]>();
    // Settled: a value with decimals was seen, or enough whole numbers that "0 decimals" is not just JSON
    // dropping trailing zeros (2.0 arrives as 2) on a handful of values.
    const settled = (unit: string) => {
      const values = seen.get(unit) ?? [];
      return values.length >= DECIMALS_PROBE_SETTLING_VALUES || maxDecimals(values) > 0;
    };
    const reads: ObservedDecimals['reads'] = [];
    for (let read = 1; read <= DECIMALS_PROBE_MAX_READS; read++) {
      const open = fit.unitCodes.filter((u) => !settled(u));
      if (open.length === 0) break;
      const probe = decimalsProbeSlice(tableId, structure, fit, open, read);
      if (probe === null) break;
      const url = buildRequestUrl(nativeCode, probe.slice);
      reads.push({ url, cells: probe.cells, periods: probe.slice.periodIn!.codes });
      let rows: CbsObservationRow[];
      try {
        const raw = await this.fetchJson(url, 'data');
        rows = parseJsonStatDataset(raw, tableId, { periodIn: probe.slice.periodIn }).rows;
      } catch (err) {
        if (err instanceof EurostatPermanentError && err.kind === 'no_results') continue;
        throw err;
      }
      // A later read covers the earlier one's periods again; only its units still open are counted, afresh.
      for (const unit of open) seen.delete(unit);
      for (const row of rows) {
        if (row.value === null) continue;
        const unit = row.measure.slice(nativeCode.length + 1);
        if (!open.includes(unit)) continue;
        const list = seen.get(unit) ?? [];
        list.push(row.value);
        seen.set(unit, list);
      }
    }
    // Every unit with at least one observed value gets the most decimals any of them carried; a unit still
    // unsettled after the last read keeps what it saw (a lower bound, like every other: the slice-time check
    // refuses a value with more). A unit with no value at all stays absent — the layout refuses it.
    const decimals = new Map<string, number>();
    for (const [unit, values] of seen) if (values.length > 0) decimals.set(unit, maxDecimals(values));
    return { decimals, reads };
  }

  async fetchCodeList(tableId: string, dimension: string, slice?: CbsSlice): Promise<CbsCode[]> {
    const parsed = this.structureLayout ? await this.loadLayout(tableId) : await this.loadDataset(tableId, slice);
    const codes = parsed.codeLists[dimension];
    if (!codes) {
      throw new Error(
        `Eurostat dataset '${tableId}' has no dimension '${dimension}' (known: ` +
          `${Object.keys(parsed.codeLists).join(', ') || '<none>'})`,
      );
    }
    return codes;
  }

  async fetchObservationCount(tableId: string): Promise<number | null> {
    return (await this.loadDataset(tableId)).rows.length;
  }

  // NB no `dimensionNames` third parameter (unlike CBS's odata-v4.ts): a
  // JSON-stat response carries its own dimension names inline (`id`), so
  // there is no separate /Dimensions fetch to short-circuit here — the #156
  // TOCTOU concern that parameter exists for on the CBS side cannot arise.
  async *fetchObservations(tableId: string, slice?: CbsSlice): AsyncIterable<CbsObservationRow[]> {
    // One bounded JSON-stat document (D6: synchronous only, under
    // SYNC_CELL_THRESHOLD by construction) — one page, nothing to paginate.
    const parsed = await this.loadDataset(tableId, slice);
    yield parsed.rows;
  }

  async fetchCatalog(): Promise<CbsCatalogEntry[]> {
    const raw = await this.fetchText(CATALOGUE_URL);
    return parseJsonStatCatalog(raw);
  }
}
