// Supervised re-baseline of a quarantined slice-cache table (ADR 065 step 5,
// design 2026-09-30-one-route-warm-slices-design.md D5; ADR 062's open point
// "a quarantined slice-cache table has no rebaseline path yet"). Mirrors
// syncTable --rebaseline as far as the slice model allows: CBS's new layout is
// the new baseline, the old cells and slice records go (after a structural
// change they cannot be trusted to mean the same thing), a pinned table is
// warmed again, an unpinned one refills per question. Refusals write nothing.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs, type FixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { Db } from '../../src/db/types.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { rebaselineSliceTable } from '../../src/ingestion/rebaseline-slices.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { ensureSlice, fetchSlice, registerSchemaOnly, sliceFilterKey, type SliceRequest } from '../../src/ingestion/slice-cache.ts';
import { WARM_MAX_CELLS, warmTable } from '../../src/ingestion/warm-job.ts';
import { loadWarmScope, planWarmSlices } from '../../src/ingestion/warm-plan.ts';
import { runQuery, type StructuredIntent } from '../../src/query/index.ts';
import { applyRegistryDefaults } from '../../src/registry/apply.ts';
import { CANONICAL_MEASURES, TABLE_REGISTRY_DEFAULTS } from '../../src/registry/defaults.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await db.query('truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade');
});

const FAR = () => Date.now() + 3_600_000;
const POP = '03759ned';
const HOUSES = '83625NED';

function docsFor(id: string): FixtureDocs {
  return loadFixtureDocs(`${FIXTURES_DIR}/${id}`);
}

/** CBS redesigned the table: one more numeric measure (a fingerprint mismatch). */
function withExtraMeasure(docs: FixtureDocs): FixtureDocs {
  const clone = structuredClone(docs);
  const measures = clone.measureCodes as { value: Record<string, unknown>[] };
  measures.value.push({ ...measures.value[0]!, Identifier: 'M999999' });
  return clone;
}

function withoutMeasure(docs: FixtureDocs, code: string): FixtureDocs {
  const clone = structuredClone(docs);
  const measures = clone.measureCodes as { value: Record<string, unknown>[] };
  measures.value = measures.value.filter((m) => m.Identifier !== code);
  return clone;
}

function withoutPeriodStatus(docs: FixtureDocs): FixtureDocs {
  const clone = structuredClone(docs);
  const periods = (clone.codes as Record<string, { value: Record<string, unknown>[] }>)['Perioden']!;
  for (const p of periods.value) p.Status = null;
  return clone;
}

async function registerPinned(id: string, docs: FixtureDocs): Promise<void> {
  const t = SEED_TABLES.find((e) => e.id === id)!;
  const result = await registerSchemaOnly(db, new FixtureSource(docs), id, undefined, {
    pinned: true,
    updateCadence: t.updateCadence,
    slice: t.slice ?? null,
    excludeMeasures: t.excludeMeasures,
  });
  if (!result.ok) throw new Error(result.summary);
}

async function applyDefaults(): Promise<void> {
  const ids = new Set([...TABLE_REGISTRY_DEFAULTS.map((t) => t.tableId), ...CANONICAL_MEASURES.map((c) => c.tableId)]);
  for (const id of ids) {
    await db.query(
      `insert into cbs_tables (id, title, expected_dimensions, units) values ($1, 'stand-in', '[]'::jsonb, '{}'::jsonb)
       on conflict (id) do nothing`,
      [id],
    );
  }
  expect((await applyRegistryDefaults(db)).tablesMissing).toEqual([]);
}

/** A pinned POP in slice storage, warmed, with its registry defaults — then
 * quarantined by a warm run against a redesigned CBS table. */
async function quarantinedPop(): Promise<void> {
  const docs = docsFor(POP);
  await registerPinned(POP, docs);
  expect((await warmTable(db, new FixtureSource(docs), POP, { deadline: FAR() })).outcome).toBe('complete');
  await applyDefaults();
  const failed = await warmTable(db, new FixtureSource(withExtraMeasure(docs)), POP, { deadline: FAR() });
  expect(failed.failure).toMatchObject({ stage: 'schema_fingerprint', quarantined: true });
}

async function registry(tableId: string) {
  return (await db.query('select * from cbs_tables where id = $1', [tableId])).rows[0]!;
}

async function storedCells(tableId: string) {
  const { rows } = await db.query(
    `select measure, region_code, period_code, dims::text as dims, value::text as value, unit, decimals, status,
            value_attribute
       from observations where table_id = $1
      order by measure, region_code, period_code, dims::text`,
    [tableId],
  );
  return rows;
}

