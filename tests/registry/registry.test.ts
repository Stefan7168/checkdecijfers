// Registry work package tests (ADR 010): hermetic (PGlite, no network — ADR 009),
// registers every curated seed table (8 Phase 0 + coverage sprint) from fixture docs (schema only, no observations
// needed) then applies src/registry/defaults.ts and checks the result.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocsTree } from '../../src/cbs-adapter/fixture-source.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { StatisticsApiSource } from '../../src/eurostat-adapter/statistics-api.ts';
import { applyRegistryDefaults } from '../../src/registry/apply.ts';
import { CANONICAL_MEASURES, TABLE_REGISTRY_DEFAULTS } from '../../src/registry/defaults.ts';
import {
  EUROSTAT_SIBLING_MEASURES_REVIEWED,
  EUROSTAT_SIBLING_REGISTRATIONS,
} from '../../src/sources/eurostat-siblings.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

// Perf (#245 Action 3, session 110): boots ONE PGlite instance for the whole
// file (beforeAll/afterAll) instead of once per test (registeredDb() used to
// call createTestDb() itself, 3 boots, plus a 4th bare boot below), and
// TRUNCATE-resets it before every test instead. registerFixtures() re-runs
// registerTables() against the shared, freshly-reset db for the tests that
// need a populated registry; the "empty cbs_tables" test simply doesn't call
// it, exactly as it didn't call registeredDb() before.
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

async function registerFixtures(db: Db): Promise<void> {
  const docsTree = loadFixtureDocsTree(FIXTURES_DIR);
  const source = new FixtureSource(docsTree);
  await registerTables(db, source, SEED_TABLES);
}

async function cbsTable(db: Db, id: string) {
  const r = await db.query(
    'select default_coordinates, period_semantics from cbs_tables where id = $1',
    [id],
  );
  return r.rows[0] as { default_coordinates: unknown; period_semantics: unknown } | undefined;
}

