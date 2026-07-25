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
// audit_answers rows with source_tag in ('user', 'onboarding_delivery',
// 'anonymous_trial') — the user's own questions, the on-demand-onboarding
// delivery answers AND the #53 anonymous-trial answers (all personal data;
// ADR 036 D4). benchmark/validation rows are this project's own regression
// fixtures and are never touched, regardless of age. The #53 trial's
// limit-bookkeeping rows (trial_questions: visitor UUID + HMAC'd ip) get
// their own SHORTER sweep here — DELETED after 90 days (ADR 036 D4), since
// their only purpose is abuse-limit enforcement. The purge ALSO redacts the
// free text of expired pending_table_requests rows (question_text/topic_term/
// failure_summary) in the SAME transaction — the second place a question's text
// is stored (migration 012). The dry run's counts come from
// countPurgeableQuestionHistory, which reuses the purge's OWN scope fragments
// (⟨F2⟩) so preview and apply can never disagree.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  describeRetentionPurge,
  RetentionPurgePartialError,
  runRetentionPurge,
} from '../src/answer/audit/index.ts';
import {
  countPurgeableTrialBookkeeping,
  purgeExpiredTrialBookkeeping,
  trialRetentionCutoff,
} from '../src/billing/index.ts';
import { connectFromEnv } from '../src/db/client.ts';

// The trial leg is INJECTED, not imported by the job — ADR 001's arrow points
// billing → answer, never back. This script is one of the two composition roots
// (the other is web/app/api/gdpr-purge-cron/route.ts) and they inject the SAME
// three functions, so the CLI and the cron cannot describe different work.
const TRIAL_LEG = {
  cutoff: trialRetentionCutoff,
  count: countPurgeableTrialBookkeeping,
  purge: purgeExpiredTrialBookkeeping,
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  // ONE clock for both windows: two `new Date()` calls could straddle midnight
  // and cut the two cutoffs from different days.
  const now = new Date();

  const { db, pool } = connectFromEnv();
  try {
    try {
      const summary = await runRetentionPurge({ db, now, apply, trial: TRIAL_LEG });
      console.log(describeRetentionPurge(summary));
      if (!apply) console.log('Re-run with --apply to actually redact/delete them.');
    } catch (error) {
      // A partial failure still redacted rows. Saying only "it failed" would
      // lose the record of GDPR work that actually committed.
      if (error instanceof RetentionPurgePartialError) {
        console.error(
          `PARTIAL — ${error.auditRowsRedacted} audit redaction(s) COMMITTED; the 90-day trial leg then failed.`,
        );
      }
      throw error;
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
