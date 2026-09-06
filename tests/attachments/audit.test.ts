// writeTurn — the R8-analog "stored before shown" guarantee, including the
// delete-vs-write race fix (D9). Hermetic (PGlite).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { writeTurn } from '../../src/attachments/audit.ts';
import { insertDataset } from '../../src/attachments/store.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import type { DatasetProfile } from '../../src/attachments/types.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

const MINIMAL_PROFILE: DatasetProfile = { columns: [], rowCount: 0 };

async function seed(db: Db): Promise<{ userId: string; datasetId: number; threadId: number }> {
  const userId = randomUUID();
  const dataset = await insertDataset(db, {
    userId,
    sourceKind: 'file_csv',
    displayName: 'x.csv',
    sourceUrl: null,
    mimeSniffed: 'text/csv',
    byteSize: 10,
    contentSha256: 'deadbeef',
    requestId: null,
    fileBytes: null,
    cells: [['a']],
    profile: MINIMAL_PROFILE,
    status: 'ready',
  });
  const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
    userId,
  ]);
  return { userId, datasetId: dataset.id, threadId: Number(rows[0]!.id) };
}

function turnParams(seeded: Awaited<ReturnType<typeof seed>>) {
  return {
    userId: seeded.userId,
    datasetId: seeded.datasetId,
    threadId: seeded.threadId,
    requestId: randomUUID(),
    kind: 'chart' as const,
    question: 'maak een lijngrafiek',
    envelope: { schemaVersion: 1 },
    finalText: 'Hier is de grafiek.',
    instruction: null,
    chartEmitted: true,
    promptVersions: {},
    llmCalls: [],
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
  };
}

describe('writeTurn — the happy path', () => {
  it('writes the turn and returns a real auditId', async () => {
    await withDb(async (db) => {
      const seeded = await seed(db);
      const result = await writeTurn(db, turnParams(seeded));
      expect(result.datasetGone).toBe(false);
      expect(result.auditId).toBeGreaterThan(0);
    });
  });
});

describe('writeTurn — the delete-vs-write race (D9, fixed in review)', () => {
  it('writes NO turn at all when the dataset is no longer ready (deleted mid-flight)', async () => {
    await withDb(async (db) => {
      const seeded = await seed(db);
      // Simulate a concurrent delete completing between the caller's own
      // pre-check and this write.
      await db.query(`update user_datasets set status = 'redacted' where id = $1`, [seeded.datasetId]);

      const result = await writeTurn(db, turnParams(seeded));
      expect(result).toEqual({ auditId: null, datasetGone: true });

      const { rows } = await db.query('select count(*)::int as n from dataset_turns where dataset_id = $1', [
        seeded.datasetId,
      ]);
      expect(rows[0]!.n).toBe(0); // nothing written — never re-persists text against a deleted dataset
    });
  });

  it('a needs_decision dataset (not yet ready) also refuses the write, same as deleted', async () => {
    await withDb(async (db) => {
      const seeded = await seed(db);
      await db.query(`update user_datasets set status = 'needs_decision' where id = $1`, [seeded.datasetId]);
      const result = await writeTurn(db, turnParams(seeded));
      expect(result).toEqual({ auditId: null, datasetGone: true });
    });
  });

  it('a nonexistent dataset id also refuses cleanly (status lock finds nothing)', async () => {
    await withDb(async (db) => {
      const seeded = await seed(db);
      const result = await writeTurn(db, { ...turnParams(seeded), datasetId: 999999 });
      expect(result.auditId).toBeNull();
      expect(result.datasetGone).toBe(true);
    });
  });
});
