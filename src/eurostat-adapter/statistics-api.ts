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
import {
  EU_EFTA_STAND_IN_GEO_CODES,
  parseJsonStatCatalog,
  parseJsonStatDataset,
  type ParsedEurostatDataset,
} from './jsonstat.ts';

/** VERIFIED live (session 107, 2026-09-16) — Eurostat's real Statistics API
 * dissemination endpoint. */
const STATISTICS_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
/** VERIFIED live (session 107, 2026-09-16) — Eurostat's real Catalogue API
 * "table of contents" endpoint; see parseJsonStatCatalog's own doc comment
 * in ./jsonstat.ts for the tab-separated TEXT (not JSON) shape this returns. */
const CATALOGUE_URL = 'https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt?lang=EN';

const FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1500;
// Time limit per attempt (#357). One dataset response can hold up to SYNC_CELL_THRESHOLD cells and
// the catalogue file is several MB, so the limit is generous; its job is to end a hung connection.
const REQUEST_TIMEOUT_MS = 300_000;

export interface StatisticsApiSourceOptions {
  /** Per-attempt limit for every request (body read included). */
  timeoutMs?: number;
  /** Base of the linear retry backoff (attempt n waits n x this). */
  retryBackoffMs?: number;
  /** Epoch ms: the end of the run's time budget (the command line's --budget-seconds), the same contract as
   * `ODataV4SourceOptions.stopAt`: every attempt is limited to the smaller of its own limit and the time left,
   * no attempt or retry wait starts once it has passed, and a request cut that way fails with
   * BUDGET_ENDED_PHRASE in its message (the warm job then counts it as remaining, not failed). Absent: no
   * budget. */
  stopAt?: number;
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

  private readonly timeoutMs: number;
  private readonly retryBackoffMs: number;
  private readonly stopAt: number | undefined;

  constructor(fetchFn: FetchFn = fetch, options: StatisticsApiSourceOptions = {}) {
    this.fetchFn = fetchFn;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.retryBackoffMs = options.retryBackoffMs ?? RETRY_BACKOFF_MS;
    this.stopAt = options.stopAt;
  }

  private budgetEnded(url: string): Error {
    return new Error(`Eurostat request stopped: ${BUDGET_ENDED_PHRASE} for ${shortUrl(url)}`);
  }

  private async fetchWith<T>(url: string, headers: Record<string, string>, read: (res: Response) => Promise<T>): Promise<T> {
    type Outcome = { body: T } | { failure: string };
    let lastError: unknown;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      // The attempt's limit: its own, or what is left of the run's budget when that is less.
      const left = this.stopAt === undefined ? Number.POSITIVE_INFINITY : this.stopAt - Date.now();
      if (left <= 0) throw this.budgetEnded(url);
      const capped = left < this.timeoutMs;
      try {
        // One time limit per attempt, covering the body read too; a timeout is a failed attempt.
        const outcome = await fetchAndRead<Outcome>(
          url,
          { headers },
          capped ? left : this.timeoutMs,
          async (res) =>
            res.ok
              ? { body: await read(res) }
              : { failure: `Eurostat request failed: ${res.status} ${res.statusText} for ${url}` },
          this.fetchFn,
        );
        if ('body' in outcome) return outcome.body;
        lastError = new Error(outcome.failure);
      } catch (err) {
        lastError = err;
      }
      if (this.stopAt !== undefined) {
        const timedOut = lastError instanceof Error && /timed out after/.test(lastError.message);
        if ((capped && timedOut) || this.stopAt - Date.now() <= 0) throw this.budgetEnded(url);
      }
      if (attempt < FETCH_ATTEMPTS) {
        const wait = this.retryBackoffMs * attempt;
        // A wait that would reach the end of the budget is not started (ODataV4Source's rule).
        if (this.stopAt !== undefined && wait >= this.stopAt - Date.now()) throw this.budgetEnded(url);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw new Error(
      `Eurostat request failed after ${FETCH_ATTEMPTS} attempts for ${url}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  private fetchJson(url: string): Promise<unknown> {
    return this.fetchWith(url, { Accept: 'application/json' }, (res) => res.json());
  }

  /** The Catalogue "table of contents" endpoint returns tab-separated TEXT,
   * not JSON (verified live, session 107) — a JSON `Accept` header on this
   * one endpoint gets a 406, not a JSON body. No `Accept` header at all,
   * matching what a live capture confirmed the server accepts. */
  private fetchText(url: string): Promise<string> {
    return this.fetchWith(url, {}, (res) => res.text());
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
    const raw = await this.fetchJson(url);
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
    return (await this.loadDataset(tableId, slice)).schema;
  }

  async fetchCodeList(tableId: string, dimension: string, slice?: CbsSlice): Promise<CbsCode[]> {
    const parsed = await this.loadDataset(tableId, slice);
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
