// Ingestion CLI (docs/05-data-rules.md: "Loud includes the operator" — Phase
// 0's ingestion CLI fails with a non-zero exit and a plain-language summary
// the owner can read). Commands: register, sync, warm, and the supervised
// storage commands convert-to-slices, convert-to-full, rebaseline-slices.
import type { CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { maybeAlertIngestionRunProblems, type IngestionRunProblem } from '../answer/audit/alerts.ts';
import { CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../sources/registry.ts';
import { SEED_TABLES } from './registry-seed.ts';
import { registerTables, syncTable } from './pipeline.ts';
import type { Correction, SyncResult } from './types.ts';
import { convertTableToFull, convertTableToSlices, describeConversion, describeConversionToFull } from './convert.ts';
import { describeRebaseline, rebaselineSliceTable } from './rebaseline-slices.ts';
import { warmPinnedTables, type WarmTableResult } from './warm-job.ts';

interface Deps {
  db: Db;
  source: CbsSource;
  /** Builds the adapter for a table's source key (ADR 065, #358 item 4: CBS and Eurostat tables in one
   * run). With `stopAt` (epoch ms) every request it makes is limited to the time left until then, so
   * --budget-seconds is a real upper bound. Absent (tests with a fixture source): `source` is used for
   * every table, as is. */
  sourceFor?: (sourceKey: string, stopAt?: number) => CbsSource;
  /** Injected for tests (hermetic Resend stubbing, same pattern every sibling
   * admin alert test uses). Defaults to the real fetch in production. */
  fetchImpl?: typeof fetch;
}

const COMMANDS = ['register', 'sync', 'warm', 'convert-to-slices', 'convert-to-full', 'rebaseline-slices'] as const;
type Command = (typeof COMMANDS)[number];

interface ParsedArgs {
  command: Command | null;
  tableIds: string[];
  all: boolean;
  acceptNewCodes: boolean;
  rebaseline: boolean;
  /** The storage commands: perform the change (without it they are a dry run). */
  yes: boolean;
  /** warm and the storage commands: the run's time budget; undefined when not
   * given (each command has its default), null when the value was not a positive number. */
  budgetSeconds: number | null | undefined;
}

/** warm's default time budget (seconds). */
const DEFAULT_WARM_BUDGET_SECONDS = 240;
/** convert-to-slices / rebaseline-slices: the proof and the warm run of a big table take longer. */
const DEFAULT_STORAGE_BUDGET_SECONDS = 900;

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const tableIds: string[] = [];
  let all = false;
  let acceptNewCodes = false;
  let rebaseline = false;
  let yes = false;
  let budgetSeconds: number | null | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--all') all = true;
    else if (arg === '--accept-new-codes') acceptNewCodes = true;
    else if (arg === '--rebaseline') rebaseline = true;
    else if (arg === '--yes') yes = true;
    else if (arg === '--budget-seconds') {
      const value = Number(rest[++i]);
      budgetSeconds = Number.isFinite(value) && value > 0 ? value : null;
    } else if (!arg.startsWith('--')) tableIds.push(arg);
  }

  return {
    command: (COMMANDS as readonly string[]).includes(command ?? '') ? (command as Command) : null,
    tableIds,
    all: all || tableIds.length === 0,
    acceptNewCodes,
    rebaseline,
    yes,
    budgetSeconds,
  };
}

/** The adapter for one source key: `sourceFor` when given (the CLI entry), otherwise `source`. */
function sourceOf(deps: Deps, sourceKey: string, stopAt?: number): CbsSource {
  return deps.sourceFor ? deps.sourceFor(sourceKey, stopAt) : deps.source;
}

function printWarmResult(r: WarmTableResult): void {
  const counts = `planned ${r.planned}, fetched ${r.fetched}, confirmed ${r.confirmed}, remaining ${r.remaining}`;
  if (r.outcome === 'skipped') {
    console.log(`[${r.tableId}] skipped — ${r.skippedReason ?? 'no reason recorded'}`);
  } else if (r.outcome === 'failed') {
    const f = r.failure;
    console.log(
      `[${r.tableId}] FAILED (${f?.stage ?? 'unknown'}${f?.quarantined ? ', table quarantined' : ''}) — ${counts}` +
        `\n  ${f?.summary ?? '(no summary recorded)'}`,
    );
  } else {
    console.log(`[${r.tableId}] ${r.outcome} — ${counts}`);
  }
}

