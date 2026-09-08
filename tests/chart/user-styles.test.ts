// src/chart/user-styles.ts — the user chart-style store + anonymous usage
// counter (migration 028, WP218 phases 2+6, ADR 039). Hermetic (PGlite).
// The load-bearing properties: every read/write degrades (never throws)
// when its table is absent, the 4000-char JSON cap on `style`, day-bucketed
// counting for the usage table, and the purge/count pair reporting the
// exact same rows.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  chartStyleRetentionCutoff,
  chartStylesTablePresent,
  countPurgeableChartStyles,
  deleteUserChartStyle,
  getUserChartStyle,
  purgeExpiredChartStyles,
  recordChartStyleEvent,
  saveUserChartStyle,
  USER_CHART_STYLE_MAX_JSON,
} from '../../src/chart/user-styles.ts';
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

interface UsageRow {
  event: string;
  day: string;
  count: number;
}

async function usageRows(db: Db): Promise<UsageRow[]> {
  const { rows } = await db.query(
    'select event, day, count from chart_style_usage order by day, event',
    [],
  );
  return rows.map((r) => {
    const day = (r as { day: unknown }).day;
    return {
      event: String((r as { event: unknown }).event),
      day: day instanceof Date ? day.toISOString().slice(0, 10) : String(day),
      count: Number((r as { count: unknown }).count),
    };
  });
}

describe('getUserChartStyle / saveUserChartStyle / deleteUserChartStyle', () => {
  it('the table exists in a fresh test db, and an unknown user has no style', async () => {
    await withDb(async (db) => {
      expect(await chartStylesTablePresent(db)).toBe(true);
      expect(await getUserChartStyle(db, randomUUID())).toBeNull();
    });
  });

  it('saves then reads back the style, leaving brand untouched (null)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const style = { theme: 'dark', colors: ['#111111', '#222222'] };

      const result = await saveUserChartStyle(db, userId, style);
      expect(result).toEqual({ ok: true });

      const row = await getUserChartStyle(db, userId);
      expect(row).not.toBeNull();
      expect(row!.style).toEqual(style);
      expect(row!.brand).toBeNull();
      expect(typeof row!.updatedAt).toBe('string');
    });
  });

  it('saving again overwrites the style and bumps updated_at', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await saveUserChartStyle(db, userId, { theme: 'light' });
      // Push updated_at into the deep past so the bump below is unambiguous
      // regardless of how fast the two saves run (the purge test below uses
      // the same direct-UPDATE technique).
      await db.query(
        `update user_chart_styles set updated_at = '2000-01-01T00:00:00.000Z' where user_id = $1`,
        [userId],
      );
      const before = await getUserChartStyle(db, userId);
      expect(before!.updatedAt.startsWith('2000-01-01')).toBe(true);

      const result = await saveUserChartStyle(db, userId, { theme: 'dark' });
      expect(result).toEqual({ ok: true });

      const after = await getUserChartStyle(db, userId);
      expect(after!.style).toEqual({ theme: 'dark' });
      expect(after!.updatedAt.startsWith('2000-01-01')).toBe(false);
    });
  });

  it('rejects a style whose JSON exceeds the cap, writing nothing', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const big = { note: 'a'.repeat(USER_CHART_STYLE_MAX_JSON) };
      expect(JSON.stringify(big).length).toBeGreaterThan(USER_CHART_STYLE_MAX_JSON);

      const result = await saveUserChartStyle(db, userId, big);
      expect(result).toEqual({ ok: false, reason: 'too-large' });
      expect(await getUserChartStyle(db, userId)).toBeNull();
    });
  });

  it('deletes a saved style, returning true then false', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await saveUserChartStyle(db, userId, { theme: 'dark' });

      expect(await deleteUserChartStyle(db, userId)).toBe(true);
      expect(await deleteUserChartStyle(db, userId)).toBe(false);
      expect(await getUserChartStyle(db, userId)).toBeNull();
    });
  });
});

describe('recordChartStyleEvent', () => {
  it('counts two events on the same day as one row with count 2', async () => {
    await withDb(async (db) => {
      await recordChartStyleEvent(db, 'panel_open', new Date('2026-01-01T08:00:00.000Z'));
      await recordChartStyleEvent(db, 'panel_open', new Date('2026-01-01T20:00:00.000Z'));

      expect(await usageRows(db)).toEqual([{ event: 'panel_open', day: '2026-01-01', count: 2 }]);
    });
  });

  it('counts a different day as a separate row', async () => {
    await withDb(async (db) => {
      await recordChartStyleEvent(db, 'option_changed', new Date('2026-01-01T00:00:00.000Z'));
      await recordChartStyleEvent(db, 'option_changed', new Date('2026-01-02T00:00:00.000Z'));

      expect(await usageRows(db)).toEqual([
        { event: 'option_changed', day: '2026-01-01', count: 1 },
        { event: 'option_changed', day: '2026-01-02', count: 1 },
      ]);
    });
  });
});

describe('chartStyleRetentionCutoff / countPurgeableChartStyles / purgeExpiredChartStyles', () => {
  it('chartStyleRetentionCutoff is the shared two-year window', () => {
    const now = new Date('2026-09-09T00:00:00.000Z');
    expect(chartStyleRetentionCutoff(now)).toEqual(new Date('2024-09-09T00:00:00.000Z'));
  });

  it('counts and purges only rows older than the cutoff, and count/purge agree', async () => {
    await withDb(async (db) => {
      const oldUser = randomUUID();
      const freshUser = randomUUID();
      await saveUserChartStyle(db, oldUser, { theme: 'dark' });
      await saveUserChartStyle(db, freshUser, { theme: 'light' });
      await db.query(`update user_chart_styles set updated_at = $1 where user_id = $2`, [
        '2020-01-01T00:00:00.000Z',
        oldUser,
      ]);

      const cutoff = new Date('2024-01-01T00:00:00.000Z');
      expect(await countPurgeableChartStyles(db, cutoff)).toEqual([{ userId: oldUser }]);

      expect(await purgeExpiredChartStyles(db, cutoff)).toEqual([{ userId: oldUser }]);

      expect(await getUserChartStyle(db, oldUser)).toBeNull();
      expect(await getUserChartStyle(db, freshUser)).not.toBeNull();
    });
  });
});

describe('absent-table degrade', () => {
  it('every user_chart_styles reader/writer degrades instead of throwing when the table is gone', async () => {
    await withDb(async (db) => {
      await db.query('drop table if exists user_chart_styles cascade', []);

      expect(await chartStylesTablePresent(db)).toBe(false);
      expect(await getUserChartStyle(db, randomUUID())).toBeNull();
      expect(await saveUserChartStyle(db, randomUUID(), { theme: 'dark' })).toEqual({
        ok: false,
        reason: 'unavailable',
      });
      expect(await deleteUserChartStyle(db, randomUUID())).toBe(false);
      expect(await countPurgeableChartStyles(db, new Date())).toEqual([]);
      expect(await purgeExpiredChartStyles(db, new Date())).toEqual([]);
    });
  });

  it('recordChartStyleEvent resolves without throwing when chart_style_usage is gone', async () => {
    await withDb(async (db) => {
      await db.query('drop table if exists chart_style_usage cascade', []);

      await expect(
        recordChartStyleEvent(db, 'panel_open', new Date('2026-01-01T00:00:00.000Z')),
      ).resolves.toBeUndefined();
    });
  });
});
