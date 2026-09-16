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
  });

  it('exact-length-under-cap text is returned unchanged (untouched by the truncation path)', () => {
    const exact = 'x'.repeat(CHART_HEADLINE_MAX_LENGTH);
    expect(normalizeHeadlineText(exact)).toBe(exact);
    expect(normalizeHeadlineText(exact)).toHaveLength(CHART_HEADLINE_MAX_LENGTH);
  });

  it('pathological fallback: a single token with no whitespace boundary near the cap hard-cuts rather than returning empty', () => {
    expect(normalizeHeadlineText('x'.repeat(CHART_HEADLINE_MAX_LENGTH + 50))).toHaveLength(CHART_HEADLINE_MAX_LENGTH);
  });

  // Final-review fix (Finding 3): the whole point of this product is that a
  // number shown to the reader is never wrong. A raw `.slice(0, 140)` can
  // land in the MIDDLE of a number token, presenting a truncated (and
  // therefore WRONG) figure as fact — e.g. "...naar 1,5%" cut to "...naar
  // 1," reads as a real, different number, not as an obviously-cut string.
  // Constructs a string where the naive hard cut at 140 lands mid-number:
  // exactly 138 filler characters (well under the cap on their own) + one
  // space + the 4-character token "1,5%" — so `raw.slice(0, 140)` would
  // land 2 characters into "1,5%", producing "...1," (a different, wrong
  // number). The word-boundary-aware version must instead drop "1,5%"
  // WHOLE and return just the 138-char filler, trimmed.
  it('never splits a token (a number, here) across the 140-char cap — drops the whole partial token instead', () => {
    const filler = 'Werkloosheid stijgt scherp naar recordhoogte volgens de nieuwste CBS-cijfers over het afgelopen kwartaal in heel Nederland vandaag gepubliceerd'.slice(
      0,
      138,
    );
    expect(filler).toHaveLength(138);
    const raw = `${filler} 1,5%`;
    expect(raw.length).toBeGreaterThan(CHART_HEADLINE_MAX_LENGTH);

    // Prove the naive hard-cut really would have cut the number in half —
    // this is the bug this test exists to catch: "1,5%" (one and a half
    // percent) becomes a bare, different, wrong number "1".
    const naiveCut = raw.slice(0, CHART_HEADLINE_MAX_LENGTH);
    expect(naiveCut).not.toContain('1,5%');
    expect(naiveCut.endsWith(' 1')).toBe(true);

    // The fix: the whole "1,5%" token is dropped, never split — the result
    // is exactly the filler text, with the partial number gone entirely.
    const result = normalizeHeadlineText(raw);
    expect(result).toBe(filler);
    expect(result).not.toContain('1,5%');
    expect(result?.endsWith(' 1')).toBe(false);
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