describe('registry defaults (ADR 010)', () => {
  it('refuses to apply anything when a referenced table is not yet registered (all-or-nothing)', async () => {
    const db = sharedDb; // no registerFixtures() call — empty cbs_tables
    const result = await applyRegistryDefaults(db);
    expect(result.tablesMissing.length).toBe(SEED_TABLES.length);
    expect(result.tablesUpdated).toEqual([]);
    expect(result.canonicalMeasuresUpserted).toEqual([]);
    // Fix round 2 (minor): the early return used to hardcode
    // `siblingMeasuresSkipped: []`, misleadingly reading as "every sibling
    // measure is fine" even though NOTHING was applied. On a genuinely empty
    // db every reviewed sibling measure is unregistered too, so it must be
    // reported here, same as when the CBS write actually goes through.
    expect(result.siblingMeasuresSkipped.sort()).toEqual(
      EUROSTAT_SIBLING_MEASURES_REVIEWED.map((m) => m.key).sort(),
    );
    const cm = await db.query('select count(*) c from canonical_measures');
    expect(Number(cm.rows[0]!.c)).toBe(0);
  });

  it('applies default_coordinates + period_semantics for every registered Phase 0 table', async () => {
    const db = sharedDb;
    await registerFixtures(db);
    const result = await applyRegistryDefaults(db);
    expect(result.tablesMissing).toEqual([]);
    expect(result.tablesUpdated.sort()).toEqual(SEED_TABLES.map((t) => t.id).sort());

    for (const entry of TABLE_REGISTRY_DEFAULTS) {
      const row = await cbsTable(db, entry.tableId);
      expect(row, entry.tableId).toBeTruthy();
      expect(row!.default_coordinates, entry.tableId).toEqual(entry.defaultCoordinates);
      expect(row!.period_semantics, entry.tableId).toEqual(entry.periodSemantics);
    }
  });

  it('upserts every canonical measure, each referencing a real registered table', async () => {
    const db = sharedDb;
    await registerFixtures(db);
    const result = await applyRegistryDefaults(db);
    expect(result.canonicalMeasuresUpserted.sort()).toEqual(CANONICAL_MEASURES.map((c) => c.key).sort());

    const rows = await db.query('select key, table_id, measure, dims, definition_label, everyday_terms from canonical_measures order by key');
    expect(rows.rows).toHaveLength(CANONICAL_MEASURES.length);
    const registeredIds = new Set(SEED_TABLES.map((t) => t.id));
    for (const row of rows.rows) {
      expect(registeredIds.has(row.table_id as string), `${row.key} -> ${row.table_id}`).toBe(true);
      expect((row.everyday_terms as string[]).length, `${row.key} everydayTerms`).toBeGreaterThan(0);
      expect((row.definition_label as string).length, `${row.key} definitionLabel`).toBeGreaterThan(0);
    }
  });

  it('is idempotent: applying twice yields the same row counts and values, no duplicates', async () => {
    const db = sharedDb;
    await registerFixtures(db);
    await applyRegistryDefaults(db);
    const first = await db.query('select key, table_id, measure, dims from canonical_measures order by key');

    const second = await applyRegistryDefaults(db);
    expect(second.tablesMissing).toEqual([]);
    const after = await db.query('select key, table_id, measure, dims from canonical_measures order by key');

    expect(after.rows).toHaveLength(first.rows.length);
    expect(after.rows).toEqual(first.rows);
  });

  it('every canonical measure flagged as an owner-revisable **Assumption** carries visible alternates (transparency, R7)', () => {
    for (const cm of CANONICAL_MEASURES) {
      if (cm.notes?.includes('**Assumption**')) {
        expect(cm.alternates?.length, cm.key).toBeGreaterThan(0);
      }
    }
  });

  it('solar_electricity_production has no alternates — "zonnestroom" names one CBS reading, not a choice among several', () => {
    const cm = CANONICAL_MEASURES.find((c) => c.key === 'solar_electricity_production')!;
    expect(cm.alternates).toBeUndefined();
  });

  it('#254(a), ADR 052 session 110 addendum: periodChangeEligible is set on exactly the three household-income alternates, nothing else', () => {
    const marked: { key: string; label: string }[] = [];
    for (const cm of CANONICAL_MEASURES) {
      for (const alt of cm.alternates ?? []) {
        if (alt.periodChangeEligible === true) marked.push({ key: cm.key, label: alt.label });
      }
    }
    marked.sort((a, b) => a.label.localeCompare(b.label));
    expect(marked).toEqual([
      { key: 'average_disposable_household_income', label: 'bruto inkomen' },
      { key: 'average_disposable_household_income', label: 'gestandaardiseerd inkomen' },
      { key: 'average_disposable_household_income', label: 'primair inkomen' },
    ]);
  });

  it('#254(a): average_disposable_household_income carries exactly 3 alternates, every one marked eligible', () => {
    const cm = CANONICAL_MEASURES.find((c) => c.key === 'average_disposable_household_income')!;
    expect(cm.alternates).toHaveLength(3);
    for (const alt of cm.alternates!) {
      expect(alt.periodChangeEligible, alt.label).toBe(true);
    }
  });
});

