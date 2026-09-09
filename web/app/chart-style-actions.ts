// The signed-in account default for chart styling's Server Actions (WP218
// phases 2-3, owner decision C, ADR 039). Deliberately kept to its own tiny
// file — the db client + current-user auth check + the store + the brand
// cache + the Brandfetch client + the error reporter, nothing from
// app/actions.ts's much larger graph — the same usage-actions.ts precedent,
// so that chart.tsx (a client component) importing this module never drags
// the chat pipeline's dependencies toward the client bundle. chart.tsx
// imports ONLY this file, never actions.ts.
//
// `raw` is untrusted input straight from the browser (the panel's current
// resolved.values) — sanitizeOverrides is the same allow-list every other
// overrides input goes through, so a stale/removed key or outright garbage
// can never reach the store or get persisted.
'use server';

import {
  BRAND_FETCHES_PER_MONTH,
  bumpBrandLookups,
  deleteUserChartStyle,
  recordChartStyleEvent,
  saveUserChartStyle,
  setAppliedBrand,
  sumChartStyleEventsInMonth,
} from '../backend/chart/user-styles.ts';
import { getCachedBrand, putCachedBrand } from '../backend/chart/brand-cache.ts';
import {
  fetchBrand,
  isFreeMailDomain,
  normalizeDomain,
  pickBrandColours,
  pickBrandFont,
} from '../backend/chart/brandfetch.ts';
import { currentUserEmail, currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { sanitizeOverrides } from '../lib/chart-presentation.ts';
import { reportError } from '../lib/error-report.ts';

/** The exact allow-listed shape `saveMyChartStyle`'s `brandApplied` argument
 * must have before it is forwarded to `setAppliedBrand` — `domain` re-run
 * through the same `normalizeDomain` a lookup itself uses (so a stored
 * "applied" record can never carry a domain `lookupBrand` would have
 * rejected), `name` bounded to a sane display length, `fetchedAt` the exact
 * ISO shape `Date#toISOString` produces (this field is always an echo of a
 * value THIS module emitted from `lookupBrand`, never freehand input, so a
 * tight format check costs nothing). Anything else — wrong types, an
 * unparsable domain, an out-of-range name, a non-ISO fetchedAt, or not an
 * object at all — returns null so the caller can silently ignore it rather
 * than fail the style save it rode in on. */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function parseBrandApplied(raw: unknown): { domain: string; name: string; fetchedAt: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const domain = typeof record.domain === 'string' ? normalizeDomain(record.domain) : null;
  if (domain === null) return null;

  const name = record.name;
  if (typeof name !== 'string' || name.length < 1 || name.length > 80) return null;

  const fetchedAt = record.fetchedAt;
  if (typeof fetchedAt !== 'string' || !ISO_TIMESTAMP_RE.test(fetchedAt)) return null;

  return { domain, name, fetchedAt };
}

export async function saveMyChartStyle(
  raw: unknown,
  brandApplied?: unknown,
): Promise<{ ok: true } | { ok: false; reason: 'unauthenticated' | 'unavailable' | 'too-large' | 'error' }> {
  const userId = await currentUserId();
  if (userId === null) return { ok: false, reason: 'unauthenticated' };
  try {
    const clean = sanitizeOverrides(raw);
    const result = await saveUserChartStyle(getDb(), userId, clean);
    if (result.ok) {
      const applied = parseBrandApplied(brandApplied);
      if (applied !== null) {
        await setAppliedBrand(getDb(), userId, applied);
      }
    }
    return result;
  } catch (e) {
    await reportError('saveMyChartStyle', e, { userId });
    return { ok: false, reason: 'error' };
  }
}

export async function forgetMyChartStyle(): Promise<{ ok: boolean }> {
  const userId = await currentUserId();
  if (userId === null) return { ok: false };
  try {
    const ok = await deleteUserChartStyle(getDb(), userId);
    return { ok };
  } catch (e) {
    await reportError('forgetMyChartStyle', e, { userId });
    return { ok: false };
  }
}

/** A domain segment sliced off an email's `local@domain`, normalised the
 * same way an explicit website input is — so "Person@Example.COM" and an
 * explicit "https://www.example.com" resolve to the exact same cache key.
 * Null for anything without an `@`, or whose right-hand side doesn't
 * survive `normalizeDomain` (the email-shape validity itself is Supabase's
 * concern, not this module's — an unparsable domain here just means
 * `lookupBrand` falls back to asking for a website). */
function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  return normalizeDomain(email.slice(at + 1));
}

export type LookupBrandResponse =
  | {
      ok: true;
      brand: {
        name: string;
        domain: string;
        colors: string[];
        font: { family: string; origin: 'google' | 'system' } | null;
        fetchedAt: string;
        cached: boolean;
      };
    }
  | {
      ok: false;
      reason:
        | 'unauthenticated'
        | 'unavailable'
        | 'need_website'
        | 'invalid_domain'
        | 'not_found'
        | 'rate_limited'
        | 'daily_cap'
        | 'monthly_cap'
        | 'error';
    };

