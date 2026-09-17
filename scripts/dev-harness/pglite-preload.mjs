// Local real-browser harness (docs/RUNBOOK.md "Local real-browser harness"): feeds web/lib/db.ts's documented
// `global.__checkdecijfersDb` HMR seam with a PGlite database restored from
// the repo's own hermetic fixture snapshot (tests/helpers/fixture-snapshot.ts).
// No TLS, no secrets, no production database — the same data CI tests against.
import { fileURLToPath } from 'node:url';
import { ensureSnapshot, readSnapshot, restoreFromSnapshot } from '../../tests/helpers/fixture-snapshot.ts';
import { wrapPGlite } from '../../tests/helpers/pglite-db.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
// dev-harness Task 2 (session 111): the CBS snapshot above never carries a
// Eurostat table (it is keyed on tests/fixtures/cbs/ + the CBS SEED_TABLES
// only — see fixture-snapshot.ts's own header), so `/eurostat-explorer`
// showed only its empty state in every prior harness run. Registered here,
// AFTER the snapshot restore, against THIS harness's own private db only —
// never inside fixture-snapshot.ts, whose shared, cached snapshot backs all
// 34 hermetic test files and must stay byte-identical. Same real pipeline
// tests/eurostat-adapter/register-sync.test.ts pins (registerTables +
// syncTable against a real EurostatFixtureSource) — this is that exact call.
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { EurostatFixtureSource, loadEurostatFixtureTree } from '../../src/eurostat-adapter/fixture-source.ts';

const EUROSTAT_FIXTURES_DIR = fileURLToPath(new URL('../../tests/fixtures/eurostat', import.meta.url));
// demo_pjan: the smallest, plain-happy-path fixture (1 unit x 3 geo x 3
// years, no flags) — see tests/fixtures/eurostat/demo_pjan/index.json.
const EUROSTAT_HARNESS_TABLE_ID = 'eurostat:demo_pjan';

/** Never the real network (CLAUDE.md principle b; ADR 048 D7(a)'s own
 * `fetchImpl` seam): a synthetic "findable" DataCite response, so
 * registerTables' out-of-band DOI-verification call stays fully hermetic. */
async function fakeDataciteFetch() {
  return new Response(JSON.stringify({ data: { attributes: { state: 'findable' } } }), {
    status: 200,
    headers: { 'content-type': 'application/vnd.api+json' },
  });
}

if (process.env.CDC_PGLITE_HARNESS === '1' && !globalThis.__checkdecijfersDb) {
  await ensureSnapshot();
  const client = await restoreFromSnapshot(readSnapshot());
  await client.waitReady;
  const db = wrapPGlite(client);
  await applyPricingDefaults(db);
  if (process.env.CDC_HARNESS_USER_ID) {
    try { await db.query('select public.grant_signup_credits($1::uuid)', [process.env.CDC_HARNESS_USER_ID]); } catch (e) { console.log('[pglite-harness] grant:', String(e).slice(0, 120)); }
  }
  try {
    const source = new EurostatFixtureSource(loadEurostatFixtureTree(EUROSTAT_FIXTURES_DIR));
    await registerTables(db, source, [{ id: EUROSTAT_HARNESS_TABLE_ID, updateCadence: 'yearly', servesTasks: [] }], {
      fetchImpl: fakeDataciteFetch,
    });
    const result = await syncTable(db, source, EUROSTAT_HARNESS_TABLE_ID);
    console.log(
      `[pglite-harness] eurostat table ${EUROSTAT_HARNESS_TABLE_ID}: ${result.outcome} (${result.rowCount} rows) — /eurostat-explorer now has something to pick`,
    );
  } catch (e) {
    console.log('[pglite-harness] eurostat fixture registration failed (explorer stays empty):', String(e).slice(0, 300));
  }
  globalThis.__checkdecijfersDb = db;
  console.log('[pglite-harness] fixture database ready in pid', process.pid);
}
