// "Eigen data" import — a Google Sheet shared as "anyone with the link can
// view". No Google login and no OAuth: we fetch Google's own public export
// URL once and store the snapshot exactly like an uploaded file (a later
// change to the sheet does not reach it — the chat says so).
//
// The only server-side fetch in the own-data tier, so the SSRF surface is
// closed by construction: the URL we call is REBUILT from a validated sheet id
// (never the user's string), only https, only docs.google.com — and each
// redirect hop (Google redirects public exports to *.googleusercontent.com)
// must land on an allow-listed Google host, or we stop. A private sheet
// redirects to accounts.google.com's sign-in: that is the "not shared" answer.
import { MAX_FILE_BYTES } from '../limits.ts';
import { CsvTooLargeError } from './csv.ts';

export interface GSheetRef {
  id: string;
  /** The tab id from `#gid=` / `?gid=`; null = the workbook's first tab. */
  gid: string | null;
}

export type GSheetFailure = 'not_shared' | 'not_found' | 'unreachable';

export class GSheetFetchError extends Error {
  reason: GSheetFailure;
  constructor(reason: GSheetFailure) {
    super(`google sheet fetch failed: ${reason}`);
    this.name = 'GSheetFetchError';
    this.reason = reason;
  }
}

const ID_RE = /^[A-Za-z0-9_-]{20,120}$/;

/** A pasted string → the sheet it points at, or null if it is not a Google
 * Sheets link. Accepts /spreadsheets/d/<id>/edit…, /view, /htmlview, /pub. */
export function parseGoogleSheetUrl(input: string): GSheetRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
  const m = /^\/spreadsheets\/(?:u\/\d+\/)?d\/(?:e\/)?([^/]+)/.exec(url.pathname);
  if (!m || !ID_RE.test(m[1]!)) return null;
  const gidRaw = url.searchParams.get('gid') ?? /(?:^|[#&])gid=(\d+)/.exec(url.hash)?.[1] ?? null;
  const gid = gidRaw !== null && /^\d{1,12}$/.test(gidRaw) ? gidRaw : null;
  return { id: m[1]!, gid };
}

function allowedHost(host: string): boolean {
  return host === 'docs.google.com' || host.endsWith('.googleusercontent.com') || host === 'googleusercontent.com';
}

/** Which export to call: a specific tab → CSV of exactly that tab; otherwise the
 * whole workbook as .xlsx (real number/date types, first tab imported). */
export function exportUrlFor(ref: GSheetRef): { url: string; format: 'csv' | 'xlsx' } {
  const base = `https://docs.google.com/spreadsheets/d/${ref.id}/export`;
  return ref.gid !== null
    ? { url: `${base}?format=csv&gid=${ref.gid}`, format: 'csv' }
    : { url: `${base}?format=xlsx`, format: 'xlsx' };
}

export async function fetchGoogleSheet(
  ref: GSheetRef,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; format: 'csv' | 'xlsx' }> {
  const { url: first, format } = exportUrlFor(ref);
  let current = first;
  for (let hop = 0; hop < 4; hop += 1) {
    const target = new URL(current);
    if (target.protocol !== 'https:' || !allowedHost(target.hostname)) throw new GSheetFetchError('not_shared');
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: { accept: '*/*' },
      });
    } catch {
      throw new GSheetFetchError('unreachable');
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new GSheetFetchError('unreachable');
      current = new URL(location, current).toString();
      continue;
    }
    if (response.status === 404) throw new GSheetFetchError('not_found');
    if (response.status === 401 || response.status === 403) throw new GSheetFetchError('not_shared');
    if (!response.ok) throw new GSheetFetchError('unreachable');
    const type = response.headers.get('content-type') ?? '';
    // A sign-in or error page instead of data.
    if (type.includes('text/html')) throw new GSheetFetchError('not_shared');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_FILE_BYTES) throw new CsvTooLargeError('het bestand is te groot');
    return { bytes: await readCapped(response), format };
  }
  throw new GSheetFetchError('unreachable');
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new GSheetFetchError('unreachable');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new CsvTooLargeError('het bestand is te groot');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
