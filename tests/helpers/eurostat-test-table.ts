// Eurostat E2a Task 1 (R1): a shared hand-insert helper for a synthetic,
// REGISTERED Eurostat table with a geo dimension — English region labels
// (as a real Eurostat ingest would leave them, ADR 048), a canonical measure
// pointing at it, and ≥2 years of observations for DE/NL/BE + EU27_2020.
// Mirrors tests/answer/eurostat-explorer-wiring.test.ts's insert pattern
// (same column sets, read from migrations/001_ingestion_schema.sql and
// 002_registry_defaults.sql) and tests/helpers/pglite-db.ts's `createTestDb`.
//
// Reused by later E2a tasks (the sibling-measure clarification chip, Task
// 2+) — parameterisable enough to flag one observation's status (e.g. Eurostat
// 'p' provisional or 'b' break-in-series), so those tasks don't need their
// own hand-insert.
import type { Db } from '../../src/db/types.ts';
import { EUROSTAT_SOURCE_KEY } from '../../src/sources/registry.ts';
import { EUROSTAT_DEFINITIVE_STATUS } from '../../src/eurostat-adapter/jsonstat.ts';

/** The table id every test using this helper can rely on. */
export const EUROSTAT_TEST_TABLE_ID = 'eurostat:e2a_test_unemp';
/** The observations/canonical_measures measure code (Eurostat-shaped:
 * dataset-code|unit-code) — deliberately distinct from the canonical KEY
 * below, same distinction the registry draws for every real measure. */
export const EUROSTAT_TEST_MEASURE = 'e2a_test_unemp|PC_ACT';
/** The canonical measure key a resolved intent targets (R1). */
export const EUROSTAT_TEST_CANONICAL_KEY = 'eu_test_unemployment';
export const EUROSTAT_TEST_GEO_DIMENSION = 'geo';
export const EUROSTAT_TEST_YEARS = [2020, 2021] as const;

/** English dimension_labels, as a real Eurostat ingest leaves them (§4.2 —
 * this is exactly why the Dutch geo-name list exists: these labels alone
 * would not match "Duitsland"). */
export const EUROSTAT_TEST_REGION_LABELS: Readonly<Record<string, string>> = {
  DE: 'Germany',
  NL: 'Netherlands',
  BE: 'Belgium',
  EU27_2020: 'European Union - 27 countries (from 2020)',
};

/** Base value per region per year — arbitrary but distinct, so a wrong-cell
 * bug in a later assertion would be visible rather than accidentally
 * matching. */
const BASE_VALUE: Readonly<Record<string, number>> = {
  DE: 5.1,
  NL: 3.4,
  BE: 5.8,
  EU27_2020: 6.0,
};

export interface EurostatTestTableOptions {
  /** Override one observation's stored `status` (e.g. Eurostat flag 'p'
   * provisional, 'b' break-in-series), keyed `${regionCode}|${year}`.
   * Every other observation keeps the default definitive status
   * (`EUROSTAT_DEFINITIVE_STATUS`, 'Published'). */
  statusOverrides?: Readonly<Record<string, string>>;
}

/** Hand-inserts the registered table + its dimension_labels + its canonical
 * measure + one ingestion_batches row + one observation per (region, year)
 * — exactly what a real Eurostat ingest (E1, ADR 048) would have left
 * behind for this slice, per the migrations' own column sets. */
export async function insertEurostatTestTable(db: Db, options: EurostatTestTableOptions = {}): Promise<void> {
  const statusOverrides = options.statusOverrides ?? {};

  await db.query(
    `insert into cbs_tables (id, title, expected_dimensions, default_coordinates, units, source, status, last_sync_at)
     values ($1, $2, $3::jsonb, '{}'::jsonb, $4::jsonb, $5, 'active', now())`,
    [
      EUROSTAT_TEST_TABLE_ID,
      'E2a test — harmonised unemployment (synthetic)',
      JSON.stringify([
        { name: EUROSTAT_TEST_GEO_DIMENSION, kind: 'GeoDimension' },
        { name: 'Perioden', kind: 'TimeDimension' },
      ]),
      JSON.stringify({
        [EUROSTAT_TEST_MEASURE]: { unit: 'Percentage', decimals: 1, title: 'Unemployment rate — Percentage' },
      }),
      EUROSTAT_SOURCE_KEY,
    ],
  );

  for (const [code, label] of Object.entries(EUROSTAT_TEST_REGION_LABELS)) {
    await db.query(
      `insert into dimension_labels (table_id, dimension, code, label)
       values ($1, $2, $3, $4)`,
      [EUROSTAT_TEST_TABLE_ID, EUROSTAT_TEST_GEO_DIMENSION, code, label],
    );
  }

  await db.query(
    `insert into canonical_measures (key, table_id, measure, measure_title, dims, definition_label, everyday_terms)
     values ($1, $2, $3, $4, '{}'::jsonb, $5, '{}'::text[])`,
    [
      EUROSTAT_TEST_CANONICAL_KEY,
      EUROSTAT_TEST_TABLE_ID,
      EUROSTAT_TEST_MEASURE,
      'Unemployment rate — Percentage',
      'geharmoniseerde werkloosheid (Eurostat, synthetisch testcijfer)',
    ],
  );

  const {
    rows: [batch],
  } = await db.query(
    `insert into ingestion_batches (table_id, finished_at, outcome, row_count)
     values ($1, now(), 'succeeded', $2) returning id`,
    [EUROSTAT_TEST_TABLE_ID, Object.keys(EUROSTAT_TEST_REGION_LABELS).length * EUROSTAT_TEST_YEARS.length],
  );
  const batchId = (batch as { id: number }).id;

  for (const code of Object.keys(EUROSTAT_TEST_REGION_LABELS)) {
    for (const [i, year] of EUROSTAT_TEST_YEARS.entries()) {
      const status = statusOverrides[`${code}|${year}`] ?? EUROSTAT_DEFINITIVE_STATUS;
      const value = BASE_VALUE[code]! + i * 0.1;
      await db.query(
        `insert into observations
           (table_id, measure, region_code, period_code, period_grain, period_year, dims, value, unit, decimals, status, value_attribute, batch_id)
         values ($1, $2, $3, $4, 'JJ', $5, '{}'::jsonb, $6, 'Percentage', 1, $7, 'None', $8)`,
        [EUROSTAT_TEST_TABLE_ID, EUROSTAT_TEST_MEASURE, code, `${year}JJ00`, year, value, status, batchId],
      );
    }
  }
}
