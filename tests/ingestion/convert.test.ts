// Supervised conversion of a pinned whole-table table to slice storage (ADR 065
// step 7; design 2026-09-30-one-route-warm-slices-design.md D7), and the way
// back. The heart: a converted table stores exactly the cells it stored before,
// keeps its registry curation and canonical measures, and answers a curated
// question with the same value — and every refusal writes nothing. Same
// PGlite/FixtureSource pattern as warm-job.test.ts (real parsing, ADR 003).
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs, type FixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { CbsSource } from '../../src/cbs-adapter/types.ts';
import type { Db } from '../../src/db/types.ts';
import { convertTableToFull, convertTableToSlices, describeConversion } from '../../src/ingestion/convert.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES, type Phase0Table } from '../../src/ingestion/registry-seed.ts';
import { registerSchemaOnly, sliceFilterKey } from '../../src/ingestion/slice-cache.ts';
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
const POP = '03759ned'; // declared scope: pinned dims, NL/PV/GM regions, 2019+
const HOUSES = '83625NED'; // no declared scope (the whole table)
const GDP = '85880NED'; // curated: 17 excluded measures

/** The canonical measure each happy-path table answers through. */
const CURATED: Record<string, string> = {
  [POP]: 'population_on_1_january',
  [HOUSES]: 'average_home_sale_price_by_gemeente',
  [GDP]: 'gdp_growth_yoy_volume',
};

