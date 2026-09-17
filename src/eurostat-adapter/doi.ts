// Eurostat DOI construction + out-of-band verification (ADR 048 D7(a),
// docs/open-questions.md #264). Eurostat mints one DOI per dataset, pattern
// `10.2908/<CODE>` (code uppercased), per Eurostat's own "Anchoring of
// datasets" guide — confirmed live against the public, unauthenticated
// DataCite REST API for three real datasets including `tipsbd30` (session
// 108 research; see ADR 048's second As-built addendum). Neither the
// Catalogue "table of contents" endpoint nor the Statistics API expose a
// DOI — DataCite is the only verified programmatic source.
//
// Cheapest-mechanism-first (CLAUDE.md convention): the DOI is constructed
// deterministically with ZERO API calls, then — because principle (c) forbids
// storing a guess as fact — verified with exactly one cheap, out-of-band call
// before it is ever written. This module is presentation-only support for
// the "Bewijs dit cijfer" proof panel; nothing here may ever block or fail
// ingestion (registerTables' own call site treats every outcome here as
// best-effort, per that file's comment).
//
// nativeIdFrom is duplicated here on purpose, matching this codebase's own
// per-adapter convention (see src/answer/audit/retention.ts's `isRedacted`
// comment and src/eurostat-adapter/{jsonstat,statistics-api,fixture-source}.ts,
// each of which already carries its own copy) rather than importing
// registry.ts's private helper across a module boundary for one line of logic.
function nativeIdFrom(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
}

/**
 * Deterministic DOI construction — zero API calls. Accepts either a full
 * table id (`eurostat:tipsbd30`) or a bare native code (`tipsbd30`); a
 * source-key prefix, if present, is stripped the same way the registry's own
 * `nativeIdFrom` does. The result is NOT verified — pair with
 * `verifyEurostatDoi` before ever storing it as fact (principle c).
 */
export function eurostatDoiFor(tableIdOrCode: string): string {
  return `10.2908/${nativeIdFrom(tableIdOrCode).toUpperCase()}`;
}

export interface DoiVerificationDeps {
  /** Injectable so callers/tests never hit the real network (mirrors
   * src/chart/brandfetch.ts's `fetchBrand` dependency shape). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DATACITE_ENDPOINT = 'https://api.datacite.org/dois/';
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * One cheap, out-of-band (never the request path) call to the public,
 * unauthenticated DataCite REST API: `GET
 * https://api.datacite.org/dois/<doi>`. Returns `true` only when the
 * response is 200 and `data.attributes.state === "findable"` — the one
 * signal principle (c) asks for before treating a constructed DOI as fact.
 *
 * NEVER throws: a 404, any other non-2xx status, a network error, a
 * JSON-parse error, a synchronously-throwing `fetchImpl`, or a request that
 * exceeds `timeoutMs` all resolve to `false` rather than a rejected promise
 * — matching `fetchBrand`'s fail-safe shape in src/chart/brandfetch.ts.
 * Callers must never let this block or fail ingestion; it is presentation-
 * only support for the proof panel, not a validation-pipeline check.
 */
export async function verifyEurostatDoi(doi: string, deps: DoiVerificationDeps = {}): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${DATACITE_ENDPOINT}${doi}`, {
      method: 'GET',
      headers: { Accept: 'application/vnd.api+json' },
      signal: controller.signal,
    });
    if (!response.ok) return false;

    const json: unknown = await response.json();
    const state = (json as { data?: { attributes?: { state?: unknown } } })?.data?.attributes?.state;
    return state === 'findable';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
