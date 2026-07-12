// GDPR retention purge (#14, docs/08-build-plan.md WP14): redacts every
// personal-data audit_answers row older than the 2-year retention window
// (docs/05-data-rules.md audit-trail section). Deterministic code only — no
// LLM calls, no live pipeline invocation.
//
//   npm run gdpr:purge                dry run (default): reports how many
//                                      rows WOULD be redacted, changes nothing.
//   npm run gdpr:purge -- --apply     actually redacts the matching rows.
//
// Idempotent: redacting an already-redacted row writes the identical sentinel
// values again (src/answer/audit/retention.ts) — a second run against the same
// cutoff always finds zero NEWLY-affected rows once the first run committed,
// and re-running it is always safe (never double-charges, never touches the
// ledger, never widens scope).
//
// Scope, enforced in retention.ts (never trusted to this script), #120:
// audit_answers rows with source_tag in ('user', 'onboarding_delivery') — the
// user's own questions AND the on-demand-onboarding delivery answers (both
// personal data). benchmark/validation rows are this project's own regression
// fixtures and are never touched, regardless of age. The purge ALSO redacts the
// free text of expired pending_table_requests rows (question_text/topic_term/
// failure_summary) in the SAME transaction — the second place a question's text
// is stored (migration 012). The dry run's counts come from
// countPurgeableQuestionHistory, which reuses the purge's OWN scope fragments
// (⟨F2⟩) so preview and apply can never disagree.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  countPurgeableQuestionHistory,
  purgeExpiredQuestionHistory,
  twoYearsBefore,
} from '../src/answer/audit/index.ts';
import { connectFromEnv } from '../src/db/client.ts';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const cutoff = twoYearsBefore(new Date());

  const { db, pool } = connectFromEnv();
  try {
    if (!apply) {
      // Dry run: ⟨F2⟩ counts come from countPurgeableQuestionHistory, which is
      // built on the purge's OWN scope fragments — no second hand-written WHERE
      // clause that could silently drift from what --apply redacts. Read-only:
      // two COUNT queries, never a write.
      const { auditRows, pendingRows } = await countPurgeableQuestionHistory(db, cutoff);
      console.log(
        `DRY RUN — cutoff ${cutoff.toISOString()}: ${auditRows} audit_answers row(s) ` +
          `(source_tag user + onboarding_delivery) and ${pendingRows} pending_table_requests ` +
          `row(s) older than 2 years would be redacted.`,
      );
      console.log('Re-run with --apply to actually redact them.');
      return;
    }

    const redacted = await purgeExpiredQuestionHistory(db, cutoff);
    console.log(
      `Applied — cutoff ${cutoff.toISOString()}: redacted ${redacted.length} audit_answers row(s) ` +
        `(source_tag user + onboarding_delivery).`,
    );
    if (redacted.length > 0) {
      const byKind = redacted.reduce<Record<string, number>>((acc, r) => {
        acc[r.kind] = (acc[r.kind] ?? 0) + 1;
        return acc;
      }, {});
      console.log(`  by kind: ${JSON.stringify(byKind)}`);
    }
    // #120: the expired pending_table_requests rows were redacted in the SAME
    // transaction as the audit rows above (purgeExpiredQuestionHistory's pending
    // leg). Its count isn't in the RedactedRow[] return, so we note it here so
    // an operator reading the log knows the pending store was covered too.
    console.log(
      '  note: expired pending_table_requests free text (question_text/topic_term/' +
        'failure_summary) was redacted in the same transaction.',
    );
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
