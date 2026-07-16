// Registry work package tests (ADR 010): hermetic (PGlite, no network — ADR 009),
// registers every curated seed table (8 Phase 0 + coverage sprint) from fixture docs (schema only, no observations
// needed) then applies src/registry/defaults.ts and checks the result.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocsTree } from '../../src/cbs-adapter/fixture-source.ts';
import { registerTables } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { applyRegistryDefaults } from '../../src/registry/apply.ts';
import { CANONICAL_MEASURES, TABLE_REGISTRY_DEFAULTS } from '../../src/registry/defaults.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

async function registeredDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const { db, close } = await createTestDb();
  const docsTree = loadFixtureDocsTree(FIXTURES_DIR);
  const source = new FixtureSource(docsTree);
  await registerTables(db, source, SEED_TABLES);
  return { db, close };
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
    const { db, close } = await createTestDb(); // no registerTables call — empty cbs_tables
    try {
      const result = await applyRegistryDefaults(db);
      expect(result.tablesMissing.length).toBe(SEED_TABLES.length);
      expect(result.tablesUpdated).toEqual([]);
      expect(result.canonicalMeasuresUpserted).toEqual([]);
      const cm = await db.query('select count(*) c from canonical_measures');
      expect(Number(cm.rows[0]!.c)).toBe(0);
    } finally {
      await close();
    }
  });

  it('applies default_coordinates + period_semantics for every registered Phase 0 table', async () => {
    const { db, close } = await registeredDb();
    try {
      const result = await applyRegistryDefaults(db);
      expect(result.tablesMissing).toEqual([]);
      expect(result.tablesUpdated.sort()).toEqual(SEED_TABLES.map((t) => t.id).sort());

      for (const entry of TABLE_REGISTRY_DEFAULTS) {
        const row = await cbsTable(db, entry.tableId);
        expect(row, entry.tableId).toBeTruthy();
        expect(row!.default_coordinates, entry.tableId).toEqual(entry.defaultCoordinates);
        expect(row!.period_semantics, entry.tableId).toEqual(entry.periodSemantics);
      }
    } finally {
      await close();
    }
  });

  it('upserts every canonical measure, each referencing a real registered table', async () => {
    const { db, close } = await registeredDb();
    try {
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
    } finally {
      await close();
    }
  });

  it('is idempotent: applying twice yields the same row counts and values, no duplicates', async () => {
    const { db, close } = await registeredDb();
    try {
      await applyRegistryDefaults(db);
      const first = await db.query('select key, table_id, measure, dims from canonical_measures order by key');

      const second = await applyRegistryDefaults(db);
      expect(second.tablesMissing).toEqual([]);
      const after = await db.query('select key, table_id, measure, dims from canonical_measures order by key');

      expect(after.rows).toHaveLength(first.rows.length);
      expect(after.rows).toEqual(first.rows);
    } finally {
      await close();
    }
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
