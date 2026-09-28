// Breadth step 3, Task 3 — reach check: re-measures, with the PRODUCTION
// TypeScript functions `classifyDimension` and `findGrandTotal` from
// src/query/breakdowns.ts, how many CBS breakdown dimensions the total rule
// resolves over the session-138 catalog crawl. Purpose: prove the TS
// implementation reproduces the Python measurement
// (docs/superpowers/plans/2026-09-28-breadth-step-3-breakdown-resolver.md
// Global Constraints) exactly — this script does NOT re-derive the rule, it
// only exercises the shipped one against real CBS data shape.
//
// A committed research tool, not part of the app. The crawl JSONL is
// committed on `main` as
// scripts/research/data/cbs-catalog-crawl-2026-09-28.jsonl.gz (it arrives on
// this branch once `main` is merged in).
//
// Session 139 final-review fix wave (F8): the numbers below now also mirror
// resolveBreakdowns' own table-level ok/ask outcome (not just the
// breakdown-level findGrandTotal count), so this script's `resolved` count
// stays a pure re-measurement while `noAskTables`/`askTables` match what the
// resolver itself would decide per table. This is why the numbers differ
// from the session-138 Python measurement (923/1,785/1,363/576/347): F1's
// stricter total rule drops 85004NED's resolved count by 1, and a
// margins-without-'Waarde' table (82557NED) that the Python pass counted as
// no-ask now correctly asks — see the EXPECTED comment below for the
// re-measured numbers.
//
// Usage:
//   node scripts/research/breakdown-reach.ts <path-to-crawl.jsonl[.gz]> [--expect]
//
// <path> may be a plain .jsonl file or a gzip .jsonl.gz file. With --expect,
// the five measured numbers are checked against the session-139 re-measured
// EXPECTED values above and the process exits 1 (printing the mismatch) if
// they differ.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  classifyDimension,
  findGrandTotal,
  resolveBreakdowns,
  type BreakdownDimension,
  type BreakdownMember,
} from '../../src/query/breakdowns.ts';

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

// Session 139 (F8): resolved is re-measured against the shipped, stricter F1
// total rule — 1,362 (was 1,363; -1 = 85004NED/BronEnTechniek, the trap that
// motivated F1) — measured 2026-09-28 against the session-138 crawl and
// matches the review's prediction exactly. noAskTables/askTables are now
// measured by calling the PRODUCTION `resolveBreakdowns(dims, {})` per
// eligible table (ok -> no-ask) instead of re-deriving the same logic here,
// so they also pick up F2's named-code checking and margins handling; the
// review's own estimate for these two was "≈574/≈349" (it flagged only one
// concrete driver, 82557NED, alongside 85004NED) — the actual
// re-measurement is 575/348 (one table off the estimate in each direction,
// recorded here rather than adjusted, per the brief's "record whatever it
// actually measures" instruction).
const EXPECTED = {
  eligibleTables: 923,
  eligibleBreakdowns: 1785,
  resolved: 1362,
  noAskTables: 575,
  askTables: 348,
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

    const allDims = row.dims.map(toBreakdownDimension);
    const breakdownDims = allDims.filter((d) => classifyDimension(d) === 'breakdown');
    eligibleBreakdowns += breakdownDims.length;

    for (const d of breakdownDims) {
      if (findGrandTotal(d.members) !== null) resolved++;
    }

    // F8: table-level no-ask/ask mirrors the PRODUCTION resolver itself
    // (margins + breakdown dimensions both count), not a re-derivation of
    // its logic here.
    const resolution = resolveBreakdowns(allDims, {});
    if (resolution.ok) noAskTables++;
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
    console.log('\n--expect: all five numbers match the session-139 re-measured expected values.');
    return;
  }

  console.error('\n--expect: MISMATCH against the session-139 re-measured expected values:');
  for (const k of mismatches) {
    console.error(`  ${k}: expected ${EXPECTED[k]}, got ${actual[k]}`);
  }
  process.exit(1);
}

main();
