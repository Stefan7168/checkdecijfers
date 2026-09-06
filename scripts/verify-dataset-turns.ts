// Re-verify a range of live dataset_turns rows from the stored rows alone
// (D9, the R8 analog for the "Eigen data" attachments tier) — mirrors
// scripts/verify-audit-rows.ts's shape and purpose exactly, adapted to this
// tier's own structural difference: reconstruction needs the CURRENT
// user_datasets row (cells/profile), fetched fresh per turn, alongside the
// stored dataset_turns row — see src/attachments/reconstruct.ts's header.
//
//   npm run attachments:verify -- <fromId> <toId>
//
// Exit is non-zero when any row is missing or fails reconstruction — loud,
// owner-followable, matching the CBS-side script's own discipline. No
// known-divergences register exists for this tier yet (nothing has ever run
// live — migrations 026/027 are file-only, ATTACHMENTS_ENABLED does not
// exist yet); add one the same way src/answer/audit/known-divergences.ts
// was added, if/when a real historical-behavior divergence is ever found.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getDatasetTurnById } from '../src/attachments/read.ts';
import { reconstructDatasetTurn, redactedTurnIntegrityReport } from '../src/attachments/reconstruct.ts';
import { getDataset } from '../src/attachments/store.ts';
import { connectFromEnv } from '../src/db/client.ts';

function isRedacted(envelope: unknown): boolean {
  return typeof envelope === 'object' && envelope !== null && (envelope as { redacted?: unknown }).redacted === true;
}

function parseIdArg(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer dataset_turns id, got "${value}"`);
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
  let redactedTotal = 0;
  let redactedOk = 0;
  const problems: string[] = [];
  try {
    for (let id = from; id <= to; id++) {
      const record = await getDatasetTurnById(db, id);
      if (record === null) {
        problems.push(`row ${id}: not found`);
        continue;
      }

      if (isRedacted(record.envelope)) {
        redactedTotal++;
        const report = redactedTurnIntegrityReport(record);
        if (report.ok) {
          redactedOk++;
        } else {
          for (const p of report.problems) problems.push(`row ${id} (redacted, ${record.kind}): ${p}`);
        }
        continue;
      }

      // Ownership-bound read, but always succeeds here: record.userId IS the
      // dataset's real owner (it came from the trusted dataset_turns row
      // itself), so this is not a cross-user access — it's the same
      // ownership-checked path a Server Action would use, given the right id.
      const dataset = await getDataset(db, record.userId, record.datasetId);
      if (dataset === null) {
        problems.push(`row ${id}: referenced dataset ${record.datasetId} not found for user ${record.userId}`);
        continue;
      }

      const report = reconstructDatasetTurn(record, dataset);
      if (report.ok) {
        ok++;
      } else {
        for (const p of report.problems) problems.push(`row ${id} (${record.kind}): ${p}`);
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
  let summary = `dataset_turns rows ${from}-${to}: ${ok}/${checked} reconstruct clean`;
  if (redactedTotal > 0) {
    summary += `, ${redactedOk}/${redactedTotal} redacted row(s) redaction-verified`;
  }
  console.log(summary);

  if (problems.length > 0) {
    for (const p of problems) console.error(`  PROBLEM: ${p}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
