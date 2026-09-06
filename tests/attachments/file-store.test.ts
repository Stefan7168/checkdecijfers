// PostgresFileStore — bytea round-trip through PGlite (ADR 037 §8's own
// flagged assumption: "verify at build" — this is that verification, not an
// assumption anymore) plus the cross-user isolation the code-review pass
// added (get/delete now take userId, scoped identically to put).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PostgresFileStore } from '../../src/attachments/file-store.ts';
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
    cells: [['a']],
    profile: MINIMAL_PROFILE,
    status: 'ready',
  });
  return dataset.id;
}

describe('PostgresFileStore — bytea round-trip (PGlite, verifying the ADR 037 §8 assumption)', () => {
  it('put then get returns the exact bytes back', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      const store = new PostgresFileStore(db);
      const original = new Uint8Array([0, 1, 2, 255, 128, 42]);
      await store.put(userId, datasetId, original);
      const fetched = await store.get(userId, datasetId);
      expect(fetched).toEqual(original);
    });
  });

  it('get returns null before anything has been put', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      const store = new PostgresFileStore(db);
      expect(await store.get(userId, datasetId)).toBeNull();
    });
  });

  it('delete nulls the bytes without touching the dataset row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      const store = new PostgresFileStore(db);
      await store.put(userId, datasetId, new Uint8Array([9, 9, 9]));
      await store.delete(userId, datasetId);
      expect(await store.get(userId, datasetId)).toBeNull();
    });
  });
});

describe('PostgresFileStore — cross-user isolation (fixed in review: get/delete now scoped by userId)', () => {
  it('CROSS-USER: get returns null for another user\'s file, even with the right dataset id', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const datasetId = await seedDataset(db, owner);
      const store = new PostgresFileStore(db);
      await store.put(owner, datasetId, new Uint8Array([1, 2, 3]));
      expect(await store.get(attacker, datasetId)).toBeNull();
    });
  });

  it('CROSS-USER: put scoped to the wrong user is a silent no-op, never writes another user\'s file', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const datasetId = await seedDataset(db, owner);
      const store = new PostgresFileStore(db);
      await store.put(attacker, datasetId, new Uint8Array([6, 6, 6]));
      expect(await store.get(owner, datasetId)).toBeNull();
    });
  });

  it('CROSS-USER: delete scoped to the wrong user does not clear the real owner\'s file', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const datasetId = await seedDataset(db, owner);
      const store = new PostgresFileStore(db);
      const original = new Uint8Array([7, 7, 7]);
      await store.put(owner, datasetId, original);
      await store.delete(attacker, datasetId);
      expect(await store.get(owner, datasetId)).toEqual(original);
    });
  });
});
