// src/attachments/publications.ts — the store for published own-data charts
// (ADR 057, session 127). Hermetic (PGlite). The load-bearing properties:
// public-id shape/uniqueness, upsert-keeps-same-id-replaces-content,
// cross-user isolation on every reader/deleter, the DB-level source-line
// length guard, the GDPR retention leg (deleteOneDataset / deleteUserDatasets
// / purgeExpiredDatasets all hard-delete publications of the turns they
// touch), and deploy-order safety (every function degrades to its "absent"
// value when migration 036 hasn't been applied yet).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  countPublications,
  deletePublicationForTurn,
  deletePublicationsForTurns,
  getPublicationByPublicId,
  getPublicationForTurn,
  isPublicIdShape,
  newPublicId,
  publicationsTablePresent,
  upsertPublication,
} from '../../src/attachments/publications.ts';
import {
  deleteOneDataset,
  deleteUserDatasets,
  fileBytesCutoff,
  purgeExpiredDatasets,
  twoYearsBefore,
} from '../../src/attachments/retention.ts';
import { insertDataset, insertDatasetTurn } from '../../src/attachments/store.ts';
import type { DatasetProfile } from '../../src/attachments/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';

let sharedDb: Db;
let closeSharedDb: () => Promise<void>;

beforeAll(async () => {
  ({ db: sharedDb, close: closeSharedDb } = await createTestDb());
});

afterAll(async () => {
  await closeSharedDb();
});

beforeEach(async () => {
  await resetTestDb(sharedDb);
});

// Copied verbatim from tests/attachments/retention.test.ts.
const MINIMAL_PROFILE: DatasetProfile = { columns: [], rowCount: 0 };

async function seedDataset(
  db: Db,
  userId: string,
  overrides: { fileBytes?: Uint8Array | null; createdAt?: string } = {},
): Promise<number> {
  const inserted = await insertDataset(db, {
    userId,
    sourceKind: 'file_csv',
    displayName: 'verkoop.csv',
    sourceUrl: 'https://example.com/data.csv',
    mimeSniffed: 'text/csv',
    byteSize: 10,
    contentSha256: 'deadbeef',
    requestId: null,
    fileBytes: overrides.fileBytes ?? new Uint8Array([1, 2, 3]),
    cells: [['Jaar'], ['2020']],
    profile: MINIMAL_PROFILE,
    status: 'ready',
  });
  if (overrides.createdAt) {
    await db.query('update user_datasets set created_at = $1 where id = $2', [
      overrides.createdAt,
      inserted.id,
    ]);
  }
  return inserted.id;
}

async function seedThread(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
    userId,
  ]);
  return Number(rows[0]!.id);
}

async function seedTurn(db: Db, userId: string, datasetId: number, threadId: number): Promise<number> {
  return insertDatasetTurn(db, {
    userId,
    datasetId,
    threadId,
    requestId: randomUUID(),
    kind: 'chart',
    question: 'maak een lijngrafiek van omzet',
    envelope: { schemaVersion: 1, kind: 'chart' },
    finalText: 'Hier is de grafiek van Amsterdam.',
    instruction: { version: 1, x: 'c0' },
    chartEmitted: true,
    promptVersions: {},
    llmCalls: [],
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
  });
}

/** Seeds one user with a dataset, a thread and a chart turn — the minimal
 * fixture every publications test starts from. */
async function seedTurnFixture(
  db: Db,
  userId: string,
): Promise<{ datasetId: number; threadId: number; turnId: number }> {
  const datasetId = await seedDataset(db, userId);
  const threadId = await seedThread(db, userId);
  const turnId = await seedTurn(db, userId, datasetId, threadId);
  return { datasetId, threadId, turnId };
}

describe('public ids', () => {
  it('are 22 base64url chars and unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPublicId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(isPublicIdShape(id)).toBe(true);
  });

  it('rejects every other shape', () => {
    for (const bad of ['', 'abc', 'a'.repeat(21), 'a'.repeat(23), 'a'.repeat(21) + '/', 42, null, undefined]) {
      expect(isPublicIdShape(bad)).toBe(false);
    }
  });
});

