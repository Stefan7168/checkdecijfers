// chart_edits store (session 112 phase 1 / session 113 phase 2, migrations
// 034 + 035, ADR 056 decision 4, docs/open-questions.md #274). Mirrors
// tests/chart/headline-store.test.ts's withDb/insertAuditRow fixtures and the
// pre-migration degrade-gracefully pattern. The turn leg reuses
// src/attachments/store.ts's own insertDataset/insertDatasetTurn helpers
// (tests/attachments/store.test.ts / retention.test.ts precedent) rather
// than hand-rolled SQL, so the fixture never drifts from the real column
// list.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { insertDataset, insertDatasetTurn } from '../../src/attachments/store.ts';
import {
  CHART_EDITS_MAX_JSON,
  deleteChartEditsForTurns,
  getOwnChartEdits,
  upsertChartEdits,
} from '../../src/chart/edits-store.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

// dataset_turns.user_id / user_datasets.user_id are `uuid` (migration 026);
// chart_edits.user_id stays `text` (034) but is fed the same uuid string
// here so ownership actually matches across the join.
const USER = randomUUID();

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

async function insertThread(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
    userId,
  ]);
  return Number(rows[0]!.id);
}

/** Inserts a dataset + thread + an own-data chart turn owned by `userId`,
 * copying the tests/attachments/store.test.ts / retention.test.ts seed
 * pattern verbatim (real insertDataset/insertDatasetTurn calls, not raw
 * SQL) so this fixture can never drift from the real dataset_turns shape. */
async function insertDatasetTurnRow(
  db: Db,
  userId: string,
  opts: { kind?: 'chart' | 'clarification' | 'refusal'; chartEmitted?: boolean } = {},
): Promise<number> {
  const dataset = await insertDataset(db, {
    userId,
    sourceKind: 'file_csv',
    displayName: 'verkoop.csv',
    sourceUrl: null,
    mimeSniffed: 'text/csv',
    byteSize: 10,
    contentSha256: randomUUID(),
    requestId: null,
    fileBytes: new Uint8Array([1, 2, 3]),
    cells: [['Jaar'], ['2020']],
    profile: { columns: [], rowCount: 0 },
    status: 'ready',
  });
  const threadId = await insertThread(db, userId);
  return insertDatasetTurn(db, {
    userId,
    datasetId: dataset.id,
    threadId,
    requestId: randomUUID(),
    kind: opts.kind ?? 'chart',
    question: 'maak een lijngrafiek van omzet',
    envelope: { schemaVersion: 1, kind: 'chart' },
    finalText: 'Hier is de grafiek.',
    instruction: { version: 1, x: 'c0' },
    chartEmitted: opts.chartEmitted ?? true,
    promptVersions: {},
    llmCalls: [],
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
  });
}

describe('chart_edits store — answer key (phase 1)', () => {
  it("upserts only into the caller's own chart-bearing user answer row, and reads it back", async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'u1' });
      const theirs = await insertAuditRow(db, { userId: 'u2' });
      const noChart = await insertAuditRow(db, { userId: 'u1', chartEmitted: false });
      const log = [{ kind: 'setForm', form: 'bar', id: 'a', at: '2026-09-18T00:00:00.000Z', source: 'panel' }];
      expect(await upsertChartEdits(db, { key: { kind: 'answer', id: mine }, userId: 'u1', log })).toBe(true);
      expect(await upsertChartEdits(db, { key: { kind: 'answer', id: theirs }, userId: 'u1', log })).toBe(false);
      expect(await upsertChartEdits(db, { key: { kind: 'answer', id: noChart }, userId: 'u1', log })).toBe(false);
      expect(await getOwnChartEdits(db, { kind: 'answer', id: mine }, 'u1')).toEqual(log);
      expect(await getOwnChartEdits(db, { kind: 'answer', id: mine }, 'u2')).toBeNull();
      // Second save replaces, bumps updated_at.
      expect(await upsertChartEdits(db, { key: { kind: 'answer', id: mine }, userId: 'u1', log: [] })).toBe(true);
      expect(await getOwnChartEdits(db, { kind: 'answer', id: mine }, 'u1')).toEqual([]);
    });
  });

  it('refuses a log above CHART_EDITS_MAX_JSON', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'u1' });
      const big = [{ kind: 'setTitle', title: 'x'.repeat(CHART_EDITS_MAX_JSON), id: 'a', at: 'now', source: 'canvas' }];
      expect(await upsertChartEdits(db, { key: { kind: 'answer', id: mine }, userId: 'u1', log: big })).toBe(false);
    });
  });

  it('degrades to false/null when the table is absent (pre-migration deploy window)', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'u1' });
      await db.query('drop table chart_edits');
      expect(await upsertChartEdits(db, { key: { kind: 'answer', id: mine }, userId: 'u1', log: [] })).toBe(false);
      expect(await getOwnChartEdits(db, { kind: 'answer', id: mine }, 'u1')).toBeNull();
    });
  });

  // Fix round 1 (code review, session 113): the live table, BEFORE the
  // owner applies migration 035, still has the plain (predicate-less)
  // primary key `(audit_answer_id, user_id)` — not the two partial unique
  // indexes 035 adds. Postgres's ON CONFLICT target inference with an
  // explicit WHERE predicate matches ONLY an existing partial unique index
  // with that exact predicate; it does not fall back to a full unique
  // index/PK. Reverts a fully-migrated test db back to the exact pre-035
  // shape (rather than applying migrations only through 034 — no such
  // helper exists in tests/helpers) to prove the answer leg still works in
  // that real, currently-live deploy window.
  it('answer leg still round-trips on the pre-035 schema (deploy-window regression)', async () => {
    await withDb(async (db) => {
      await db.query('drop index chart_edits_answer_user');
      await db.query('drop index chart_edits_turn_user');
      await db.query('alter table chart_edits drop constraint chart_edits_one_key');
      await db.query('alter table chart_edits drop column dataset_turn_id');
      await db.query('alter table chart_edits drop constraint chart_edits_pkey');
      await db.query('alter table chart_edits alter column audit_answer_id set not null');
      await db.query('alter table chart_edits add primary key (audit_answer_id, user_id)');

      const mine = await insertAuditRow(db, { userId: 'u1' });
      const log = [{ kind: 'setForm', form: 'bar', id: 'a', at: '2026-09-18T00:00:00.000Z', source: 'panel' }];
      expect(await upsertChartEdits(db, { key: { kind: 'answer', id: mine }, userId: 'u1', log })).toBe(true);
      expect(await getOwnChartEdits(db, { kind: 'answer', id: mine }, 'u1')).toEqual(log);
      // A second upsert updates the same row rather than raising 42P10 or
      // duplicating it (proves the conflict target actually matched).
      expect(await upsertChartEdits(db, { key: { kind: 'answer', id: mine }, userId: 'u1', log: [] })).toBe(true);
      expect(await getOwnChartEdits(db, { kind: 'answer', id: mine }, 'u1')).toEqual([]);
      const { rows } = await db.query('select count(*)::int as n from chart_edits where audit_answer_id = $1', [
        mine,
      ]);
      expect(Number((rows[0] as { n: number }).n)).toBe(1);
    });
  });
});