async function runWarm(args: ParsedArgs, deps: Deps): Promise<number> {
  if (args.budgetSeconds === null) {
    console.error('warm: --budget-seconds needs a positive number of seconds.');
    return 1;
  }
  const deadline = Date.now() + (args.budgetSeconds ?? DEFAULT_WARM_BUDGET_SECONDS) * 1000;
  const results = await warmPinnedTables(deps.db, sourceOf(deps, CBS_SOURCE_KEY, deadline), {
    deadline,
    ...(args.tableIds.length > 0 ? { tableIds: args.tableIds } : {}),
    // Eurostat's pinned datasets ride the same job once converted (#358 item 4).
    ...(deps.sourceFor ? { sources: { [EUROSTAT_SOURCE_KEY]: deps.sourceFor(EUROSTAT_SOURCE_KEY, deadline) } } : {}),
  });
  if (results.length === 0) console.log('No pinned slice-cache table to warm.');
  for (const r of results) printWarmResult(r);
  return results.some((r) => r.outcome === 'failed') ? 1 : 0;
}

/**
 * ADR 065 step 7: the supervised storage commands, one table at a time. Each is
 * a dry run (checks only, nothing written) unless --yes is given. Exit 0 for a
 * dry run and a finished change; 1 for a refusal, an unfinished conversion and
 * a failed after-check (the printed text says what to do next).
 */
