// One-off, idempotent backfill for `cbs_tables.doi` (#264, ADR 048 D7(a)) —
// catches Eurostat tables that were REGISTERED before this fix shipped, so
// `registerTables` never had the chance to source a DOI for them at all
// (session 107's `eurostat:tipsbd30` is exactly this case). Newly registered
// Eurostat tables no longer need this: `registerTables` itself now
// constructs + verifies the DOI at registration time (src/ingestion/
// pipeline.ts).
//
//   npx tsx scripts/backfill-eurostat-doi.ts             dry run (default):
//                                                         reports what WOULD
//                                                         be written, changes
//                                                         nothing.
//   npx tsx scripts/backfill-eurostat-doi.ts --apply     actually writes doi.
//
// Idempotent: only ever touches rows with `source = 'eurostat' and doi is
// null`; a second run after a successful --apply finds zero rows to touch
// (mirrors scripts/gdpr-purge.ts's dry-run/--apply shape).
//
// Scope, enforced by the query below: `source = 'eurostat'` rows only — CBS
// has no DOI concept and is never touched. Never blocks on a DataCite
// hiccup: any row that DataCite doesn't confirm `findable` is reported and
// left null, never guessed (principle c), same fail-safe rule
// `registerTables`'s own call site follows.
//
// NOT run against the live database by the session that wrote it (CLAUDE.md:
// no live DB writes from a dispatched/autonomous session) — this is an
// owner-run RUNBOOK step (docs/RUNBOOK.md, WP30c E1) for the one
// already-registered production row, `eurostat:tipsbd30`.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { connectFromEnv } from '../src/db/client.ts';
import { eurostatDoiFor, verifyEurostatDoi } from '../src/eurostat-adapter/doi.ts';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const { db, pool } = connectFromEnv();
  try {
    const { rows } = await db.query(
      `select id from cbs_tables where source = 'eurostat' and doi is null order by id`,
    );

    if (rows.length === 0) {
      console.log('No eurostat table has a null doi — nothing to backfill.');
      return;
    }

    console.log(`${rows.length} eurostat table(s) with doi is null:`);
    let wouldWrite = 0;
    let leftNull = 0;

    for (const row of rows) {
      const id = row.id as string;
      const candidate = eurostatDoiFor(id);
      const findable = await verifyEurostatDoi(candidate);

      if (findable) {
        wouldWrite += 1;
        console.log(`  ${id}: ${candidate} — DataCite confirms findable${apply ? ', writing' : ' (dry run)'}`);
        if (apply) {
          await db.query('update cbs_tables set doi = $2 where id = $1', [id, candidate]);
        }
      } else {
        leftNull += 1;
        console.log(`  ${id}: ${candidate} — NOT confirmed findable by DataCite, left null`);
      }
    }

    console.log(`\n${wouldWrite} ${apply ? 'written' : 'would be written'}, ${leftNull} left null.`);
    if (!apply) console.log('Re-run with --apply to actually write them.');
  } finally {
    try {
      await pool.end();
    } catch (closeError) {
      console.error('warning: closing the database connection failed:', closeError);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
