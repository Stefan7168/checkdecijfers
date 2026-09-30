// compareTableWithSource (ADR 065 step 2, decision D7): the read-only parity report — what CBS returns for a
// table's planned slice requests against the cells stored today. The stored side is loaded by the whole-table
// path (registerTables + syncTable) from fixtures; the source is a FixtureSource over the same fixtures, or a
// wrapper of it that misbehaves in one chosen way.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { CbsObservationRow, CbsSource } from '../../src/cbs-adapter/types.ts';
import type { Db } from '../../src/db/types.ts';
import { compareTableWithSource } from '../../src/ingestion/parity.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const FAR = Number.MAX_SAFE_INTEGER;

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await db.query(
    'truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade',
  );
});

function seedTable(id: string) {
  const t = SEED_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no Phase0Table registry entry for ${id}`);
  return t;
}

/** Whole-table load, exactly as production does it today. */
async function loadWhole(tableId: string): Promise<FixtureSource> {
  const source = new FixtureSource(loadFixtureDocs(`${FIXTURES_DIR}/${tableId}`));
  await registerTables(db, source, [seedTable(tableId)]);
  const result = await syncTable(db, source, tableId);
  if (result.outcome !== 'succeeded') throw new Error(`sync of ${tableId} did not succeed`);
  return source;
}

/** A source that behaves like `inner` except for the given methods. */
function over(inner: CbsSource, patch: Partial<CbsSource>): CbsSource {
  return Object.assign(Object.create(inner) as CbsSource, patch);
}

/** `inner`'s observations with every row for which `drop` is true removed. */
function dropping(inner: CbsSource, drop: (row: CbsObservationRow) => boolean): CbsSource {
  return over(inner, {
    fetchObservations: (tableId, slice, names) =>
      (async function* () {
        for await (const page of inner.fetchObservations(tableId, slice, names)) yield page.filter((r) => !drop(r));
      })(),
  });
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await db.query(sql, params)).rows[0]!.n);
}

interface StoredRow {
  id: number;
  measure: string;
  region_code: string;
  period_code: string;
  value: unknown;
  status: string;
  batch_id: number;
}

/** The first stored row with a value, in a stable order. */
async function firstStored(tableId: string): Promise<StoredRow> {
  const r = await db.query(
    `select id, measure, region_code, period_code, value, status, batch_id
       from observations where table_id = $1 and value is not null order by id limit 1`,
    [tableId],
  );
  return r.rows[0] as unknown as StoredRow;
}

/** 83625NED has only a region and a period, so measure + region + period is one cell. */
const isCell = (row: StoredRow) => (r: CbsObservationRow) => {
  const coordinates = Object.values(r.coordinates).map((c) => c.trim());
  return r.measure === row.measure && coordinates.includes(row.region_code) && coordinates.includes(row.period_code);
};

describe('compareTableWithSource: identical', () => {
  for (const tableId of ['03759ned', '83625NED']) {
    it(`a freshly synced ${tableId} equals what the same fixtures return`, async () => {
      const source = await loadWhole(tableId);
      const report = await compareTableWithSource(db, source, tableId, { deadline: FAR });
      expect(report.error).toBeUndefined();
      expect(report.complete).toBe(true);
      expect(report.diffs).toEqual([]);
      expect(report.diffCounts).toEqual({ value_differs: 0, status_differs: 0, missing_in_store: 0, missing_at_source: 0 });
      const stored = await count('select count(*)::int as n from observations where table_id = $1', [tableId]);
      expect(stored).toBeGreaterThan(0);
      expect(report.storedCells).toBe(stored);
      expect(report.fetchedCells).toBe(stored);
      expect(report.identical).toBe(stored);
      expect(report.retained).toBe(0);
      expect(report.requests).toBeGreaterThan(0);
      expect(report.requestsFetched).toBe(report.requests);
    });
  }
});

describe('compareTableWithSource: differences', () => {
  it('one changed stored value is one value_differs with both sides shown', async () => {
    const source = await loadWhole('83625NED');
    const row = await firstStored('83625NED');
    await db.query('update observations set value = value + 1 where id = $1', [row.id]);
    const report = await compareTableWithSource(db, source, '83625NED', { deadline: FAR });
    expect(report.complete).toBe(true);
    expect(report.diffCounts).toEqual({ value_differs: 1, status_differs: 0, missing_in_store: 0, missing_at_source: 0 });
    const diff = report.diffs[0]!;
    expect(diff.kind).toBe('value_differs');
    expect(diff.measure).toBe(row.measure);
    expect(diff.periodCode).toBe(row.period_code);
    expect(diff.fetched!.value).toBe(Number(row.value));
    expect(diff.stored!.value).toBe(Number(row.value) + 1);
    expect(diff.stored!.status).toBe(row.status);
    expect(diff.fetched!.status).toBe(row.status);
    expect(report.identical).toBe(report.storedCells - 1);
  });

  it('one changed stored status is one status_differs', async () => {
    const source = await loadWhole('83625NED');
    const row = await firstStored('83625NED');
    await db.query(`update observations set status = 'Voorlopig-test' where id = $1`, [row.id]);
    const report = await compareTableWithSource(db, source, '83625NED', { deadline: FAR });
    expect(report.diffCounts).toEqual({ value_differs: 0, status_differs: 1, missing_in_store: 0, missing_at_source: 0 });
    expect(report.diffs[0]).toMatchObject({
      kind: 'status_differs',
      stored: { status: 'Voorlopig-test' },
      fetched: { status: row.status },
    });
  });

  it('one deleted stored row is one missing_in_store', async () => {
    const source = await loadWhole('83625NED');
    const row = await firstStored('83625NED');
    await db.query('delete from observations where id = $1', [row.id]);
    const report = await compareTableWithSource(db, source, '83625NED', { deadline: FAR });
    expect(report.diffCounts).toEqual({ value_differs: 0, status_differs: 0, missing_in_store: 1, missing_at_source: 0 });
    expect(report.diffs[0]!.kind).toBe('missing_in_store');
    expect(report.diffs[0]!.stored).toBeUndefined();
    expect(report.diffs[0]!.fetched!.value).toBe(Number(row.value));
    expect(report.storedCells).toBe(report.fetchedCells - 1);
  });

  it('a source that drops one row is one missing_at_source, not retained', async () => {
    const source = await loadWhole('83625NED');
    const row = await firstStored('83625NED');
    const report = await compareTableWithSource(db, dropping(source, isCell(row)), '83625NED', { deadline: FAR });
    expect(report.diffCounts).toEqual({ value_differs: 0, status_differs: 0, missing_in_store: 0, missing_at_source: 1 });
    expect(report.diffs[0]).toMatchObject({ kind: 'missing_at_source', retained: false, measure: row.measure });
    expect(report.diffs[0]!.fetched).toBeUndefined();
    expect(report.retained).toBe(0);
  });

  it('a stored cell CBS withdrew (marked retained) is missing_at_source and counted in retained', async () => {
    const source = await loadWhole('83625NED');
    const row = await firstStored('83625NED');
    await db.query('update observations set last_seen_batch_id = $2 where id = $1', [row.id, row.batch_id]);
    const report = await compareTableWithSource(db, dropping(source, isCell(row)), '83625NED', { deadline: FAR });
    expect(report.retained).toBe(1);
    const flagged = report.diffs.filter((d) => d.retained);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ kind: 'missing_at_source', measure: row.measure, periodCode: row.period_code });
    expect(flagged[0]!.note).toMatch(/retained/i);
  });

  it('maxDiffs caps the list, never the counts', async () => {
    const source = await loadWhole('83625NED');
    await db.query('update observations set value = value + 1 where table_id = $1 and value is not null', ['83625NED']);
    const all = await compareTableWithSource(db, source, '83625NED', { deadline: FAR });
    expect(all.diffCounts.value_differs).toBeGreaterThan(3);
    const capped = await compareTableWithSource(db, source, '83625NED', { deadline: FAR, maxDiffs: 3 });
    expect(capped.diffs).toHaveLength(3);
    expect(capped.diffCounts).toEqual(all.diffCounts);
    expect(all.diffs).toHaveLength(Math.min(50, all.diffCounts.value_differs));
  });
});

describe('compareTableWithSource: limits and failures', () => {
  it('a deadline reached after the first request stops there', async () => {
    const source = await loadWhole('83625NED');
    let calls = 0;
    // Time 0 before the first request, then always past the deadline (10).
    const now = () => (calls++ === 0 ? 0 : 100);
    const report = await compareTableWithSource(db, source, '83625NED', { deadline: 10, maxCells: 20, now });
    expect(report.requests).toBeGreaterThan(1);
    expect(report.requestsFetched).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/deadline/i);
  });

  it('a source whose fetch throws gives complete: false with the message, and no throw', async () => {
    const source = await loadWhole('83625NED');
    const failing = over(source, {
      fetchObservations: () => {
        throw new Error('CBS is on fire');
      },
    });
    const report = await compareTableWithSource(db, failing, '83625NED', { deadline: FAR });
    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/CBS is on fire/);
    expect(report.requestsFetched).toBe(0);
  });

  it('writes nothing', async () => {
    const source = await loadWhole('03759ned');
    const snapshot = async () => ({
      observations: await count('select count(*)::int as n from observations'),
      batches: await count('select count(*)::int as n from ingestion_batches'),
      sliceFetches: await count('select count(*)::int as n from slice_fetches'),
      table: (await db.query('select id, version, last_sync_at from cbs_tables order by id')).rows,
      lastSeen: await count('select count(*)::int as n from observations where last_seen_batch_id is not null'),
    });
    const before = await snapshot();
    await compareTableWithSource(db, source, '03759ned', { deadline: FAR });
    await compareTableWithSource(db, source, '03759ned', { deadline: FAR, maxCells: 1000 });
    expect(await snapshot()).toEqual(before);
  });
});
