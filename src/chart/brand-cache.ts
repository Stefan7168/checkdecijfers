// src/chart/brand-cache.ts — domain-keyed brand cache (migration 029, WP218
// phase 3, ADR 039). Caches a Brandfetch lookup's result so the per-user
// daily lookup cap (user-styles.ts's bumpBrandLookups) and repeat visits to
// the same company domain don't re-hit Brandfetch's paid API. FILE-ONLY
// until the migration's supervised apply (see 029_brand_cache.sql's own
// header) — every function here degrades instead of throwing when the
// table doesn't exist yet, mirroring user-styles.ts's
// to_regclass-check-plus-42P01-catch discipline for the same
// deploy-window problem.
//
// `brand_cache` has no user column (not personal data — see the migration
// header), so unlike user_chart_styles it needs no retention-job leg; the
// table stays small on its own via `purgeExpiredBrandCache`, called
// opportunistically from every `putCachedBrand` rather than needing its own
// cron leg.
//
// A stored row is NEVER trusted blindly: `getCachedBrand` re-runs the
// payload through `parseBrandPayload` — the same tolerant parser
// `fetchBrand` itself uses — on every read, so a corrupted or hand-edited
// row degrades to null instead of handing a caller a bad shape. Because
// `parseBrandPayload` parses Brandfetch's OWN raw response shape (a font
// entry's family/role live under `name`/`type` there, not this module's
// `BrandInfo.fonts[].family`/`role`), `putCachedBrand` stores a payload
// shaped like that raw response (`toStorablePayload`) rather than a literal
// dump of the `BrandInfo` it's given — storing a literal `BrandInfo` and
// re-parsing it verbatim would silently lose every font on read
// (`parseBrandPayload` looks for `record.name`, which a `{family, role,
// origin}` object never has). The mapping is idempotent for any value
// `parseBrandPayload` could itself have produced: an 'other' colour type,
// an 'other' font role, or a 'custom' font origin all fall back to those
// exact same values on the way back in, so a round trip through this cache
// never drifts from what was put in.
import type { Db } from '../db/types.ts';
import { parseBrandPayload, type BrandInfo } from './brandfetch.ts';

export const BRAND_CACHE_TTL_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Postgres's SQLSTATE for "relation does not exist" — the race-window
 * fallback behind the to_regclass check below (see module header; the
 * identical user-styles.ts precedent). */
const UNDEFINED_TABLE = '42P01';

function isUndefinedTableError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === UNDEFINED_TABLE
  );
}

/** `to_regclass` existence check for `brand_cache` — a check, not a catch,
 * so a real failure (permissions, pool exhaustion) still propagates instead
 * of being silently reported as "no table". */
async function brandCacheTablePresent(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.brand_cache') as t`, []);
  return rows[0]?.t != null;
}

/** jsonb column → plain value (the user-styles.ts `decodeJsonb` precedent —
 * pg and PGlite both return a parsed object for a jsonb select; a string
 * fallback keeps this driver-agnostic). */
function decodeJsonb(raw: unknown): unknown {
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/** See the module header's "never trust blindly" note: converts a
 * `BrandInfo` into the shape `parseBrandPayload` expects on the way back
 * in — the raw Brandfetch API's own field names for colours (already
 * identical: `hex`/`type`) and fonts (`name`/`type`, not `family`/`role`). */
function toStorablePayload(brand: BrandInfo): Record<string, unknown> {
  return {
    name: brand.name,
    colors: brand.colors.map((c) => ({ hex: c.hex, type: c.type })),
    fonts: brand.fonts.map((f) => ({ name: f.family, type: f.role, origin: f.origin })),
  };
}

/** `BRAND_CACHE_TTL_DAYS` before `now` — a row with `fetched_at` older than
 * this is treated as absent by `getCachedBrand` and removed by
 * `purgeExpiredBrandCache`; both use this exact same cutoff so the two can
 * never disagree about which rows are expired. */
function ttlCutoff(now: Date): Date {
  return new Date(now.getTime() - BRAND_CACHE_TTL_DAYS * MS_PER_DAY);
}

/**
 * Reads a cached brand lookup for `domain`. Null when: no row exists, the
 * row's `fetched_at` is older than `BRAND_CACHE_TTL_DAYS` (Brandfetch's own
 * terms — the migration comment's "kept ≤ 30 days"; a row exactly at the
 * boundary still counts as fresh), the stored payload no longer parses as a
 * brand (see module header), or the table doesn't exist yet.
 *
 * Returns the row's OWN `fetched_at` alongside the brand (final-review
 * fix): a cache hit on a 29-day-old row is still a hit, but the caller must
 * report ITS real age, not the moment of this read — `lookupBrand` used to
 * discard this value and stamp `now` instead, so a stale-but-fresh-enough
 * cached lookup could claim "fetched today" all the way into the persisted
 * `brand.applied` provenance.
 */
export async function getCachedBrand(
  db: Db,
  domain: string,
  now: Date,
): Promise<{ brand: BrandInfo; fetchedAt: string } | null> {
  if (!(await brandCacheTablePresent(db))) return null;
  try {
    const { rows } = await db.query(`select payload, fetched_at from brand_cache where domain = $1`, [
      domain,
    ]);
    const row = rows[0];
    if (row === undefined) return null;

    const fetchedAt = row.fetched_at instanceof Date ? row.fetched_at : new Date(String(row.fetched_at));
    if (fetchedAt.getTime() < ttlCutoff(now).getTime()) return null;

    const brand = parseBrandPayload(decodeJsonb(row.payload), domain);
    if (brand === null) return null;
    return { brand, fetchedAt: fetchedAt.toISOString() };
  } catch (err) {
    if (isUndefinedTableError(err)) return null;
    throw err;
  }
}

/**
 * Upserts a brand lookup result for `domain`, then opportunistically purges
 * rows older than the TTL (see module header — cheap, keeps the table
 * small, no cron leg needed since this isn't personal data). Silent no-op
 * when the table doesn't exist yet.
 */
export async function putCachedBrand(db: Db, domain: string, brand: BrandInfo, now: Date): Promise<void> {
  if (!(await brandCacheTablePresent(db))) return;
  try {
    await db.query(
      `insert into brand_cache (domain, payload, fetched_at)
       values ($1, $2::jsonb, $3)
       on conflict (domain) do update set payload = excluded.payload, fetched_at = excluded.fetched_at`,
      [domain, JSON.stringify(toStorablePayload(brand)), now.toISOString()],
    );
  } catch (err) {
    if (isUndefinedTableError(err)) return;
    throw err;
  }
  await purgeExpiredBrandCache(db, now);
}

/**
 * Deletes every row whose `fetched_at` is older than the TTL, returning how
 * many were removed. Called opportunistically by `putCachedBrand`; safe to
 * call on its own too. Never throws for an absent table — resolves to 0.
 */
export async function purgeExpiredBrandCache(db: Db, now: Date): Promise<number> {
  if (!(await brandCacheTablePresent(db))) return 0;
  try {
    const { rows } = await db.query(`delete from brand_cache where fetched_at < $1 returning domain`, [
      ttlCutoff(now).toISOString(),
    ]);
    return rows.length;
  } catch (err) {
    if (isUndefinedTableError(err)) return 0;
    throw err;
  }
}
