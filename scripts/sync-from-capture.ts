// Supervised escape hatch: sync a table into the LIVE database from a local
// VERBATIM capture directory instead of a live CBS fetch — for the case where
// CBS's unfiltered Observations stream is too slow/fragile from the operator's
// network to survive a single-connection fetch (measured ~6KB/s with mid-body
// terminations, session 50; the parallel chunked capture in the session notes
// finishes in minutes). Same pipeline, same five validators, same batch/
// correction bookkeeping as a normal `ingest sync` — ONLY the transport
// differs (FixtureSource over the captured wire responses).
//
// ⚠ Use ONLY with a capture fetched the SAME DAY (the capture's index.json
// records capturedAt — this script refuses older ones): syncing stale local
// data into production would defeat the freshness the sync exists to provide.
// The capture directory must be a scripts/capture-cbs-fixtures.ts-format dir
// holding the FULL table (or the registered slice) — verbatim CBS responses.
//
// #192 (2026-08-07): this script used to call syncTable with NO options bag,
// so `--accept-new-codes` / `--rebaseline` were unreachable from here. Every
// CBS release brings a new period code BY DEFINITION, a new code fails
// checkDimensionMapping, and a failed mapping quarantines the table
// (status = 'needs_review') — which then REFUSES in production. So the
// documented hatch could not complete the one job it exists for: a release-day
// sync. It could only ever succeed on a first-time registration, which is the
// case session 50 happened to use it for. The flags are threaded now, exactly
// as src/ingestion/cli.ts threads them.
//
// Structured like cli.ts (exported parseArgs + run function, thin guarded
// entry) so the release-day path is reachable from a hermetic test instead of
// only from a terminal at 8am on a release morning.
//
// Usage: node --env-file=.env scripts/sync-from-capture.ts <tableId> <captureDir>
//          [--accept-new-codes] [--rebaseline]
import { readFileSync } from 'node:fs';
import { FixtureSource, loadFixtureDocs } from '../src/cbs-adapter/fixture-source.ts';
import type { Db } from '../src/db/types.ts';
import type { CbsSource } from '../src/cbs-adapter/types.ts';
import { syncTable } from '../src/ingestion/pipeline.ts';

export interface SyncFromCaptureArgs {
  tableId: string;
  dir: string;
  /** Reviewed acceptance of new dimension codes — the flag a release-day sync
   * needs, because a new period code is new by definition. */
  acceptNewCodes: boolean;
  /** Reviewed re-baseline out of a needs_review quarantine. */
  rebaseline: boolean;
}

/** Same flag vocabulary and same scanning shape as src/ingestion/cli.ts, so an
 * operator who knows one knows the other. Returns null when the two required
 * positionals are absent. */
export function parseArgs(argv: string[]): SyncFromCaptureArgs | null {
  const positional: string[] = [];
  let acceptNewCodes = false;
  let rebaseline = false;

  for (const arg of argv) {
    if (arg === '--accept-new-codes') acceptNewCodes = true;
    else if (arg === '--rebaseline') rebaseline = true;
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  const [tableId, dir] = positional;
  if (!tableId || !dir) return null;
  return { tableId, dir, acceptNewCodes, rebaseline };
}

/** The sync itself, with the db and the source injected so a test can drive
 * the real path. Returns the process exit code (0 ok, 2 sync failed). */
export async function runSyncFromCapture(
  db: Db,
  source: CbsSource,
  args: SyncFromCaptureArgs,
  capturedAt?: string,
): Promise<number> {
  // #192: the options bag that used to be missing entirely.
  const result = await syncTable(db, source, args.tableId, {
    acceptNewCodes: args.acceptNewCodes,
    rebaseline: args.rebaseline,
  });

  if (result.outcome === 'succeeded') {
    console.log(
      `[${args.tableId}] Synced from capture (${capturedAt ?? 'unknown'})\n` +
        `  Rows — fetched: ${result.rowCount}, inserted: ${result.rowsInserted}, updated: ${result.rowsUpdated}, ` +
        `unchanged: ${result.rowsUnchanged}, missing: ${result.rowsMissing}\n` +
        `  Corrections: ${result.corrections.length}. Batch id: ${result.batchId}.`,
    );
    return 0;
  }

  console.error(`[${args.tableId}] FAILED (${result.failureStage}): ${result.failureSummary}`);
  // The release-day trap, named where the operator will actually see it.
  if (result.failureStage === 'dimension_mapping' && !args.acceptNewCodes) {
    console.error(
      `  ⚠ dimension_mapping failed WITHOUT --accept-new-codes. Every CBS release adds a period\n` +
        `    code, and an unmapped code quarantines the table (needs_review), which refuses in\n` +
        `    production. Diff the code lists read-only first, then re-run with --accept-new-codes\n` +
        `    (and --rebaseline if this run already quarantined it). See RUNBOOK "release-day sync".`,
    );
  }
  return 2;
}

// CLI entry: node --env-file=.env scripts/sync-from-capture.ts <tableId> <dir> [flags]
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(
      'usage: sync-from-capture.ts <tableId> <captureDir> [--accept-new-codes] [--rebaseline]',
    );
    process.exit(1);
  }

  const docs = loadFixtureDocs(args.dir);
  const capturedAt = (
    JSON.parse(readFileSync(`${args.dir}/index.json`, 'utf8')) as { capturedAt?: string }
  ).capturedAt;
  const today = new Date().toISOString().slice(0, 10);
  if (!capturedAt?.startsWith(today)) {
    console.error(
      `refusing: capture at '${args.dir}' is from ${capturedAt ?? 'unknown'}, not today (${today}) — ` +
        `a live sync must carry today's CBS truth; re-capture first.`,
    );
    process.exit(1);
  }

  const { connectFromEnv } = await import('../src/db/client.ts');
  const { db, pool } = connectFromEnv();
  try {
    process.exitCode = await runSyncFromCapture(db, new FixtureSource(docs), args, capturedAt);
  } finally {
    await pool.end();
  }
}
