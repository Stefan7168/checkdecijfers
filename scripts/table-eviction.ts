// On-demand table eviction (#110 b/c, docs/open-questions.md): removes
// on-demand-onboarded CBS tables that nobody has queried for 30 days — the TTL
// half of the WP16 lifecycle (on-demand tables are a cache ABOVE the permanent
// seed set; src/ingestion/eviction.ts has the full design). Deterministic code
// only — no LLM calls, no live pipeline invocation.
//
//   npm run tables:evict                dry run (default): reports which
//                                        tables WOULD be evicted, changes nothing.
//   npm run tables:evict -- --apply     actually evicts them.
//
// Idempotent: an evicted table's registration row is gone, so a second run
// against the same state finds zero new candidates. Pinned (seed) tables are
// structurally exempt; a table with an ACTIVE onboarding job is never touched;
// audit_answers / credit_transactions / pending_table_requests are never
// written (R8: past answers reconstruct from their stored record alone, so
// they survive their table's eviction — verified in
// tests/ingestion/eviction.test.ts). The dry run's listing comes from the
// eviction's OWN scope fragment (the gdpr-purge ⟨F2⟩ discipline), so preview
// and apply can never disagree.
//
// The live --apply against production is a SUPERVISED step (the gdpr:purge
// convention): run the dry run, read the listing, then apply with the owner.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  TableEvictionPartialError,
  describeTableEviction,
  runTableEviction,
} from '../src/ingestion/eviction.ts';
import { connectFromEnv } from '../src/db/client.ts';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const now = new Date();

  const { db, pool } = connectFromEnv();
  try {
    try {
      const summary = await runTableEviction({ db, now, apply });
      console.log(describeTableEviction(summary));
      if (!apply && summary.tables.length > 0) {
        console.log('Re-run with --apply to actually evict them.');
      }
    } catch (error) {
      // A partial failure still evicted tables (their per-table transactions
      // committed). Saying only "it failed" would lose the record of deletions
      // that actually happened.
      if (error instanceof TableEvictionPartialError) {
        console.error(
          `PARTIAL — ${error.evicted.length} table(s) WERE evicted before the failure: ` +
            `${error.evicted.map((t) => t.id).join(', ') || '(none)'}. ` +
            'The failed table and later candidates are untouched; re-run after fixing the cause.',
        );
      }
      throw error;
    }
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
