// Migration 037 (breadth step 2, spec 2026-09-28-breadth-any-cbs-table-design.md D4):
// ingest_mode + slice_fetches table. Verifies the migration is picked up by the
// scan, that ingest_mode defaults to 'full' and rejects invalid values, that
// slice_fetches enforces unique(table_id, filter_key), and that cascade delete
// works. Mirrors migration-033.test.ts's shape.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { applyMigrations, MIGRATIONS_DIR } from '../../src/db/migrate.ts';
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

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  await fn(sharedDb);
}

describe('migration 037 is picked up by the migration scan', () => {
  it('applyMigrations records 037_slice_cache.sql as applied', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        "select name from schema_migrations where name like '037_%' order by name",
      );
      expect(rows.map((r) => r.name)).toEqual(['037_slice_cache.sql']);
    });
  });

  it('re-running applyMigrations against the same db is a no-op (idempotent scan)', async () => {
    await withDb(async (db) => {
      const applied = await applyMigrations(db, MIGRATIONS_DIR);
      expect(applied).toEqual([]);
    });
  });
});

describe('cbs_tables.ingest_mode — defaults to "full", rejects invalid values', () => {
  it('a legacy-shaped insert (no ingest_mode named) defaults to "full"', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into cbs_tables (id, title, platform, expected_dimensions)
         values ('99999TST', 'Testtabel', 'v4', '[]'::jsonb)`,
      );
      const { rows } = await db.query(
        `select ingest_mode from cbs_tables where id = '99999TST'`,
      );
      expect(rows[0]!.ingest_mode).toBe('full');
    });
  });

  it('ingest_mode accepts "slice_cache"', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into cbs_tables (id, title, platform, expected_dimensions, ingest_mode)
         values ('99999SLC', 'Slice tabel', 'v4', '[]'::jsonb, 'slice_cache')`,
      );
      const { rows } = await db.query(
        `select ingest_mode from cbs_tables where id = '99999SLC'`,
      );
      expect(rows[0]!.ingest_mode).toBe('slice_cache');
    });
  });

  it('ingest_mode rejects invalid values', async () => {
    await withDb(async (db) => {
      try {
        await db.query(
          `insert into cbs_tables (id, title, platform, expected_dimensions, ingest_mode)
           values ('99999BAD', 'Bad tabel', 'v4', '[]'::jsonb, 'other')`,
        );
        throw new Error('Expected constraint violation for invalid ingest_mode');
      } catch (err) {
        if (err instanceof Error && err.message.includes('constraint') && !err.message.includes('Expected constraint')) {
          // Expected: a constraint violation from the CHECK
          expect(err.message).toContain('ingest_mode');
        } else {
          throw err;
        }
      }
    });
  });
});

describe('slice_fetches table — enforces unique(table_id, filter_key) and cascade deletes', () => {
  it('slice_fetches enforces unique constraint on (table_id, filter_key)', async () => {
    await withDb(async (db) => {
      // Insert a test table
      await db.query(
        `insert into cbs_tables (id, title, platform, expected_dimensions)
         values ('99999TST', 'Testtabel', 'v4', '[]'::jsonb)`,
      );

      // Insert the first slice_fetch record
      await db.query(
        `insert into slice_fetches (table_id, filter_key, filter, row_count)
         values ('99999TST', 'key1', '{"dim":"value"}'::jsonb, 100)`,
      );

      // Try to insert a duplicate — should violate the unique constraint
      try {
        await db.query(
          `insert into slice_fetches (table_id, filter_key, filter, row_count)
           values ('99999TST', 'key1', '{"dim":"value"}'::jsonb, 200)`,
        );
        throw new Error('Expected unique constraint violation');
      } catch (err) {
        if (err instanceof Error && err.message.includes('unique') && !err.message.includes('Expected unique')) {
          // Expected: unique constraint violation
          expect(err.message).toContain('unique');
        } else {
          throw err;
        }
      }
    });
  });

  it('slice_fetches cascades delete when table is deleted', async () => {
    await withDb(async (db) => {
      // Insert a test table
      await db.query(
        `insert into cbs_tables (id, title, platform, expected_dimensions)
         values ('99999TST', 'Testtabel', 'v4', '[]'::jsonb)`,
      );

      // Insert a slice_fetch record
      await db.query(
        `insert into slice_fetches (table_id, filter_key, filter, row_count)
         values ('99999TST', 'key1', '{"dim":"value"}'::jsonb, 100)`,
      );

      // Verify it was inserted
      let { rows } = await db.query(
        `select count(*) as cnt from slice_fetches where table_id = '99999TST'`,
      );
      expect(rows[0]!.cnt).toBe(1);

      // Delete the table
      await db.query(`delete from cbs_tables where id = '99999TST'`);

      // Verify the slice_fetch was cascaded
      ({ rows } = await db.query(
        `select count(*) as cnt from slice_fetches where table_id = '99999TST'`,
      ));
      expect(rows[0]!.cnt).toBe(0);
    });
  });

  it('slice_fetches allows multiple records for the same table with different filter_keys', async () => {
    await withDb(async (db) => {
      // Insert a test table
      await db.query(
        `insert into cbs_tables (id, title, platform, expected_dimensions)
         values ('99999TST', 'Testtabel', 'v4', '[]'::jsonb)`,
      );

      // Insert multiple slice_fetch records with different filter_keys
      await db.query(
        `insert into slice_fetches (table_id, filter_key, filter, row_count)
         values ('99999TST', 'key1', '{"dim":"value1"}'::jsonb, 100)`,
      );
      await db.query(
        `insert into slice_fetches (table_id, filter_key, filter, row_count)
         values ('99999TST', 'key2', '{"dim":"value2"}'::jsonb, 200)`,
      );

      // Verify both records exist
      const { rows } = await db.query(
        `select count(*) as cnt from slice_fetches where table_id = '99999TST'`,
      );
      expect(rows[0]!.cnt).toBe(2);
    });
  });
});
