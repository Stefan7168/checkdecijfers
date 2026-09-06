// ADR 037 D10/D8 — the dataset-thread additions to src/threads/index.ts:
// createDatasetThread (the EAGER creation path, unlike attachOrCreateThread's
// lazy CBS one) and validateDatasetThreadOwnership (the double bind: the
// thread must belong to the caller AND be paired with THIS dataset).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDatasetThread, validateDatasetThreadOwnership } from '../../src/threads/index.ts';
import { insertDataset } from '../../src/attachments/store.ts';
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

async function seedDataset(db: Db, userId: string): Promise<number> {
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
    cells: [['a'], ['1']],
    profile: MINIMAL_PROFILE,
    status: 'ready',
  });
  return dataset.id;
}

describe('createDatasetThread', () => {
  it('creates a thread eagerly, with dataset_id set from the start', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      const threadId = await createDatasetThread(db, userId, datasetId);
      const { rows } = await db.query('select user_id, dataset_id from chat_threads where id = $1', [threadId]);
      expect(rows[0]).toMatchObject({ user_id: userId, dataset_id: datasetId });
    });
  });
});

describe('validateDatasetThreadOwnership', () => {
  it('validates a thread that belongs to the caller AND is paired with the given dataset', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      const threadId = await createDatasetThread(db, userId, datasetId);
      expect(await validateDatasetThreadOwnership(db, userId, threadId, datasetId)).toBe(threadId);
    });
  });

  it('CROSS-USER: rejects a thread belonging to a different user', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const datasetId = await seedDataset(db, owner);
      const threadId = await createDatasetThread(db, owner, datasetId);
      expect(await validateDatasetThreadOwnership(db, attacker, threadId, datasetId)).toBeNull();
    });
  });

  it('rejects a real, owned thread paired with a DIFFERENT dataset', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetA = await seedDataset(db, userId);
      const datasetB = await seedDataset(db, userId);
      const threadForA = await createDatasetThread(db, userId, datasetA);
      expect(await validateDatasetThreadOwnership(db, userId, threadForA, datasetB)).toBeNull();
    });
  });

  it('rejects a CBS thread (dataset_id NULL) even when owned by the caller', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
        userId,
      ]);
      const cbsThreadId = Number(rows[0]!.id);
      expect(await validateDatasetThreadOwnership(db, userId, cbsThreadId, datasetId)).toBeNull();
    });
  });

  it('returns null for a forged/non-integer thread id', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      expect(await validateDatasetThreadOwnership(db, userId, 'not-an-id', datasetId)).toBeNull();
      expect(await validateDatasetThreadOwnership(db, userId, -1, datasetId)).toBeNull();
    });
  });
});
