// Migration 032 (WP30c phase E1, ADR 048 D7(b)): the additive nullable
// `request_urls text[]` column on ingestion_batches. Verifies the migration
// is picked up by the scan, that a legacy-shaped batch insert (every batch
// today) still defaults to NULL, and that a batch can carry the real request
// URL(s) it fetched. Mirrors migration-016/030/031.test.ts's shape.
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

async function insertTable(db: Db, id: string): Promise<void> {
  await db.query(
    `insert into cbs_tables (id, title, platform, expected_dimensions)
     values ($1, 'Testtabel', 'v4', '[]'::jsonb)`,
    [id],
  );
}

describe('migration 032 is picked up by the migration scan', () => {
  it('applyMigrations records 032_ingestion_batch_request_urls.sql as applied', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        "select name from schema_migrations where name like '032_%' order by name",
      );
      expect(rows.map((r) => r.name)).toEqual(['032_ingestion_batch_request_urls.sql']);
    });
  });

  it('re-running applyMigrations against the same db is a no-op (idempotent scan)', async () => {
    await withDb(async (db) => {
      const applied = await applyMigrations(db, MIGRATIONS_DIR);
      expect(applied).toEqual([]);
    });
  });
});

describe('ingestion_batches.request_urls — additive, nullable, byte-identical for a legacy-shaped insert', () => {
  it('a legacy-shaped insert (no request_urls named) defaults to NULL', async () => {
    await withDb(async (db) => {
      await insertTable(db, '99999TST');
      const { rows } = await db.query(
        `insert into ingestion_batches (table_id) values ('99999TST') returning request_urls`,
      );
      expect(rows[0]!.request_urls).toBeNull();
    });
  });

  it('a batch can carry the real request URL(s) it fetched', async () => {
    await withDb(async (db) => {
      await insertTable(db, '99999TST');
      const urls = [
        'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/tps00001',
      ];
      const { rows } = await db.query(
        `insert into ingestion_batches (table_id, request_urls) values ($1, $2) returning request_urls`,
        ['99999TST', urls],
      );
      expect(rows[0]!.request_urls).toEqual(urls);
    });
  });
});
