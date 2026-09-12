// Local real-browser harness (docs/RUNBOOK.md "Local real-browser harness"): feeds web/lib/db.ts's documented
// `global.__checkdecijfersDb` HMR seam with a PGlite database restored from
// the repo's own hermetic fixture snapshot (tests/helpers/fixture-snapshot.ts).
// No TLS, no secrets, no production database — the same data CI tests against.
import { ensureSnapshot, readSnapshot, restoreFromSnapshot } from '../../tests/helpers/fixture-snapshot.ts';
import { wrapPGlite } from '../../tests/helpers/pglite-db.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
if (process.env.CDC_PGLITE_HARNESS === '1' && !globalThis.__checkdecijfersDb) {
  await ensureSnapshot();
  const client = await restoreFromSnapshot(readSnapshot());
  await client.waitReady;
  const db = wrapPGlite(client);
  await applyPricingDefaults(db);
  if (process.env.CDC_HARNESS_USER_ID) {
    try { await db.query('select public.grant_signup_credits($1::uuid)', [process.env.CDC_HARNESS_USER_ID]); } catch (e) { console.log('[pglite-harness] grant:', String(e).slice(0, 120)); }
  }
  globalThis.__checkdecijfersDb = db;
  console.log('[pglite-harness] fixture database ready in pid', process.pid);
}