describe('chart_edits store — turn key (phase 2, migration 035)', () => {
  it('saves and reads a log keyed by a dataset turn the user owns', async () => {
    await withDb(async (db) => {
      const turnId = await insertDatasetTurnRow(db, USER);
      expect(
        await upsertChartEdits(db, { key: { kind: 'turn', id: turnId }, userId: USER, log: [{ kind: 'setTitle', title: 'x' }] }),
      ).toBe(true);
      expect(await getOwnChartEdits(db, { kind: 'turn', id: turnId }, USER)).toEqual([{ kind: 'setTitle', title: 'x' }]);
      expect(await getOwnChartEdits(db, { kind: 'turn', id: turnId }, randomUUID())).toBeNull();
    });
  });

  it('refuses a turn key for a turn owned by another user', async () => {
    await withDb(async (db) => {
      const turnId = await insertDatasetTurnRow(db, randomUUID());
      expect(await upsertChartEdits(db, { key: { kind: 'turn', id: turnId }, userId: USER, log: [] })).toBe(false);
    });
  });

  it('refuses a turn that is not a chart-emitted chart turn', async () => {
    await withDb(async (db) => {
      const clarification = await insertDatasetTurnRow(db, USER, { kind: 'clarification', chartEmitted: false });
      expect(await upsertChartEdits(db, { key: { kind: 'turn', id: clarification }, userId: USER, log: [] })).toBe(false);
    });
  });

  it('degrades to false/null for a turn key when the column is absent (pre-035 deploy window)', async () => {
    await withDb(async (db) => {
      const turnId = await insertDatasetTurnRow(db, USER);
      await db.query('alter table chart_edits drop column dataset_turn_id');
      expect(await upsertChartEdits(db, { key: { kind: 'turn', id: turnId }, userId: USER, log: [] })).toBe(false);
      expect(await getOwnChartEdits(db, { kind: 'turn', id: turnId }, USER)).toBeNull();
    });
  });

  it('deleteChartEditsForTurns removes the rows and returns the count', async () => {
    await withDb(async (db) => {
      const turnA = await insertDatasetTurnRow(db, USER);
      const turnB = await insertDatasetTurnRow(db, USER);
      const untouched = await insertDatasetTurnRow(db, USER);
      await upsertChartEdits(db, { key: { kind: 'turn', id: turnA }, userId: USER, log: [] });
      await upsertChartEdits(db, { key: { kind: 'turn', id: turnB }, userId: USER, log: [] });
      await upsertChartEdits(db, { key: { kind: 'turn', id: untouched }, userId: USER, log: [] });

      expect(await deleteChartEditsForTurns(db, [turnA, turnB])).toBe(2);
      expect(await getOwnChartEdits(db, { kind: 'turn', id: turnA }, USER)).toBeNull();
      expect(await getOwnChartEdits(db, { kind: 'turn', id: turnB }, USER)).toBeNull();
      expect(await getOwnChartEdits(db, { kind: 'turn', id: untouched }, USER)).toEqual([]);
    });
  });

  // Final review (session 113): the column-absent case is asserted INSIDE a
  // transaction, because that is the only way this leg is ever called
  // (src/attachments/retention.ts's redactTurnsForDatasets). A caught 42703
  // would still have aborted the transaction, so the assertion that matters
  // is "a following statement in the same transaction still works".
  it('deleteChartEditsForTurns returns 0 on an empty list and when the column is absent, without aborting the transaction', async () => {
    await withDb(async (db) => {
      expect(await deleteChartEditsForTurns(db, [])).toBe(0);
      await db.query('alter table chart_edits drop column dataset_turn_id');
      const stillAlive = await db.withTransaction(async (tx) => {
        expect(await deleteChartEditsForTurns(tx, [1, 2])).toBe(0);
        const { rows } = await tx.query('select 1 as ok');
        return rows[0]?.ok;
      });
      expect(Number(stillAlive)).toBe(1);
    });
  });
});
