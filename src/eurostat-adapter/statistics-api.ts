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
import { parseJsonStatCatalog, parseJsonStatDataset, type ParsedEurostatDataset } from './jsonstat.ts';

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
    // E1 does not attempt server-side dimensionEquals/dimensionPrefixes
    // filtering in the URL — parseJsonStatDataset applies the FULL slice
    // (incl. the structural D6 geo restriction) client-side, the same
    // pattern CBS's own FixtureSource already uses for its slice. A missing
    // server-side filter degrades to "fetches more than strictly needed",
    // never to a correctness bug — and E1 never registers a dataset near
    // the sync threshold in the first place (Constraint 0: nothing is
    // registered yet).
    const url = `${STATISTICS_BASE}/${nativeCode}?format=JSON&lang=EN`;
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
