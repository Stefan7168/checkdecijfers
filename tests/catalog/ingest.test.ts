// Catalog-mirror ingest: hermetic (PGlite), against the real catalog fixture.
// Proves idempotency and the timestamp-based prune of delisted tables.
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadCatalogFixture } from '../../src/cbs-adapter/fixture-source.ts';
import { ingestCatalog } from '../../src/catalog/ingest.ts';
import type { CbsCatalogEntry, CbsSource } from '../../src/cbs-adapter/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import type { Db } from '../../src/db/types.ts';

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
    const first = await ingestCatalog(db, source);
    expect(first.fetched).toBeGreaterThan(20);
    expect(first.upserted).toBe(first.fetched);
    expect(first.pruned).toBe(0);
    const n1 = await countCatalog(db);
    expect(n1).toBe(first.fetched);

    const second = await ingestCatalog(db, source);
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
    await ingestCatalog(db, catalogOnlySource([before]));
    await ingestCatalog(db, catalogOnlySource([{ ...before, title: 'Nieuw' }]));
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
    await ingestCatalog(db, catalogOnlySource([a, b]));
    expect(await countCatalog(db)).toBe(2);

    const result = await ingestCatalog(db, catalogOnlySource([a])); // B delisted
    expect(result.pruned).toBe(1);
    expect(await countCatalog(db)).toBe(1);
    const { rows } = await db.query('select table_id from cbs_catalog');
    expect(rows.map((r) => (r as { table_id: string }).table_id)).toEqual(['A']);
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
    await ingestCatalog(db, catalogOnlySource([a]));
    const result = await ingestCatalog(db, catalogOnlySource([]));
    expect(result).toEqual({ fetched: 0, upserted: 0, pruned: 0 });
    expect(await countCatalog(db)).toBe(1); // untouched
  });
});
