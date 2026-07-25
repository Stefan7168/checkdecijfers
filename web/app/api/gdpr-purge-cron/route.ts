// GDPR retention-purge cron route (#189, 2026-07-25).
//
// Why this exists. The purge is the ONLY thing that enforces either retention
// window — audit rows redact at 2 years, `trial_questions` bookkeeping DELETES
// at 90 days (ADR 036 D4) — and until now NOTHING invoked it. No cron, no CI
// schedule, no runbook duty: `web/vercel.json` carried one cron and it was the
// onboarding job. The first trial rows become purgeable ~2026-10-15, and on the
// old wiring nothing would have happened on that date. An adversarial pass found
// this; a maintenance-agenda line is a promise of exactly the kind that failed.
//
// A Route Handler, not a Server Action, for the same reason as the onboarding
// cron: Vercel Cron invokes a plain scheduled GET carrying the Bearer secret.
//
// SHIPS DORMANT, deliberately. Without `GDPR_PURGE_APPLY=1` this route only ever
// REPORTS what it would delete. A cron that redacts and deletes on its first
// unattended run, on a project that handles money, is not a change to make blind
// — so the flip is one env var and one watched run, and everything up to it is
// autonomous. Turning the flag off again is a complete rollback: nothing else
// about this route writes.
export const runtime = 'nodejs';
// The purge is a handful of scoped UPDATEs and one DELETE, but it runs against
// however many rows have accumulated; give it the same room the onboarding job
// has rather than discover the ceiling on the first real apply.
export const maxDuration = 300;

import {
  describeRetentionPurge,
  maybeAlertRetentionPurge,
  RetentionPurgePartialError,
  runRetentionPurge,
} from '../../../backend/answer/audit/index.ts';
import {
  countPurgeableTrialBookkeeping,
  purgeExpiredTrialBookkeeping,
  trialRetentionCutoff,
} from '../../../backend/billing/index.ts';
import { getDb } from '../../../lib/db.ts';

// Injected, not imported by the job — ADR 001's arrow points billing → answer,
// never back. This route and `scripts/gdpr-purge.ts` are the two composition
// roots and they inject the SAME three functions, so the cron and the CLI can
// never describe different work.
const TRIAL_LEG = {
  cutoff: trialRetentionCutoff,
  count: countPurgeableTrialBookkeeping,
  purge: purgeExpiredTrialBookkeeping,
};

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  // Fail CLOSED when the secret is unconfigured — without it there is no way to
  // authenticate the caller, and an open purge endpoint would let anyone redact
  // this database's question history.
  if (!cronSecret) {
    console.error('gdpr-purge-cron: CRON_SECRET is not set — refusing to run (fail closed)');
    return new Response('cron secret not configured', { status: 503 });
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const apply = process.env.GDPR_PURGE_APPLY === '1';

  try {
    const summary = await runRetentionPurge({
      db: getDb(),
      // ONE clock for both windows, so they cannot be cut from different days.
      now: new Date(),
      apply,
      trial: TRIAL_LEG,
    });
    // The same operator line the CLI prints — Vercel logs are the owner's only
    // production visibility (WP12 review), and two descriptions of one run is
    // how they drift.
    console.log(`gdpr-purge-cron: ${describeRetentionPurge(summary)}`);

    // Migration 020 has been live since the 2026-07-17 go-live, so on THIS
    // database an absent trial table is not an honest skip — it is a signal.
    if ('skipped' in summary.trial && summary.trial.skipped === 'table-absent') {
      await maybeAlertRetentionPurge({
        kind: 'skipped',
        detail: 'trial_questions reported absent by to_regclass on production.',
      });
    }
    return Response.json(summary, { status: 200 });
  } catch (error) {
    // Loud, because silence is the bug this route exists to fix. The alert is
    // fail-soft and cannot turn a successful purge into a failed response — it
    // only ever runs on a path that has already failed.
    // A PARTIAL failure must not be reported as "nothing expired": the audit
    // leg may already have committed its redactions, and the alert's standing
    // wording says nothing is expiring. Say what landed.
    const detail =
      error instanceof RetentionPurgePartialError
        ? `${error.message} — those ${error.auditRowsRedacted} redaction(s) DID commit; ` +
          `the 2-year leg ran, only the 90-day trial leg did not.`
        : error instanceof Error
          ? error.message
          : String(error);
    await maybeAlertRetentionPurge({ kind: 'failed', detail });
    return new Response('retention purge failed', { status: 500 });
  }
}
