// src/chart/brandfetch.ts — Brandfetch Brand API client (WP218 phase 3, Task
// 1 of the phase-3 plan; research: .superpowers/sdd/brandfetch-research.md).
// Looks up a company's brand colours + fonts by domain so a user can seed
// their saved chart style (src/chart/user-styles.ts, migration 028) from
// their own company's brand instead of picking colours by hand. This file is
// the pure domain-rule layer + a single typed fetch client only — no DB, no
// API route, no wiring into the chart module's own `index.ts` surface (a
// later phase-3 task owns that); `src/` never imports from `web/`.
//
// Design notes:
// - `fetchBrand` NEVER throws: every failure path (an invalid domain, any
//   non-2xx HTTP status, a network error, a JSON-parse error, a
//   synchronously-throwing `fetchImpl`, a request that exceeds `timeoutMs`)
//   comes back as a typed `{ ok: false, reason }` instead of a rejected
//   promise. A brand lookup is a "nice to have" seed for a styling panel,
//   never something the rest of the app needs to wrap in a try/catch.
// - `parseBrandPayload` is deliberately TOLERANT, not a strict schema gate:
//   an unrecognised colour `type` becomes 'other' rather than rejecting the
//   whole payload, a malformed hex is dropped rather than kept broken, and a
//   missing/non-array `colors` or `fonts` becomes `[]`. Brandfetch's real
//   response carries many more fields (logos, company info, quality score,
//   claimed status, ...) that this module ignores entirely — see the
//   research file for the fuller schema.
// - Endpoint form (UNCONFIRMED — see the phase-3 Task 1 report): the
//   research file found TWO domain-lookup URL forms in Brandfetch's own
//   docs — `/v2/brands/domain/{domain}` (the form the research file calls
//   "confirmed" for domain lookups) and the more general auto-detect route
//   `/v2/brands/{identifier}` (identifier can be a domain, email, ticker,
//   ISIN, ... — resolved in that order). This file keeps the task brief's
//   literal constant (the auto-detect form) rather than silently switching
//   to the other one; a live-key smoke test against both forms is the real
//   tie-breaker, tracked as a follow-up rather than guessed here.
import { z } from 'zod';

export interface BrandInfo {
  name: string;
  domain: string;
  colors: { hex: string; type: 'brand' | 'accent' | 'dark' | 'light' | 'other' }[];
  fonts: { family: string; role: 'title' | 'body' | 'other'; origin: 'google' | 'custom' | 'system' }[];
}

export type BrandLookupFailure =
  | 'not_found'
  | 'unauthorized'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_domain';

export type BrandLookupResult = { ok: true; brand: BrandInfo } | { ok: false; reason: BrandLookupFailure };

// See the "Endpoint form" design note above — kept as the brief specifies;
// flagged UNCONFIRMED in the phase-3 Task 1 report.
export const BRANDFETCH_ENDPOINT = 'https://api.brandfetch.io/v2/brands/';

const MAX_DOMAIN_LENGTH = 253;
const DOMAIN_CHARS_RE = /^[a-z0-9.-]+$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * A plain hostname, nothing else. Strips a leading scheme, any userinfo, a
 * path/query/fragment, a trailing port, and a leading "www.", then lowercases
 * and validates what's left. Returns null for anything that isn't a
 * deliverable public-looking hostname: no scheme/path/port residue, no
 * internal whitespace, not "localhost", not an IPv4/IPv6 literal, at least
 * one dot, at most 253 characters, only `[a-z0-9.-]`, and no label (the whole
 * string or any dot-separated segment) starting or ending with a hyphen, nor
 * starting or ending with a dot.
 */
