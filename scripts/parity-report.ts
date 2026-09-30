// ADR 065 step 2 (decision D7): does what CBS returns for a table's planned slice requests equal
// the cells stored today? READ-ONLY: SELECT statements and CBS GETs only — nothing is written.
//
//   npm run ingest:parity -- 85770NED                     one table
//   npm run ingest:parity -- 85770NED 83625NED --json     several tables, as JSON
//   npm run ingest:parity -- 85770NED --budget-seconds 300 --max-cells 2000
//
// Every request is a LIVE CBS call, so at least one table id is required (no "all tables"
// default). Exit code 0 when every table is IDENTICAL and complete, 1 otherwise.
import { connectFromEnv } from '../src/db/client.ts';
import { compareTableWithSource, type ParityCellDiff, type ParityReport } from '../src/ingestion/parity.ts';
import { adapterFor } from '../src/sources/adapters.ts';
import { sourceKeyForTableId } from '../src/sources/registry.ts';

const DEFAULT_BUDGET_SECONDS = 600;
const args = process.argv.slice(2);
const asJson = args.includes('--json');

function numberFlag(name: string): number | undefined {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = Number(args[at + 1]);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`${name} needs a whole number of at least 1`);
    process.exit(1);
  }
  return value;
}

const budgetSeconds = numberFlag('--budget-seconds') ?? DEFAULT_BUDGET_SECONDS;
const maxCells = numberFlag('--max-cells');

// Table ids are the arguments that are neither a flag nor a flag's value.
const flagsWithValue = new Set(['--budget-seconds', '--max-cells']);
const tableIds = args.filter((a, i) => !a.startsWith('--') && !flagsWithValue.has(args[i - 1] ?? ''));
if (tableIds.length === 0) {
  console.error('Give at least one table id: npm run ingest:parity -- <tableId> [tableId ...] [--budget-seconds N] [--max-cells N] [--json]');
  process.exit(1);
}

function verdict(r: ParityReport): string {
  if (!r.complete) return `INCOMPLETE (${r.error ?? 'reason not recorded'})`;
  const different = Object.values(r.diffCounts).reduce((n, c) => n + c, 0);
  return different === 0 ? 'IDENTICAL' : `DIFFERENT (${different} cells)`;
}

function side(s: ParityCellDiff['stored']): string {
  return s ? `value ${s.value === null ? 'null' : s.value} / ${s.status ?? '-'} / ${s.valueAttribute ?? '-'}` : '-';
}

function describe(d: ParityCellDiff): string {
  const cell = [d.measure, d.regionCode ?? '(no region)', d.periodCode, JSON.stringify(d.dims)].join(' | ');
  const note = d.note ? `  [${d.note}]` : '';
  return `    ${d.kind.padEnd(17)} ${cell}\n      stored:  ${side(d.stored)}\n      fetched: ${side(d.fetched)}${note}`;
}

const { db, pool } = connectFromEnv();
let allIdentical = true;

try {
  // One budget for the whole run: a table that starts late gets what is left.
  const deadline = Date.now() + budgetSeconds * 1000;
  const reports: ParityReport[] = [];
  for (const tableId of tableIds) {
    // Each table through its own source's adapter (a Eurostat dataset too, #358 item 4).
    const report = await compareTableWithSource(db, adapterFor(sourceKeyForTableId(tableId)), tableId, { deadline, maxCells });
    reports.push(report);
    if (verdict(report) !== 'IDENTICAL') allIdentical = false;
    if (asJson) continue;
    console.log(`${tableId}`);
    console.log(`  requests: ${report.requestsFetched} of ${report.requests} fetched`);
    console.log(
      `  cells: ${report.storedCells} stored, ${report.fetchedCells} fetched, ${report.identical} identical`,
    );
    for (const [kind, n] of Object.entries(report.diffCounts)) {
      console.log(`  ${kind.padEnd(17)} ${n}${kind === 'missing_at_source' && report.retained > 0 ? ` (of which ${report.retained} retained)` : ''}`);
    }
    const shown = report.diffs.length;
    const total = Object.values(report.diffCounts).reduce((n, c) => n + c, 0);
    if (shown > 0) {
      console.log(`  first ${Math.min(shown, 10)} of ${total} difference(s):`);
      for (const d of report.diffs.slice(0, 10)) console.log(describe(d));
    }
    console.log(`  verdict: ${verdict(report)}\n`);
  }
  if (asJson) console.log(JSON.stringify(reports.map((r) => ({ ...r, verdict: verdict(r) })), null, 2));
} finally {
  await pool.end();
}

process.exit(allIdentical ? 0 : 1);
