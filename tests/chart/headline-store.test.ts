import { describe, expect, it } from 'vitest';
import {
  CHART_HEADLINE_MAX_LENGTH,
  getChartHeadlinePublic,
  getOwnChartHeadline,
  normalizeHeadlineText,
  upsertChartHeadline,
} from '../../src/chart/headline-store.ts';
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

async function insertAuditRow(
  db: Db,
  opts: { userId: string | null; kind?: string; chartEmitted?: boolean; sourceTag?: string },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, chart_emitted)
     values (1, $1, $2, $3, 'q', '2026-01-01', '{}'::jsonb, 'a', '{}'::jsonb, 100, $4)
     returning id`,
    [opts.userId, opts.sourceTag ?? 'user', opts.kind ?? 'answer', opts.chartEmitted ?? true],
  );
  return Number(rows[0]!.id);
}

describe('normalizeHeadlineText', () => {
  it('trims, nulls empties, caps at the max length', () => {
    expect(normalizeHeadlineText(undefined)).toBeNull();
    expect(normalizeHeadlineText(null)).toBeNull();
    expect(normalizeHeadlineText('   ')).toBeNull();
    expect(normalizeHeadlineText('  Werkloosheid daalt  ')).toBe('Werkloosheid daalt');
    expect(normalizeHeadlineText('x'.repeat(CHART_HEADLINE_MAX_LENGTH + 50))).toHaveLength(CHART_HEADLINE_MAX_LENGTH);
  });
});

describe('upsertChartHeadline — the guarded write', () => {
  it("writes the caller's headline on their own chart-bearing answer, and upserts on edit", async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Eerste versie' })).toBe(true);
      expect(await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Bewerkte versie' })).toBe(true);
      expect(await getOwnChartHeadline(db, auditId, 'user-1')).toBe('Bewerkte versie');
      const { rows } = await db.query('select count(*)::int as n from chart_headlines');
      expect(rows[0]!.n).toBe(1);
    });
  });

  it("ownership guard: another user's chart is untouchable", async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-2', headline: 'Poging' })).toBe(false);
      expect(await getOwnChartHeadline(db, auditId, 'user-2')).toBeNull();
    });
  });

  it('kind guard: refusals and clarifications never take a headline', async () => {
    await withDb(async (db) => {
      const refusal = await insertAuditRow(db, { userId: 'user-1', kind: 'refusal', chartEmitted: false });
      expect(await upsertChartHeadline(db, { auditAnswerId: refusal, userId: 'user-1', headline: 'Nee' })).toBe(false);
    });
  });

  it('chart guard: an answer with no chart never takes a headline', async () => {
    await withDb(async (db) => {
      const chartless = await insertAuditRow(db, { userId: 'user-1', chartEmitted: false });
      expect(await upsertChartHeadline(db, { auditAnswerId: chartless, userId: 'user-1', headline: 'Nee' })).toBe(false);
    });
  });

  it('anonymous rows (null user_id) can never take a headline', async () => {
    await withDb(async (db) => {
      const anon = await insertAuditRow(db, { userId: null });
      expect(await upsertChartHeadline(db, { auditAnswerId: anon, userId: 'user-1', headline: 'Nee' })).toBe(false);
    });
  });

  it('source guard: onboarding_delivery rows never take a headline, even with valid user/kind/chart', async () => {
    await withDb(async (db) => {
      const onboarding = await insertAuditRow(db, {
        userId: 'user-1',
        kind: 'answer',
        chartEmitted: true,
        sourceTag: 'onboarding_delivery',
      });
      expect(await upsertChartHeadline(db, { auditAnswerId: onboarding, userId: 'user-1', headline: 'Nee' })).toBe(false);
    });
  });

  it('nonexistent audit id → soft false', async () => {
    await withDb(async (db) => {
      expect(await upsertChartHeadline(db, { auditAnswerId: 999999, userId: 'user-1', headline: 'Nee' })).toBe(false);
    });
  });
});

describe('getOwnChartHeadline', () => {
  it('returns null for a chart with no headline yet, and null for a non-owner', async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await getOwnChartHeadline(db, auditId, 'user-1')).toBeNull();
      await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Kop' });
      expect(await getOwnChartHeadline(db, auditId, 'user-2')).toBeNull();
    });
  });
});

describe('getChartHeadlinePublic', () => {
  it('returns the headline with no ownership check (embed-page use: the signed token already proved access)', async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await getChartHeadlinePublic(db, auditId)).toBeNull();
      await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Publieke kop' });
      expect(await getChartHeadlinePublic(db, auditId)).toBe('Publieke kop');
    });
  });
});

describe('pre-migration window', () => {
  it('every function degrades gracefully when chart_headlines does not exist', async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      await db.query('drop table chart_headlines');
      expect(await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Kop' })).toBe(false);
      expect(await getOwnChartHeadline(db, auditId, 'user-1')).toBeNull();
      expect(await getChartHeadlinePublic(db, auditId)).toBeNull();
    });
  });
});
