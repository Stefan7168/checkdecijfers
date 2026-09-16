// Migration 032 (WP30c phase E1, ADR 048 D7(a)): the additive nullable `doi`
// column on cbs_tables/cbs_catalog. Verifies the migration is picked up by
// the scan, that it is a true no-op for every existing (CBS-shaped) row —
// NULL by default, no NOT NULL, no CHECK narrowing what a legacy insert can
// do — and that a Eurostat-shaped row can carry a real DOI value. Mirrors
// migration-016/030.test.ts's shape.
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

describe('migration 032 is picked up by the migration scan', () => {
  it('applyMigrations records 032_source_doi.sql as applied', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        "select name from schema_migrations where name like '032_%' order by name",
      );
      expect(rows.map((r) => r.name)).toEqual(['032_source_doi.sql']);
    });
  });

  it('re-running applyMigrations against the same db is a no-op (idempotent scan)', async () => {
    await withDb(async (db) => {
      const applied = await applyMigrations(db, MIGRATIONS_DIR);
      expect(applied).toEqual([]);
    });
  });
});

describe('cbs_tables.doi — additive, nullable, byte-identical for a legacy-shaped (CBS) insert', () => {
  it('a legacy-shaped insert (no doi named) defaults to NULL', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into cbs_tables (id, title, platform, expected_dimensions)
         values ('99999TST', 'Testtabel', 'v4', '[]'::jsonb)`,
      );
      const { rows } = await db.query(`select doi from cbs_tables where id = '99999TST'`);
      expect(rows[0]!.doi).toBeNull();
    });
  });

  it('a Eurostat-shaped row can carry a real DOI value', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into cbs_tables (id, title, platform, expected_dimensions, source, doi)
         values ('eurostat:tps00001', 'Test EU tabel', 'eurostat-api', '[]'::jsonb, 'eurostat', '10.2908/TPS00001')`,
      );
      const { rows } = await db.query(
        `select doi from cbs_tables where id = 'eurostat:tps00001'`,
      );
      expect(rows[0]!.doi).toBe('10.2908/TPS00001');
    });
  });
});

describe('cbs_catalog.doi — additive, nullable, byte-identical for a legacy-shaped (CBS) insert', () => {
  it('a legacy-shaped insert (no doi named) defaults to NULL', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into cbs_catalog (table_id, title, status, dataset_type)
         values ('99999TST', 'Testtabel', 'Regulier', 'Numeric')`,
      );
      const { rows } = await db.query(`select doi from cbs_catalog where table_id = '99999TST'`);
      expect(rows[0]!.doi).toBeNull();
    });
  });

  it('a Eurostat-shaped row can carry a real DOI value', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into cbs_catalog (table_id, title, source, doi)
         values ('eurostat:tps00001', 'Test EU tabel', 'eurostat', '10.2908/TPS00001')`,
      );
      const { rows } = await db.query(
        `select doi from cbs_catalog where table_id = 'eurostat:tps00001'`,
      );
      expect(rows[0]!.doi).toBe('10.2908/TPS00001');
    });
  });
});
