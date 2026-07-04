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
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadAuditRecord, reconstructionReport } from '../src/answer/audit/index.ts';
import { connectFromEnv } from '../src/db/client.ts';

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
  const problems: string[] = [];
  try {
    for (let id = from; id <= to; id++) {
      const record = await loadAuditRecord(db, id);
      if (record === null) {
        problems.push(`row ${id}: not found`);
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
  console.log(`audit rows ${from}-${to}: ${ok}/${total} reconstruct clean`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  PROBLEM: ${p}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