// E2a step 5 (docs/RUNBOOK.md "E2a step 5"; requirement 2 of the step-5
// brief): a reviewed Eurostat sibling measure's table not being registered
// yet must NEVER abort the CBS-only apply the owner's regular
// `registry:apply` depends on — it is skipped and reported instead.
describe('E2a step 5: Eurostat sibling measures never regress the CBS apply', () => {
  /** Never the real network (same fixture shape register-sync.test.ts's
   * `FILTERED_DATASET` uses for `eurostat:une_rt_q` — matching
   * EUROSTAT_SIBLING_MEASURES_REVIEWED's `dims`/`measure` for that table). */
  const FILTERED_UNE_RT_Q = {
    version: '2.0',
    class: 'dataset',
    label: 'Unemployment by sex and age - quarterly data',
    id: ['s_adj', 'age', 'sex', 'unit', 'geo', 'time'],
    size: [1, 1, 1, 1, 1, 1],
    dimension: {
      s_adj: { category: { index: { SA: 0 }, label: { SA: 'Seasonally adjusted data' } } },
      age: { category: { index: { 'Y15-74': 0 }, label: { 'Y15-74': 'From 15 to 74 years' } } },
      sex: { category: { index: { T: 0 }, label: { T: 'Total' } } },
      unit: { category: { index: { PC_ACT: 0 }, label: { PC_ACT: 'Percentage of population in the labour force' } } },
      geo: { category: { index: { NL: 0 }, label: { NL: 'Netherlands' } } },
      time: { category: { index: { '2024-Q1': 0 }, label: { '2024-Q1': '2024-Q1' } } },
    },
    value: [3.5],
  };

  async function fakeDataciteFetch(): Promise<Response> {
    return new Response(JSON.stringify({ data: { attributes: { state: 'findable' } } }), {
      status: 200,
      headers: { 'content-type': 'application/vnd.api+json' },
    });
  }

  it('CBS apply is unaffected and reports all three reviewed siblings skipped when none of their tables are registered', async () => {
    const db = sharedDb;
    await registerFixtures(db); // CBS only — no Eurostat table registered
    const result = await applyRegistryDefaults(db);
    expect(result.tablesMissing).toEqual([]);
    expect(result.tablesUpdated.sort()).toEqual(SEED_TABLES.map((t) => t.id).sort());
    expect(result.canonicalMeasuresUpserted.sort()).toEqual(CANONICAL_MEASURES.map((c) => c.key).sort());
    expect(result.siblingMeasuresSkipped.sort()).toEqual(
      EUROSTAT_SIBLING_MEASURES_REVIEWED.map((m) => m.key).sort(),
    );
    const cm = await db.query('select count(*) c from canonical_measures where key = any($1)', [
      EUROSTAT_SIBLING_MEASURES_REVIEWED.map((m) => m.key),
    ]);
    expect(Number(cm.rows[0]!.c)).toBe(0);
  });

  it('upserts a reviewed sibling measure once its table is registered, still skips the other two', async () => {
    const db = sharedDb;
    await registerFixtures(db);

    const uneRtQ = EUROSTAT_SIBLING_REGISTRATIONS.find((r) => r.tableId === 'eurostat:une_rt_q')!;
    const fetchFn = async () =>
      new Response(JSON.stringify(FILTERED_UNE_RT_Q), { status: 200, headers: { 'content-type': 'application/json' } });
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    await registerTables(
      db,
      source,
      [{ id: uneRtQ.tableId, updateCadence: uneRtQ.updateCadence, servesTasks: [], slice: uneRtQ.slice }],
      { fetchImpl: fakeDataciteFetch },
    );
    await syncTable(db, source, uneRtQ.tableId);

    const result = await applyRegistryDefaults(db);
    expect(result.tablesMissing).toEqual([]);
    expect(result.canonicalMeasuresUpserted).toContain('eu_unemployment_rate_harmonised');
    expect(result.siblingMeasuresSkipped.sort()).toEqual(['eu_gdp_growth_yoy_volume', 'eu_hicp_annual_rate']);

    const row = await db.query('select table_id, measure from canonical_measures where key = $1', [
      'eu_unemployment_rate_harmonised',
    ]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.table_id).toBe('eurostat:une_rt_q');
    expect(row.rows[0]!.measure).toBe('une_rt_q|PC_ACT');
  });

  // Fix round 2 (minor): the early-return path (CBS tables still missing)
  // used to always report `siblingMeasuresSkipped: []`, even when a sibling
  // table genuinely WAS registered — misleadingly implying nothing was
  // outstanding on the sibling side while the CBS apply had failed outright.
  it('early return (CBS tables missing): still reports which sibling measures are skipped, distinguishing a registered sibling table from an unregistered one', async () => {
    const db = sharedDb;
    // Deliberately NO registerFixtures(db) — every CBS seed table is
    // missing, so applyRegistryDefaults must take the early-return path.
    const uneRtQ = EUROSTAT_SIBLING_REGISTRATIONS.find((r) => r.tableId === 'eurostat:une_rt_q')!;
    const fetchFn = async () =>
      new Response(JSON.stringify(FILTERED_UNE_RT_Q), { status: 200, headers: { 'content-type': 'application/json' } });
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    await registerTables(
      db,
      source,
      [{ id: uneRtQ.tableId, updateCadence: uneRtQ.updateCadence, servesTasks: [], slice: uneRtQ.slice }],
      { fetchImpl: fakeDataciteFetch },
    );
    await syncTable(db, source, uneRtQ.tableId);

    const result = await applyRegistryDefaults(db);
    // The early-return path fired (CBS tables are missing) — nothing written.
    expect(result.tablesMissing.length).toBe(SEED_TABLES.length);
    expect(result.tablesUpdated).toEqual([]);
    expect(result.canonicalMeasuresUpserted).toEqual([]);
    // But the sibling picture is still accurate: une_rt_q IS registered, so
    // its measure is NOT reported as skipped; the other two genuinely are.
    expect(result.siblingMeasuresSkipped.sort()).toEqual(['eu_gdp_growth_yoy_volume', 'eu_hicp_annual_rate']);
  });

  it('is idempotent for sibling measures too: applying twice after the table is registered yields the same row, no duplicates', async () => {
    const db = sharedDb;
    await registerFixtures(db);
    const uneRtQ = EUROSTAT_SIBLING_REGISTRATIONS.find((r) => r.tableId === 'eurostat:une_rt_q')!;
    const fetchFn = async () =>
      new Response(JSON.stringify(FILTERED_UNE_RT_Q), { status: 200, headers: { 'content-type': 'application/json' } });
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    await registerTables(
      db,
      source,
      [{ id: uneRtQ.tableId, updateCadence: uneRtQ.updateCadence, servesTasks: [], slice: uneRtQ.slice }],
      { fetchImpl: fakeDataciteFetch },
    );
    await syncTable(db, source, uneRtQ.tableId);

    await applyRegistryDefaults(db);
    const second = await applyRegistryDefaults(db);
    expect(second.siblingMeasuresSkipped.sort()).toEqual(['eu_gdp_growth_yoy_volume', 'eu_hicp_annual_rate']);
    const rows = await db.query('select key from canonical_measures where key = $1', [
      'eu_unemployment_rate_harmonised',
    ]);
    expect(rows.rows).toHaveLength(1);
  });
});

