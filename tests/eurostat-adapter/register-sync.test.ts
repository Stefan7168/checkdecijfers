// dev-harness Task 2 (session 111): the FIRST genuine exercise of
// registerTables/syncTable (src/ingestion/pipeline.ts) against a real
// EurostatFixtureSource, over a real (schema-only) PGlite database — proving
// the generic ingestion pipeline, built and tested against CBS's own
// FixtureSource, also works unmodified for the Eurostat CbsSource
// implementation (ADR 048 D1). Before this, only the source-conformance
// harness (tests/sources/conformance.test.ts) had exercised
// EurostatFixtureSource, and that harness never touches a database — it
// checks the parsed schema/observations shape only, never
// registerTables/syncTable's five validation checks, the cbs_tables insert,
// or the DOI verification side call (D7(a)). Session 107's own RUNBOOK note
// ("WP30c E1... found a 5th bug: registerTables never wrote cbs_tables.source")
// was found registering the FIRST real (non-fixture) Eurostat table for
// exactly this reason — a generic function's type signature accepting a
// second source does not mean it has ever been called with one (memory
// lesson: "verify first real exercise of generic code").
//
// This is also what scripts/dev-harness/pglite-preload.mjs (session 111,
// Task 2) now does at harness startup, against the SAME fixture
// (tests/fixtures/eurostat/demo_pjan) — this test is that exact call,
// pinned in the hermetic suite so a future change to the pipeline or the
// adapter that would break the harness fails loudly here first, in seconds,
// rather than only being discoverable by starting `next dev`.
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CbsSlice } from '../../src/cbs-adapter/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { EurostatFixtureSource, loadEurostatFixtureTree } from '../../src/eurostat-adapter/fixture-source.ts';
import { StatisticsApiSource } from '../../src/eurostat-adapter/statistics-api.ts';
import { EUROSTAT_SOURCE_KEY } from '../../src/sources/registry.ts';
import { listMeasuresForTable, listRegisteredEurostatTables } from '../../web/lib/eurostat-explorer.ts';

// fileURLToPath (never `.pathname`, which percent-encodes spaces — this
// checkout's own path has one, "Check de Cijfers", the same trap
// scripts/dev-harness/run-next-dev.mjs's header documents for NODE_OPTIONS).
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/eurostat', import.meta.url));
const TABLE_ID = 'eurostat:demo_pjan';

/** Never the real network (CLAUDE.md principle b / ADR 048 D7(a)'s own
 * `fetchImpl` seam): a synthetic DataCite "findable" response, so
 * registration's out-of-band DOI-verification call stays fully hermetic —
 * same shape the real endpoint returns, per doi.ts's own doc comment. */
async function fakeDataciteFetch(): Promise<Response> {
  return new Response(JSON.stringify({ data: { attributes: { state: 'findable' } } }), {
    status: 200,
    headers: { 'content-type': 'application/vnd.api+json' },
  });
}

