// CLI to refresh the CBS catalog mirror (cbs_catalog) from the live v4 API.
// SUPERVISED live step (WP16 sub-part 1): it hits CBS and writes to the real DB,
// so it is never on the CI gate. Scheduled cadence is an operational choice
// (open) — for now it is run by hand / a maintenance session.
//   node --env-file=.env src/catalog/cli.ts       (npm run catalog:refresh)
import { ingestCatalog } from './ingest.ts';

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { connectFromEnv } = await import('../db/client.ts');
  const { applyMigrations } = await import('../db/migrate.ts');
  const { adapterFor } = await import('../sources/adapters.ts');
  const { CBS_SOURCE_KEY } = await import('../sources/registry.ts');
  const { db, pool } = connectFromEnv();
  try {
    await applyMigrations(db);
    const result = await ingestCatalog(db, adapterFor(CBS_SOURCE_KEY));
    console.log(
      `Catalog refresh: fetched ${result.fetched}, upserted ${result.upserted}, pruned ${result.pruned}.`,
    );
    if (result.fetched === 0) {
      console.error('FAILED: CBS returned zero catalog rows — mirror left untouched (suspect result).');
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}
