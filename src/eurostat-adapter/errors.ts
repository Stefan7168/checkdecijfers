// Eurostat failure classes (#357, study step 0, defect 2).
//
// A Statistics API failure is either TRANSIENT (a timeout, a network drop, a 5xx, 408/429, an HTML page instead
// of JSON — the same request may succeed a moment later, so the adapter retries it) or PERMANENT (a 400, a 404,
// a 413 and every other 4xx — Eurostat answers the identical request identically every time, so retrying only
// burns the run budget). A permanent failure is thrown as an `EurostatPermanentError` carrying a short, specific
// summary of what Eurostat refused; the adapter never retries it and never turns it into data (principle (c)).
//
// Response shapes follow the connector study (docs/session-briefs/2026-09-30-eurostat-mcp-deep-study.md,
// section 1.5): a JSON body `{ "error": [{ "status": 400, "id": 150, "label": "..." }] }`, and a
// `warning` with status 413 on an HTTP 200 for a request Eurostat would only answer asynchronously.
// **Assumption (mirrored in open-questions #357):** these body shapes are taken from the study's captures, not
// from our own live calls. The classification leans on the HTTP status first, so an unexpected body only
// changes the wording of the summary, never whether the call is retried.
import { shortUrl, summarizeErrorBody } from '../sources/fetch-with-timeout.ts';

/** What Eurostat refused, in the study's vocabulary. */
export type EurostatFailureKind =
  /** 404: no such dataset (or address). */
  | 'not_found'
  /** 400 with id 150: an unknown dimension or code in the filter. */
  | 'invalid_dimension'
  /** 400 with id 140, or a label naming the period: a period Eurostat cannot use. */
  | 'invalid_period'
  /** Any other 400: a request Eurostat finds inconsistent. */
  | 'conflicting_params'
  /** 413 (HTTP status, error entry, or a `warning` on an HTTP 200), or 414: too much data or too long a request. */
  | 'too_large'
  /** HTTP 200 with error id 100: the selection matches nothing. */
  | 'no_results'
  /** Every other 4xx (401, 403, 405, 406, 410, 422, ...). */
  | 'rejected';

const KIND_TEXT: Readonly<Record<EurostatFailureKind, string>> = {
  not_found: 'unknown dataset',
  invalid_dimension: 'unknown dimension or code in the filter',
  invalid_period: 'period not usable',
  conflicting_params: 'request rejected as inconsistent',
  too_large: 'too large — narrow the selection (asynchronous downloads are not used)',
  no_results: 'no data for this selection',
  rejected: 'request rejected',
};

/** A failure that repeating the same request cannot fix. Never retried by the adapter. */
export class EurostatPermanentError extends Error {
  readonly retryable = false as const;
  readonly kind: EurostatFailureKind;
  readonly status: number;
  constructor(kind: EurostatFailureKind, status: number, message: string) {
    super(message);
    this.name = 'EurostatPermanentError';
    this.kind = kind;
    this.status = status;
  }
}

export interface EurostatErrorEntry {
  status: number | null;
  id: number | null;
  label: string;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v);
  return null;
}

/** The entries of a Eurostat error/warning body (`error` or `warning`, an array or one object). Empty when the body
 * is not of that shape. Never throws. */
export function errorEntriesOf(body: unknown, key: 'error' | 'warning' = 'error'): EurostatErrorEntry[] {
  if (body === null || typeof body !== 'object') return [];
  const raw = (body as Record<string, unknown>)[key];
  const list = Array.isArray(raw) ? raw : raw !== undefined && raw !== null ? [raw] : [];
  const out: EurostatErrorEntry[] = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    out.push({
      status: asNumber(rec.status),
      id: asNumber(rec.id),
      label: typeof rec.label === 'string' ? rec.label : typeof rec.message === 'string' ? rec.message : '',
    });
  }
  return out;
}

/** True for statuses worth repeating: 408, 429 and every 5xx. Every other non-2xx is permanent. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function kindFor(status: number, entries: EurostatErrorEntry[]): EurostatFailureKind {
  if (status === 404) return 'not_found';
  if (status === 413 || status === 414 || entries.some((e) => e.status === 413)) return 'too_large';
  if (status === 400) {
    if (entries.some((e) => e.id === 150)) return 'invalid_dimension';
    if (entries.some((e) => e.id === 140 || /\b(period|time)\b/i.test(e.label))) return 'invalid_period';
    return 'conflicting_params';
  }
  return 'rejected';
}

function describe(kind: EurostatFailureKind, status: number, entries: EurostatErrorEntry[], bodyText: string, url: string): string {
  const label = entries.map((e) => e.label).find((l) => l.trim() !== '') ?? summarizeErrorBody(bodyText);
  const detail = label ? `: ${label.length > 200 ? `${label.slice(0, 199)}…` : label}` : '';
  return `Eurostat request failed (${KIND_TEXT[kind]}, ${status}, not retried) for ${shortUrl(url)}${detail}`;
}

/** The permanent error for a non-2xx response, or null when the status is worth retrying. `bodyText` is the raw
 * response body ('' when unreadable). */
export function classifyFailedResponse(status: number, bodyText: string, url: string): EurostatPermanentError | null {
  if (isRetryableStatus(status)) return null;
  let entries: EurostatErrorEntry[] = [];
  try {
    entries = errorEntriesOf(JSON.parse(bodyText) as unknown);
  } catch {
    // not JSON: the summary falls back to the plain text
  }
  const kind = kindFor(status, entries);
  return new EurostatPermanentError(kind, status, describe(kind, status, entries, bodyText, url));
}

/** Eurostat can answer HTTP 200 with a body that is an error, not a dataset: a `warning` with status 413 (too large
 * for a synchronous reply) or an `error` entry with id 100 (no data) or a 4xx status. Returns the permanent error
 * for such a body; null for anything else (a normal dataset, or a body of another shape the parser judges). */
export function classifyOkBody(body: unknown, url: string): EurostatPermanentError | null {
  if (body === null || typeof body !== 'object') return null;
  const rec = body as Record<string, unknown>;
  // A real dataset carries its cells; an error body never does.
  if ('value' in rec || rec.class === 'dataset') return null;
  const warnings = errorEntriesOf(body, 'warning');
  const errors = errorEntriesOf(body, 'error');
  const all = [...warnings, ...errors];
  if (all.some((e) => e.status === 413)) {
    return new EurostatPermanentError('too_large', 413, describe('too_large', 413, all, '', url));
  }
  if (errors.some((e) => e.id === 100)) {
    return new EurostatPermanentError('no_results', 200, describe('no_results', 200, errors, '', url));
  }
  const status = errors.map((e) => e.status).find((s): s is number => s !== null && s >= 400 && s < 500);
  if (status !== undefined) {
    const kind = kindFor(status, errors);
    return new EurostatPermanentError(kind, status, describe(kind, status, errors, '', url));
  }
  return null;
}
