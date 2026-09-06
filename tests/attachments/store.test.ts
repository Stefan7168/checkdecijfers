// src/attachments/store.ts — the SQL layer, hermetic (PGlite, ADR 009).
// The load-bearing property under test throughout: EVERY read/write binds
// user_id as a parameter, so cross-user access is structurally impossible,
// not just policy (the GDPR/cross-user-isolation adversarial-review lens).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  activeDatasetUsage,
  getDataset,
  insertDataset,
  insertDatasetTurn,
  lockDatasetStatus,
  markDatasetFailed,
  resolveDatasetDecision,
} from '../../src/attachments/store.ts';
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

async function insertThread(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
    userId,
  ]);
  return Number(rows[0]!.id);
}

function datasetParams(userId: string, overrides: Partial<Parameters<typeof insertDataset>[1]> = {}) {
  return {
    userId,
    sourceKind: 'file_csv' as const,
    displayName: 'verkoop.csv',
    sourceUrl: null,
    mimeSniffed: 'text/csv',
    byteSize: 42,
    contentSha256: 'deadbeef',
    requestId: null,
    fileBytes: null,
    cells: [['Jaar'], ['2020']],
    profile: MINIMAL_PROFILE,
    status: 'ready' as const,
    ...overrides,
  };
}

describe('insertDataset / getDataset', () => {
  it('round-trips a dataset', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const inserted = await insertDataset(db, datasetParams(userId));
      const fetched = await getDataset(db, userId, inserted.id);
      expect(fetched).toEqual(inserted);
    });
  });

  it('CROSS-USER: a different user cannot read the dataset', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const other = randomUUID();
      const inserted = await insertDataset(db, datasetParams(owner));
      expect(await getDataset(db, other, inserted.id)).toBeNull();
    });
  });

  it('returns null for a nonexistent dataset id (same shape as cross-user, no existence leak)', async () => {
    await withDb(async (db) => {
      expect(await getDataset(db, randomUUID(), 999999)).toBeNull();
    });
  });
});

describe('resolveDatasetDecision — the one allowed mutation window (U12)', () => {
  it('resolves a needs_decision dataset to ready with new cells/profile', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const inserted = await insertDataset(db, datasetParams(userId, { status: 'needs_decision' }));
      const newProfile: DatasetProfile = { columns: [{ id: 'c0', header: 'Jaar', type: 'year', nulls: 0 }], rowCount: 1 };
      const resolved = await resolveDatasetDecision(db, userId, inserted.id, [['Jaar'], ['2021']], newProfile);
      expect(resolved).toBe(true);
      const fetched = await getDataset(db, userId, inserted.id);
      expect(fetched?.status).toBe('ready');
      expect(fetched?.cells).toEqual([['Jaar'], ['2021']]);
    });
  });

  it('refuses to resolve a dataset that is already ready (U12 immutability)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const inserted = await insertDataset(db, datasetParams(userId, { status: 'ready' }));
      const resolved = await resolveDatasetDecision(db, userId, inserted.id, [['x'], ['y']], MINIMAL_PROFILE);
      expect(resolved).toBe(false);
      const fetched = await getDataset(db, userId, inserted.id);
      expect(fetched?.cells).toEqual(datasetParams(userId).cells); // untouched
    });
  });

  it('CROSS-USER: cannot resolve another user\'s needs_decision dataset', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const inserted = await insertDataset(db, datasetParams(owner, { status: 'needs_decision' }));
      const resolved = await resolveDatasetDecision(db, attacker, inserted.id, [['x']], MINIMAL_PROFILE);
      expect(resolved).toBe(false);
    });
  });
});

describe('markDatasetFailed', () => {
  it('sets status to failed, scoped by user_id', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const inserted = await insertDataset(db, datasetParams(userId, { status: 'needs_decision' }));
      await markDatasetFailed(db, userId, inserted.id);
      expect((await getDataset(db, userId, inserted.id))?.status).toBe('failed');
    });
  });

  it('CROSS-USER: cannot fail another user\'s dataset', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const inserted = await insertDataset(db, datasetParams(owner));
      await markDatasetFailed(db, attacker, inserted.id);
      expect((await getDataset(db, owner, inserted.id))?.status).toBe('ready'); // untouched
    });
  });
});

describe('activeDatasetUsage — quota accounting', () => {
  it('counts and sums only non-redacted datasets for the given user', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertDataset(db, datasetParams(userId, { byteSize: 100 }));
      await insertDataset(db, datasetParams(userId, { byteSize: 200 }));
      const usage = await activeDatasetUsage(db, userId);
      expect(usage).toEqual({ count: 2, totalBytes: 300 });
    });
  });

  it('never counts another user\'s datasets', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertDataset(db, datasetParams(randomUUID(), { byteSize: 999 }));
      expect(await activeDatasetUsage(db, userId)).toEqual({ count: 0, totalBytes: 0 });
    });
  });

  it('excludes redacted datasets from the count/sum', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertDataset(db, datasetParams(userId, { byteSize: 500, status: 'redacted' }));
      expect(await activeDatasetUsage(db, userId)).toEqual({ count: 0, totalBytes: 0 });
    });
  });
});

describe('lockDatasetStatus — the delete-race fix\'s row lock (D9)', () => {
  it('returns the current status', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const inserted = await insertDataset(db, datasetParams(userId));
      expect(await lockDatasetStatus(db, inserted.id)).toBe('ready');
    });
  });

  it('returns null for a nonexistent dataset', async () => {
    await withDb(async (db) => {
      expect(await lockDatasetStatus(db, 999999)).toBeNull();
    });
  });
});

describe('insertDatasetTurn', () => {
  it('inserts a turn referencing a real dataset and thread', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const dataset = await insertDataset(db, datasetParams(userId));
      const threadId = await insertThread(db, userId);
      const id = await insertDatasetTurn(db, {
        userId,
        datasetId: dataset.id,
        threadId,
        requestId: randomUUID(),
        kind: 'chart',
        question: 'maak een lijngrafiek',
        envelope: { schemaVersion: 1, kind: 'chart' },
        finalText: 'Hier is de grafiek.',
        instruction: { version: 1 },
        chartEmitted: true,
        promptVersions: { instruct: 1 },
        llmCalls: [],
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 120,
      });
      expect(id).toBeGreaterThan(0);
    });
  });
});