describe('publications store', () => {
  it('insert then update keeps the same public id and replaces log + source line + style', async () => {
    const userId = randomUUID();
    const { datasetId, turnId } = await seedTurnFixture(sharedDb, userId);

    const a = await upsertPublication(sharedDb, {
      userId,
      datasetId,
      datasetTurnId: turnId,
      log: [],
      sourceLine: 'Bron A',
      style: { fontFamily: 'Georgia' },
    });
    const b = await upsertPublication(sharedDb, {
      userId,
      datasetId,
      datasetTurnId: turnId,
      log: [{ kind: 'setTitle', title: 'X' }],
      sourceLine: null,
      style: null,
    });
    expect(b!.publicId).toBe(a!.publicId);

    const row = await getPublicationByPublicId(sharedDb, a!.publicId);
    expect(row!.log).toEqual([{ kind: 'setTitle', title: 'X' }]);
    expect(row!.sourceLine).toBeNull();
    // Session 128 (ADR 057 ruling 1): the update replaced the style too —
    // an upsert never leaves the FIRST publish's style stranded behind a
    // later, style-less update.
    expect(row!.style).toBeNull();
  });

  it('round-trips a non-null style', async () => {
    const userId = randomUUID();
    const { datasetId, turnId } = await seedTurnFixture(sharedDb, userId);

    const created = await upsertPublication(sharedDb, {
      userId,
      datasetId,
      datasetTurnId: turnId,
      log: [],
      sourceLine: null,
      style: { fontFamily: 'Georgia', language: 'en' },
    });

    const row = await getPublicationByPublicId(sharedDb, created!.publicId);
    expect(row!.style).toEqual({ fontFamily: 'Georgia', language: 'en' });
  });

  it('getPublicationForTurn is scoped by user', async () => {
    const userId = randomUUID();
    const attackerId = randomUUID();
    const { datasetId, turnId } = await seedTurnFixture(sharedDb, userId);

    await upsertPublication(sharedDb, { userId, datasetId, datasetTurnId: turnId, log: [], sourceLine: null, style: null });

    expect(await getPublicationForTurn(sharedDb, attackerId, turnId)).toBeNull();
    expect(await getPublicationForTurn(sharedDb, userId, turnId)).not.toBeNull();
  });

  it('deletePublicationForTurn removes the row and is user-scoped', async () => {
    const userId = randomUUID();
    const attackerId = randomUUID();
    const { datasetId, turnId } = await seedTurnFixture(sharedDb, userId);

    const created = await upsertPublication(sharedDb, {
      userId,
      datasetId,
      datasetTurnId: turnId,
      log: [],
      sourceLine: null,
      style: null,
    });

    expect(await deletePublicationForTurn(sharedDb, attackerId, turnId)).toBe(false);
    expect(await getPublicationByPublicId(sharedDb, created!.publicId)).not.toBeNull();

    expect(await deletePublicationForTurn(sharedDb, userId, turnId)).toBe(true);
    expect(await getPublicationByPublicId(sharedDb, created!.publicId)).toBeNull();
  });

  it('countPublications counts only this user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const fixtureA1 = await seedTurnFixture(sharedDb, userA);
    const fixtureA2 = await seedTurnFixture(sharedDb, userA);
    const fixtureB = await seedTurnFixture(sharedDb, userB);

    await upsertPublication(sharedDb, {
      userId: userA,
      datasetId: fixtureA1.datasetId,
      datasetTurnId: fixtureA1.turnId,
      log: [],
      sourceLine: null,
      style: null,
    });
    await upsertPublication(sharedDb, {
      userId: userA,
      datasetId: fixtureA2.datasetId,
      datasetTurnId: fixtureA2.turnId,
      log: [],
      sourceLine: null,
      style: null,
    });
    await upsertPublication(sharedDb, {
      userId: userB,
      datasetId: fixtureB.datasetId,
      datasetTurnId: fixtureB.turnId,
      log: [],
      sourceLine: null,
      style: null,
    });

    expect(await countPublications(sharedDb, userA)).toBe(2);
    expect(await countPublications(sharedDb, userB)).toBe(1);
  });

  it('the DB rejects a source line over 120 chars', async () => {
    const userId = randomUUID();
    const { datasetId, turnId } = await seedTurnFixture(sharedDb, userId);
    const base = { userId, datasetId, datasetTurnId: turnId, log: [] as unknown[], style: null };

    await expect(upsertPublication(sharedDb, { ...base, sourceLine: 'x'.repeat(121) })).rejects.toThrow();
  });
});

