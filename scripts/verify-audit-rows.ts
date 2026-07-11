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
// GDPR-REDACTED ROWS ARE SKIPPED, LOUDLY, NOT SILENTLY (found 2026-07-12,
// re-running the owed A1 check post-WP30b/WP128): retention.ts's
// redactMatchingRows deliberately overwrites `response` with a stripped
// sentinel shape (REDACTED_QUESTION_TEXT + `redacted: true`, no `.answer`/
// `.result` at all) — reconstructionReport was never taught this shape and
// crashes on it (`response.answer` is undefined). Whether "reconstructs"
// should mean anything different for a row whose content was deliberately
// erased is a real design question (recorded: open-questions — reconstruction
// semantics for redacted rows), not one to settle under a live migration
// window. Skipping here is scoped to THIS script only; reconstructionReport
// itself (and the benchmark gate that trusts it) is untouched.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadAuditRecord, reconstructionReport } from '../src/answer/audit/index.ts';
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
  let skippedRedacted = 0;
  const problems: string[] = [];
  try {
    for (let id = from; id <= to; id++) {
      const record = await loadAuditRecord(db, id);
      if (record === null) {
        problems.push(`row ${id}: not found`);
        continue;
      }
      if (isRedacted(record.response)) {
        skippedRedacted++;
        continue;
      }
      const report = reconstructionReport(record);
      if (report.ok) {
        ok++;
      } else {
        for (const p of report.problems) problems.push(`row ${id} (${record.response.kind}): ${p}`);
      }
    }
  } finally {
    try {
      await pool.end();
    } catch (closeError) {
      console.error('warning: closing the database connection failed:', closeError);
    }
  }

  const total = to - from + 1;
  console.log(`audit rows ${from}-${to}: ${ok}/${total - skippedRedacted} reconstruct clean` +
    (skippedRedacted > 0 ? ` (${skippedRedacted} GDPR-redacted row(s) skipped, not checked — see the module header)` : ''));
  if (problems.length > 0) {
    for (const p of problems) console.error(`  PROBLEM: ${p}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
