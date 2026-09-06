// Migration 026 (WP202a, ADR 037): user_datasets + dataset_turns, the
// "Eigen data" attachments tier's own tables, plus the additive
// chat_threads.dataset_id column. Verifies the constraint behavior the
// migration claims, not just "the file applies" — per CLAUDE.md's
// "structural, never pattern-based" standard. Functional behavior
// (ownership checks, redaction, reconstruction) is covered where the code
// that owns it lands (tests/attachments/); this file is schema-level only,
// mirroring migration-018.test.ts's shape for a brand-new table pair rather
// than a widening.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { applyMigrations, MIGRATIONS_DIR } from '../../src/db/migrate.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

const MINIMAL_PROFILE = JSON.stringify({ columns: [], rowCount: 0 });
const MINIMAL_CELLS = JSON.stringify([]);

async function insertDataset(
  db: Db,
  userId: string,
  overrides: Partial<{ sourceKind: string; status: string }> = {},
): Promise<number> {
  const { rows } = await db.query(
    `insert into user_datasets
       (user_id, source_kind, display_name, mime_sniffed, byte_size, content_sha256, cells, profile, status)
     values ($1, $2, 'test.csv', 'text/csv', 10, 'deadbeef', $3, $4, $5)
     returning id`,
    [
      userId,
      overrides.sourceKind ?? 'file_csv',
      MINIMAL_CELLS,
      MINIMAL_PROFILE,
      overrides.status ?? 'ready',
    ],
  );
  return Number(rows[0]!.id);
}

async function insertThread(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query(
    'insert into chat_threads (user_id) values ($1::uuid) returning id',
    [userId],
  );
  return Number(rows[0]!.id);
}

describe('migration 026 is picked up by the migration scan', () => {
  it('applyMigrations records 026_user_datasets.sql as applied', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        "select name from schema_migrations where name like '026_%' order by name",
      );
      expect(rows.map((r) => r.name)).toEqual(['026_user_datasets.sql']);
    });
  });

  it('re-running applyMigrations against the same db is a no-op (idempotent scan)', async () => {
    await withDb(async (db) => {
      const applied = await applyMigrations(db, MIGRATIONS_DIR);
      expect(applied).toEqual([]);
    });
  });
});