describe('registerTables + syncTable against a real EurostatFixtureSource (dev-harness Task 2)', () => {
  it('registers demo_pjan with source="eurostat" and a verified DOI, then syncs all 9 observations', async () => {
    const { db, close } = await createTestDb();
    try {
      const source = new EurostatFixtureSource(loadEurostatFixtureTree(FIXTURES_DIR));

      const registered = await registerTables(
        db,
        source,
        [{ id: TABLE_ID, updateCadence: 'yearly', servesTasks: [] }],
        { fetchImpl: fakeDataciteFetch },
      );
      expect(registered).toEqual([TABLE_ID]);

      const { rows } = await db.query(
        'select source, doi, status from cbs_tables where id = $1',
        [TABLE_ID],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe(EUROSTAT_SOURCE_KEY);
      expect(rows[0]!.doi).toBe('10.2908/DEMO_PJAN');
      expect(rows[0]!.status).toBe('active');

      const result = await syncTable(db, source, TABLE_ID);
      expect(result.outcome).toBe('succeeded');
      expect(result.rowCount).toBe(9); // 1 unit x 3 geo x 3 years
      expect(result.rowsInserted).toBe(9);

      // The exact glue web/app/eurostat-explorer/page.tsx calls: proves the
      // registered table is genuinely discoverable through the explorer's
      // own reads, not just present in cbs_tables by direct SQL inspection.
      const explorerTables = await listRegisteredEurostatTables(db);
      expect(explorerTables).toEqual([{ id: TABLE_ID, title: 'Population on 1 January' }]);

      const measures = await listMeasuresForTable(db, TABLE_ID);
      expect(measures).toEqual([
        { code: 'demo_pjan|NR', title: 'Population on 1 January — Number' },
      ]);

      const { rows: obs } = await db.query(
        `select region_code, period_code, value from observations where table_id = $1 order by region_code, period_code`,
        [TABLE_ID],
      );
      expect(obs).toHaveLength(9);
      // Sanity on one real value from dataset.json (DE, 2021) — the geo
      // dimension for this dataset has no CBS-style region code, so
      // region_code is the bare Eurostat geo code.
      const de2021 = obs.find((r) => r.region_code === 'DE' && r.period_code === '2021JJ00');
      expect(Number(de2021?.value)).toBe(83155031);
    } finally {
      await close();
    }
  });
});

// E2a step-5 fix round 2 (2026-09-23): registerTables/syncTable's OWN
// schema/code-list reads never passed the table's registered slice through
// (only fetchObservations did) — so a Eurostat sibling whose FULL dataset
// exceeds the 500k-cell synchronous cap could never even REGISTER, even
// after fetchAndParse's own request-URL fix. This is that fix, proven
// against a live-style StatisticsApiSource + injected fetch stub (never the
// real network) rather than EurostatFixtureSource, because the "over cap
// unfiltered vs under cap filtered" distinction is inherently about what
// URL the (simulated) server receives.
describe('registerTables/syncTable thread the registered slice into schema + code-list reads too (E2a step-5 fix round 2)', () => {
  const TABLE_ID = 'eurostat:une_rt_q';

  // Cheap stand-in for a real "over cap" dataset: only `size`'s product
  // matters for AsyncApiRequiredError (jsonstat.ts throws on `total` BEFORE
  // examining `dimension`/`value` at all — see statistics-api.test.ts's own
  // note), so this needs no giant arrays.
  const OVER_CAP_DATASET = { id: ['unit', 'geo', 'time'], size: [1, 1000, 1000], dimension: {}, value: {} };

  const FILTERED_DATASET = {
    version: '2.0',
    class: 'dataset',
    label: 'Unemployment by sex and age - quarterly data',
    id: ['unit', 'geo', 'time'],
    size: [1, 1, 1],
    dimension: {
      unit: { category: { index: { PC_ACT: 0 }, label: { PC_ACT: 'Percentage of population in the labour force' } } },
      geo: { category: { index: { NL: 0 }, label: { NL: 'Netherlands' } } },
      time: { category: { index: { '2024-Q1': 0 }, label: { '2024-Q1': '2024-Q1' } } },
    },
    value: [3.5],
  };

  /** A real Eurostat server would shrink `size` once the request carries
   * filter params (verified live — see the E2a sibling-datasets research
   * doc); this stub simulates exactly that so the test proves the ADAPTER's
   * request URL now carries those params for schema/code-list reads too,
   * not just observations. */
  function slicedFetchStub() {
    return vi.fn(async (url: string) => {
      const body = url.includes('geo=') ? FILTERED_DATASET : OVER_CAP_DATASET;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  }

  it('NO registered slice — an over-cap dataset still throws AsyncApiRequiredError on registration (unchanged)', async () => {
    const { db, close } = await createTestDb();
    try {
      const fetchFn = slicedFetchStub();
      const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);

      await expect(
        registerTables(db, source, [{ id: TABLE_ID, updateCadence: 'quarterly', servesTasks: [] }], {
          fetchImpl: fakeDataciteFetch,
        }),
      ).rejects.toThrow(/500000-cell synchronous/);
    } finally {
      await close();
    }
  });

  it('WITH a registered slice — registration succeeds, and schema + code lists + observations all come from ONE filtered fetch', async () => {
    const { db, close } = await createTestDb();
    try {
      const fetchFn = slicedFetchStub();
      const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
      const slice: CbsSlice = { dimensionEquals: { unit: 'PC_ACT' } };

      const registered = await registerTables(
        db,
        source,
        [{ id: TABLE_ID, updateCadence: 'quarterly', servesTasks: [], slice }],
        { fetchImpl: fakeDataciteFetch },
      );
      expect(registered).toEqual([TABLE_ID]);

      const { rows } = await db.query('select source, slice, status from cbs_tables where id = $1', [TABLE_ID]);
      expect(rows[0]!.source).toBe(EUROSTAT_SOURCE_KEY);
      expect(rows[0]!.status).toBe('active');

      const result = await syncTable(db, source, TABLE_ID);
      expect(result.outcome).toBe('succeeded');
      expect(result.rowCount).toBe(1);

      const measures = await listMeasuresForTable(db, TABLE_ID);
      expect(measures).toEqual([
        { code: 'une_rt_q|PC_ACT', title: 'Unemployment by sex and age - quarterly data — Percentage of population in the labour force' },
      ]);

      // registerTables (fetchTableSchema + fetchCodeList x N dims) AND the
      // separate syncTable call (fetchTableSchema + fetchCodeList x N dims +
      // fetchObservations) all key `loadDataset` on the SAME (tableId,
      // slice) pair, on the SAME source instance — one underlying fetch for
      // the whole registration + sync of this table, not one per method.
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const calledUrl = fetchFn.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('unit=PC_ACT');
      expect(calledUrl).toContain('geo=');
    } finally {
      await close();
    }
  });
});
