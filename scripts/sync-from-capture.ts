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
// Usage: node --env-file=.env scripts/sync-from-capture.ts <tableId> <captureDir>
import { readFileSync } from 'node:fs';
import { FixtureSource, loadFixtureDocs } from '../src/cbs-adapter/fixture-source.ts';
import { connectFromEnv } from '../src/db/client.ts';
import { syncTable } from '../src/ingestion/pipeline.ts';

const [tableId, dir] = process.argv.slice(2);
if (!tableId || !dir) {
  console.error('usage: sync-from-capture.ts <tableId> <captureDir>');
  process.exit(1);
}

const docs = loadFixtureDocs(dir);
const capturedAt = (JSON.parse(readFileSync(`${dir}/index.json`, 'utf8')) as { capturedAt?: string })
  .capturedAt;
const today = new Date().toISOString().slice(0, 10);
if (!capturedAt?.startsWith(today)) {
  console.error(
    `refusing: capture at '${dir}' is from ${capturedAt ?? 'unknown'}, not today (${today}) — ` +
      `a live sync must carry today's CBS truth; re-capture first.`,
  );
  process.exit(1);
}

const { db, pool } = connectFromEnv();
try {
  const result = await syncTable(db, new FixtureSource(docs), tableId);
  if (result.outcome === 'succeeded') {
    console.log(
      `[${tableId}] Synced from capture (${capturedAt})\n` +
        `  Rows — fetched: ${result.rowCount}, inserted: ${result.rowsInserted}, updated: ${result.rowsUpdated}, ` +
        `unchanged: ${result.rowsUnchanged}, missing: ${result.rowsMissing}\n` +
        `  Corrections: ${result.corrections.length}. Batch id: ${result.batchId}.`,
    );
  } else {
    console.error(`[${tableId}] FAILED (${result.failureStage}): ${result.failureSummary}`);
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
