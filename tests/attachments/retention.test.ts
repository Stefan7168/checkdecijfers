// src/attachments/retention.ts — GDPR self-service delete + age-based
// purge for the attachments tier. Hermetic (PGlite). The load-bearing
// properties: cross-user isolation (self-service/per-file legs), the D13
// "Fixed in review" redaction completeness (question/final_text, not just
// the envelope sentinel), and the two-cutoff purge never double-counting.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  countPurgeableDatasets,
  deleteOneDataset,
  deleteUserDatasets,
  fileBytesCutoff,
  PartialPurgeError,
  purgeExpiredDatasets,
  REDACTED_DISPLAY_NAME,
  twoYearsBefore,
} from '../../src/attachments/retention.ts';
import { getDataset, insertDataset, insertDatasetTurn } from '../../src/attachments/store.ts';
import { REDACTED_DATASET_TEXT } from '../../src/attachments/types.ts';
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

describe('deleteUserDatasets — self-service, full redaction', () => {
  it('redacts the dataset row: bytes, cells, profile, name, url, status', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      const { datasets } = await deleteUserDatasets(db, userId);
      expect(datasets).toBe(1);
      const fetched = await getDataset(db, userId, datasetId);
      expect(fetched?.status).toBe('redacted');
      expect(fetched?.displayName).toBe(REDACTED_DISPLAY_NAME);
      expect(fetched?.sourceUrl).toBeNull();
      expect(fetched?.cells).toEqual([]);
      // A real, type-valid DatasetProfile, not a bare {} (code-review fix).
      expect(fetched?.profile).toEqual({ columns: [], rowCount: 0 });
    });
  });

  it('fixed in review — redacts the turn\'s question AND final_text columns, not just the envelope', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await seedDataset(db, userId);
      const threadId = await seedThread(db, userId);
      const turnId = await seedTurn(db, userId, datasetId, threadId);

      const { turns } = await deleteUserDatasets(db, userId);
      expect(turns).toBe(1);

      const { rows } = await db.query(
        'select question, final_text, envelope, instruction from dataset_turns where id = $1',
        [turnId],
      );
      const row = rows[0]!;
      expect(row.question).toBe(REDACTED_DATASET_TEXT);
      expect(row.final_text).toBe(REDACTED_DATASET_TEXT);
      expect(row.instruction).toBeNull();
      expect(row.envelope).toMatchObject({ redacted: true, kind: 'chart' });
      // The sentinel must not carry the real content back in disguise.
      expect(JSON.stringify(row.envelope)).not.toContain('Amsterdam');
    });
  });

  it('CROSS-USER: never touches another user\'s dataset', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const datasetId = await seedDataset(db, owner);
      await deleteUserDatasets(db, attacker);
      const fetched = await getDataset(db, owner, datasetId);
      expect(fetched?.status).toBe('ready'); // untouched
    });
  });

  it('is idempotent — redacting an already-redacted dataset is a harmless no-op', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await seedDataset(db, userId);
      await deleteUserDatasets(db, userId);
      await expect(deleteUserDatasets(db, userId)).resolves.toEqual({ datasets: 1, turns: 0 });
    });
  });
});

describe('deleteOneDataset — per-file delete (ADR 037 §8 Q3)', () => {
  it('redacts only the named dataset, leaving the user\'s other datasets alone', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const keep = await seedDataset(db, userId);
      const remove = await seedDataset(db, userId);
      const ok = await deleteOneDataset(db, userId, remove);
      expect(ok).toBe(true);
      expect((await getDataset(db, userId, keep))?.status).toBe('ready');
      expect((await getDataset(db, userId, remove))?.status).toBe('redacted');
    });
  });

  it('CROSS-USER: returns false and does not redact another user\'s dataset', async () => {
    await withDb(async (db) => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const datasetId = await seedDataset(db, owner);
      const ok = await deleteOneDataset(db, attacker, datasetId);
      expect(ok).toBe(false);
      expect((await getDataset(db, owner, datasetId))?.status).toBe('ready');
    });
  });

  it('returns false for a nonexistent dataset id', async () => {
    await withDb(async (db) => {
      expect(await deleteOneDataset(db, randomUUID(), 999999)).toBe(false);
    });
  });
});