describe('retention kills publications (GDPR)', () => {
  it('deleteOneDataset hard-deletes the dataset\'s publications', async () => {
    const userId = randomUUID();
    const { datasetId, turnId } = await seedTurnFixture(sharedDb, userId);
    const created = await upsertPublication(sharedDb, {
      userId,
      datasetId,
      datasetTurnId: turnId,
      log: [],
      sourceLine: null,
      style: null,
    });

    await deleteOneDataset(sharedDb, userId, datasetId);

    expect(await getPublicationByPublicId(sharedDb, created!.publicId)).toBeNull();
  });

  it('deleteUserDatasets hard-deletes every publication of the user', async () => {
    const userId = randomUUID();
    const fixture1 = await seedTurnFixture(sharedDb, userId);
    const fixture2 = await seedTurnFixture(sharedDb, userId);
    const created1 = await upsertPublication(sharedDb, {
      userId,
      datasetId: fixture1.datasetId,
      datasetTurnId: fixture1.turnId,
      log: [],
      sourceLine: null,
      style: null,
    });
    const created2 = await upsertPublication(sharedDb, {
      userId,
      datasetId: fixture2.datasetId,
      datasetTurnId: fixture2.turnId,
      log: [],
      sourceLine: null,
      style: null,
    });

    await deleteUserDatasets(sharedDb, userId);

    expect(await getPublicationByPublicId(sharedDb, created1!.publicId)).toBeNull();
    expect(await getPublicationByPublicId(sharedDb, created2!.publicId)).toBeNull();
  });

  it('purgeExpiredDatasets hard-deletes publications of expired datasets only', async () => {
    const userId = randomUUID();
    const expired = await seedTurnFixture(sharedDb, userId);
    const fresh = await seedTurnFixture(sharedDb, userId);

    const expiredPub = await upsertPublication(sharedDb, {
      userId,
      datasetId: expired.datasetId,
      datasetTurnId: expired.turnId,
      log: [],
      sourceLine: null,
      style: null,
    });
    const freshPub = await upsertPublication(sharedDb, {
      userId,
      datasetId: fresh.datasetId,
      datasetTurnId: fresh.turnId,
      log: [],
      sourceLine: null,
      style: null,
    });

    await sharedDb.query("update user_datasets set created_at = now() - interval '3 years' where id = $1", [
      expired.datasetId,
    ]);

    const now = new Date();
    await purgeExpiredDatasets(sharedDb, twoYearsBefore(now), fileBytesCutoff(now));

    expect(await getPublicationByPublicId(sharedDb, expiredPub!.publicId)).toBeNull();
    expect(await getPublicationByPublicId(sharedDb, freshPub!.publicId)).not.toBeNull();
  });
});

describe('table absent (deploy-order safety)', () => {
  it('every reader returns its absent value and the retention leg still works', async () => {
    const { db, close } = await createTestDb();
    try {
      const userId = randomUUID();
      const { datasetId, turnId } = await seedTurnFixture(db, userId);
      const base = { userId, datasetId, datasetTurnId: turnId, log: [] as unknown[], sourceLine: null, style: null };

      await db.query('drop table published_user_charts');

      expect(await publicationsTablePresent(db)).toBe(false);
      expect(await upsertPublication(db, base)).toBeNull();
      expect(await getPublicationByPublicId(db, newPublicId())).toBeNull();
      expect(await getPublicationForTurn(db, userId, turnId)).toBeNull();
      expect(await deletePublicationForTurn(db, userId, turnId)).toBe(false);
      expect(await countPublications(db, userId)).toBe(0);
      expect(await deletePublicationsForTurns(db, [turnId])).toBe(0);
      await expect(deleteOneDataset(db, userId, datasetId)).resolves.toBe(true);
    } finally {
      await close();
    }
  });
});
