// ADR 037 D10/D8 — the dataset-thread additions to src/threads/index.ts:
// createDatasetThread (the EAGER creation path, unlike attachOrCreateThread's
// lazy CBS one) and validateDatasetThreadOwnership (the double bind: the
// thread must belong to the caller AND be paired with THIS dataset).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDatasetThread, getThreadDatasetId, validateDatasetThreadOwnership } from '../../src/threads/index.ts';
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

describe('getThreadDatasetId — loadMyThread\'s dispatch point (ADR 037 D10)', () => {
  it('returns the dataset id for a dataset thread', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      const threadId = await createDatasetThread(db, userId, datasetId);
      expect(await getThreadDatasetId(db, userId, threadId)).toBe(datasetId);
    });
  });

  it('returns null for a CBS thread', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
        userId,
      ]);
      expect(await getThreadDatasetId(db, userId, Number(rows[0]!.id))).toBeNull();
    });
  });

  it('CROSS-USER: returns null for a real dataset thread bound to a different user', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const datasetId = await seedDataset(db, owner);
      const threadId = await createDatasetThread(db, owner, datasetId);
      expect(await getThreadDatasetId(db, attacker, threadId)).toBeNull();
    });
  });

  // Emergency fix regression (2026-09-07, session 86): migrations 026/027 add
  // BOTH user_datasets and chat_threads.dataset_id in one file, so dropping
  // user_datasets reproduces the real pre-migration-apply production shape
  // (the column literally doesn't exist either) — mirrors the
  // trialTableExists/errorLogTableExists drop-table precedent in
  // tests/audit/retention-job.test.ts. Before this fix, this threw
  // "column dataset_id does not exist" instead of returning null — the exact
  // bug that broke every real thread selection in production once the
  // long-broken CI deploy pipeline started working again.
  it('pre-migration (dataset_id column and user_datasets table absent): returns null instead of throwing', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
        userId,
      ]);
      const threadId = Number(rows[0]!.id);
      // Reproduces the real pre-migration-026 production shape exactly:
      // that migration adds BOTH the column and the table in one file, so
      // dropping only user_datasets would leave dataset_id intact (still
      // NULL, not actually exercising the fix) — drop the column too, or
      // this test would pass even without the userDatasetsTableExists guard.
      await db.query('alter table chat_threads drop column dataset_id', []);
      await db.query('drop table if exists user_datasets cascade', []);
      expect(await getThreadDatasetId(db, userId, threadId)).toBeNull();
    });
  });
});