describe('user_datasets', () => {
  it('inserts a minimal ready row and defaults status/created_at', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const id = await insertDataset(db, userId);
      const { rows } = await db.query('select * from user_datasets where id = $1', [id]);
      expect(rows[0]!.status).toBe('ready');
      expect(rows[0]!.created_at).not.toBeNull();
      expect(rows[0]!.redacted_at).toBeNull();
      expect(rows[0]!.request_id).toBeNull();
    });
  });

  it('rejects an unknown source_kind (CHECK constraint)', async () => {
    await withDb(async (db) => {
      await expect(insertDataset(db, randomUUID(), { sourceKind: 'not_a_kind' })).rejects.toThrow();
    });
  });

  it('accepts every documented source_kind', async () => {
    await withDb(async (db) => {
      for (const kind of ['file_csv', 'file_tsv', 'file_xlsx', 'url_html', 'file_pdf']) {
        await expect(insertDataset(db, randomUUID(), { sourceKind: kind })).resolves.toBeTypeOf('number');
      }
    });
  });

  it('rejects an unknown status (CHECK constraint)', async () => {
    await withDb(async (db) => {
      await expect(insertDataset(db, randomUUID(), { status: 'not_a_status' })).rejects.toThrow();
    });
  });

  it('accepts every documented status', async () => {
    await withDb(async (db) => {
      for (const status of ['ready', 'needs_decision', 'failed', 'redacted']) {
        await expect(insertDataset(db, randomUUID(), { status })).resolves.toBeTypeOf('number');
      }
    });
  });

  it('rejects a negative byte_size', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into user_datasets
             (user_id, source_kind, display_name, mime_sniffed, byte_size, content_sha256, cells, profile)
           values ($1, 'file_csv', 'x.csv', 'text/csv', -1, 'deadbeef', $2, $3)`,
          [randomUUID(), MINIMAL_CELLS, MINIMAL_PROFILE],
        ),
      ).rejects.toThrow();
    });
  });

  it('requires cells and profile (NOT NULL)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into user_datasets
             (user_id, source_kind, display_name, mime_sniffed, byte_size, content_sha256, profile)
           values ($1, 'file_csv', 'x.csv', 'text/csv', 10, 'deadbeef', $2)`,
          [randomUUID(), MINIMAL_PROFILE],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('dataset_turns', () => {
  it('inserts a minimal chart-kind row referencing a real dataset and thread', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await insertDataset(db, userId);
      const threadId = await insertThread(db, userId);
      const requestId = randomUUID();
      const { rows } = await db.query(
        `insert into dataset_turns
           (user_id, dataset_id, thread_id, request_id, kind, question, envelope, final_text,
            chart_emitted, prompt_versions, llm_calls)
         values ($1, $2, $3, $4, 'chart', 'maak een lijngrafiek', '{}'::jsonb, 'Hier is de grafiek.',
                 true, '{}'::jsonb, '[]'::jsonb)
         returning id`,
        [userId, datasetId, threadId, requestId],
      );
      expect(rows[0]!.id).not.toBeNull();
    });
  });

  it('rejects an unknown kind (CHECK constraint)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await insertDataset(db, userId);
      const threadId = await insertThread(db, userId);
      await expect(
        db.query(
          `insert into dataset_turns
             (user_id, dataset_id, thread_id, request_id, kind, question, envelope, final_text,
              chart_emitted, prompt_versions, llm_calls)
           values ($1, $2, $3, $4, 'not_a_kind', 'q', '{}'::jsonb, 't', false, '{}'::jsonb, '[]'::jsonb)`,
          [userId, datasetId, threadId, randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a dataset_id that does not exist (FK enforced)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const threadId = await insertThread(db, userId);
      await expect(
        db.query(
          `insert into dataset_turns
             (user_id, dataset_id, thread_id, request_id, kind, question, envelope, final_text,
              chart_emitted, prompt_versions, llm_calls)
           values ($1, 999999, $2, $3, 'chart', 'q', '{}'::jsonb, 't', true, '{}'::jsonb, '[]'::jsonb)`,
          [userId, threadId, randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a thread_id that does not exist (FK enforced)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await insertDataset(db, userId);
      await expect(
        db.query(
          `insert into dataset_turns
             (user_id, dataset_id, thread_id, request_id, kind, question, envelope, final_text,
              chart_emitted, prompt_versions, llm_calls)
           values ($1, $2, 999999, $3, 'chart', 'q', '{}'::jsonb, 't', true, '{}'::jsonb, '[]'::jsonb)`,
          [userId, datasetId, randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('chat_threads.dataset_id — additive column', () => {
  it('a thread created without a dataset_id (a CBS thread) stays NULL, exactly as before this migration', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const threadId = await insertThread(db, userId);
      const { rows } = await db.query('select dataset_id from chat_threads where id = $1', [threadId]);
      expect(rows[0]!.dataset_id).toBeNull();
    });
  });

  it('a thread CAN reference a real dataset', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const datasetId = await insertDataset(db, userId);
      const { rows } = await db.query(
        'insert into chat_threads (user_id, dataset_id) values ($1::uuid, $2) returning dataset_id',
        [userId, datasetId],
      );
      expect(Number(rows[0]!.dataset_id)).toBe(datasetId);
    });
  });

  it('rejects a dataset_id that does not exist (FK enforced on the additive column too)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query('insert into chat_threads (user_id, dataset_id) values ($1::uuid, 999999)', [randomUUID()]),
      ).rejects.toThrow();
    });
  });
});
