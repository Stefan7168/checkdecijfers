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

/** D4: strips the '<key>:' prefix internally (never the caller's job) —
 * a local copy of the same first-colon rule every other module in this
 * source's family implements independently (see jsonstat.ts's own copy). */
function nativeIdFrom(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
}

/**
 * Converts a CBS-format `periodFloor` (e.g. '2015JJ00', '2015KW01',
 * '2015MM01' — `src/ingestion/periods.ts`'s grammar, the same one
 * `CbsSlice.periodFloor` is always expressed in) into Eurostat's OWN
 * `sinceTimePeriod` filter grammar. This is the exact inverse of
 * `mapEurostatPeriod` (jsonstat.ts) in terms of WHICH grain it accepts, but
 * NOT the same target string shape: Eurostat's `sinceTimePeriod` query
 * parameter takes plain 'YYYY' / 'YYYY-Qn' / 'YYYY-MM' — no 'M' prefix on the
 * month, unlike the JSON-stat response's own 'time' category codes (which DO
 * read '2024-M01'; see MONTH_RE in jsonstat.ts). Verified against the brief's
 * exact values (docs/superpowers/specs/2026-09-23-eurostat-e2a-step5-sibling-datasets.md).
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
 *
 * Params are sorted (key, then value) for a deterministic, stable URL/cache
 * key; `format`/`lang` stay first, matching the unsliced shape exactly.
 */
function buildRequestUrl(nativeCode: string, slice: CbsSlice | undefined): string {
  const base = `${STATISTICS_BASE}/${nativeCode}?format=JSON&lang=EN`;
  if (!slice) return base;

  const params: Array<[string, string]> = [];
  if (slice.dimensionEquals) {
    for (const [dim, code] of Object.entries(slice.dimensionEquals)) {
      params.push([dim, code]);
    }
  }
  for (const code of EU_EFTA_STAND_IN_GEO_CODES) {
    params.push(['geo', code]);
  }
  if (slice.periodFloor) {
    params.push(['sinceTimePeriod', sinceTimePeriodFor(slice.periodFloor)]);
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

  constructor(fetchFn: FetchFn = fetch) {
    this.fetchFn = fetchFn;
  }

  private async fetchWith<T>(url: string, headers: Record<string, string>, read: (res: Response) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      try {
        const res = await this.fetchFn(url, { headers });
        if (res.ok) return await read(res);
        lastError = new Error(`Eurostat request failed: ${res.status} ${res.statusText} for ${url}`);
      } catch (err) {
        lastError = err;
      }
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * attempt));
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
    const key = `${tableId} ${slice ? JSON.stringify(slice) : ''}`;
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

  async fetchTableSchema(tableId: string): Promise<CbsTableSchema> {
    return (await this.loadDataset(tableId)).schema;
  }

  async fetchCodeList(tableId: string, dimension: string): Promise<CbsCode[]> {
    const parsed = await this.loadDataset(tableId);
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