export function normalizeDomain(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  if (/\s/.test(input)) return null;

  let value = input;

  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(value);
  if (schemeMatch) value = value.slice(schemeMatch[0].length);

  // Drop path/query/fragment.
  const cutIndex = value.search(/[/?#]/);
  if (cutIndex !== -1) value = value.slice(0, cutIndex);

  // Drop userinfo ("user:pass@host").
  const atIndex = value.lastIndexOf('@');
  if (atIndex !== -1) value = value.slice(atIndex + 1);

  // A bracketed IPv6 literal ("[::1]" or "[::1]:8080") — reject outright.
  if (value.startsWith('[')) return null;

  // A trailing ":<digits>" is a port, stripped; any other colon (an
  // unbracketed IPv6 literal, or garbage) is rejected.
  const colonIndex = value.indexOf(':');
  if (colonIndex !== -1) {
    const rest = value.slice(colonIndex + 1);
    if (!/^\d+$/.test(rest)) return null;
    value = value.slice(0, colonIndex);
  }

  value = value.toLowerCase();
  if (value.startsWith('www.')) value = value.slice(4);

  if (value === '' || value === 'localhost') return null;
  if (value.length > MAX_DOMAIN_LENGTH) return null;
  if (!DOMAIN_CHARS_RE.test(value)) return null;
  if (!value.includes('.')) return null;
  if (value.startsWith('.') || value.endsWith('.')) return null;
  if (value.startsWith('-') || value.endsWith('-')) return null;
  if (IPV4_RE.test(value)) return null;

  for (const label of value.split('.')) {
    if (label === '' || label.startsWith('-') || label.endsWith('-')) return null;
  }

  return value;
}

/** Consumer free-mail providers — a brand lookup on one of these identifies
 * the mail provider, never the user's own employer, so a caller should skip
 * the Brandfetch call entirely when the signup domain is one of these. */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.nl',
  'outlook.com',
  'live.nl',
  'live.com',
  'yahoo.com',
  'yahoo.nl',
  'icloud.com',
  'me.com',
  'ziggo.nl',
  'kpnmail.nl',
  'kpnplanet.nl',
  'home.nl',
  'casema.nl',
  'hetnet.nl',
  'planet.nl',
  'xs4all.nl',
  'protonmail.com',
  'proton.me',
  'mail.com',
  'gmx.com',
  'gmx.net',
];

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.includes(domain.toLowerCase());
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Validates + normalises a hex colour string: lowercased, short `#abc` form
 * expanded to `#aabbcc`. Anything else (wrong length, non-hex characters, not
 * a string at all) returns null so the caller can drop the entry. */
function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = HEX_COLOR_RE.exec(raw.trim());
  if (match === null) return null;
  let digits = match[1].toLowerCase();
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return `#${digits}`;
}

const colorTypeSchema = z.enum(['brand', 'accent', 'dark', 'light']);
const fontRoleSchema = z.enum(['title', 'body']);
const fontOriginSchema = z.enum(['google', 'system']);

function parseColorType(value: unknown): BrandInfo['colors'][number]['type'] {
  const result = colorTypeSchema.safeParse(value);
  return result.success ? result.data : 'other';
}

function parseFontRole(value: unknown): BrandInfo['fonts'][number]['role'] {
  const result = fontRoleSchema.safeParse(value);
  return result.success ? result.data : 'other';
}

function parseFontOrigin(value: unknown): BrandInfo['fonts'][number]['origin'] {
  const result = fontOriginSchema.safeParse(value);
  return result.success ? result.data : 'custom';
}

/** Just enough top-level shape to reject junk outright: an object with a
 * non-empty `name`. Everything else (colors/fonts) is read straight off the
 * raw object below so each array entry can be tolerated or dropped
 * independently — a single nested zod schema would reject the WHOLE payload
 * on one bad entry, which is the opposite of what a tolerant parser is for. */
const brandNameSchema = z.object({ name: z.string().min(1) });

/**
 * Parses a raw Brandfetch Brand API response into this module's own
 * `BrandInfo` shape. Tolerant by design (see the module header): an unknown
 * colour `type` becomes 'other', an unparsable hex is dropped (not kept
 * broken), a missing or non-array `colors`/`fonts` becomes `[]`, hex values
 * are lowercased and the short `#abc` form is expanded to `#aabbcc`. Returns
 * null only when the payload isn't recognisable as a brand at all (not an
 * object, or no non-empty `name`).
 */
