// The warm job (ADR 065 step 2; design 2026-09-30-one-route-warm-slices-design.md
// D1/D2/D4/D6): a pinned slice-cache table's declared scope is filled and kept
// current through bounded slice requests, each stored/validated/dated by the slice
// store. The heart: the cells it stores equal, cell for cell, what the whole-table
// path (registerTables + syncTable) stores from the same CBS responses. Same
// PGlite/FixtureSource pattern as slice-cache-pinned.test.ts (real parsing, ADR 003).
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixtureSource, loadFixtureDocs, type FixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { CbsSource } from '../../src/cbs-adapter/types.ts';
import type { Db } from '../../src/db/types.ts';
import { runCli } from '../../src/ingestion/cli.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES, type Phase0Table } from '../../src/ingestion/registry-seed.ts';
import {
  ensureSlice,
  fetchSlice,
  registerSchemaOnly,
  sliceFilterKey,
  type SliceRequest,
} from '../../src/ingestion/slice-cache.ts';
import { WARM_MAX_CELLS, warmPinnedTables, warmTable } from '../../src/ingestion/warm-job.ts';
import { loadWarmScope, planWarmSlices } from '../../src/ingestion/warm-plan.ts';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

let sliceDb: Db;
let fullDb: Db;
let closeSlice: () => Promise<void>;
let closeFull: () => Promise<void>;

beforeAll(async () => {
  ({ db: sliceDb, close: closeSlice } = await createTestDb());
  ({ db: fullDb, close: closeFull } = await createTestDb());
});

afterAll(async () => {
  await closeSlice();
  await closeFull();
});

beforeEach(async () => {
  for (const db of [sliceDb, fullDb]) {
    await db.query(
      'truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade',
    );
  }
});

const FAR = () => Date.now() + 3_600_000;
const POP = '03759ned'; // declared scope: pinned dims, NL/PV/GM regions, 2019+
const HOUSES = '83625NED'; // no declared scope (the whole table)
const GDP = '85880NED'; // curated: 17 excluded measures
const POP_DIMS = { Geslacht: 'T001038', Leeftijd: '10000', BurgerlijkeStaat: 'T001019' };

