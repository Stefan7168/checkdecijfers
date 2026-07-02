// Live OData v4 implementation of CbsSource (ADR 003: the only module that
// may know CBS URL shapes). Base URL and wire facts measured 2026-07-02 —
// see docs/07-phase0-table-set.md "Catalog quirks" for the casing and
// trailing-space rules this module must respect (never case-normalize a
// table ID; parsing trims codes, this module does not).
import type { CbsCode, CbsObservationRow, CbsSlice, CbsSource, CbsTableSchema } from './types.ts';
import { parseCodes, parseDimensions, parseMeasures, parseObservationsPage } from './parse-v4.ts';

const BASE = 'https://datasets.cbs.nl/odata/v1/CBS';
const FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1500;

/**
 * Builds the OData $filter expression for a registered slice.
 * Semantics (must match scripts/capture-cbs-fixtures.ts's original copy,
 * which now imports this function):
 * - dimensionEquals: `Dim eq 'code'`, ANDed together.
 * - dimensionPrefixes: `startswith(Dim,'prefix')`, ORed per dimension
 *   (parenthesised when more than one prefix), ANDed with everything else.
 * - periodFloor: `Perioden ge 'code'` (lexicographic on CBS period codes).
 * Returns null when the slice is absent or empty (no $filter needed).
 */
export function sliceToFilter(slice?: CbsSlice): string | null {
  if (!slice) return null;
  const parts: string[] = [];
  for (const [dim, code] of Object.entries(slice.dimensionEquals ?? {})) {
    parts.push(`${dim} eq '${code}'`);
  }
  for (const [dim, prefixes] of Object.entries(slice.dimensionPrefixes ?? {})) {
    const ors = prefixes.map((p) => `startswith(${dim},'${p}')`).join(' or ');
    parts.push(prefixes.length > 1 ? `(${ors})` : ors);
  }
  if (slice.periodFloor) parts.push(`Perioden ge '${slice.periodFloor}'`);
  return parts.length ? parts.join(' and ') : null;
}

export class ODataV4Source implements CbsSource {
  private async fetchJson(url: string): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.ok) return await res.json();
        lastError = new Error(
          `CBS OData request failed: ${res.status} ${res.statusText} for ${url}`,
        );
      } catch (err) {
        lastError = err;
      }
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * attempt));
      }
    }
    throw new Error(
      `CBS OData request failed after ${FETCH_ATTEMPTS} attempts for ${url}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  async fetchTableSchema(tableId: string): Promise<CbsTableSchema> {
    const [properties, dimensionsRaw, measuresRaw] = await Promise.all([
      this.fetchJson(`${BASE}/${tableId}/Properties`),
      this.fetchJson(`${BASE}/${tableId}/Dimensions`),
      this.fetchJson(`${BASE}/${tableId}/MeasureCodes`),
    ]);
    const props = properties as { Title?: unknown };
    if (typeof props.Title !== 'string') {
      throw new Error(`CBS Properties response for table '${tableId}' is missing Title`);
    }
    return {
      tableId,
      title: props.Title,
      dimensions: parseDimensions(dimensionsRaw),
      measures: parseMeasures(measuresRaw),
    };
  }

  async fetchCodeList(tableId: string, dimension: string): Promise<CbsCode[]> {
    const raw = await this.fetchJson(`${BASE}/${tableId}/${dimension}Codes`);
    return parseCodes(raw);
  }

  async *fetchObservations(
    tableId: string,
    slice?: CbsSlice,
  ): AsyncIterable<CbsObservationRow[]> {
    const dimensionsRaw = await this.fetchJson(`${BASE}/${tableId}/Dimensions`);
    const dimensionNames = parseDimensions(dimensionsRaw).map((d) => d.name);

    const filter = sliceToFilter(slice);
    const params = new URLSearchParams();
    if (filter) params.set('$filter', filter);
    const query = params.toString();
    let url: string | null = `${BASE}/${tableId}/Observations${query ? `?${query}` : ''}`;

    while (url) {
      const raw = await this.fetchJson(url);
      const { rows, nextLink } = parseObservationsPage(raw, dimensionNames);
      yield rows;
      url = nextLink;
    }
  }
}
