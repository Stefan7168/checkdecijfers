// src/chart/brand-cache.ts — the domain-keyed brand cache (migration 029,
// WP218 phase 3, ADR 039). Hermetic (PGlite). The load-bearing properties:
// a stored row is NEVER trusted blindly (re-parsed through
// `parseBrandPayload` on every read), a row older than the 30-day TTL reads
// back as absent (Brandfetch's own terms), `putCachedBrand`'s opportunistic
// purge, and every reader/writer degrades instead of throwing when the
// table is gone.
import { describe, expect, it } from 'vitest';
import {
  BRAND_CACHE_TTL_DAYS,
  getCachedBrand,
  putCachedBrand,
  purgeExpiredBrandCache,
} from '../../src/chart/brand-cache.ts';
import type { BrandInfo } from '../../src/chart/brandfetch.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

const SAMPLE_BRAND: BrandInfo = {
  name: 'Example BV',
  domain: 'example.com',
  colors: [
    { hex: '#112233', type: 'brand' },
    { hex: '#445566', type: 'accent' },
  ],
  fonts: [
    { family: 'Roboto', role: 'body', origin: 'google' },
    { family: 'Merriweather', role: 'title', origin: 'google' },
  ],
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('getCachedBrand / putCachedBrand', () => {
  it('is a miss for a domain never put', async () => {
    await withDb(async (db) => {
      expect(await getCachedBrand(db, 'example.com', new Date())).toBeNull();
    });
  });

  it('put then get round-trips the full brand, including fonts, alongside the row\'s own fetchedAt', async () => {
    await withDb(async (db) => {
      const now = new Date('2026-09-09T12:00:00.000Z');
      await putCachedBrand(db, 'example.com', SAMPLE_BRAND, now);

      expect(await getCachedBrand(db, 'example.com', now)).toEqual({
        brand: SAMPLE_BRAND,
        fetchedAt: now.toISOString(),
      });
    });
  });

  it('a cache hit reports the STORED fetched_at, not the read-time `now` (final-review fix)', async () => {
    await withDb(async (db) => {
      const storedAt = new Date('2026-08-15T00:00:00.000Z');
      await putCachedBrand(db, 'example.com', SAMPLE_BRAND, storedAt);

      const readAt = new Date('2026-09-09T12:00:00.000Z');
      const result = await getCachedBrand(db, 'example.com', readAt);

      expect(result?.fetchedAt).toBe(storedAt.toISOString());
      expect(result?.fetchedAt).not.toBe(readAt.toISOString());
    });
  });

  it('a row exactly at the TTL boundary is still a hit; one second older is a miss', async () => {
    await withDb(async (db) => {
      const fetchedAt = new Date('2026-01-01T00:00:00.000Z');
      await putCachedBrand(db, 'example.com', SAMPLE_BRAND, fetchedAt);

      const atBoundary = new Date(fetchedAt.getTime() + BRAND_CACHE_TTL_DAYS * MS_PER_DAY);
      expect(await getCachedBrand(db, 'example.com', atBoundary)).toEqual({
        brand: SAMPLE_BRAND,
        fetchedAt: fetchedAt.toISOString(),
      });

      const pastBoundary = new Date(atBoundary.getTime() + 1000);
      expect(await getCachedBrand(db, 'example.com', pastBoundary)).toBeNull();
    });
  });

  it('a junk stored payload reads back as null instead of throwing', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into brand_cache (domain, payload, fetched_at) values ($1, $2::jsonb, now())`,
        ['junk.example', JSON.stringify({ nope: true })],
      );
      expect(await getCachedBrand(db, 'junk.example', new Date())).toBeNull();
    });
  });

  it('put upserts — a second put on the same domain replaces the payload and refreshes fetched_at, leaving one row', async () => {
    await withDb(async (db) => {
      const first = new Date('2026-01-01T00:00:00.000Z');
      await putCachedBrand(db, 'example.com', SAMPLE_BRAND, first);

      const updated: BrandInfo = { ...SAMPLE_BRAND, name: 'Renamed BV' };
      const second = new Date('2026-02-01T00:00:00.000Z');
      await putCachedBrand(db, 'example.com', updated, second);

      expect(await getCachedBrand(db, 'example.com', second)).toEqual({
        brand: updated,
        fetchedAt: second.toISOString(),
      });

      const { rows } = await db.query('select domain from brand_cache', []);
      expect(rows).toHaveLength(1);
    });
  });
});

describe('purgeExpiredBrandCache', () => {
  it('deletes only rows older than the TTL and returns the count', async () => {
    await withDb(async (db) => {
      await db.query(`insert into brand_cache (domain, payload, fetched_at) values ($1, $2::jsonb, $3)`, [
        'old.example',
        '{}',
        '2020-01-01T00:00:00.000Z',
      ]);
      await db.query(`insert into brand_cache (domain, payload, fetched_at) values ($1, $2::jsonb, $3)`, [
        'fresh.example',
        '{}',
        '2026-09-01T00:00:00.000Z',
      ]);

      const deleted = await purgeExpiredBrandCache(db, new Date('2026-09-01T00:00:00.000Z'));
      expect(deleted).toBe(1);

      const { rows } = await db.query('select domain from brand_cache order by domain', []);
      expect(rows.map((r) => r.domain)).toEqual(['fresh.example']);
    });
  });

  it('putCachedBrand opportunistically purges expired rows on every call', async () => {
    await withDb(async (db) => {
      await db.query(`insert into brand_cache (domain, payload, fetched_at) values ($1, $2::jsonb, $3)`, [
        'stale.example',
        '{}',
        '2020-01-01T00:00:00.000Z',
      ]);

      await putCachedBrand(db, 'new.example', SAMPLE_BRAND, new Date('2026-09-01T00:00:00.000Z'));

      const { rows } = await db.query('select domain from brand_cache order by domain', []);
      expect(rows.map((r) => r.domain)).toEqual(['new.example']);
    });
  });
});

describe('absent-table degrade', () => {
  it('every brand_cache reader/writer degrades instead of throwing when the table is gone', async () => {
    await withDb(async (db) => {
      await db.query('drop table if exists brand_cache cascade', []);

      await expect(getCachedBrand(db, 'example.com', new Date())).resolves.toBeNull();
      await expect(putCachedBrand(db, 'example.com', SAMPLE_BRAND, new Date())).resolves.toBeUndefined();
      await expect(purgeExpiredBrandCache(db, new Date())).resolves.toBe(0);
    });
  });
});