/**
 * Looks up a brand's colours/fonts by domain — from an explicit `rawWebsite`
 * when given, otherwise from the signed-in account's own signup email
 * (skipped for a free-mail provider, which identifies the mail host, not
 * the user's employer). Key-gated (`BRANDFETCH_API_KEY` absent →
 * `unavailable`, checked BEFORE any cache/DB work), cache-first (a hit
 * never touches the per-user daily cap — only a real Brandfetch call does),
 * and cap-gated on a miss (`bumpBrandLookups`, `BRAND_LOOKUPS_PER_DAY` —
 * user-styles.ts). `setAppliedBrand` is deliberately NOT called here —
 * looking a brand up is not the same as applying it; that's
 * `saveMyChartStyle`'s `brandApplied` argument, a separate, later, client
 * decision. Never throws: every path — including an unexpected rejection
 * from any dependency — resolves to a typed `{ ok: false, reason }`.
 */
export async function lookupBrand(rawWebsite?: unknown): Promise<LookupBrandResponse> {
  let userId: string | null = null;
  try {
    userId = await currentUserId();
    if (userId === null) return { ok: false, reason: 'unauthenticated' };

    const apiKey = process.env.BRANDFETCH_API_KEY;
    if (!apiKey) return { ok: false, reason: 'unavailable' };

    let domain: string;
    if (typeof rawWebsite === 'string' && rawWebsite !== '') {
      const normalized = normalizeDomain(rawWebsite);
      if (normalized === null) return { ok: false, reason: 'invalid_domain' };
      domain = normalized;
    } else {
      const email = await currentUserEmail();
      const emailDomain = email === null ? null : domainFromEmail(email);
      if (emailDomain === null || isFreeMailDomain(emailDomain)) {
        return { ok: false, reason: 'need_website' };
      }
      domain = emailDomain;
    }

    const db = getDb();
    const now = new Date();

    // Cache first — a hit never touches the daily cap (only a real
    // Brandfetch call does). Final-review fix: report the CACHE ROW's own
    // fetchedAt, not `now` — a cache hit can be up to BRAND_CACHE_TTL_DAYS
    // old, and this value rides through onBrandApplied → lastAppliedBrand
    // → saveMyChartStyle's brandApplied argument into the persisted
    // `brand.applied` column, so stamping `now` here would misreport a
    // 29-day-old cached payload as "fetched today".
    const cacheHit = await getCachedBrand(db, domain, now);
    if (cacheHit !== null) {
      return {
        ok: true,
        brand: {
          name: cacheHit.brand.name,
          domain,
          colors: pickBrandColours(cacheHit.brand),
          font: pickBrandFont(cacheHit.brand),
          fetchedAt: cacheHit.fetchedAt,
          cached: true,
        },
      };
    }

    // Global monthly cap (owner decision 2026-09-09), checked BEFORE the
    // per-user daily cap and BEFORE any fetch: `null` means the counter
    // table is absent, so the cap cannot be enforced — fail closed rather
    // than let a paid call through uncounted, same discipline the rest of
    // this module's absent-table paths already follow.
    const used = await sumChartStyleEventsInMonth(db, 'brand_fetch', now);
    if (used === null || used >= BRAND_FETCHES_PER_MONTH) {
      return { ok: false, reason: 'monthly_cap' };
    }

    // Same UTC YYYY-MM-DD convention recordChartStyleEvent uses, computed
    // once from the single `now` this call already has.
    const today = now.toISOString().slice(0, 10);
    const bump = await bumpBrandLookups(db, userId, today);
    if (!bump.allowed) return { ok: false, reason: 'daily_cap' };

    // Counted right before the real call, not after: a failed Brandfetch
    // call still counts against the monthly cap — it was already billed.
    await recordChartStyleEvent(db, 'brand_fetch', now);
    const fetchResult = await fetchBrand(domain, { apiKey });
    if (!fetchResult.ok) {
      if (fetchResult.reason === 'unauthorized') {
        // A bad key is an operational problem, not a normal refusal — the
        // owner needs to see this, never just the caller.
        await reportError('lookupBrand', new Error('Brandfetch rejected the API key (unauthorized)'), {
          userId,
          extra: { domain },
        });
        return { ok: false, reason: 'unavailable' };
      }
      return { ok: false, reason: fetchResult.reason };
    }

    await putCachedBrand(db, domain, fetchResult.brand, now);

    return {
      ok: true,
      brand: {
        name: fetchResult.brand.name,
        domain,
        colors: pickBrandColours(fetchResult.brand),
        font: pickBrandFont(fetchResult.brand),
        fetchedAt: now.toISOString(),
        cached: false,
      },
    };
  } catch (e) {
    await reportError('lookupBrand', e, { userId });
    return { ok: false, reason: 'error' };
  }
}
