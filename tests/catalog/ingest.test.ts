// Catalog-mirror ingest: hermetic (PGlite), against the real catalog fixture.
// Proves idempotency and the timestamp-based prune of delisted tables.
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadCatalogFixture } from '../../src/cbs-adapter/fixture-source.ts';
import { ingestCatalog } from '../../src/catalog/ingest.ts';
import type { CbsCatalogEntry, CbsSource } from '../../src/cbs-adapter/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import type { Db } from '../../src/db/types.ts';
import { CBS_SOURCE_KEY } from '../../src/sources/registry.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

/** A minimal CbsSource that only serves a fixed catalog (the other methods are
 *  never called by ingest). Lets a test control the exact entry set. */
function catalogOnlySource(entries: CbsCatalogEntry[]): CbsSource {
  return {
    fetchTableSchema: () => Promise.reject(new Error('unused')),
    fetchCodeList: () => Promise.reject(new Error('unused')),
    fetchObservations: () => {
      throw new Error('unused');
    },
    fetchObservationCount: () => Promise.reject(new Error('unused')),
    fetchCatalog: () => Promise.resolve(entries),
  };
}

async function countCatalog(db: Db): Promise<number> {
  const { rows } = await db.query('select count(*)::int as n from cbs_catalog');
  return (rows[0] as { n: number }).n;
}

