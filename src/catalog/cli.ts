// CLI to refresh the CBS catalog mirror (cbs_catalog) from the live v4 API.
// SUPERVISED live step (WP16 sub-part 1): it hits CBS and writes to the real DB,
// so it is never on the CI gate. Scheduled cadence is an operational choice
// (open) — for now it is run by hand / a maintenance session.
//   node --env-file=.env src/catalog/cli.ts       (npm run catalog:refresh)
//   … -- --source eurostat                         Eurostat's own table of contents (session 154: production
//                                                  had 0 Eurostat rows, so the live finder could find none)
import { ingestCatalog } from './ingest.ts';

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { connectFromEnv } = await import('../db/client.ts');
  const { applyMigrations } = await import('../db/migrate.ts');
  const { adapterFor } = await import('../sources/adapters.ts');
  const { CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY } = await import('../sources/registry.ts');
  const sourceArg = process.argv.indexOf('--source');
  const sourceKey = sourceArg >= 0 ? process.argv[sourceArg + 1] : CBS_SOURCE_KEY;
  if (sourceKey !== CBS_SOURCE_KEY && sourceKey !== EUROSTAT_SOURCE_KEY) {
    console.error(`unknown --source '${sourceKey}' (cbs | eurostat)`);
    process.exit(2);
  }
  const { maybeAlertTableStatusFlip } = await import('../answer/audit/alerts.ts');
  const { db, pool } = connectFromEnv();
  try {
    await applyMigrations(db);
    const result = await ingestCatalog(db, adapterFor(sourceKey), sourceKey);
    console.log(
      `Catalog refresh: fetched ${result.fetched}, upserted ${result.upserted}, pruned ${result.pruned}.`,
    );
    if (result.fetched === 0) {
      console.error(`FAILED: ${sourceKey} returned zero catalog rows — mirror left untouched (suspect result).`);
      process.exit(1);
    }
    // #108: detection-only — a registered table falling out of "current"
    // (status flip or vanishing) never blocks the refresh or exits non-zero;
    // it is an operator signal, not a failure of this run.
    if (result.flips.length > 0) {
      console.log(`Catalog refresh: ${result.flips.length} registered table(s) no longer current.`);
      await maybeAlertTableStatusFlip({ flips: result.flips });
    }
  } finally {
    await pool.end();
  }
}