async function runStorageCommand(
  command: 'convert-to-slices' | 'convert-to-full' | 'rebaseline-slices',
  args: ParsedArgs,
  deps: Deps,
): Promise<number> {
  if (args.tableIds.length !== 1) {
    console.error(`${command}: give exactly one table id: ingest ${command} <tableId> [--yes]`);
    return 1;
  }
  if (args.budgetSeconds === null) {
    console.error(`${command}: --budget-seconds needs a positive number of seconds.`);
    return 1;
  }
  const tableId = args.tableIds[0]!;
  const deadline = Date.now() + (args.budgetSeconds ?? DEFAULT_STORAGE_BUDGET_SECONDS) * 1000;
  let source: CbsSource;
  try {
    source = sourceOf(deps, sourceKeyForTableId(tableId), deadline);
  } catch (err) {
    console.error(`${command}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (command === 'convert-to-full') {
    const result = await convertTableToFull(deps.db, tableId, { apply: args.yes });
    console.log(describeConversionToFull(result));
    return result.outcome === 'refused' ? 1 : 0;
  }
  if (command === 'rebaseline-slices') {
    const result = await rebaselineSliceTable(deps.db, source, tableId, { deadline, apply: args.yes });
    console.log(describeRebaseline(result));
    // A pinned table whose warm run did not finish still needs `ingest warm`.
    const unfinished = result.warm != null && result.warm.outcome !== 'complete';
    return result.outcome === 'refused' || unfinished ? 1 : 0;
  }
  const result = await convertTableToSlices(deps.db, source, tableId, { deadline, apply: args.yes });
  console.log(describeConversion(result));
  return result.outcome === 'converted' || result.outcome === 'dry_run' ? 0 : 1;
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
  const { db } = deps;
  const args = parseArgs(argv);

  if (args.command === null) {
    console.error('Usage: ingest <register|sync> [tableIds...] [--all] [--accept-new-codes] [--rebaseline]');
    console.error('       ingest warm [tableIds...] [--budget-seconds N]');
    console.error('       ingest convert-to-slices <tableId> [--budget-seconds N] [--yes]');
    console.error('       ingest convert-to-full <tableId> [--yes]');
    console.error('       ingest rebaseline-slices <tableId> [--budget-seconds N] [--yes]');
    return 1;
  }

  // ADR 065 step 2: fills pinned slice-cache tables' declared scopes. Never
  // registers or converts a table.
  if (args.command === 'warm') return runWarm(args, deps);
  if (
    args.command === 'convert-to-slices' ||
    args.command === 'convert-to-full' ||
    args.command === 'rebaseline-slices'
  ) {
    return runStorageCommand(args.command, args, deps);
  }

  if (args.command === 'register') {
    const start = Date.now();
    try {
      // #110(c): seed tables register PINNED — the permanent, eviction-exempt set.
      const registered = await registerTables(db, sourceOf(deps, CBS_SOURCE_KEY), SEED_TABLES, { pinned: true });
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      if (registered.length === 0) {
        console.log(`All ${SEED_TABLES.length} seed table(s) were already registered. Nothing to do.`);
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
  const seedTables = args.all ? SEED_TABLES : SEED_TABLES.filter((t) => args.tableIds.includes(t.id));

  try {
    const registered = await registerTables(db, sourceOf(deps, CBS_SOURCE_KEY), seedTables, { pinned: true });
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
  // Breadth step 2: `--all` skips slice-cache tables (migration 037's
  // ingest_mode) — fetchSlice fills them per question; syncTable would refuse
  // each one and turn every cron run red. Probed, because a database without
  // 037 has no such column (and then no slice-cache tables either). An
  // explicit id still reaches syncTable, which refuses it loudly.
  let targetIds = args.tableIds;
  if (args.all) {
    const hasIngestMode =
      (
        await db.query(
          `select 1 from information_schema.columns where table_name = 'cbs_tables' and column_name = 'ingest_mode'`,
        )
      ).rows.length > 0;
    const rows = (
      await db.query(hasIngestMode ? 'select id, ingest_mode from cbs_tables' : 'select id from cbs_tables')
    ).rows;
    const sliceCache = rows.filter((r) => r.ingest_mode === 'slice_cache').map((r) => String(r.id));
    if (sliceCache.length > 0) {
      console.log(
        `Skipped ${sliceCache.length} slice-cache table(s) (filled per question, never whole-table synced): ` +
          `${sliceCache.join(', ')}.`,
      );
    }
    targetIds = rows.filter((r) => r.ingest_mode !== 'slice_cache').map((r) => String(r.id));
  }

  // #23: at most one owner-alert email for this whole run, listing every
  // affected table — never one email per table (see alerts.ts's
  // maybeAlertIngestionRunProblems for the batching contract).
  const problems: IngestionRunProblem[] = [];

  let allSucceeded = true;
  for (const tableId of targetIds) {
    const start = Date.now();
    try {
      // Each table through its own source's adapter (a Eurostat dataset's whole-table sync included).
      const result = await syncTable(db, sourceOf(deps, sourceKeyForTableId(tableId)), tableId, {
        acceptNewCodes: args.acceptNewCodes,
        rebaseline: args.rebaseline,
      });
      printResult('Synced', tableId, result, Date.now() - start);
      if (result.outcome === 'failed') {
        allSucceeded = false;
        problems.push({
          tableId,
          source: sourceKeyForTableId(tableId),
          check: result.failureStage ?? 'unknown',
          message: result.failureSummary ?? '(no summary recorded)',
          batchId: result.batchId,
        });
      }
    } catch (err) {
      allSucceeded = false;
      console.error(`\n[${tableId}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      problems.push({
        tableId,
        source: sourceKeyForTableId(tableId),
        check: 'threw',
        message: err instanceof Error ? err.message : String(err),
        batchId: null,
      });
    }
  }

  // Fail-open by contract (maybeAlertIngestionRunProblems never throws); the
  // extra try/catch is defense-in-depth only — an alerting bug must never
  // flip this CLI's own exit code.
  try {
    await maybeAlertIngestionRunProblems({ problems }, deps.fetchImpl ?? fetch);
  } catch (err) {
    console.warn('ingestion run: owner alert failed (sync result unaffected):', err);
  }

  return allSucceeded ? 0 : 1;
}

// CLI entry: node --env-file=.env src/ingestion/cli.ts <register|sync|warm|convert-to-slices|convert-to-full|rebaseline-slices> ...
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { connectFromEnv } = await import('../db/client.ts');
  const { applyMigrations } = await import('../db/migrate.ts');
  const { adapterFor } = await import('../sources/adapters.ts');
  const { ODataV4Source } = await import('../cbs-adapter/odata-v4.ts');
  const { StatisticsApiSource } = await import('../eurostat-adapter/statistics-api.ts');
  const { db, pool } = connectFromEnv();
  try {
    await applyMigrations(db);
    const code = await runCli(process.argv.slice(2), {
      db,
      source: adapterFor(CBS_SOURCE_KEY),
      // Per table by its source; warm / convert / rebaseline: every request is limited to what is left of
      // --budget-seconds.
      sourceFor: (key, stopAt) =>
        key === CBS_SOURCE_KEY
          ? new ODataV4Source({ stopAt })
          : key === EUROSTAT_SOURCE_KEY
            ? new StatisticsApiSource(fetch, { stopAt })
            : adapterFor(key),
    });
    process.exit(code);
  } finally {
    await pool.end();
  }
}