function seedEntry(id: string): Phase0Table {
  const t = SEED_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no seed entry for ${id}`);
  return t;
}

function docsFor(id: string): FixtureDocs {
  return loadFixtureDocs(`${FIXTURES_DIR}/${id}`);
}

async function wholeTable(id: string, source: CbsSource, pinned = true): Promise<void> {
  await registerTables(db, source, [seedEntry(id)], { pinned });
  const synced = await syncTable(db, source, id);
  if (synced.outcome !== 'succeeded') throw new Error(`whole-table sync of ${id} failed: ${synced.failureSummary}`);
}

/** applyRegistryDefaults is all-or-nothing over every referenced table: the
 * tables a test does not load get a bare stand-in row first. */
async function applyDefaults(): Promise<void> {
  const ids = new Set([...TABLE_REGISTRY_DEFAULTS.map((t) => t.tableId), ...CANONICAL_MEASURES.map((c) => c.tableId)]);
  for (const id of ids) {
    await db.query(
      `insert into cbs_tables (id, title, expected_dimensions, units) values ($1, 'stand-in', '[]'::jsonb, '{}'::jsonb)
       on conflict (id) do nothing`,
      [id],
    );
  }
  const applied = await applyRegistryDefaults(db);
  expect(applied.tablesMissing).toEqual([]);
}

/** Counts every source call; optionally fails the data requests after the first `failAfter`. */
function counting(inner: CbsSource, failAfter = Infinity) {
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
      if (calls.observations > failAfter) {
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

/** Every stored cell of a table with every column a reader sees (batch ids and
 * dates differ by construction and are left out). */
async function storedCells(tableId: string) {
  const { rows } = await db.query(
    `select measure, region_code, period_code, period_grain, period_year, period_index, dims::text as dims,
            value::text as value, unit, decimals, status, value_attribute,
            (last_seen_batch_id is null) as present
       from observations where table_id = $1
      order by measure, region_code, period_code, dims::text`,
    [tableId],
  );
  return rows;
}

/** The registry state a reader depends on, plus the table's canonical measures. */
async function curation(tableId: string) {
  const row = (
    await db.query(
      `select expected_dimensions::text as expected_dimensions, slice::text as slice, units::text as units,
              update_cadence, pinned, source, schema_fingerprint,
              default_coordinates::text as default_coordinates, period_semantics::text as period_semantics
         from cbs_tables where id = $1`,
      [tableId],
    )
  ).rows[0];
  const canonical = (
    await db.query(
      `select key, measure, measure_title, dims::text as dims, definition_label, everyday_terms,
              alternates::text as alternates, notes
         from canonical_measures where table_id = $1 order by key`,
      [tableId],
    )
  ).rows;
  return { row, canonical };
}

/** Everything a refusal must leave exactly as it was. */
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
  const registry = (await db.query('select * from cbs_tables order by id')).rows;
  const cells = (
    await db.query(
      `select table_id, measure, region_code, period_code, dims::text as dims, value::text as value, status, batch_id
         from observations order by id`,
    )
  ).rows;
  return { counts, registry, cells };
}

async function registry(tableId: string) {
  return (await db.query('select * from cbs_tables where id = $1', [tableId])).rows[0]!;
}

async function sliceKeys(tableId: string): Promise<string[]> {
  const { rows } = await db.query('select filter_key from slice_fetches where table_id = $1 order by filter_key', [
    tableId,
  ]);
  return rows.map((r) => r.filter_key as string);
}

async function planKeys(tableId: string): Promise<string[]> {
  return planWarmSlices(await loadWarmScope(db, tableId), { maxCells: WARM_MAX_CELLS })
    .requests.map(sliceFilterKey)
    .sort();
}

/** A curated question on a stored cell of the table's canonical measure. */
async function curatedIntent(tableId: string): Promise<StructuredIntent> {
  const key = CURATED[tableId]!;
  const canonical = CANONICAL_MEASURES.find((c) => c.key === key)!;
  const dims = parsed<Record<string, string>>(
    (await db.query('select default_coordinates from cbs_tables where id = $1', [tableId])).rows[0]!.default_coordinates,
  );
  const wanted = JSON.stringify({ ...(dims ?? {}), ...canonical.dims });
  const cell = (
    await db.query(
      `select region_code, period_code from observations
        where table_id = $1 and measure = $2 and value is not null and dims @> $3::jsonb
        order by period_code desc, region_code limit 1`,
      [tableId, canonical.measure, wanted],
    )
  ).rows[0];
  if (!cell) throw new Error(`no stored cell for ${key}`);
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key },
    ...(cell.region_code ? { regions: [cell.region_code as string] } : {}),
    period: { kind: 'codes', codes: [cell.period_code as string] },
    derivation: 'none',
  };
}

async function answer(intent: StructuredIntent) {
  const result = await runQuery(db, intent);
  if (!result.ok) throw new Error(`${result.refusal.kind}: ${result.refusal.message}`);
  return result.cells.map((c) => [c.value, c.unit, c.status]);
}

function plannedCount(): Promise<number> {
  return loadWarmScope(db, POP).then((scope) => planWarmSlices(scope, { maxCells: WARM_MAX_CELLS }).requests.length);
}

describe('preconditions: refused, nothing written, CBS never asked', () => {
  async function expectRefused(tableId: string, pattern: RegExp, source: CbsSource = new FixtureSource(docsFor(POP))) {
    const before = await wholeState();
    const { source: counted, calls } = counting(source);
    const result = await convertTableToSlices(db, counted, tableId, { deadline: FAR(), apply: true });
    expect(result.outcome).toBe('refused');
    expect(result.reason).toMatch(pattern);
    expect(calls).toEqual({ schema: 0, codeLists: 0, observations: 0 });
    expect(await wholeState()).toEqual(before);
  }

  it('a table that is not registered', async () => {
    await expectRefused(POP, /not registered/);
  });

  it('a table already in slice storage', async () => {
    const t = seedEntry(POP);
    await registerSchemaOnly(db, new FixtureSource(docsFor(POP)), POP, undefined, {
      pinned: true,
      updateCadence: t.updateCadence,
      slice: t.slice ?? null,
    });
    await expectRefused(POP, /already in slice storage/);
  });

  it('a quarantined table', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(`update cbs_tables set status = 'needs_review', needs_review_reason = 'test' where id = $1`, [POP]);
    await expectRefused(POP, /quarantined/);
  });

  it('a table that is not pinned', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)), false);
    await expectRefused(POP, /not pinned/);
  });

  it('a table that is not a CBS table', async () => {
    await db.query(
      `insert into cbs_tables (id, title, expected_dimensions, units, source, pinned)
       values ('eurostat:nama_10_gdp', 'x', '[]'::jsonb, '{}'::jsonb, 'eurostat', true)`,
    );
    await expectRefused('eurostat:nama_10_gdp', /not a CBS table/);
  });

  it('a table without a seed entry', async () => {
    await db.query(
      `insert into cbs_tables (id, title, expected_dimensions, units, pinned)
       values ('99999NED', 'x', '[]'::jsonb, '{}'::jsonb, true)`,
    );
    await expectRefused('99999NED', /seed entry/);
  });

  it('a declared scope that cannot be planned', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(`update cbs_tables set slice = '{"dimensionEquals":{"Nope":"X"}}'::jsonb where id = $1`, [POP]);
    await expectRefused(POP, /cannot be planned/);
  });
});

describe('the read-only proof: refused, nothing written', () => {
  async function refusedAfterProof(pattern: RegExp) {
    const before = await wholeState();
    const result = await convertTableToSlices(db, new FixtureSource(docsFor(POP)), POP, { deadline: FAR(), apply: true });
    expect(result.outcome).toBe('refused');
    expect(result.reason).toMatch(pattern);
    expect(await wholeState()).toEqual(before);
    return result;
  }

  it('one stored value that differs from CBS', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `update observations set value = value + 1 where id = (select min(id) from observations where value is not null)`,
    );
    const result = await refusedAfterProof(/differ/);
    expect(result.parity?.diffCounts.value_differs).toBe(1);
    expect(describeConversion(result)).toMatch(/value_differs/);
  });

  it('a status difference alone', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `update observations set status = case when status = 'Definitief' then 'Voorlopig' else 'Definitief' end
        where id = (select min(id) from observations)`,
    );
    const result = await refusedAfterProof(/ordinary sync first/);
    expect(result.parity?.diffCounts).toMatchObject({ value_differs: 0, status_differs: 1 });
  });

  it('a proof that did not finish within the budget', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    const before = await wholeState();
    const result = await convertTableToSlices(db, new FixtureSource(docsFor(POP)), POP, {
      deadline: 1_000,
      now: () => 2_000,
      apply: true,
    });
    expect(result.outcome).toBe('refused');
    expect(result.reason).toMatch(/did not finish/);
    expect(await wholeState()).toEqual(before);
  });

  it('a stored registry column that the slice registration would change', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(`update cbs_tables set update_cadence = 'weekly' where id = $1`, [POP]);
    await refusedAfterProof(/update_cadence/);
  });

  it('a stored unit or decimals that differs from CBS', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `update cbs_tables set units = jsonb_set(units, '{M000352,unit}', '"x 1 000"') where id = $1`,
      [POP],
    );
    await refusedAfterProof(/units of measure M000352/);
  });

  it('a stored period status that differs from CBS’s current code list', async () => {
    // The status of a period decides the status of its cells: the ordinary sync must bring it in first.
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `update dimension_labels set status = case when status = 'Definitief' then 'Voorlopig' else 'Definitief' end
        where table_id = $1 and dimension = 'Perioden' and code = '2024JJ00'`,
      [POP],
    );
    // Caught by the proof already: the cells staged under that status no longer equal the stored ones.
    await refusedAfterProof(/different status/);
  });

  it('a stored code whose group differs from CBS’s current code list', async () => {
    // Region classes ("all municipalities") are answered from the group.
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `update dimension_labels set dimension_group = 'ELDERS' where table_id = $1 and dimension = 'RegioS' and code = 'GM0363'`,
      [POP],
    );
    await refusedAfterProof(/RegioS GM0363 changed/);
  });

  it('a stored code CBS no longer publishes', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `insert into dimension_labels (table_id, dimension, code, label, sort_index) values ($1, 'RegioS', 'GM9999', 'Verdwenen', 99999)`,
      [POP],
    );
    await refusedAfterProof(/GM9999 is no longer published/);
  });

  it('a sync of the table still running (its batch row open), checked under the lock', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(`insert into ingestion_batches (table_id, outcome) values ($1, 'running')`, [POP]);
    await refusedAfterProof(/is running/);
  });

  it('a stored cell outside the declared scope (also when --yes is given)', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `insert into observations (table_id, measure, region_code, period_code, period_grain, period_year, period_index,
                                 dims, value, unit, decimals, status, value_attribute, batch_id)
       select table_id, measure, region_code, period_code, period_grain, period_year, period_index,
              dims || '{"Geslacht":"3000"}'::jsonb, value, unit, decimals, status, value_attribute, batch_id
         from observations where table_id = $1 order by id limit 1`,
      [POP],
    );
    await refusedAfterProof(/outside the declared scope/);
  });
});

describe('refreshed measure text on a real conversion', () => {
  it('converts when CBS has reworded measure text; the after-check compares unit and decimals only', async () => {
    // Session 152: 83932NED failed its after-check because the check compared the measure text the
    // conversion itself refreshes to CBS's current wording.
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `update cbs_tables set units = (
         select jsonb_object_agg(key, jsonb_set(value, '{description}', '"Old wording"'::jsonb)) from jsonb_each(units)
       ) where id = $1`,
      [POP],
    );
    const result = await convertTableToSlices(db, new FixtureSource(docsFor(POP)), POP, { deadline: FAR(), apply: true });
    expect(result.afterCheck?.registryDifferences ?? []).toEqual([]);
    expect(result.outcome).toBe('converted');
    expect(result.notes.join(' ')).toMatch(/measure text/);
  });
});

describe('the dry run (no --yes)', () => {
  it('measure text CBS has since enriched (title, description) does not block; it is reported as a note', async () => {
    // Registrations older than #115 stored no `description`; the ingestion checks compare unit and
    // decimals only (validate.ts RegistryUnits), so the conversion must not be stricter than they are.
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `update cbs_tables set units = (
         select jsonb_object_agg(key, value - 'description') from jsonb_each(units)
       ) where id = $1`,
      [POP],
    );
    const result = await convertTableToSlices(db, new FixtureSource(docsFor(POP)), POP, { deadline: FAR(), apply: false });
    expect(result.outcome).toBe('dry_run');
    expect(result.notes.join(' ')).toMatch(/measure text/);
  });

  it('label text CBS has since reworded does not block; it is reported as a note', async () => {
    // CBS rewords labels routinely ("2026 januari-april" becomes "2026 januari-juni") and the ordinary
    // sync never refreshes them; the conversion takes CBS's current text, as a re-registration would.
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await db.query(
      `update dimension_labels set label = 'Renamed', sort_index = sort_index + 5
        where table_id = $1 and dimension = 'RegioS' and code = 'NL01'`,
      [POP],
    );
    const result = await convertTableToSlices(db, new FixtureSource(docsFor(POP)), POP, { deadline: FAR(), apply: false });
    expect(result.outcome).toBe('dry_run');
    expect(result.notes.join(' ')).toMatch(/1 label\(s\)/);
  });

  it('runs the checks and the proof, reports what it would do, and writes nothing', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    const before = await wholeState();
    const result = await convertTableToSlices(db, new FixtureSource(docsFor(POP)), POP, { deadline: FAR(), apply: false });
    expect(result.outcome).toBe('dry_run');
    expect(result.parity?.complete).toBe(true);
    expect(result.plannedRequests).toBe(await plannedCount());
    expect(result.storedCells).toBe(before.counts!.observations);
    expect(describeConversion(result)).toMatch(/DRY RUN/);
    expect(describeConversion(result)).toMatch(/--yes/);
    expect(await wholeState()).toEqual(before);
  });
});

describe('the conversion', () => {
  it.each([[POP], [GDP], [HOUSES]])(
    '%s: converted — same cells, same curation and canonical measures, the same curated answer',
    async (id) => {
      const source = new FixtureSource(docsFor(id));
      await wholeTable(id, source);
      await applyDefaults();
      const cellsBefore = await storedCells(id);
      const curationBefore = await curation(id);
      const intent = await curatedIntent(id);
      const answerBefore = await answer(intent);
      const batchesBefore = Number((await db.query('select count(*) as n from ingestion_batches where table_id = $1', [id])).rows[0]!.n);

      const result = await convertTableToSlices(db, source, id, { deadline: FAR(), apply: true });
      expect(result.reason ?? null).toBeNull();
      expect(result.outcome).toBe('converted');
      expect(result.warm?.outcome).toBe('complete');
      expect(describeConversion(result)).toMatch(/converted/);

      expect(cellsBefore.length).toBeGreaterThan(0);
      expect(await storedCells(id)).toEqual(cellsBefore);
      expect(await curation(id)).toEqual(curationBefore);
      expect(await answer(intent)).toEqual(answerBefore);

      const row = await registry(id);
      expect(row).toMatchObject({ ingest_mode: 'slice_cache', pinned: true, status: 'active' });
      expect(row.update_cadence).toBe(seedEntry(id).updateCadence);
      expect(row.last_sync_at).not.toBeNull();
      expect(row.schema_cbs_modified).not.toBeNull();
      expect(await sliceKeys(id)).toEqual(await planKeys(id));
      // History kept: the whole-table batches are still there (the warm run added its own).
      const batchesAfter = Number((await db.query('select count(*) as n from ingestion_batches where table_id = $1', [id])).rows[0]!.n);
      expect(batchesAfter).toBeGreaterThan(batchesBefore);
    },
  );

  it('the period-note table (70072ned, ADR 061): the dry run no longer refuses, and the conversion keeps every cell and status (#358 item 3)', async () => {
    const REGIONAL = '70072ned';
    const source = new FixtureSource(docsFor(REGIONAL));
    await wholeTable(REGIONAL, source);
    const cellsBefore = await storedCells(REGIONAL);
    expect(new Set(cellsBefore.map((c) => c.status))).toEqual(new Set(['Definitief', 'Voorlopig', 'NaderVoorlopig']));

    const before = await wholeState();
    const dry = await convertTableToSlices(db, source, REGIONAL, { deadline: FAR(), apply: false });
    expect(dry.reason ?? null).toBeNull();
    expect(dry.outcome).toBe('dry_run');
    expect(dry.parity?.complete).toBe(true);
    expect(dry.parity?.diffCounts).toEqual({ value_differs: 0, status_differs: 0, missing_in_store: 0, missing_at_source: 0 });
    expect(dry.parity?.identical).toBe(cellsBefore.length);
    expect(await wholeState()).toEqual(before);

    const result = await convertTableToSlices(db, source, REGIONAL, { deadline: FAR(), apply: true });
    expect(result.reason ?? null).toBeNull();
    expect(result.outcome).toBe('converted');
    expect(await storedCells(REGIONAL)).toEqual(cellsBefore);
    expect(await registry(REGIONAL)).toMatchObject({ ingest_mode: 'slice_cache', pinned: true, status: 'active' });
  });

  it('converted_incomplete when the budget ends during the warm run; `ingest warm` then finishes it', async () => {
    const source = new FixtureSource(docsFor(POP));
    await wholeTable(POP, source);
    await applyDefaults();
    const cellsBefore = await storedCells(POP);
    const curationBefore = await curation(POP);
    const planned = await plannedCount();
    const k = 2;
    // now() is asked once per proof request, once by warmTable's gate, then before each warm request.
    let calls = 0;
    const now = () => (calls++ < planned + 1 + k ? 0 : 2_000);

    const result = await convertTableToSlices(db, source, POP, { deadline: 1_000, now, apply: true });
    expect(result.outcome).toBe('converted_incomplete');
    expect(result.remaining).toBe(planned - k);
    expect(describeConversion(result)).toContain(`ingest warm ${POP}`);
    const partial = await storedCells(POP);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(cellsBefore.length);
    for (const cell of partial) expect(cellsBefore).toContainEqual(cell);
    expect((await registry(POP)).ingest_mode).toBe('slice_cache');

    const finish = await warmTable(db, source, POP, { deadline: FAR() });
    expect(finish.outcome).toBe('complete');
    expect(await storedCells(POP)).toEqual(cellsBefore);
    expect(await curation(POP)).toEqual(curationBefore);
  });

  it('a source failure during the warm run: slice storage, not quarantined, and the way to finish is printed', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    const planned = await plannedCount();
    // The proof makes exactly `planned` data requests; the warm run's first one fails.
    const { source } = counting(new FixtureSource(docsFor(POP)), planned);

    const result = await convertTableToSlices(db, source, POP, { deadline: FAR(), apply: true });
    expect(result.outcome).toBe('converted_incomplete');
    expect(result.warm?.failure).toMatchObject({ stage: 'fetch', quarantined: false });
    expect(describeConversion(result)).toContain(`ingest warm ${POP}`);
    expect(await registry(POP)).toMatchObject({ ingest_mode: 'slice_cache', status: 'active', pinned: true });
    expect(Number((await db.query('select count(*) as n from observations where table_id = $1', [POP])).rows[0]!.n)).toBe(0);
  });

  it('an after-check difference is reported loudly with the cell and the recovery, never rolled back', async () => {
    const docs = docsFor(POP);
    await wholeTable(POP, new FixtureSource(docs));
    const planned = await plannedCount();
    // CBS answers the warm run with one value changed after the proof passed.
    const changed = structuredClone(docs);
    const page = changed.observationPages[0] as { value: Record<string, unknown>[] };
    const target = page.value.find(
      (r) =>
        r.Measure === 'M000352' &&
        r.RegioS === 'NL01' &&
        r.Perioden === '2024JJ00' &&
        r.Geslacht === 'T001038' &&
        r.Leeftijd === '10000' &&
        r.BurgerlijkeStaat === 'T001019',
    )!;
    target.Value = Number(target.Value) + 7;
    const proof = new FixtureSource(docs);
    const later = new FixtureSource(changed);
    let dataCalls = 0;
    const source: CbsSource = {
      fetchTableSchema: (t) => proof.fetchTableSchema(t),
      fetchCodeList: (t, d) => proof.fetchCodeList(t, d),
      fetchObservations: (t, s, n) => (++dataCalls > planned ? later : proof).fetchObservations(t, s, n),
      fetchObservationCount: (t) => proof.fetchObservationCount(t),
      fetchCatalog: () => proof.fetchCatalog(),
    };

    const result = await convertTableToSlices(db, source, POP, { deadline: FAR(), apply: true });
    expect(result.outcome).toBe('after_check_failed');
    expect(result.afterCheck?.cellDifferenceCount).toBe(1);
    const text = describeConversion(result);
    expect(text).toContain('M000352');
    expect(text).toContain('NL01');
    expect(text).toContain(`ingest warm ${POP}`);
    expect(text).toContain(`convert-to-full ${POP}`);
    expect((await registry(POP)).ingest_mode).toBe('slice_cache');
  });
});

describe('retained cells (#154)', () => {
  const isTarget = (r: Record<string, unknown>) =>
    r.Measure === 'M000352' &&
    r.RegioS === 'NL01' &&
    r.Perioden === '2024JJ00' &&
    r.Geslacht === 'T001038' &&
    r.Leeftijd === '10000' &&
    r.BurgerlijkeStaat === 'T001019';

  async function markRetained(): Promise<void> {
    await db.query(
      `update observations set last_seen_batch_id = batch_id
        where table_id = $1 and measure = 'M000352' and region_code = 'NL01' and period_code = '2024JJ00'`,
      [POP],
    );
    const n = (await db.query('select count(*)::int as n from observations where last_seen_batch_id is not null')).rows[0]!.n;
    expect(Number(n)).toBe(1);
  }

  it('a retained cell CBS still withholds is not carried over (reported); every other cell is', async () => {
    const docs = docsFor(POP);
    await wholeTable(POP, new FixtureSource(docs));
    await markRetained();
    const cellsBefore = (await storedCells(POP)).filter((c) => c.present);
    const withheld = structuredClone(docs);
    const page = withheld.observationPages[0] as { value: Record<string, unknown>[] };
    page.value = page.value.filter((r) => !isTarget(r));

    const result = await convertTableToSlices(db, new FixtureSource(withheld), POP, { deadline: FAR(), apply: true });
    expect(result.reason ?? null).toBeNull();
    expect(result.outcome).toBe('converted');
    expect(result.parity?.retained).toBe(1);
    expect(result.retainedCells).toBe(1);
    expect(describeConversion(result)).toMatch(/1 retained cell\(s\)/);
    expect(await storedCells(POP)).toEqual(cellsBefore);
  });

  it('a retained cell CBS publishes again comes back present with the same value', async () => {
    const source = new FixtureSource(docsFor(POP));
    await wholeTable(POP, source);
    const cellsBefore = (await storedCells(POP)).map((c) => ({ ...c, present: true }));
    await markRetained();

    const result = await convertTableToSlices(db, source, POP, { deadline: FAR(), apply: true });
    expect(result.outcome).toBe('converted');
    expect(result.retainedCells).toBe(0);
    expect(await storedCells(POP)).toEqual(cellsBefore);
  });
});

describe('the way back: convert-to-full', () => {
  it('returns a converted table to whole-table storage; the ordinary sync then stores the same cells', async () => {
    const source = new FixtureSource(docsFor(POP));
    await wholeTable(POP, source);
    await applyDefaults();
    const cellsBefore = await storedCells(POP);
    const curationBefore = await curation(POP);
    expect((await convertTableToSlices(db, source, POP, { deadline: FAR(), apply: true })).outcome).toBe('converted');

    const dry = await convertTableToFull(db, POP, { apply: false });
    expect(dry.outcome).toBe('dry_run');
    expect((await registry(POP)).ingest_mode).toBe('slice_cache');

    const back = await convertTableToFull(db, POP, { apply: true });
    expect(back.outcome).toBe('converted_to_full');
    expect(await registry(POP)).toMatchObject({ ingest_mode: 'full', status: 'active', pinned: true, last_sync_at: null });
    expect(await storedCells(POP)).toEqual([]);
    expect(await sliceKeys(POP)).toEqual([]);

    const synced = await syncTable(db, source, POP);
    expect(synced.failureSummary ?? null).toBeNull();
    expect(await storedCells(POP)).toEqual(cellsBefore);
    expect(await curation(POP)).toEqual(curationBefore);
  });

  it('refuses a whole-table table, an unpinned slice table and a quarantined slice table, writing nothing', async () => {
    await wholeTable(POP, new FixtureSource(docsFor(POP)));
    await registerSchemaOnly(db, new FixtureSource(docsFor(HOUSES)), HOUSES);
    await registerSchemaOnly(db, new FixtureSource(docsFor(GDP)), GDP, undefined, {
      pinned: true,
      updateCadence: seedEntry(GDP).updateCadence,
      excludeMeasures: seedEntry(GDP).excludeMeasures,
    });
    await db.query(`update cbs_tables set status = 'needs_review', needs_review_reason = 'test' where id = $1`, [GDP]);
    const before = await wholeState();
    for (const [id, pattern] of [
      [POP, /not in slice storage/],
      [HOUSES, /not pinned/],
      [GDP, /quarantined/],
    ] as const) {
      const result = await convertTableToFull(db, id, { apply: true });
      expect(result.outcome).toBe('refused');
      expect(result.reason).toMatch(pattern);
    }
    expect(await wholeState()).toEqual(before);
  });
});
