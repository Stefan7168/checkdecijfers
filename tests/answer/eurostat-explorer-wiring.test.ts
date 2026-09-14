// WP30c/E1 Task 7 (ADR 048): a GENUINE exercise of web/lib/eurostat-explorer.ts
// against a real (hermetic, PGlite) database with a hand-inserted registered
// Eurostat table — proving the explorer's glue actually reaches the real
// runQuery -> composeAnswer -> buildChartSpec pipeline (respondToIntent),
// not a mock of it. This is the project's own "code that actually proves
// what it claims" standard: nothing here stubs runQuery, composeAnswer or
// buildChartSpec — only the DB rows a real Eurostat ingest would have left
// behind are hand-built (Constraint 0: no real ingest ran this session, so
// there is nothing else to hand-insert from).
//
// Placed alongside the backend answer-pipeline suite (not under web/,
// mirroring tests/answer/respond-staleness.test.ts's own hand-built
// ParseOutcome + real PGlite pattern) because web/lib/eurostat-explorer.ts
// is a plain, Next-free async module — importable and testable exactly like
// any other backend glue leaf, and this is the only test in the whole change
// that spins up a real database against it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { EUROSTAT_SOURCE_KEY } from '../../src/sources/registry.ts';
import {
  listMeasuresForTable,
  listRegisteredEurostatTables,
  runExplorerQuery,
} from '../../web/lib/eurostat-explorer.ts';

const TABLE_ID = 'eurostat:wiring_test_pop';
const MEASURE = 'wiring_test_pop|NR';

/** Hand-inserts exactly what a real Eurostat ingest (out of scope this
 * session, Constraint 0) would have left behind for ONE annual, no-geo-
 * dimension measure across two years — the minimum a real runQuery call can
 * answer from. Mirrors migrations/001_ingestion_schema.sql's column set
 * directly (no ORM, no helper this test doesn't already own). */
async function insertRegisteredEurostatTable(db: Db): Promise<void> {
  await db.query(
    `insert into cbs_tables (id, title, expected_dimensions, units, source, status, last_sync_at)
     values ($1, $2, '[]'::jsonb, $3::jsonb, $4, 'active', now())`,
    [
      TABLE_ID,
      'Wiring-test population (synthetic, WP30c/E1 Task 7)',
      JSON.stringify({ [MEASURE]: { unit: 'Number', decimals: 0, title: 'Population — Number' } }),
      EUROSTAT_SOURCE_KEY,
    ],
  );
  const {
    rows: [batch],
  } = await db.query(
    `insert into ingestion_batches (table_id, finished_at, outcome, row_count)
     values ($1, now(), 'succeeded', 2) returning id`,
    [TABLE_ID],
  );
  const batchId = (batch as { id: number }).id;
  for (const [year, value] of [
    [2020, 1000],
    [2021, 1010],
  ] as const) {
    await db.query(
      `insert into observations
         (table_id, measure, region_code, period_code, period_grain, period_year, dims, value, unit, decimals, status, value_attribute, batch_id)
       values ($1, $2, '', $3, 'JJ', $4, '{}'::jsonb, $5, 'Number', 0, 'Definitief', 'None', $6)`,
      [TABLE_ID, MEASURE, `${year}JJ00`, year, value, batchId],
    );
  }
}

describe('web/lib/eurostat-explorer.ts — genuine pipeline wiring (WP30c/E1 Task 7)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it('listRegisteredEurostatTables sees the hand-inserted table and nothing else (empty before)', async () => {
    expect(await listRegisteredEurostatTables(db)).toEqual([]);
    await insertRegisteredEurostatTable(db);
    expect(await listRegisteredEurostatTables(db)).toEqual([
      { id: TABLE_ID, title: 'Wiring-test population (synthetic, WP30c/E1 Task 7)' },
    ]);
  });

  it('listMeasuresForTable reads the real cbs_tables.units column', async () => {
    await insertRegisteredEurostatTable(db);
    expect(await listMeasuresForTable(db, TABLE_ID)).toEqual([
      { code: MEASURE, title: 'Population — Number' },
    ]);
  });

  it('runExplorerQuery runs the REAL pipeline end to end: two real cells, a real chart, real CSV/proof-ready data', async () => {
    await insertRegisteredEurostatTable(db);
    const response = await runExplorerQuery(db, {
      tableId: TABLE_ID,
      measure: MEASURE,
      fromYear: '2020',
      toYear: '2021',
    });

    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') return;

    // Real runQuery output — not fabricated by this module.
    expect(response.result.cells).toHaveLength(2);
    expect(response.result.cells.map((c) => c.value)).toEqual([1000, 1010]);
    expect(response.result.cells.map((c) => c.periodCode)).toEqual(['2020JJ00', '2021JJ00']);
    // Amendment B1: Eurostat's definitiveStatuses is [] — every cell renders
    // provisional regardless of its stored CBS-shaped status, the safe
    // fail-direction this brief's registry entry deliberately chose.
    expect(response.result.cells.every((c) => c.provisional)).toBe(true);

    // Real composeAnswer (templateOnly — R3's deterministic floor, not a
    // canned string this module wrote).
    expect(response.answer.body.length).toBeGreaterThan(0);
    expect(response.text).toContain(response.answer.body);

    // Real buildChartSpec — a 2-point annual series is chartable.
    expect(response.chart).not.toBeNull();
    expect(response.chart!.series[0]!.points).toHaveLength(2);

    // D5c: genuinely zero LLM spend — the throwing stub client was never
    // reached (composeAnswer's own templateOnly branch never touches it).
    expect(response.answer.model).toBeNull();
  });

  it('a table with no recorded units (cbs_tables.units null) reports zero measures, not a crash', async () => {
    await db.query(
      `insert into cbs_tables (id, title, expected_dimensions, source, status, last_sync_at)
       values ($1, $2, '[]'::jsonb, $3, 'active', now())`,
      ['eurostat:no_units_test', 'No-units test table', EUROSTAT_SOURCE_KEY],
    );
    expect(await listMeasuresForTable(db, 'eurostat:no_units_test')).toEqual([]);
  });

  it('an unregistered table id refuses honestly through the real pipeline (no crash, no fabricated answer)', async () => {
    const response = await runExplorerQuery(db, {
      tableId: 'eurostat:does_not_exist',
      measure: 'does_not_exist|NR',
      fromYear: '2020',
      toYear: '2021',
    });
    expect(response.kind).toBe('refusal');
  });
});