async function wholeState() {
  const counts = (
    await db.query(
      `select (select count(*) from observations)::int as observations,
              (select count(*) from dimension_labels)::int as labels,
              (select count(*) from slice_fetches)::int as slices,
              (select count(*) from ingestion_batches)::int as batches,
              (select count(*) from canonical_measures)::int as canonical`,
    )
  ).rows[0];
  const rows = (await db.query('select * from cbs_tables order by id')).rows;
  const labels = (await db.query('select * from dimension_labels order by table_id, dimension, code')).rows;
  return { counts, rows, labels };
}

const POP_INTENT: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'canonical', key: 'population_on_1_january' },
  regions: ['NL01'],
  period: { kind: 'codes', codes: ['2024JJ00'] },
  derivation: 'none',
};

describe('refusals write nothing', () => {
  it('a whole-table table', async () => {
    const source = new FixtureSource(docsFor(POP));
    await registerTables(db, source, [SEED_TABLES.find((t) => t.id === POP)!], { pinned: true });
    expect((await syncTable(db, source, POP)).outcome).toBe('succeeded');
    await db.query(`update cbs_tables set status = 'needs_review', needs_review_reason = 'test' where id = $1`, [POP]);
    const before = await wholeState();
    const result = await rebaselineSliceTable(db, source, POP, { deadline: FAR(), apply: true });
    expect(result.outcome).toBe('refused');
    expect(result.reason).toMatch(/not a slice-storage table/);
    expect(result.reason).toMatch(/--rebaseline/);
    expect(await wholeState()).toEqual(before);
  });

  it('a slice table that is not quarantined', async () => {
    await registerPinned(POP, docsFor(POP));
    const before = await wholeState();
    const result = await rebaselineSliceTable(db, new FixtureSource(docsFor(POP)), POP, { deadline: FAR(), apply: true });
    expect(result.outcome).toBe('refused');
    expect(result.reason).toMatch(/not quarantined/);
    expect(await wholeState()).toEqual(before);
  });

  it('a table that is not registered', async () => {
    const result = await rebaselineSliceTable(db, new FixtureSource(docsFor(POP)), POP, { deadline: FAR(), apply: true });
    expect(result).toMatchObject({ outcome: 'refused' });
    expect(result.reason).toMatch(/not registered/);
  });

  it('a new schema that cannot be registered (no machine period status)', async () => {
    await quarantinedPop();
    const before = await wholeState();
    const result = await rebaselineSliceTable(db, new FixtureSource(withoutPeriodStatus(withExtraMeasure(docsFor(POP)))), POP, {
      deadline: FAR(),
      apply: true,
    });
    expect(result.outcome).toBe('refused');
    expect(result.reason).toMatch(/no_machine_period_status/);
    expect(await wholeState()).toEqual(before);
  });

  it('a canonical measure that would point at a code CBS no longer has', async () => {
    await quarantinedPop();
    const before = await wholeState();
    const result = await rebaselineSliceTable(db, new FixtureSource(withoutMeasure(docsFor(POP), 'M000352')), POP, {
      deadline: FAR(),
      apply: true,
    });
    expect(result.outcome).toBe('refused');
    expect(result.reason).toContain('population_on_1_january');
    expect(result.reason).toContain('M000352');
    expect(await wholeState()).toEqual(before);
  });

  it('default coordinates that would point at a code CBS no longer has', async () => {
    await quarantinedPop();
    const docs = withExtraMeasure(docsFor(POP));
    const codes = (docs.codes as Record<string, { value: Record<string, unknown>[] }>)['BurgerlijkeStaat']!;
    codes.value = codes.value.filter((c) => c.Identifier !== 'T001019');
    const before = await wholeState();
    const result = await rebaselineSliceTable(db, new FixtureSource(docs), POP, { deadline: FAR(), apply: true });
    expect(result.outcome).toBe('refused');
    expect(result.reason).toContain('default_coordinates');
    expect(result.reason).toContain('T001019');
    expect(await wholeState()).toEqual(before);
  });

  it('the dry run (no --yes) reports the change and writes nothing', async () => {
    await quarantinedPop();
    const before = await wholeState();
    const result = await rebaselineSliceTable(db, new FixtureSource(withExtraMeasure(docsFor(POP))), POP, {
      deadline: FAR(),
      apply: false,
    });
    expect(result.outcome).toBe('dry_run');
    expect(result.measuresAdded).toEqual(['M999999']);
    expect(result.measuresRemoved).toEqual([]);
    expect(result.cellsDeleted).toBe(before.counts!.observations);
    expect(await wholeState()).toEqual(before);
  });
});

