// Re-verify a range of live audit_answers rows from the stored rows alone
// (R8): loads each row and runs reconstructionReport — the same deterministic
// checks the benchmark scorer trusts (stored body re-passes the R3/R9/R10/R11
// validator against the stored result, attribution/text/chart re-derive
// byte-identically). Zero LLM calls, read-only database access.
//
//   npm run audit:verify -- <fromId> <toId>
//   e.g. npm run audit:verify -- 36 73     (the 2026-07-04 validation pass)
//
// Exit is non-zero when any row is missing or fails reconstruction — loud,
// owner-followable (docs/05: a quarantine only the database knows about is
// silent, not loud). This is the committed, re-runnable backing for any
// "rows X–Y reconstruct clean" claim in the docs (review finding 2026-07-05:
// a measured claim needs an artifact or a command someone else can run).
//
// RECONSTRUCTION POLICY (#133, resolved 2026-07-12, session 39 — supersedes
// the 2026-07-12 "GDPR-redacted rows are skipped" note this header used to
// carry; see open-questions #133 and ADR 016's as-built addendum for the full
// policy record):
//
//  - Historical-behavior divergence: reconstructionReport verifies under
//    TODAY's deterministic builder rules, never a row's own historical rule.
//    A row whose builder rule legitimately changed since it was written (a
//    safety fix like #64's non-contiguous-series chart gate or #115-lever-a's
//    circular-title suppression) is not a bug — it is a documented, PINNED
//    exception in src/answer/audit/known-divergences.ts, never a blanket
//    "old rows don't have to reconstruct" skip. A row NOT in that register
//    still fails today exactly as before; a row IN the register whose
//    problems don't match its pinned substrings ALSO still fails.
//  - GDPR-redacted rows: no longer skipped. redactionIntegrityReport (the
//    module that owns the sentinel shape, src/answer/audit/retention.ts)
//    verifies a redacted row matches EXACTLY the shape redactMatchingRows
//    writes — no more, no less. A leftover `answer`/`result`/`chart` key, a
//    non-sentinel question/finalText, or an unpaired reply_text/
//    pending_clarification is a real, reported PROBLEM (exit 1), not a skip.
//
// reconstructionReport itself (and the benchmark gate that trusts it) is
// UNTOUCHED by any of this — the policy above governs only this diagnostic
// script's interpretation of reconstructionReport's output.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  KNOWN_DIVERGENCES,
  classifyKnownDivergence,
  loadAuditRecord,
  reconstructionReport,
  redactionIntegrityReport,
} from '../src/answer/audit/index.ts';
import { connectFromEnv } from '../src/db/client.ts';

function isRedacted(response: unknown): boolean {
  return typeof response === 'object' && response !== null && (response as { redacted?: unknown }).redacted === true;
}

function parseIdArg(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer audit-row id, got "${value}"`);
  }
  return n;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const from = parseIdArg(args[0], 'fromId');
  const to = parseIdArg(args[1], 'toId');
  if (to < from) throw new Error(`toId ${to} is smaller than fromId ${from}`);

  const { db, pool } = connectFromEnv();
  let ok = 0;
  let knownDivergent = 0;
  let redactedTotal = 0;
  let redactedOk = 0;
  const problems: string[] = [];
  const notes: string[] = [];
  try {
    for (let id = from; id <= to; id++) {
      const record = await loadAuditRecord(db, id);
      if (record === null) {
        problems.push(`row ${id}: not found`);
        continue;
      }

      if (isRedacted(record.response)) {
        redactedTotal++;
        const report = redactionIntegrityReport(record);
        if (report.ok) {
          redactedOk++;
        } else {
          for (const p of report.problems) problems.push(`row ${id} (redacted, ${record.kind}): ${p}`);
        }
        continue;
      }

      const report = reconstructionReport(record);
      const entry = KNOWN_DIVERGENCES.find((d) => d.id === id);

      if (entry === undefined) {
        if (report.ok) {
          ok++;
        } else {
          for (const p of report.problems) problems.push(`row ${id} (${record.kind}): ${p}`);
        }
        continue;
      }

      // A register-listed row runs the same reconstructionReport as any
      // other, then classifies its problems (if any) against the entry's
      // pinned substrings — the register narrows tolerance, it never widens
      // it (see known-divergences.ts's module header).
      const classification = classifyKnownDivergence(report.problems, entry);
      if (classification === 'stale') {
        // problems.length === 0: the row reconstructs clean now — a
        // housekeeping NOTE (the register entry can be pruned), not an error.
        ok++;
        notes.push(`row ${id}: known-divergences.ts entry is STALE — reconstructs clean now (cause: ${entry.cause})`);
      } else if (classification === 'matches') {
        knownDivergent++;
        notes.push(`row ${id} (${record.kind}): known, pinned divergence — ${entry.cause}`);
      } else {
        for (const p of report.problems) {
          problems.push(
            `row ${id} (${record.kind}): ${p} [register entry for row ${entry.id} did not cover this problem]`,
          );
        }
      }
    }
  } finally {
    try {
      await pool.end();
    } catch (closeError) {
      console.error('warning: closing the database connection failed:', closeError);
    }
  }

  const checked = to - from + 1 - redactedTotal;
  let summary = `audit rows ${from}-${to}: ${ok}/${checked} reconstruct clean`;
  if (knownDivergent > 0) {
    summary += `, ${knownDivergent} known divergence(s) (pinned in known-divergences.ts)`;
  }
  if (redactedTotal > 0) {
    summary += `, ${redactedOk}/${redactedTotal} redacted row(s) redaction-verified`;
  }
  console.log(summary);

  for (const n of notes) console.log(`  NOTE: ${n}`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  PROBLEM: ${p}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
