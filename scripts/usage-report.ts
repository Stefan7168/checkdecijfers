// WP-A (docs/superpowers/plans/2026-09-12-journey-programme.md, phase 0 R1):
// prints usage aggregates (last 12 ISO weeks + all-time) built by
// src/usage/report.ts. READ-ONLY — no writes, no LLM calls, no schema
// change; this file only formats and prints what buildUsageReport returns.
//
//   npm run usage:report            human-readable tables
//   npm run usage:report -- --json  the same report as JSON
//   npm run usage:report -- --help  this text
//
// AGGREGATES ONLY (docs/05-data-rules.md's GDPR posture, #14, and this WP's
// own hard rule): the report contains counts and group labels only — never
// question text, an e-mail, or a user id. See src/usage/report.ts's own
// header for how that is enforced in the SQL.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildUsageReport, type UsageReport, type WeeklyReport } from '../src/usage/report.ts';
import { connectFromEnv } from '../src/db/client.ts';

const HELP = `Usage report (WP-A) — read-only usage aggregates, never personal data.

  npm run usage:report            print the last 12 ISO weeks + all-time, as tables
  npm run usage:report -- --json  print the same report as JSON
  npm run usage:report -- --help  show this text
`;

function printWeeklyTable(label: string, report: WeeklyReport): void {
  console.log(`\n${label} (all-time: ${report.allTime})`);
  if (report.weekly.length === 0) {
    console.log('  (no rows in the last 12 ISO weeks)');
    return;
  }
  for (const w of report.weekly) {
    console.log(`  ${w.week}  ${w.count}`);
  }
}

function printReport(report: UsageReport): void {
  console.log(`Usage report — generated ${report.generatedAt} (last ${report.weeks} ISO weeks + all-time)`);

  printWeeklyTable('Signups', report.signups);
  printWeeklyTable('Users with >=1 question', report.usersWithQuestions);

  console.log('\nFirst-question outcome mix (all-time):');
  for (const o of report.firstVsLaterOutcomes.first) {
    console.log(`  ${o.kind}${o.refusalReason ? ` (${o.refusalReason})` : ''}  ${o.count}`);
  }
  console.log('Later-question outcome mix (all-time):');
  for (const o of report.firstVsLaterOutcomes.later) {
    console.log(`  ${o.kind}${o.refusalReason ? ` (${o.refusalReason})` : ''}  ${o.count}`);
  }

  console.log('\nTop refusal reasons (all-time):');
  if (report.topRefusalReasons.length === 0) {
    console.log('  (none)');
  }
  for (const r of report.topRefusalReasons) {
    console.log(`  ${r.refusalReason}  ${r.count}`);
  }

  console.log('\nOn-demand CBS table fetches (all-time):');
  console.log(`  started: ${report.onDemandFetches.started}`);
  console.log(`  delivered: ${report.onDemandFetches.delivered}`);
  console.log(`  failed: ${report.onDemandFetches.failed}`);
  console.log(`  pending/running: ${report.onDemandFetches.pendingOrRunning}`);
  console.log(`  credits spent: ${report.onDemandFetches.creditsSpent}`);

  printWeeklyTable('Trial questions', report.trial.questions);
  console.log(`  trial visitors who later signed up: ${report.trial.visitorsWhoSignedUp}`);
  console.log(`    (${report.trial.notMeasurableReason})`);

  printWeeklyTable('Feedback: thumbs up', report.feedback.up);
  printWeeklyTable('Feedback: thumbs down', report.feedback.down);

  console.log(`\nUsers active on >=2 distinct days (all-time): ${report.usersActiveMultipleDays}`);
  console.log(`Users at zero balance who never purchased (all-time): ${report.usersZeroBalanceNeverPurchased}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  const asJson = args.includes('--json');

  const { db, pool } = connectFromEnv();
  try {
    const report = await buildUsageReport(db, new Date());
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  } finally {
    try {
      await pool.end();
    } catch (closeError) {
      console.error('warning: closing the database connection failed:', closeError);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
