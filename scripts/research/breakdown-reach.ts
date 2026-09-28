// Breadth step 3, Task 3 — reach check: re-measures, with the PRODUCTION
// TypeScript functions `classifyDimension` and `findGrandTotal` from
// src/query/breakdowns.ts, how many CBS breakdown dimensions the total rule
// resolves over the session-138 catalog crawl. Purpose: prove the TS
// implementation reproduces the Python measurement (constraints.md) exactly
// — this script does NOT re-derive the rule, it only exercises the shipped
// one against real CBS data shape.
//
// A committed research tool, not part of the app; the crawl JSONL itself is
// not committed on this branch (see task-3-brief.md for how to fetch it from
// main).
//
// Usage:
//   node scripts/research/breakdown-reach.ts <path-to-crawl.jsonl[.gz]> [--expect]
//
// <path> may be a plain .jsonl file or a gzip .jsonl.gz file. With --expect,
// the five measured numbers are checked against the session-138 Python
// measurement and the process exits 1 (printing the mismatch) if they differ.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { classifyDimension, findGrandTotal, type BreakdownDimension, type BreakdownMember } from '../../src/query/breakdowns.ts';

interface CrawlDim {
  id: string;
  kind: string;
  n?: number;
  // Absent on TimeDimension entries (they carry status_null/n instead).
  members?: [string, string][];
  status_null?: number;
  grains?: unknown;
}

interface CrawlRow {
  id: string;
  obs?: number;
  title?: string;
  dims: CrawlDim[];
  measures?: unknown;
  units?: string[];
  err?: unknown;
}

const EXPECTED = {
  eligibleTables: 923,
  eligibleBreakdowns: 1785,
  resolved: 1363,
  noAskTables: 576,
  askTables: 347,
};

function readLines(path: string): string[] {
  const raw = path.endsWith('.gz') ? gunzipSync(readFileSync(path)) : readFileSync(path);
  return raw.toString('utf8').split('\n').filter((l) => l.trim().length > 0);
}

function toBreakdownDimension(d: CrawlDim): BreakdownDimension {
  return {
    name: d.id,
    title: d.id, // crawl carries no dimension title (brief: pass title: d.id)
    kind: d.kind,
    members: (d.members ?? []).map(([code, title]): BreakdownMember => ({ code, title })),
  };
}

/** Has at least one TimeDimension, and NOT every TimeDimension has
 * status_null === n (a table entirely without live status is not eligible). */
function isEligibleTable(row: CrawlRow): boolean {
  const timeDims = row.dims.filter((d) => d.kind === 'TimeDimension');
  if (timeDims.length === 0) return false;
  return !timeDims.every((d) => d.status_null === d.n);
}

function main() {
  const args = process.argv.slice(2);
  const expectFlag = args.includes('--expect');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('usage: node scripts/research/breakdown-reach.ts <path-to-crawl.jsonl[.gz]> [--expect]');
    process.exit(1);
  }

  const lines = readLines(path);
  let tablesMeasured = 0;
  let eligibleTables = 0;
  let eligibleBreakdowns = 0;
  let resolved = 0;
  let noAskTables = 0;
  let askTables = 0;

  for (const line of lines) {
    const row = JSON.parse(line) as CrawlRow;
    if ('err' in row) continue; // lines with an "err" key are skipped
    tablesMeasured++;

    if (!isEligibleTable(row)) continue;
    eligibleTables++;

    const breakdownDims = row.dims.map(toBreakdownDimension).filter((d) => classifyDimension(d) === 'breakdown');
    eligibleBreakdowns += breakdownDims.length;

    let tableIsNoAsk = true;
    for (const d of breakdownDims) {
      if (findGrandTotal(d.members) !== null) {
        resolved++;
      } else {
        tableIsNoAsk = false;
      }
    }
    if (tableIsNoAsk) noAskTables++;
    else askTables++;
  }

  console.log(`tables measured: ${tablesMeasured}`);
  console.log(`eligible tables: ${eligibleTables}`);
  console.log(`eligible breakdowns: ${eligibleBreakdowns}`);
  console.log(`resolved: ${resolved}`);
  console.log(`no-ask tables: ${noAskTables}`);
  console.log(`ask tables: ${askTables}`);

  if (!expectFlag) return;

  const actual = { eligibleTables, eligibleBreakdowns, resolved, noAskTables, askTables };
  const mismatches = (Object.keys(EXPECTED) as (keyof typeof EXPECTED)[]).filter((k) => actual[k] !== EXPECTED[k]);

  if (mismatches.length === 0) {
    console.log('\n--expect: all five numbers match the session-138 Python measurement.');
    return;
  }

  console.error('\n--expect: MISMATCH against the session-138 Python measurement:');
  for (const k of mismatches) {
    console.error(`  ${k}: expected ${EXPECTED[k]}, got ${actual[k]}`);
  }
  process.exit(1);
}

main();
