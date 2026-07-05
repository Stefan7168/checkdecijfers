// Ingestion CLI (docs/05-data-rules.md: "Loud includes the operator" — Phase
// 0's ingestion CLI fails with a non-zero exit and a plain-language summary
// the owner can read). Commands: register, sync.
import type { CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { PHASE0_TABLES } from './registry-seed.ts';
import { registerTables, syncTable } from './pipeline.ts';
import type { Correction, SyncResult } from './types.ts';

interface Deps {
  db: Db;
  source: CbsSource;
}

interface ParsedArgs {
  command: 'register' | 'sync' | null;
  tableIds: string[];
  all: boolean;
  acceptNewCodes: boolean;
  rebaseline: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const tableIds: string[] = [];
  let all = false;
  let acceptNewCodes = false;
  let rebaseline = false;

  for (const arg of rest) {
    if (arg === '--all') all = true;
    else if (arg === '--accept-new-codes') acceptNewCodes = true;
    else if (arg === '--rebaseline') rebaseline = true;
    else if (!arg.startsWith('--')) tableIds.push(arg);
  }

  return {
    command: command === 'register' || command === 'sync' ? command : null,
    tableIds,
    all: all || tableIds.length === 0,
    acceptNewCodes,
    rebaseline,
  };
}

function formatCorrections(corrections: Correction[]): string[] {
  return corrections.map(
    (c) =>
      `  - ${c.measure} ${c.region_code || '(no region)'} ${c.period_code} ${JSON.stringify(c.dims)}: ` +
      `${c.old_value ?? 'null'} (${c.old_status}) -> ${c.new_value ?? 'null'} (${c.new_status})`,
  );
}

function printResult(action: 'Registered' | 'Synced', tableId: string, result: SyncResult, durationMs: number): void {
  const seconds = (durationMs / 1000).toFixed(1);
  if (result.outcome === 'failed') {
    console.log(`\n[${tableId}] FAILED (check: ${result.failureStage})`);
    console.log(`  ${result.failureSummary}`);
    console.log(`  Duration: ${seconds}s. Batch id: ${result.batchId}.`);
    return;
  }

  console.log(`\n[${tableId}] ${action}${result.rebaselined ? ' (re-baselined)' : ''}`);
  console.log(
    `  Rows — fetched: ${result.rowCount}, inserted: ${result.rowsInserted}, ` +
      `updated: ${result.rowsUpdated}, unchanged: ${result.rowsUnchanged}, missing: ${result.rowsMissing}`,
  );
  console.log(`  Corrections: ${result.corrections.length}`);
  if (result.corrections.length > 0 && result.corrections.length <= 10) {
    for (const line of formatCorrections(result.corrections)) console.log(line);
  }
  console.log(`  Duration: ${seconds}s. Batch id: ${result.batchId}.`);
}

export async function runCli(argv: string[], deps: Deps): Promise<number> {
  const { db, source } = deps;
  const args = parseArgs(argv);

  if (args.command === null) {
    console.error('Usage: ingest <register|sync> [tableIds...] [--all] [--accept-new-codes] [--rebaseline]');
    return 1;
  }

  if (args.command === 'register') {
    const start = Date.now();
    try {
      const registered = await registerTables(db, source, PHASE0_TABLES);
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      if (registered.length === 0) {
        console.log(`All ${PHASE0_TABLES.length} Phase 0 table(s) were already registered. Nothing to do.`);
      } else {
        console.log(`Registered ${registered.length} table(s) in ${duration}s: ${registered.join(', ')}.`);
      }
      return 0;
    } catch (err) {
      console.error(`Registration failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  // sync: auto-register missing seed tables first (trust-on-first-use event).
  const seedTables = args.all ? PHASE0_TABLES : PHASE0_TABLES.filter((t) => args.tableIds.includes(t.id));

  try {
    const registered = await registerTables(db, source, seedTables);
    if (registered.length > 0) {
      console.log(`Auto-registered ${registered.length} table(s) before syncing: ${registered.join(', ')}.`);
    }
  } catch (err) {
    console.error(`Auto-registration before sync failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // #110a (WP16 sub-part 2, design §6): `--all` targets every table this
  // database actually knows about (cbs_tables, the REGISTERED set — which now
  // includes on-demand-onboarded tables from CORE-2's job, not just the
  // Phase 0 seeds), not the hardcoded PHASE0_TABLES list. Before this fix,
  // `sync --all` after WP16's onboarding job ran would silently skip every
  // onboarded table — a live drift risk the design doc's own §8 gap analysis
  // flagged. The seed auto-registration above still runs first unconditionally
  // so a brand-new database still bootstraps from nothing.
  const targetIds = args.all ? (await db.query('select id from cbs_tables')).rows.map((r) => String(r.id)) : args.tableIds;

  let allSucceeded = true;
  for (const tableId of targetIds) {
    const start = Date.now();
    try {
      const result = await syncTable(db, source, tableId, {
        acceptNewCodes: args.acceptNewCodes,
        rebaseline: args.rebaseline,
      });
      printResult('Synced', tableId, result, Date.now() - start);
      if (result.outcome === 'failed') allSucceeded = false;
    } catch (err) {
      allSucceeded = false;
      console.error(`\n[${tableId}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return allSucceeded ? 0 : 1;
}

// CLI entry: node --env-file=.env src/ingestion/cli.ts <register|sync> ...
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { connectFromEnv } = await import('../db/client.ts');
  const { applyMigrations } = await import('../db/migrate.ts');
  const { ODataV4Source } = await import('../cbs-adapter/odata-v4.ts');
  const { db, pool } = connectFromEnv();
  try {
    await applyMigrations(db);
    const code = await runCli(process.argv.slice(2), { db, source: new ODataV4Source() });
    process.exit(code);
  } finally {
    await pool.end();
  }
}