describe('a quarantined pinned table', () => {
  it('re-baselines to CBS’s new layout: active, new fingerprint, old cells and slice records gone, warmed again, answers', async () => {
    await quarantinedPop();
    const before = await registry(POP);
    const cellsBefore = await storedCells(POP);
    const maxBatch = Number((await db.query('select max(id) as m from ingestion_batches')).rows[0]!.m);
    const maxSlice = Number((await db.query('select max(id) as m from slice_fetches')).rows[0]!.m);
    const redesigned = withExtraMeasure(docsFor(POP));

    const result = await rebaselineSliceTable(db, new FixtureSource(redesigned), POP, { deadline: FAR(), apply: true });
    expect(result.reason ?? null).toBeNull();
    expect(result.outcome).toBe('rebaselined');
    expect(result.warm?.outcome).toBe('complete');
    expect(result.cellsDeleted).toBe(cellsBefore.length);

    const after = await registry(POP);
    expect(after).toMatchObject({ status: 'active', needs_review_reason: null, ingest_mode: 'slice_cache', pinned: true });
    expect(after.schema_fingerprint).not.toBe(before.schema_fingerprint);
    expect(Number(after.version)).toBeGreaterThan(Number(before.version));
    expect(Object.keys(typeof after.units === 'string' ? JSON.parse(after.units) : after.units)).toContain('M999999');
    expect(after.slice).toEqual(before.slice);
    expect(after.default_coordinates).toEqual(before.default_coordinates);

    // Every stored cell and slice record is new; the values are the same CBS values.
    const minCellBatch = Number(
      (await db.query('select min(batch_id) as m from observations where table_id = $1', [POP])).rows[0]!.m,
    );
    expect(minCellBatch).toBeGreaterThan(maxBatch);
    const minSlice = Number((await db.query('select min(id) as m from slice_fetches where table_id = $1', [POP])).rows[0]!.m);
    expect(minSlice).toBeGreaterThan(maxSlice);
    const keys = (await db.query('select filter_key from slice_fetches where table_id = $1 order by filter_key', [POP])).rows.map(
      (r) => r.filter_key as string,
    );
    expect(keys).toEqual(
      planWarmSlices(await loadWarmScope(db, POP), { maxCells: WARM_MAX_CELLS }).requests.map(sliceFilterKey).sort(),
    );
    expect(await storedCells(POP)).toEqual(cellsBefore);

    // The re-baseline is on the record, like syncTable's.
    const batch = (
      await db.query(`select outcome, rebaselined, fingerprint from ingestion_batches where table_id = $1 and rebaselined`, [POP])
    ).rows;
    expect(batch).toEqual([{ outcome: 'succeeded', rebaselined: true, fingerprint: after.schema_fingerprint }]);

    const answered = await runQuery(db, POP_INTENT);
    if (!answered.ok) throw new Error(answered.refusal.message);
    expect(answered.cells[0]!.value).not.toBeNull();
  });
});

describe('a quarantined unpinned table', () => {
  it('re-baselines to active and empty; the next ensureSlice fills it', async () => {
    const docs = docsFor(HOUSES);
    expect((await registerSchemaOnly(db, new FixtureSource(docs), HOUSES)).ok).toBe(true);
    const req: SliceRequest = { measures: ['M001534'], members: { RegioS: ['NL01'] }, periods: ['2024JJ00'] };
    expect((await fetchSlice(db, new FixtureSource(docs), HOUSES, req)).ok).toBe(true);
    const redesigned = withExtraMeasure(docs);
    const quarantining = await ensureSlice(db, new FixtureSource(redesigned), HOUSES, req);
    expect(quarantining.ok).toBe(false);
    expect((await registry(HOUSES)).status).toBe('needs_review');

    const result = await rebaselineSliceTable(db, new FixtureSource(redesigned), HOUSES, { deadline: FAR(), apply: true });
    expect(result.outcome).toBe('rebaselined');
    expect(result.warm ?? null).toBeNull();
    expect(await registry(HOUSES)).toMatchObject({ status: 'active', pinned: false, ingest_mode: 'slice_cache' });
    expect(await storedCells(HOUSES)).toEqual([]);
    expect(Number((await db.query('select count(*) as n from slice_fetches')).rows[0]!.n)).toBe(0);

    const refill = await ensureSlice(db, new FixtureSource(redesigned), HOUSES, req);
    expect(refill.ok, refill.ok ? '' : refill.summary).toBe(true);
    expect((await storedCells(HOUSES)).length).toBe(1);
  });
});
