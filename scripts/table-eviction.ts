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
//   npm run tables:evict -- --table 83694NED --table 85615NED [--apply]
//                                        TARGETED mode: evicts exactly the named
//                                        tables now, ignoring the 30-day staleness
//                                        cutoff. Every other guard stays: a pinned
//                                        (seed) table, an unregistered id, or a
//                                        table with an active onboarding job is
//                                        REFUSED loudly and never touched (exit
//                                        code 1); the other named ids proceed.
//                                        Dry run by default here too.
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

/** `--table <id>` / `--table=<id>`, repeatable. undefined = flag not used
 * (the untouched TTL sweep). A `--table` with no usable value is an error, never
 * a silent fall-back to the full sweep. */
export function parseTableArgs(argv: readonly string[]): string[] | undefined {
  const ids: string[] = [];
  let used = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--table') {
      used = true;
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--') || value.trim() === '') {
        throw new Error('--table needs a table id, e.g. --table 83694NED');
      }
      ids.push(value);
      i++;
    } else if (arg.startsWith('--table=')) {
      used = true;
      const value = arg.slice('--table='.length);
      if (value.trim() === '') throw new Error('--table= needs a table id');
      ids.push(value);
    }
  }
  return used ? ids : undefined;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const tables = parseTableArgs(process.argv.slice(2));
  const now = new Date();

  const { db, pool } = connectFromEnv();
  try {
    try {
      const summary = await runTableEviction({ db, now, apply, ...(tables ? { tables } : {}) });
      console.log(describeTableEviction(summary));
      if (summary.refused && summary.refused.length > 0) {
        console.error(
          `REFUSED ${summary.refused.length} named table(s): ` +
            `${summary.refused.map((r) => `${r.id} (${r.reason})`).join(', ')}.`,
        );
        process.exitCode = 1;
      }
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