function seedEntry(id: string): Phase0Table {
  const t = SEED_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no seed entry for ${id}`);
  return t;
}

function docsFor(id: string): FixtureDocs {
  return loadFixtureDocs(`${FIXTURES_DIR}/${id}`);
}

async function registerPinned(db: Db, source: CbsSource, id: string): Promise<void> {
  const t = seedEntry(id);
  const result = await registerSchemaOnly(db, source, id, undefined, {
    pinned: true,
    updateCadence: t.updateCadence,
    slice: t.slice ?? null,
    excludeMeasures: t.excludeMeasures,
  });
  if (!result.ok) throw new Error(`registration of ${id} failed: ${result.summary}`);
}

async function wholeTable(id: string, source: CbsSource): Promise<void> {
  await registerTables(fullDb, source, [seedEntry(id)], { pinned: true });
  const synced = await syncTable(fullDb, source, id);
  if (synced.outcome !== 'succeeded') throw new Error(`whole-table sync of ${id} failed: ${synced.failureSummary}`);
}

/** Counts every source call, by kind; optionally fails one table's data requests. */
function counting(inner: CbsSource, failObservationsFor?: string) {
  const calls = { schema: 0, codeLists: 0, observations: 0 };
  const source: CbsSource = {
    fetchTableSchema: (t, s) => {
      calls.schema++;
      return inner.fetchTableSchema(t, s);
    },
    fetchCodeList: (t, d, s) => {
      calls.codeLists++;
      return inner.fetchCodeList(t, d, s);
    },
    fetchObservations: (t, s, n) => {
      calls.observations++;
      if (t === failObservationsFor) {
        return (async function* () {
          throw new Error('CBS unreachable (simulated)');
        })();
      }
      return inner.fetchObservations(t, s, n);
    },
    fetchObservationCount: (t) => inner.fetchObservationCount(t),
    fetchCatalog: () => inner.fetchCatalog(),
  };
  return { source, calls };
}

function parsed<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** Every stored cell of a table, in a stable order, with every column a reader
 * sees (batch ids differ by construction and are left out). */
async function storedCells(db: Db, tableId: string) {
  const { rows } = await db.query(
    `select measure, region_code, period_code, period_grain, period_year, period_index, dims::text as dims,
            value::text as value, unit, decimals, status, value_attribute,
            (last_seen_batch_id is null) as present
       from observations where table_id = $1
      order by measure, region_code, period_code, dims::text`,
    [tableId],
  );
  return rows.map((r) => ({ ...r, dims: parsed<Record<string, string>>(r.dims) }));
}

async function sliceKeys(db: Db, tableId: string): Promise<string[]> {
  const { rows } = await db.query('select filter_key from slice_fetches where table_id = $1 order by filter_key', [
    tableId,
  ]);
  return rows.map((r) => r.filter_key as string);
}

async function planKeys(db: Db, tableId: string): Promise<string[]> {
  return planWarmSlices(await loadWarmScope(db, tableId), { maxCells: WARM_MAX_CELLS })
    .requests.map(sliceFilterKey)
    .sort();
}

async function registry(db: Db, tableId: string) {
  return (await db.query('select * from cbs_tables where id = $1', [tableId])).rows[0]!;
}

function iso(value: unknown): string | null {
  return value == null ? null : new Date(value as string | Date).toISOString();
}

/** Per stored cell: the reader-visible date under the query layer's coverage rule
 * (src/query/run.ts sliceCovers: the latest checked_at among covering rows), or
 * null when nothing covers it. Keyed by the cell's coordinates. */
async function cellDates(db: Db, tableId: string, geoDim: string | null): Promise<Map<string, string | null>> {
  const slices = (await db.query('select filter, checked_at from slice_fetches where table_id = $1', [tableId])).rows.map(
    (r) => ({ filter: parsed<SliceRequest>(r.filter), checkedAt: iso(r.checked_at)! }),
  );
  const cells = (
    await db.query('select measure, region_code, period_code, dims from observations where table_id = $1', [tableId])
  ).rows;
  const out = new Map<string, string | null>();
  for (const c of cells) {
    const dims = parsed<Record<string, string>>(c.dims);
    let date: string | null = null;
    for (const s of slices) {
      const { measures, members, periods } = s.filter;
      if (!measures.includes(c.measure as string) || !periods.includes(c.period_code as string)) continue;
      if (geoDim && !(members[geoDim] ?? []).includes(c.region_code as string)) continue;
      if (!Object.entries(dims).every(([d, v]) => (members[d] ?? []).includes(v))) continue;
      if (date === null || s.checkedAt > date) date = s.checkedAt;
    }
    out.set(`${String(c.measure)}|${String(c.region_code)}|${String(c.period_code)}|${JSON.stringify(dims)}`, date);
  }
  return out;
}

function popIntent(regions: string[], periods: string[], measure = 'M000352'): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'explicit', tableId: POP, measure, dims: POP_DIMS },
    regions,
    period: { kind: 'codes', codes: periods },
    derivation: 'none',
  };
}

/** CBS publishes a newer Modified with one extra (provisional) year of data. */
function popWithNewYear(docs: FixtureDocs): FixtureDocs {
  const clone = structuredClone(docs);
  (clone.properties as Record<string, unknown>).Modified = '2026-09-29T00:00:00+02:00';
  const periods = (clone.codes as Record<string, { value: Record<string, unknown>[] }>)['Perioden']!;
  const last = periods.value[periods.value.length - 1]!;
  periods.value.push({ ...last, Identifier: '2027JJ00', Title: '2027*', Index: Number(last.Index) + 1, Status: 'Voorlopig' });
  const page = clone.observationPages[0] as { value: Record<string, unknown>[] };
  page.value.push(
    { Id: 999_001, Measure: 'M000352', ValueAttribute: 'None', Value: 18_100_000, StringValue: null, ...POP_DIMS, RegioS: 'NL01', Perioden: '2027JJ00' },
    { Id: 999_002, Measure: 'M000352', ValueAttribute: 'None', Value: 950_000, StringValue: null, ...POP_DIMS, RegioS: 'GM0363', Perioden: '2027JJ00' },
  );
  return clone;
}

describe('warmTable fills a pinned table’s declared scope', () => {
  it.each([[POP], [HOUSES], [GDP]])(
    '%s: complete, and the stored cells equal the whole-table path cell for cell',
    async (id) => {
      const docs = docsFor(id);
      const source = new FixtureSource(docs);
      await registerPinned(sliceDb, source, id);

      const result = await warmTable(sliceDb, source, id, { deadline: FAR() });
      expect(result.failure ?? null).toBeNull();
      expect(result).toMatchObject({ tableId: id, outcome: 'complete', confirmed: 0, remaining: 0 });
      expect(result.planned).toBeGreaterThan(1);
      expect(result.fetched).toBe(result.planned);

      await wholeTable(id, source);
      const warmed = await storedCells(sliceDb, id);
      const whole = await storedCells(fullDb, id);
      expect(warmed.length).toBeGreaterThan(0);
      expect(warmed.length).toBe(whole.length);
      expect(warmed).toEqual(whole);

      const row = await registry(sliceDb, id);
      expect(row.status).toBe('active');
      expect(row.needs_review_reason).toBeNull();
      expect(row.ingest_mode).toBe('slice_cache');
      expect(row.last_sync_at).not.toBeNull();
      expect(await sliceKeys(sliceDb, id)).toEqual(await planKeys(sliceDb, id));
    },
  );
});

describe('a second run', () => {
  it('confirms every request without a data request, and moves the reader-visible date forward', async () => {
    const docs = docsFor(POP);
    await registerPinned(sliceDb, new FixtureSource(docs), POP);
    const first = await warmTable(sliceDb, new FixtureSource(docs), POP, { deadline: FAR() });
    expect(first.outcome).toBe('complete');

    const intent = popIntent(['NL01', 'GM0363'], ['2024JJ00']);
    const before = await runQuery(sliceDb, intent);
    if (!before.ok) throw new Error(before.refusal.message);
    const firstSync = iso((await registry(sliceDb, POP)).last_sync_at)!;

    const startedAt = new Date().toISOString();
    const { source, calls } = counting(new FixtureSource(docs));
    const second = await warmTable(sliceDb, source, POP, { deadline: FAR() });
    const endedAt = new Date().toISOString();

    expect(second).toMatchObject({ outcome: 'complete', planned: first.planned, fetched: 0, remaining: 0 });
    expect(second.confirmed).toBe(first.planned);
    expect(calls).toEqual({ schema: 1, codeLists: 0, observations: 0 });

    const secondSync = iso((await registry(sliceDb, POP)).last_sync_at)!;
    expect(secondSync > firstSync).toBe(true);
    expect(secondSync >= startedAt && secondSync <= endedAt).toBe(true);

    const after = await runQuery(sliceDb, intent);
    if (!after.ok) throw new Error(after.refusal.message);
    expect(after.cells.map((c) => c.value)).toEqual(before.cells.map((c) => c.value));
    expect(after.attribution.syncedAt > before.attribution.syncedAt).toBe(true);
    // Dated by the run's CBS check, not a later moment.
    expect(after.attribution.syncedAt).toBe(secondSync);
  });
});

describe('the deadline', () => {
  it('stops a run part-way (partial), and a later run finishes it; only the complete run stamps last_sync_at', async () => {
    const docs = docsFor(POP);
    const source = new FixtureSource(docs);
    await registerPinned(sliceDb, source, POP);
    const k = 2;
    // now() is asked once before the schema check, then before each request.
    let calls = 0;
    const now = () => (calls++ < 1 + k ? 0 : 2_000);

    const first = await warmTable(sliceDb, source, POP, { deadline: 1_000, now });
    expect(first.planned).toBeGreaterThan(k);
    expect(first).toMatchObject({ outcome: 'partial', fetched: k, confirmed: 0, remaining: first.planned - k });
    expect(first.failure).toBeUndefined();
    expect((await registry(sliceDb, POP)).last_sync_at).toBeNull();
    expect((await sliceKeys(sliceDb, POP)).length).toBe(k);

    const second = await warmTable(sliceDb, source, POP, { deadline: FAR() });
    expect(second).toMatchObject({ outcome: 'complete', confirmed: k, fetched: first.planned - k, remaining: 0 });
    expect((await registry(sliceDb, POP)).last_sync_at).not.toBeNull();
  });

  it('warmPinnedTables starts no table once the deadline has passed', async () => {
    const source = new FixtureSource({ [POP]: docsFor(POP), [HOUSES]: docsFor(HOUSES) });
    await registerPinned(sliceDb, source, POP);
    await registerPinned(sliceDb, source, HOUSES);
    const popPlanned = (await planKeys(sliceDb, POP)).length;
    // now() is asked before each table, by warmTable's own gate, and before each
    // request: the first table (ids tie on "never warmed", so by id) runs whole.
    let calls = 0;
    const results = await warmPinnedTables(sliceDb, source, {
      deadline: 1_000,
      now: () => (calls++ < 2 + popPlanned ? 0 : 2_000),
    });
    expect(results.map((r) => r.tableId)).toEqual([POP, HOUSES]);
    expect(results[0]!.outcome).toBe('complete');
    expect(results[1]).toMatchObject({ outcome: 'skipped', skippedReason: 'deadline' });
  });
});

describe('when CBS changed the table', () => {
  it('re-fetches, stores the new period, drops obsolete in-scope records, keeps a reader’s out-of-scope record — and no cell loses coverage or gets an older date', async () => {
    const docs = docsFor(POP);
    await registerPinned(sliceDb, new FixtureSource(docs), POP);

    // A reader's question OUTSIDE the declared scope (another Geslacht), and one INSIDE it.
    const outside: SliceRequest = {
      measures: ['M000352'],
      members: { ...Object.fromEntries(Object.entries(POP_DIMS).map(([d, c]) => [d, [c]])), Geslacht: ['3000'], RegioS: ['NL01'] },
      periods: ['2024JJ00'],
    };
    const inside: SliceRequest = {
      measures: ['M000352', 'M000365'],
      members: { ...Object.fromEntries(Object.entries(POP_DIMS).map(([d, c]) => [d, [c]])), RegioS: ['NL01', 'GM0363'] },
      periods: ['2023JJ00', '2024JJ00'],
    };
    for (const req of [outside, inside]) {
      const r = await fetchSlice(sliceDb, new FixtureSource(docs), POP, req);
      if (!r.ok) throw new Error(r.summary);
    }

    const first = await warmTable(sliceDb, new FixtureSource(docs), POP, { deadline: FAR() });
    expect(first.outcome).toBe('complete');
    // The reader's in-scope record is now obsolete (the plan covers its cells) and gone.
    expect(await sliceKeys(sliceDb, POP)).toEqual([...(await planKeys(sliceDb, POP)), sliceFilterKey(outside)].sort());

    // A reader confirmation that lands AFTER the run's check is kept (its later
    // date must not be lost), even though its cells are inside the scope.
    const late = await fetchSlice(sliceDb, new FixtureSource(docs), POP, inside);
    if (!late.ok) throw new Error(late.summary);
    await sliceDb.query('update slice_fetches set checked_at = $3 where table_id = $1 and filter_key = $2', [
      POP,
      late.filterKey,
      '2099-01-01T00:00:00.000Z',
    ]);

    const oldPlanKeys = await planKeys(sliceDb, POP);
    const newer = popWithNewYear(docs);
    const { source, calls } = counting(new FixtureSource(newer));

    // Snapshot every cell's coverage and date inside the cleanup transaction,
    // right before the delete: the "before cleanup" state.
    let beforeCleanup: Map<string, string | null> | null = null;
    const hooked = (d: Db): Db => ({
      async query(text, params) {
        if (text.startsWith('delete from slice_fetches')) beforeCleanup = await cellDates(d, POP, 'RegioS');
        return d.query(text, params);
      },
      withTransaction: (fn) => d.withTransaction((tx) => fn(hooked(tx))),
    });

    const second = await warmTable(hooked(sliceDb), source, POP, { deadline: FAR() });
    expect(second.failure ?? null).toBeNull();
    expect(second).toMatchObject({ outcome: 'complete', confirmed: 0, remaining: 0 });
    expect(second.fetched).toBe(second.planned);
    expect(calls.schema).toBe(1); // one schema read, the refresh applied from it

    // The new period is in the plan and its cells are stored.
    const newPlanKeys = await planKeys(sliceDb, POP);
    expect(newPlanKeys.every((key) => (JSON.parse(key) as SliceRequest).periods.includes('2027JJ00'))).toBe(true);
    const nl = await runQuery(sliceDb, popIntent(['NL01'], ['2027JJ00']));
    if (!nl.ok) throw new Error(nl.refusal.message);
    expect(nl.cells[0]!.value).toBe(18_100_000);
    expect(nl.cells[0]!.status).toBe('Voorlopig');

    // Obsolete in-scope records are gone; the out-of-scope one and the later-confirmed one stay.
    const keys = await sliceKeys(sliceDb, POP);
    expect(keys).toEqual([...newPlanKeys, sliceFilterKey(outside), late.filterKey].sort());
    expect(oldPlanKeys.some((k) => keys.includes(k))).toBe(false);

    // Cleanup proof: every cell covered before the delete is covered after it,
    // with a date that is not older.
    expect(beforeCleanup).not.toBeNull();
    const before = beforeCleanup as unknown as Map<string, string | null>;
    const after = await cellDates(sliceDb, POP, 'RegioS');
    let covered = 0;
    for (const [cell, date] of before) {
      if (date === null) continue;
      covered++;
      const later = after.get(cell);
      expect(later, cell).not.toBeNull();
      expect(later! >= date, `${cell}: ${later} < ${date}`).toBe(true);
    }
    expect(covered).toBe(before.size); // every stored cell was covered before, too
    expect([...after.values()].every((d) => d !== null)).toBe(true);
  });
});

describe('failures', () => {
  it('one table failing its data request does not stop the other; a fetch failure does not quarantine', async () => {
    const inner = new FixtureSource({ [POP]: docsFor(POP), [HOUSES]: docsFor(HOUSES) });
    await registerPinned(sliceDb, inner, POP);
    await registerPinned(sliceDb, inner, HOUSES);
    // POP runs first (both never warmed, ties by id) and fails.
    const { source } = counting(inner, POP);

    const results = await warmPinnedTables(sliceDb, source, { deadline: FAR() });
    expect(results.map((r) => r.tableId)).toEqual([POP, HOUSES]);
    const byId = Object.fromEntries(results.map((r) => [r.tableId, r]));
    expect(byId[HOUSES]!.outcome).toBe('complete');
    expect(byId[POP]).toMatchObject({ outcome: 'failed', fetched: 0 });
    expect(byId[POP]!.failure).toMatchObject({ stage: 'fetch', quarantined: false });
    expect(byId[POP]!.failure!.summary).toContain('CBS unreachable');
    expect(byId[POP]!.remaining).toBe(byId[POP]!.planned);
    expect((await registry(sliceDb, POP)).status).toBe('active');
    expect((await registry(sliceDb, POP)).last_sync_at).toBeNull();
  });

  it('a fingerprint mismatch fails the table and quarantines it, as the slice rules dictate', async () => {
    const docs = docsFor(POP);
    await registerPinned(sliceDb, new FixtureSource(docs), POP);
    const redesigned = structuredClone(docs);
    const measures = redesigned.measureCodes as { value: Record<string, unknown>[] };
    measures.value.push({ ...measures.value[0]!, Identifier: 'M999999' });

    const result = await warmTable(sliceDb, new FixtureSource(redesigned), POP, { deadline: FAR() });
    expect(result.outcome).toBe('failed');
    expect(result.failure).toMatchObject({ stage: 'schema_fingerprint', quarantined: true });
    expect((await registry(sliceDb, POP)).status).toBe('needs_review');
    expect(Number((await sliceDb.query('select count(*) as n from observations')).rows[0]!.n)).toBe(0);
  });

  it('a planning refusal fails the table without fetching or quarantining', async () => {
    const docs = docsFor(POP);
    await registerPinned(sliceDb, new FixtureSource(docs), POP);
    // A declared scope naming a dimension the table does not have.
    await sliceDb.query(`update cbs_tables set slice = '{"dimensionEquals":{"Nope":"X"}}'::jsonb where id = $1`, [POP]);
    const { source, calls } = counting(new FixtureSource(docs));

    const result = await warmTable(sliceDb, source, POP, { deadline: FAR() });
    expect(result).toMatchObject({ outcome: 'failed', planned: 0, fetched: 0 });
    expect(result.failure).toMatchObject({ stage: 'plan', quarantined: false });
    expect(calls.observations).toBe(0);
    expect((await registry(sliceDb, POP)).status).toBe('active');
  });
});

describe('tables the warm job does not touch', () => {
  it('skips a whole-table table, an unpinned slice table and a quarantined table, with distinct reasons and no writes', async () => {
    const full = new FixtureSource(docsFor(HOUSES));
    await registerTables(sliceDb, full, [seedEntry(HOUSES)], { pinned: true });
    await registerSchemaOnly(sliceDb, new FixtureSource(docsFor('82235NED')), '82235NED');
    await registerPinned(sliceDb, new FixtureSource(docsFor(POP)), POP);
    await sliceDb.query(`update cbs_tables set status = 'needs_review', needs_review_reason = 'test' where id = $1`, [POP]);

    const counts = async () =>
      (
        await sliceDb.query(
          `select (select count(*) from observations) as o, (select count(*) from slice_fetches) as s,
                  (select count(*) from ingestion_batches) as b`,
        )
      ).rows[0];
    const before = await counts();
    const { source, calls } = counting(
      new FixtureSource({ [HOUSES]: docsFor(HOUSES), '82235NED': docsFor('82235NED'), [POP]: docsFor(POP) }),
    );

    const results = await warmPinnedTables(sliceDb, source, { deadline: FAR(), tableIds: [HOUSES, '82235NED', POP] });
    expect(results.map((r) => r.outcome)).toEqual(['skipped', 'skipped', 'skipped']);
    const reasons = Object.fromEntries(results.map((r) => [r.tableId, r.skippedReason]));
    expect(reasons[HOUSES]).toContain('whole-table');
    expect(reasons['82235NED']).toContain('not pinned');
    expect(reasons[POP]).toContain('quarantined');
    expect(new Set(Object.values(reasons)).size).toBe(3);

    // The default selection finds nothing to warm either.
    expect(await warmPinnedTables(sliceDb, source, { deadline: FAR() })).toEqual([]);
    expect(calls).toEqual({ schema: 0, codeLists: 0, observations: 0 });
    expect(await counts()).toEqual(before);
    expect((await registry(sliceDb, HOUSES)).ingest_mode).toBe('full');
  });
});

describe('one schema check per table per run', () => {
  it('a multi-request warm reads CBS’s schema once, and a refresh run once too', async () => {
    const docs = docsFor(POP);
    await registerPinned(sliceDb, new FixtureSource(docs), POP);

    const first = counting(new FixtureSource(docs));
    const result = await warmTable(sliceDb, first.source, POP, { deadline: FAR() });
    expect(result.planned).toBeGreaterThan(1);
    expect(first.calls).toEqual({ schema: 1, codeLists: 0, observations: result.planned });

    const refresh = counting(new FixtureSource(popWithNewYear(docs)));
    const second = await warmTable(sliceDb, refresh.source, POP, { deadline: FAR() });
    expect(second.outcome).toBe('complete');
    // One schema read; the five code lists once, for the refresh.
    expect(refresh.calls).toEqual({ schema: 1, codeLists: 5, observations: second.planned });
  });
});

describe('one confirmation time per run', () => {
  it('every slice fetched in one run carries the run’s check time, equal to the table’s last_sync_at', async () => {
    // Otherwise an answer spanning two requests would read as "partly older" by the seconds
    // between two fetches of the same run (the staleness wording compares the two dates).
    const source = new FixtureSource(docsFor(POP));
    await registerPinned(sliceDb, source, POP);
    const result = await warmTable(sliceDb, source, POP, { deadline: FAR() });
    expect(result.outcome).toBe('complete');
    expect(result.fetched).toBeGreaterThan(1);

    const times = await sliceDb.query('select distinct checked_at from slice_fetches where table_id = $1', [POP]);
    expect(times.rows).toHaveLength(1);
    const table = await sliceDb.query('select last_sync_at from cbs_tables where id = $1', [POP]);
    expect(new Date(times.rows[0]!.checked_at as string).toISOString()).toBe(
      new Date(table.rows[0]!.last_sync_at as string).toISOString(),
    );
  });
});

describe('the answer path on a warmed table', () => {
  it('answers a curated query with the same value as the whole-table database', async () => {
    const docs = docsFor(POP);
    const source = new FixtureSource(docs);
    await registerPinned(sliceDb, source, POP);
    expect((await warmTable(sliceDb, source, POP, { deadline: FAR() })).outcome).toBe('complete');
    await wholeTable(POP, source);

    for (const intent of [
      popIntent(['NL01'], ['2019JJ00', '2024JJ00']),
      popIntent(['GM0363', 'NL01'], ['2024JJ00']),
      popIntent(['PV27'], ['2019JJ00', '2024JJ00'], 'M000365'),
    ]) {
      const warmed = await runQuery(sliceDb, intent);
      const whole = await runQuery(fullDb, intent);
      if (!warmed.ok) throw new Error(`warmed: ${warmed.refusal.message}`);
      if (!whole.ok) throw new Error(`whole: ${whole.refusal.message}`);
      expect(warmed.cells.length).toBeGreaterThan(0);
      expect(warmed.cells.map((c) => [c.value, c.unit, c.status])).toEqual(whole.cells.map((c) => [c.value, c.unit, c.status]));
    }
  });
});

describe('the cell cap', () => {
  it('fetchSlice and ensureSlice without options still refuse 2,001 cells; the warm cap is only opt-in', async () => {
    const docs = docsFor(POP);
    const source = new FixtureSource(docs);
    await registerPinned(sliceDb, source, POP);
    const regions = (
      await sliceDb.query(
        `select code from dimension_labels where table_id = $1 and dimension = 'RegioS' order by code limit 667`,
        [POP],
      )
    ).rows.map((r) => r.code as string);
    const req: SliceRequest = {
      measures: ['M000352'],
      members: { ...Object.fromEntries(Object.entries(POP_DIMS).map(([d, c]) => [d, [c]])), RegioS: regions },
      periods: ['2019JJ00', '2020JJ00', '2021JJ00'],
    };

    for (const result of [await fetchSlice(sliceDb, source, POP, req), await ensureSlice(sliceDb, source, POP, req)]) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.stage).toBe('request');
      expect(result.summary).toBe('The slice asks for 2001 cells; at most 2000 can be fetched per question.');
    }
    expect(await sliceKeys(sliceDb, POP)).toEqual([]);

    const larger = await fetchSlice(sliceDb, source, POP, req, { maxCells: WARM_MAX_CELLS });
    expect(larger.ok).toBe(true);
  });
});

describe('ingest warm (command line)', () => {
  it('prints one line per table and exits 0; a bad budget exits 1', async () => {
    const source = new FixtureSource(docsFor(POP));
    await registerPinned(sliceDb, source, POP);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await runCli(['warm', POP, '--budget-seconds', '240'], { db: sliceDb, source })).toBe(0);
      const out = log.mock.calls.flat().join('\n');
      expect(out).toMatch(/\[03759ned\] complete — planned \d+, fetched \d+, confirmed 0, remaining 0/);
      expect(await runCli(['warm', '--budget-seconds', 'soon'], { db: sliceDb, source })).toBe(1);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('exits non-zero when a table failed', async () => {
    const inner = new FixtureSource(docsFor(POP));
    await registerPinned(sliceDb, inner, POP);
    const { source } = counting(inner, POP);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(await runCli(['warm'], { db: sliceDb, source })).toBe(1);
      expect(log.mock.calls.flat().join('\n')).toContain('[03759ned] FAILED (fetch)');
    } finally {
      log.mockRestore();
    }
  });
});