describe('purgeExpiredDatasets — two cutoffs, never double-counted', () => {
  it('fully redacts a dataset older than the 2-year cutoff (also clearing its file bytes)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const now = new Date('2026-09-06T00:00:00Z');
      const veryOld = new Date('2020-01-01T00:00:00Z').toISOString();
      const datasetId = await seedDataset(db, userId, { createdAt: veryOld });

      const summary = await purgeExpiredDatasets(db, twoYearsBefore(now), fileBytesCutoff(now));
      expect(summary.datasets).toBe(1);
      expect(summary.fileBytesCleared).toBe(0); // already covered by the full redaction leg, not double-counted

      const fetched = await getDataset(db, userId, datasetId);
      expect(fetched?.status).toBe('redacted');
    });
  });

  it('clears ONLY file_bytes for a dataset older than 90 days but younger than 2 years', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const now = new Date('2026-09-06T00:00:00Z');
      const hundredDaysAgo = new Date('2026-05-29T00:00:00Z').toISOString(); // >90d, <2y
      const datasetId = await seedDataset(db, userId, { createdAt: hundredDaysAgo });

      const summary = await purgeExpiredDatasets(db, twoYearsBefore(now), fileBytesCutoff(now));
      expect(summary.datasets).toBe(0);
      expect(summary.fileBytesCleared).toBe(1);

      const fetched = await getDataset(db, userId, datasetId);
      expect(fetched?.status).toBe('ready'); // the dataset itself is untouched
      expect(fetched?.cells).toEqual([['Jaar'], ['2020']]); // cells survive
    });
  });

  it('touches nothing for a recent dataset', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const now = new Date('2026-09-06T00:00:00Z');
      await seedDataset(db, userId); // created_at = now, via the DB default

      const summary = await purgeExpiredDatasets(db, twoYearsBefore(now), fileBytesCutoff(now));
      expect(summary).toEqual({ datasets: 0, turns: 0, fileBytesCleared: 0 });
    });
  });
});

describe('purgeExpiredDatasets — code-review finding: partial-failure reporting', () => {
  it('throws PartialPurgeError carrying the already-committed counts when the file-bytes leg fails', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const now = new Date('2026-09-06T00:00:00Z');
      await seedDataset(db, userId, { createdAt: new Date('2020-01-01T00:00:00Z').toISOString() });

      // Intercept-and-inject (the tests/query/eviction-race.test.ts
      // technique): pass through every real query except the second leg's
      // own UPDATE, which is made to fail — simulating a transient error
      // AFTER the first leg's transaction already committed real work.
      const failingDb: Db = {
        query: (text, params) => {
          if (text.includes('set file_bytes = null') && !text.includes('where id')) {
            return Promise.reject(new Error('simulated transient failure'));
          }
          return db.query(text, params);
        },
        withTransaction: (fn) => db.withTransaction(fn),
      };

      await expect(purgeExpiredDatasets(failingDb, twoYearsBefore(now), fileBytesCutoff(now))).rejects.toThrow(
        PartialPurgeError,
      );

      let secondError: unknown;
      await purgeExpiredDatasets(failingDb, twoYearsBefore(now), fileBytesCutoff(now)).catch((error) => {
        secondError = error;
      });
      expect(secondError).toBeInstanceOf(PartialPurgeError);
      // The FIRST attempt already redacted the one expired dataset, so a
      // second run's first leg finds nothing left to redact — proving the
      // first leg's work truly committed and survived the thrown error.
      expect((secondError as InstanceType<typeof PartialPurgeError>).partial.datasets).toBe(0);
    });
  });
});

describe('countPurgeableDatasets — the ⟨F2⟩ dry-run equivalence', () => {
  it('matches what purgeExpiredDatasets would actually do', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const now = new Date('2026-09-06T00:00:00Z');
      await seedDataset(db, userId, { createdAt: new Date('2020-01-01T00:00:00Z').toISOString() });
      await seedDataset(db, userId, { createdAt: new Date('2026-05-29T00:00:00Z').toISOString() });
      await seedDataset(db, userId); // recent, untouched

      const cellsCutoff = twoYearsBefore(now);
      const filesCutoff = fileBytesCutoff(now);

      const preview = await countPurgeableDatasets(db, cellsCutoff, filesCutoff);
      expect(preview).toEqual({ datasets: 1, fileBytesOnly: 2 }); // the old one is in both counts (pre-apply)

      const actual = await purgeExpiredDatasets(db, cellsCutoff, filesCutoff);
      expect(actual.datasets).toBe(preview.datasets);
      // Post-apply, fileBytesCleared counts only what the second leg
      // ACTUALLY cleared (excluding the one the first leg already redacted) —
      // preview's fileBytesOnly is a pre-apply count of both, by design (a
      // dry run answers "what's in scope", not "what the second leg alone
      // will touch after the first leg runs").
      expect(actual.fileBytesCleared).toBe(1);
    });
  });
});
