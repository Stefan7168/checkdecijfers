// Migration 016 (WP30a, ADR 030 D4): the additive source column + the
// id-shape CHECK on cbs_tables/cbs_catalog, and the widened platform check.
// Verifies the behavior the migration claims — defaults on existing-shaped
// inserts, the prefix convention enforced by the database itself, and that
// the OLD inline platform check ('v4' only) is really gone (its
// auto-generated name is what 016 drops; a wrong name would silently leave
// both checks active and block every non-v4 adapter).
//
// NOTE: applied here (PGlite) and in CI only — production waits for the
// owner-supervised live step. WP30a code never reads these columns.
import { describe, expect, it } from 'vitest';
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

async function insertTable(db: Db, id: string, opts: { source?: string; platform?: string } = {}): Promise<void> {
  if (opts.source === undefined) {
    // Legacy-shaped insert: names no 016 column — the SQL every current
    // deploy runs.
    await db.query(
      `insert into cbs_tables (id, title, platform, expected_dimensions)
       values ($1, 'Testtabel', $2, '[]'::jsonb)`,
      [id, opts.platform ?? 'v4'],
    );
    return;
  }
  await db.query(
    `insert into cbs_tables (id, title, platform, expected_dimensions, source)
     values ($1, 'Testtabel', $2, '[]'::jsonb, $3)`,
    [id, opts.platform ?? 'v4', opts.source],
  );
}

describe('migration 016 — source identity columns (D4)', () => {
  it("a legacy-shaped insert defaults to source 'cbs' on both tables", async () => {
    await withDb(async (db) => {
      await insertTable(db, '99999TST');
      const { rows } = await db.query(`select source from cbs_tables where id = '99999TST'`);
      expect(rows[0]!.source).toBe('cbs');

      await db.query(
        `insert into cbs_catalog (table_id, title, status, dataset_type)
         values ('99999TST', 'Testtabel', 'Regulier', 'Numeric')`,
      );
      const catalog = await db.query(`select source from cbs_catalog where table_id = '99999TST'`);
      expect(catalog.rows[0]!.source).toBe('cbs');
    });
  });

  it('a second source MUST prefix its ids (the CHECK is a database fact)', async () => {
    await withDb(async (db) => {
      // Correctly prefixed: accepted — on both tables.
      await insertTable(db, 'lisa:12345', { source: 'lisa', platform: 'lisa-api' });
      await db.query(
        `insert into cbs_catalog (table_id, title, source) values ('lisa:12345', 'Testtabel', 'lisa')`,
      );
      // Bare id under a non-cbs source: refused by the CHECK, on both tables.
      await expect(insertTable(db, '12345', { source: 'lisa', platform: 'lisa-api' })).rejects.toThrow(
        /cbs_tables_source_id_shape/,
      );
      await expect(
        db.query(`insert into cbs_catalog (table_id, title, source) values ('12345', 'Testtabel', 'lisa')`),
      ).rejects.toThrow(/cbs_catalog_source_id_shape/);
    });
  });

  it("the old platform check ('v4' only) is really dropped — a non-v4 platform inserts", async () => {
    await withDb(async (db) => {
      await insertTable(db, 'lisa:67890', { source: 'lisa', platform: 'lisa-api' });
      const { rows } = await db.query(`select platform from cbs_tables where id = 'lisa:67890'`);
      expect(rows[0]!.platform).toBe('lisa-api');
      // The widened check still refuses an empty platform.
      await expect(insertTable(db, 'lisa:00000', { source: 'lisa', platform: '' })).rejects.toThrow(
        /cbs_tables_platform_check/,
      );
    });
  });
});
