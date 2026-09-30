// Live OData v4 implementation of CbsSource (ADR 003: the only module that
// may know CBS URL shapes). Base URL and wire facts measured 2026-07-02 —
// see docs/07-phase0-table-set.md "Catalog quirks" for the casing and
// trailing-space rules this module must respect (never case-normalize a
// table ID; parsing trims codes, this module does not).
import type {
  CbsCatalogEntry,
  CbsCode,
  CbsObservationRow,
  CbsSlice,
  CbsSource,
  CbsTableSchema,
} from './types.ts';
import {
  optionalString,
  parseCatalogPage,
  parseCodes,
  parseDimensions,
  parseMeasureGroups,
  parseMeasures,
  parseObservationsPage,
  type CbsMeasureGroup,
} from './parse-v4.ts';
import { fetchAndRead, shortUrl, summarizeErrorBody } from '../sources/fetch-with-timeout.ts';

const BASE = 'https://datasets.cbs.nl/odata/v1/CBS';
const FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1500;
// Time limit per attempt (#357). Metadata calls are small; an Observations page
// of a big table is legitimately slow, so it gets far longer.
const METADATA_TIMEOUT_MS = 30_000;
const OBSERVATIONS_TIMEOUT_MS = 300_000;
// The full catalogue is one 6.8 MB response (21 s measured 2026-09-30): its own limit.
const CATALOG_TIMEOUT_MS = 300_000;