describe('ingestCatalog', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it('ingests the real catalog fixture and is idempotent (re-run upserts, prunes nothing)', async () => {
    const source = new FixtureSource({}, loadCatalogFixture(FIXTURES_DIR));
    const first = await ingestCatalog(db, source, CBS_SOURCE_KEY);
    expect(first.fetched).toBeGreaterThan(20);
    expect(first.upserted).toBe(first.fetched);
    expect(first.pruned).toBe(0);
    const n1 = await countCatalog(db);
    expect(n1).toBe(first.fetched);

    const second = await ingestCatalog(db, source, CBS_SOURCE_KEY);
    expect(second.fetched).toBe(first.fetched);
    expect(second.pruned).toBe(0);
    expect(await countCatalog(db)).toBe(n1); // no duplicates, no growth
  });

  it('updates a changed title in place (upsert, not insert)', async () => {
    const before: CbsCatalogEntry = {
      tableId: 'AAA',
      title: 'Oud',
      summary: 's',
      status: 'Regulier',
      datasetType: 'Numeric',
      language: 'nl',
      modified: null,
    };
    await ingestCatalog(db, catalogOnlySource([before]), CBS_SOURCE_KEY);
    await ingestCatalog(db, catalogOnlySource([{ ...before, title: 'Nieuw' }]), CBS_SOURCE_KEY);
    expect(await countCatalog(db)).toBe(1);
    const { rows } = await db.query('select title from cbs_catalog where table_id = $1', ['AAA']);
    expect((rows[0] as { title: string }).title).toBe('Nieuw');
  });

  it('prunes tables that disappear from a later refresh', async () => {
    const a: CbsCatalogEntry = {
      tableId: 'A',
      title: 'A',
      summary: '',
      status: null,
      datasetType: 'Numeric',
      language: 'nl',
      modified: null,
    };
    const b: CbsCatalogEntry = { ...a, tableId: 'B', title: 'B' };
    await ingestCatalog(db, catalogOnlySource([a, b]), CBS_SOURCE_KEY);
    expect(await countCatalog(db)).toBe(2);

    const result = await ingestCatalog(db, catalogOnlySource([a]), CBS_SOURCE_KEY); // B delisted
    expect(result.pruned).toBe(1);
    expect(await countCatalog(db)).toBe(1);
    const { rows } = await db.query('select table_id from cbs_catalog');
    expect(rows.map((r) => (r as { table_id: string }).table_id)).toEqual(['A']);
  });

  // WP30c E1 (Amendment B6): ingestCatalog gained a required `sourceKey`
  // parameter and now both stamps every upserted row's `source` column and
  // scopes the prune's WHERE clause by it. This test pins that a CBS-only
  // refresh's fetched/upserted/pruned counts and surviving row set are
  // BYTE-IDENTICAL to the pre-change behavior (the assertions above, in
  // 'prunes tables that disappear from a later refresh', already prove the
  // counts are unchanged) — it additionally proves the new `source` column
  // itself is stamped correctly, which no test before this change could, and
  // which the isolation test below depends on for its own claim to hold.
  it('a CBS-only refresh stamps every row source=cbs and prunes exactly as before this change', async () => {
    const a: CbsCatalogEntry = {
      tableId: 'A',
      title: 'A',
      summary: '',
      status: null,
      datasetType: 'Numeric',
      language: 'nl',
      modified: null,
    };
    const b: CbsCatalogEntry = { ...a, tableId: 'B', title: 'B' };
    await ingestCatalog(db, catalogOnlySource([a, b]), CBS_SOURCE_KEY);
    expect(await countCatalog(db)).toBe(2);

    const result = await ingestCatalog(db, catalogOnlySource([a]), CBS_SOURCE_KEY); // B delisted
    expect(result.fetched).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.pruned).toBe(1); // identical to the pre-sourceKey behavior
    expect(await countCatalog(db)).toBe(1);

    const { rows } = await db.query('select table_id, source from cbs_catalog');
    expect(rows).toEqual([{ table_id: 'A', source: 'cbs' }]);
  });

  it('never prunes to empty on a zero-row fetch (suspect result guard)', async () => {
    const a: CbsCatalogEntry = {
      tableId: 'A',
      title: 'A',
      summary: '',
      status: null,
      datasetType: 'Numeric',
      language: 'nl',
      modified: null,
    };
    await ingestCatalog(db, catalogOnlySource([a]), CBS_SOURCE_KEY);
    const result = await ingestCatalog(db, catalogOnlySource([]), CBS_SOURCE_KEY);
    expect(result).toEqual({ fetched: 0, upserted: 0, pruned: 0, flips: [] });
    expect(await countCatalog(db)).toBe(1); // untouched
  });

  // #108: a REGISTERED table (cbs_tables) going non-current at the source.
  async function registerTable(db: Db, id: string): Promise<void> {
    await db.query(
      `insert into cbs_tables (id, title, expected_dimensions) values ($1, $2, '[]'::jsonb)`,
      [id, id],
    );
  }

  it('#108: flags a REGISTERED table flipping from a current to a non-current status', async () => {
    const reg: CbsCatalogEntry = {
      tableId: 'REG1',
      title: 'Geregistreerd',
      summary: '',
      status: 'Regulier',
      datasetType: 'Numeric',
      language: 'nl',
      modified: null,
    };
    await registerTable(db, 'REG1');
    const first = await ingestCatalog(db, catalogOnlySource([reg]), CBS_SOURCE_KEY);
    expect(first.flips).toEqual([]); // first sync, nothing to compare against

    const flipped = await ingestCatalog(db, catalogOnlySource([{ ...reg, status: 'Gediscontinueerd' }]), CBS_SOURCE_KEY);
    expect(flipped.flips).toEqual([{ tableId: 'REG1', oldStatus: 'Regulier', newStatus: 'Gediscontinueerd' }]);
  });

  it('#108: does NOT flag a registered table that stays current, or an unregistered one that goes discontinued', async () => {
    const reg: CbsCatalogEntry = {
      tableId: 'REG2',
      title: 'Geregistreerd, stabiel',
      summary: '',
      status: 'Regulier',
      datasetType: 'Numeric',
      language: 'nl',
      modified: null,
    };
    const unreg: CbsCatalogEntry = { ...reg, tableId: 'UNREG', title: 'Niet geregistreerd' };
    await registerTable(db, 'REG2');
    await ingestCatalog(db, catalogOnlySource([reg, unreg]), CBS_SOURCE_KEY);

    const stillRegular = await ingestCatalog(db, catalogOnlySource([reg, unreg]), CBS_SOURCE_KEY); // no change
    expect(stillRegular.flips).toEqual([]);

    // UNREG going discontinued is a real catalog change but NOT a flip we
    // alert on — #108 is scoped to tables we actually serve answers from.
    const unregDiscontinued = await ingestCatalog(
      db,
      catalogOnlySource([reg, { ...unreg, status: 'Gediscontinueerd' }]),
      CBS_SOURCE_KEY,
    );
    expect(unregDiscontinued.flips).toEqual([]);
  });

  it('#108: flags a registered table that VANISHES from the catalog fetch entirely (not just a status change)', async () => {
    const reg: CbsCatalogEntry = {
      tableId: 'REG3',
      title: 'Verdwijnt straks',
      summary: '',
      status: 'Regulier',
      datasetType: 'Numeric',
      language: 'nl',
      modified: null,
    };
    await registerTable(db, 'REG3');
    await ingestCatalog(db, catalogOnlySource([reg]), CBS_SOURCE_KEY);

    const vanished = await ingestCatalog(db, catalogOnlySource([]), CBS_SOURCE_KEY); // suspect-result guard: fetched 0
    // The zero-fetch guard short-circuits before any diffing happens — this
    // is the SAME "never wipe on a suspect empty fetch" protection the prune
    // guard above relies on, so no flip fires from a suspect zero-row fetch.
    expect(vanished.flips).toEqual([]);

    // A REAL non-empty fetch that simply no longer lists REG3 (e.g. a fixed
    // small catalog with one other real row) is the genuine vanish case.
    const other: CbsCatalogEntry = { ...reg, tableId: 'OTHER', title: 'Iets anders' };
    const reallyGone = await ingestCatalog(db, catalogOnlySource([other]), CBS_SOURCE_KEY);
    expect(reallyGone.flips).toEqual([{ tableId: 'REG3', oldStatus: 'Regulier', newStatus: null }]);
  });

  // WP30c E1 (Amendment B6): cross-source isolation. Before this change, the
  // prune had no `source` predicate at all — a refresh for ANY source would
  // delete every stale row regardless of which source it belonged to. This
  // test would fail if that predicate were removed: both hand-inserted rows
  // below are equally stale, so an unscoped prune deletes both, not just the
  // one belonging to the refreshed source.
  it('a refresh scoped to one source key cannot delete another source\'s catalog row', async () => {
    const OLD_TS = '2000-01-01T00:00:00Z';
    // Hand-inserted directly (not via ingestCatalog) so each row's `source`
    // is exactly controlled. migration 016's CHECK constraint requires a
    // non-cbs source's table_id to carry that source's ':' prefix.
    await db.query(`insert into cbs_catalog (table_id, title, source, refreshed_at) values ($1, $2, $3, $4)`, [
      'CBSOLD',
      'Oude CBS-tabel',
      'cbs',
      OLD_TS,
    ]);
    await db.query(`insert into cbs_catalog (table_id, title, source, refreshed_at) values ($1, $2, $3, $4)`, [
      'eurostat:OTHER',
      'Andere bron',
      'eurostat',
      OLD_TS,
    ]);
    expect(await countCatalog(db)).toBe(2);

    // A CBS-scoped refresh that no longer lists CBSOLD: it must prune CBSOLD
    // (same source, stale) but must NEVER touch the eurostat row, even though
    // that row's refreshed_at is equally stale.
    const cbsNew: CbsCatalogEntry = {
      tableId: 'CBSNEW',
      title: 'Nieuwe CBS-tabel',
      summary: '',
      status: null,
      datasetType: 'Numeric',
      language: 'nl',
      modified: null,
    };
    const result = await ingestCatalog(db, catalogOnlySource([cbsNew]), CBS_SOURCE_KEY);
    expect(result.pruned).toBe(1); // only CBSOLD — never the eurostat row

    const { rows } = await db.query('select table_id, source from cbs_catalog order by table_id');
    expect(rows).toEqual([
      { table_id: 'CBSNEW', source: 'cbs' },
      { table_id: 'eurostat:OTHER', source: 'eurostat' },
    ]);
  });
});
