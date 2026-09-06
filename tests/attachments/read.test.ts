// getDatasetTurnById (read.ts) — the AuditRecord-analog reader for
// dataset_turns, used by reconstruct.ts and scripts/verify-dataset-turns.ts.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getDatasetTurnById } from '../../src/attachments/read.ts';
import { insertDataset, insertDatasetTurn } from '../../src/attachments/store.ts';
import type { DatasetProfile } from '../../src/attachments/types.ts';
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

const MINIMAL_PROFILE: DatasetProfile = { columns: [], rowCount: 0 };

async function insertThread(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
    userId,
  ]);
  return Number(rows[0]!.id);
}

describe('getDatasetTurnById', () => {
  it('returns null for a nonexistent id', async () => {
    await withDb(async (db) => {
      expect(await getDatasetTurnById(db, 999999)).toBeNull();
    });
  });

  it('round-trips every column, unscoped by user (ops/verify-script reader)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const dataset = await insertDataset(db, {
        userId,
        sourceKind: 'file_csv',
        displayName: 'x.csv',
        sourceUrl: null,
        mimeSniffed: 'text/csv',
        byteSize: 42,
        contentSha256: 'deadbeef',
        requestId: null,
        fileBytes: null,
        cells: [['a'], ['1']],
        profile: MINIMAL_PROFILE,
        status: 'ready',
      });
      const threadId = await insertThread(db, userId);
      const requestId = randomUUID();
      const id = await insertDatasetTurn(db, {
        userId,
        datasetId: dataset.id,
        threadId,
        requestId,
        kind: 'refusal',
        question: 'wat is de trend',
        envelope: { schemaVersion: 1, kind: 'refusal', question: 'wat is de trend', text: "I can't do that with your data right now.", reason: 'other', guidance: null },
        finalText: "I can't do that with your data right now.",
        instruction: null,
        chartEmitted: false,
        promptVersions: {},
        llmCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      });

      const record = await getDatasetTurnById(db, id);
      expect(record).toEqual({
        id,
        userId,
        datasetId: dataset.id,
        threadId,
        requestId,
        kind: 'refusal',
        question: 'wat is de trend',
        envelope: { schemaVersion: 1, kind: 'refusal', question: 'wat is de trend', text: "I can't do that with your data right now.", reason: 'other', guidance: null },
        finalText: "I can't do that with your data right now.",
        instruction: null,
        chartEmitted: false,
        promptVersions: {},
        llmCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        createdAt: expect.any(String),
      });
    });
  });
});