/** OData string literals escape a single quote by doubling it. */
const q = (value: string): string => value.replace(/'/g, "''");

// Fields pulled for the catalog mirror. Explicit $select keeps the payload lean
// (drops Distributions/VersionNotes/ObservationCount we don't use) and pins the
// contract. Description is the blurb; NEVER use $search (a measured v4 no-op —
// HTTP 200 + irrelevant results, docs/07 / WP16 brief).
const CATALOG_SELECT = 'Identifier,Title,Description,Status,DatasetType,Language,Modified';

/**
 * Builds the OData $filter expression for a registered slice.
 * Semantics (must match scripts/capture-cbs-fixtures.ts's original copy,
 * which now imports this function):
 * - dimensionEquals: `Dim eq 'code'`, ANDed together.
 * - dimensionPrefixes: `startswith(Dim,'prefix')`, ORed per dimension
 *   (parenthesised when more than one prefix), ANDed with everything else.
 * - periodFloor: `Perioden ge 'code'` (lexicographic on CBS period codes).
 * - measures: `Measure eq 'code'`, ORed, parenthesised when more than one,
 *   appended LAST so slices without it keep their exact filter string.
 * - dimensionIn (breadth step 2): `Dim eq 'code'`, ORed per dimension
 *   (parenthesised when more than one code), dimension keys visited in
 *   SORTED order for a deterministic string, ANDed with everything else,
 *   appended AFTER measures.
 * - periodIn (breadth step 2): `Dim eq 'code'` (dimension = periodIn.dimension),
 *   ORed, parenthesised when more than one code, appended LAST of all —
 *   so every slice that predates dimensionIn/periodIn keeps its exact
 *   filter string (the 03759ned exact-string test pins this).
 * Returns null when the slice is absent or empty (no $filter needed).
 */
export function sliceToFilter(slice?: CbsSlice): string | null {
  if (!slice) return null;
  const parts: string[] = [];
  for (const [dim, code] of Object.entries(slice.dimensionEquals ?? {})) {
    parts.push(`${dim} eq '${q(code)}'`);
  }
  for (const [dim, prefixes] of Object.entries(slice.dimensionPrefixes ?? {})) {
    const ors = prefixes.map((p) => `startswith(${dim},'${q(p)}')`).join(' or ');
    parts.push(prefixes.length > 1 ? `(${ors})` : ors);
  }
  if (slice.periodFloor) parts.push(`Perioden ge '${q(slice.periodFloor)}'`);
  const measures = slice.measures ?? [];
  if (measures.length > 0) {
    const ors = measures.map((m) => `Measure eq '${q(m)}'`).join(' or ');
    parts.push(measures.length > 1 ? `(${ors})` : ors);
  }
  const dimensionIn = slice.dimensionIn ?? {};
  for (const dim of Object.keys(dimensionIn).sort()) {
    const codes = dimensionIn[dim] ?? [];
    if (codes.length === 0) continue;
    const ors = codes.map((c) => `${dim} eq '${q(c)}'`).join(' or ');
    parts.push(codes.length > 1 ? `(${ors})` : ors);
  }
  if (slice.periodIn && slice.periodIn.codes.length > 0) {
    const { dimension, codes } = slice.periodIn;
    const ors = codes.map((c) => `${dimension} eq '${q(c)}'`).join(' or ');
    parts.push(codes.length > 1 ? `(${ors})` : ors);
  }
  return parts.length ? parts.join(' and ') : null;
}

/** Sentinel for "MeasureGroups could not be fetched" (final-review I2). */
const MEASURE_GROUPS_UNAVAILABLE = Symbol('measure-groups-unavailable');

/** MeasureGroups parsed best-effort (final-review I2, breadth step 4b fix
 * wave): `null` when the fetch failed (non-404, after retries) or the
 * document does not parse — the caller then gives every measure groupPath
 * [] and flags the schema `measureGroupsUnavailable`, instead of failing a
 * sync over data that is never stored. */
function parseMeasureGroupsBestEffort(raw: unknown): CbsMeasureGroup[] | null {
  if (raw === MEASURE_GROUPS_UNAVAILABLE) return null;
  try {
    return parseMeasureGroups(raw);
  } catch {
    return null;
  }
}

export interface ODataV4SourceOptions {
  /** Injected in tests; defaults to the global `fetch` (looked up per call). */
  fetchFn?: typeof fetch;
  /** Per-attempt limit for every call except Observations pages. */
  metadataTimeoutMs?: number;
  /** Per-attempt limit for one Observations page. */
  observationsTimeoutMs?: number;
  /** Per-attempt limit for one catalogue (Datasets) page. */
  catalogTimeoutMs?: number;
  /** Base of the linear retry backoff (attempt n waits n x this). */
  retryBackoffMs?: number;
}

/** One failed response as a message: status line, plus a short summary of the
 * body when it can be read. Never throws — an unreadable body gives the plain
 * status line. (A stalled body is cut off by the caller's deadline.) */
async function failureMessage(label: string, res: Response, url: string): Promise<string> {
  const base = `${label} failed: ${res.status} ${res.statusText} for ${shortUrl(url)}`;
  try {
    const summary = summarizeErrorBody(await res.text());
    return summary ? `${base}: ${summary}` : base;
  } catch {
    return base;
  }
}

export class ODataV4Source implements CbsSource {
  private readonly fetchFn: typeof fetch | undefined;
  private readonly metadataTimeoutMs: number;
  private readonly observationsTimeoutMs: number;
  private readonly catalogTimeoutMs: number;
  private readonly retryBackoffMs: number;

  constructor(options: ODataV4SourceOptions = {}) {
    this.fetchFn = options.fetchFn;
    this.metadataTimeoutMs = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS;
    this.observationsTimeoutMs = options.observationsTimeoutMs ?? OBSERVATIONS_TIMEOUT_MS;
    this.catalogTimeoutMs = options.catalogTimeoutMs ?? CATALOG_TIMEOUT_MS;
    this.retryBackoffMs = options.retryBackoffMs ?? RETRY_BACKOFF_MS;
  }

  private async fetchJson(url: string, timeoutMs: number = this.metadataTimeoutMs): Promise<unknown> {
    return this.fetchJsonWithRetries(url, timeoutMs);
  }

  /**
   * Fetches a metadata document, but normalizes an HTTP 404 to "no rows"
   * (`{ value: [] }`) instead of throwing — for `MeasureGroups`, which many
   * CBS tables simply don't publish (breadth step 4b, Task 1). Any OTHER
   * failure (after retries) throws like `fetchJson`; fetchTableSchema is the
   * one caller, and it catches that (final-review I2: MeasureGroups is
   * best-effort).
   */
  private async fetchJsonOptional(url: string): Promise<unknown> {
    return this.fetchJsonWithRetries(url, this.metadataTimeoutMs, { value: [] });
  }

  /** The shared retry loop. Each attempt is one time-limited request whose
   * limit also covers reading the body; a timeout is just a failed attempt. */
  private async fetchJsonWithRetries(url: string, timeoutMs: number, onNotFound?: unknown): Promise<unknown> {
    type Outcome = { body: unknown } | { failure: string };
    let lastError: unknown;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      try {
        const outcome = await fetchAndRead<Outcome>(
          url,
          { headers: { Accept: 'application/json' } },
          timeoutMs,
          async (res) => {
            if (res.ok) return { body: await res.json() };
            if (onNotFound !== undefined && res.status === 404) return { body: onNotFound };
            return { failure: await failureMessage('CBS OData request', res, url) };
          },
          this.fetchFn,
        );
        if ('body' in outcome) return outcome.body;
        lastError = new Error(outcome.failure);
      } catch (err) {
        lastError = err;
      }
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, this.retryBackoffMs * attempt));
      }
    }
    throw new Error(
      `CBS OData request failed after ${FETCH_ATTEMPTS} attempts for ${shortUrl(url)}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  async fetchTableSchema(tableId: string): Promise<CbsTableSchema> {
    const [properties, dimensionsRaw, measuresRaw, measureGroupsRaw] = await Promise.all([
      this.fetchJson(`${BASE}/${tableId}/Properties`),
      this.fetchJson(`${BASE}/${tableId}/Dimensions`),
      this.fetchJson(`${BASE}/${tableId}/MeasureCodes`),
      // breadth step 4b, Task 1: a 404 (table publishes no MeasureGroups) or
      // an empty list both mean "no groups" — every measure's groupPath is
      // []. Final-review I2: any OTHER failure (after the normal retries) is
      // caught here rather than failing the whole schema fetch — groups are
      // never stored, so they must never fail an ingestion sync.
      this.fetchJsonOptional(`${BASE}/${tableId}/MeasureGroups`).catch(() => MEASURE_GROUPS_UNAVAILABLE),
    ]);
    const props = properties as { Title?: unknown };
    if (typeof props.Title !== 'string') {
      throw new Error(`CBS Properties response for table '${tableId}' is missing Title`);
    }
    const groups = parseMeasureGroupsBestEffort(measureGroupsRaw);
    return {
      tableId,
      title: props.Title,
      dimensions: parseDimensions(dimensionsRaw),
      measures: parseMeasures(measuresRaw, groups ?? []),
      // breadth step 2, Task 3: the same Properties document already fetched
      // above for Title carries CBS's own 'Modified' timestamp.
      modified: optionalString(properties as Record<string, unknown>, 'Modified'),
      // Final-review I2: present (true) only when MeasureGroups could not be
      // fetched or parsed — every groupPath above is then []. Ingestion never
      // reads it; buildTableParseSchema refuses a flagged table.
      ...(groups === null ? { measureGroupsUnavailable: true } : {}),
    };
  }

  async fetchCodeList(tableId: string, dimension: string): Promise<CbsCode[]> {
    const raw = await this.fetchJson(`${BASE}/${tableId}/${dimension}Codes`);
    return parseCodes(raw);
  }

  async fetchCatalog(): Promise<CbsCatalogEntry[]> {
    const params = new URLSearchParams({ $select: CATALOG_SELECT });
    // The listing currently returns all ~4,858 rows in one response (no
    // @odata.nextLink, measured 2026-07-05); the loop follows nextLink anyway
    // so a future CBS-side paging change can't silently truncate the catalog.
    let url: string | null = `${BASE}/Datasets?${params.toString()}`;
    const all: CbsCatalogEntry[] = [];
    while (url) {
      const raw = await this.fetchJson(url, this.catalogTimeoutMs);
      const { entries, nextLink } = parseCatalogPage(raw);
      all.push(...entries);
      url = nextLink;
    }
    return all;
  }

  /**
   * GET {base}/{tableId}/Observations/$count → a bare integer body (OData v4
   * $count endpoint). Used for slice sizing (WP16 sub-part 2 §4) BEFORE any
   * ingest — it is metadata about the table's size, not a data cell, so it is
   * fine on this out-of-band job path (principle b holds: the job is
   * cron-invoked, never the request path).
   *
   * **Assumption (design §4, mark inline):** the v4 API supports `$count` on
   * the Observations set and returns a plain integer body. Not re-verified live
   * this session; if a table 404s or returns a non-integer body, this returns
   * null (the slice estimator falls back to the dimension-cardinality product)
   * rather than throwing — a missing count must never block or fabricate a
   * size. A genuine network failure (all retries exhausted) still throws, like
   * every other fetch here; the job wraps the whole size step.
   */
  async fetchObservationCount(tableId: string): Promise<number | null> {
    const url = `${BASE}/${tableId}/Observations/$count`;
    type Outcome = { count: number | null } | { failure: string };
    let lastError: unknown;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      try {
        const outcome = await fetchAndRead<Outcome>(
          url,
          { headers: { Accept: 'text/plain' } },
          this.metadataTimeoutMs,
          async (res) => {
            if (res.ok) {
              const body = (await res.text()).trim();
              const n = Number(body);
              // A non-integer body ($count unsupported → HTML/JSON, or an empty
              // body) → treat as "count unavailable", never a fabricated size.
              return { count: Number.isInteger(n) && n >= 0 ? n : null };
            }
            // 404 / not-supported: count unavailable, fall back to the estimate.
            if (res.status === 404) return { count: null };
            return { failure: await failureMessage('CBS OData $count request', res, url) };
          },
          this.fetchFn,
        );
        if ('count' in outcome) return outcome.count;
        lastError = new Error(outcome.failure);
      } catch (err) {
        lastError = err;
      }
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, this.retryBackoffMs * attempt));
      }
    }
    throw new Error(
      `CBS OData $count request failed after ${FETCH_ATTEMPTS} attempts for ${shortUrl(url)}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  async *fetchObservations(
    tableId: string,
    slice?: CbsSlice,
    dimensionNames?: string[],
  ): AsyncIterable<CbsObservationRow[]> {
    // #156: reuse the caller's already-validated dimension names when given (the
    // ingestion pipeline passes schema.dimensions); only fetch /Dimensions here
    // when no caller supplied them, so one validated dimension set governs the
    // whole sync (no redundant fetch, no two-fetch TOCTOU).
    const dimNames =
      dimensionNames ?? parseDimensions(await this.fetchJson(`${BASE}/${tableId}/Dimensions`)).map((d) => d.name);

    const filter = sliceToFilter(slice);
    const params = new URLSearchParams();
    if (filter) params.set('$filter', filter);
    const query = params.toString();
    let url: string | null = `${BASE}/${tableId}/Observations${query ? `?${query}` : ''}`;

    while (url) {
      const raw = await this.fetchJson(url, this.observationsTimeoutMs);
      const { rows, nextLink } = parseObservationsPage(raw, dimNames);
      yield rows;
      url = nextLink;
    }
  }
}
