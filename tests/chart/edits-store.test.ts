// chart_edits store (session 112, chart co-pilot phase 1, migration 034,
// ADR 056 decision 4, docs/open-questions.md #274). Mirrors
// tests/chart/headline-store.test.ts's withDb/insertAuditRow fixtures and the
// pre-migration degrade-gracefully pattern.
import { describe, expect, it } from 'vitest';
import { CHART_EDITS_MAX_JSON, getOwnChartEdits, upsertChartEdits } from '../../src/chart/edits-store.ts';
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

describe('chart_edits store', () => {
  it("upserts only into the caller's own chart-bearing user answer row, and reads it back", async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'u1' });
      const theirs = await insertAuditRow(db, { userId: 'u2' });
      const noChart = await insertAuditRow(db, { userId: 'u1', chartEmitted: false });
      const log = [{ kind: 'setForm', form: 'bar', id: 'a', at: '2026-09-18T00:00:00.000Z', source: 'panel' }];
      expect(await upsertChartEdits(db, { auditAnswerId: mine, userId: 'u1', log })).toBe(true);
      expect(await upsertChartEdits(db, { auditAnswerId: theirs, userId: 'u1', log })).toBe(false);
      expect(await upsertChartEdits(db, { auditAnswerId: noChart, userId: 'u1', log })).toBe(false);
      expect(await getOwnChartEdits(db, mine, 'u1')).toEqual(log);
      expect(await getOwnChartEdits(db, mine, 'u2')).toBeNull();
      // Second save replaces, bumps updated_at.
      expect(await upsertChartEdits(db, { auditAnswerId: mine, userId: 'u1', log: [] })).toBe(true);
      expect(await getOwnChartEdits(db, mine, 'u1')).toEqual([]);
    });
  });

  it('refuses a log above CHART_EDITS_MAX_JSON', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'u1' });
      const big = [{ kind: 'setTitle', title: 'x'.repeat(CHART_EDITS_MAX_JSON), id: 'a', at: 'now', source: 'canvas' }];
      expect(await upsertChartEdits(db, { auditAnswerId: mine, userId: 'u1', log: big })).toBe(false);
    });
  });

  it('degrades to false/null when the table is absent (pre-migration deploy window)', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'u1' });
      await db.query('drop table chart_edits');
      expect(await upsertChartEdits(db, { auditAnswerId: mine, userId: 'u1', log: [] })).toBe(false);
      expect(await getOwnChartEdits(db, mine, 'u1')).toBeNull();
    });
  });
});