describe('canonical measures vs. the frozen benchmark answer key (cross-check, no DB)', () => {
  const answerKey = JSON.parse(
    readFileSync(new URL('../../benchmark/answer-key.json', import.meta.url), 'utf8'),
  ) as { tasks: Record<string, any> };

  function canonicalFor(key: string) {
    const cm = CANONICAL_MEASURES.find((c) => c.key === key);
    if (!cm) throw new Error(`no canonical_measures entry for ${key}`);
    return cm;
  }

  it('B1 (population) matches population_on_1_january', () => {
    const cm = canonicalFor('population_on_1_january');
    expect(cm.tableId).toBe(answerKey.tasks.B1.table);
    expect(cm.measure).toBe(answerKey.tasks.B1.measure);
  });

  it('B3 (CPI) matches cpi_yearly_inflation', () => {
    const cm = canonicalFor('cpi_yearly_inflation');
    expect(cm.tableId).toBe(answerKey.tasks.B3.table);
    expect(cm.measure).toBe(answerKey.tasks.B3.measure);
  });

  it('B5 (unemployment) matches the frozen key\'s canonicalDefault exactly', () => {
    const cm = canonicalFor('unemployment_rate_seasonally_adjusted');
    const frozen = answerKey.tasks.B5;
    expect(cm.tableId).toBe(frozen.table);
    expect(cm.measure).toBe(frozen.measure);
    expect(cm.dims).toEqual(frozen.canonicalDefault.chosen ? { SeizoenEnWerkdagcorrectie: frozen.canonicalDefault.chosen.code } : frozen.dims);
  });

  it('B6 (housing stock) matches the frozen key\'s pinned assumption exactly', () => {
    const cm = canonicalFor('housing_stock_start_of_year');
    const frozen = answerKey.tasks.B6;
    expect(cm.tableId).toBe(frozen.table);
    expect(cm.measure).toBe(frozen.measure);
  });

  it('B7 (house price) matches average_existing_home_sale_price', () => {
    const cm = canonicalFor('average_existing_home_sale_price');
    expect(cm.tableId).toBe(answerKey.tasks.B7.table);
    expect(cm.measure).toBe(answerKey.tasks.B7.measure);
  });

  it('B9 (bankruptcies) matches the frozen key\'s pinned assumption exactly', () => {
    const cm = canonicalFor('bankruptcies_businesses');
    const frozen = answerKey.tasks.B9;
    expect(cm.tableId).toBe(frozen.table);
    expect(cm.measure).toBe(frozen.measure);
    expect(cm.dims).toEqual(frozen.dims);
  });

  it('B11 (solar) matches solar_electricity_production', () => {
    const cm = canonicalFor('solar_electricity_production');
    const frozen = answerKey.tasks.B11;
    expect(cm.tableId).toBe(frozen.table);
    expect(cm.measure).toBe(frozen.measure);
    expect(cm.dims).toEqual(frozen.dims);
  });

  it('B12 (household income) matches average_disposable_household_income', () => {
    const cm = canonicalFor('average_disposable_household_income');
    const frozen = answerKey.tasks.B12;
    expect(cm.tableId).toBe(frozen.table);
    expect(cm.measure).toBe(frozen.measure);
    expect(cm.dims.Inkomensbegrippen).toBe(frozen.dims.Inkomensbegrippen);
  });
});