export function parseBrandPayload(json: unknown, domain: string): BrandInfo | null {
  const parsedName = brandNameSchema.safeParse(json);
  if (!parsedName.success) return null;

  const raw = json as Record<string, unknown>;

  const colors: BrandInfo['colors'] = [];
  if (Array.isArray(raw.colors)) {
    for (const entry of raw.colors) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const hex = normalizeHex(record.hex);
      if (hex === null) continue;
      colors.push({ hex, type: parseColorType(record.type) });
    }
  }

  const fonts: BrandInfo['fonts'] = [];
  if (Array.isArray(raw.fonts)) {
    for (const entry of raw.fonts) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const family = record.name;
      if (typeof family !== 'string' || family.trim() === '') continue;
      fonts.push({
        family,
        role: parseFontRole(record.type),
        origin: parseFontOrigin(record.origin),
      });
    }
  }

  return { name: parsedName.data.name, domain, colors, fonts };
}

const COLOR_TYPE_ORDER: BrandInfo['colors'][number]['type'][] = [
  'brand',
  'accent',
  'dark',
  'light',
  'other',
];
const MAX_PICKED_COLOURS = 8;

/** Flattens a brand's colours into the hex list a styling panel offers, in a
 * fixed priority order (brand → accent → dark → light → other), de-duplicated
 * by hex and capped at 8 — a palette a person can actually scan, not the raw
 * (often much longer) Brandfetch list. */
export function pickBrandColours(brand: BrandInfo): string[] {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const type of COLOR_TYPE_ORDER) {
    for (const color of brand.colors) {
      if (color.type !== type || seen.has(color.hex)) continue;
      seen.add(color.hex);
      picked.push(color.hex);
      if (picked.length >= MAX_PICKED_COLOURS) return picked;
    }
  }
  return picked;
}

const FONT_FAMILY_RE = /^[A-Za-z0-9 ]{1,40}$/;
const FONT_LADDER: { role: 'body' | 'title'; origin: 'google' | 'system' }[] = [
  { role: 'body', origin: 'google' },
  { role: 'title', origin: 'google' },
  { role: 'body', origin: 'system' },
  { role: 'title', origin: 'system' },
];

/** Picks the ONE font a styling panel would offer to apply, walking a fixed
 * preference ladder (body before title, google before system). A
 * custom-hosted font is always skipped (there is no way to actually load it
 * client-side from this data alone), and a family name outside
 * `/^[A-Za-z0-9 ]{1,40}$/` is skipped too (kept out of any CSS `font-family`
 * value later built from it). Returns null when nothing on the ladder
 * matches. */
export function pickBrandFont(brand: BrandInfo): { family: string; origin: 'google' | 'system' } | null {
  for (const step of FONT_LADDER) {
    const match = brand.fonts.find(
      (font) => font.role === step.role && font.origin === step.origin && FONT_FAMILY_RE.test(font.family),
    );
    if (match !== undefined) return { family: match.family, origin: step.origin };
  }
  return null;
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Looks up a domain's brand colours/fonts from the Brandfetch Brand API.
 * NEVER throws: every failure — an invalid domain, any non-2xx HTTP status,
 * a network error, a JSON-parse error, a synchronously-throwing `fetchImpl`,
 * or a request that exceeds `timeoutMs` — comes back as a typed
 * `{ ok: false, reason }` instead of a rejected promise.
 */
export async function fetchBrand(
  domain: string,
  deps: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<BrandLookupResult> {
  const normalized = normalizeDomain(domain);
  if (normalized === null) return { ok: false, reason: 'invalid_domain' };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${BRANDFETCH_ENDPOINT}${normalized}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (response.status === 404) return { ok: false, reason: 'not_found' };
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'unauthorized' };
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (!response.ok) return { ok: false, reason: 'unavailable' };

    const json: unknown = await response.json();
    const brand = parseBrandPayload(json, normalized);
    return brand === null ? { ok: false, reason: 'unavailable' } : { ok: true, brand };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
