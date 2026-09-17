// On-demand CBS onboarding cron route (WP16 sub-part 2, ADR 026, design §3):
// a thin Route Handler adapter over src/ingestion/onboarding.ts's
// framework-agnostic job. A Route Handler (not a Server Action) because Vercel
// Cron invokes it with a plain scheduled GET carrying the Bearer secret — a
// Server Action can't be triggered that way.
//
// This route is the ONLY thing that ever runs the job: the Vercel Cron entry
// in web/vercel.json points here DAILY (a Vercel-Hobby-plan limit rejected a
// minutes-level schedule at deploy time; the trigger cadence decision that
// makes the acknowledgment's 'kwestie van minuten' promise true is #113 and
// gates ONBOARDING_ENABLED). It fetches from
// CBS (out-of-band, never the request path — principle b) and spends live LLM
// tokens on the delivery re-run's parse+compose (normal per-question spend,
// already funded by the user's 100-credit onboarding debit).
export const runtime = 'nodejs';
// The job may fetch + ingest a CBS table and run an LLM parse+compose; give it
// the room ADR 026 sized it against (~300s Fluid Compute budget). The job's own
// per-invocation work is ONE table, kept small by the slice cap.
export const maxDuration = 300;

import { AnthropicLlmClient } from '../../../backend/answer/llm/client.ts';
import {
  maybeAlertHealthProbeFailure,
  maybeAlertIngestionRunProblems,
  maybeAlertMissedSyncs,
} from '../../../backend/answer/audit/alerts.ts';
import { ODataV4Source } from '../../../backend/cbs-adapter/odata-v4.ts';
import { runOnboardingJob } from '../../../backend/ingestion/onboarding.ts';
import { productionNotifier } from '../../../backend/ingestion/onboarding-notify.ts';
import { getPendingRequest } from '../../../backend/ingestion/onboarding-store.ts';
import { findStaleSyncs, loadStaleSyncCandidateRows } from '../../../backend/ingestion/stale-sync.ts';
import { sourceKeyForTableId } from '../../../backend/sources/registry.ts';
import { getDb } from '../../../lib/db.ts';
import { runHealthChecks } from '../health/checks.ts';

/** 'today' in the product's own timezone — same computation as the chat
 * action's referenceDate(), so the delivery re-run resolves relative periods
 * exactly as a live turn would. */
function referenceDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  // Fail CLOSED when the secret is unconfigured: without it there is no way to
  // authenticate the caller, and an open onboarding job would let anyone drain
  // the queue / spend credits. 503, logged plainly (WP12 review: Vercel logs
  // are the owner's only production visibility).
  if (!cronSecret) {
    console.error('onboarding-cron: CRON_SECRET is not set — refusing to run (fail closed)');
    return new Response('cron secret not configured', { status: 503 });
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    const db = getDb();
    const summary = await runOnboardingJob({
      db,
      source: new ODataV4Source(),
      intentClient: new AnthropicLlmClient(),
      answerClient: new AnthropicLlmClient(),
      // #144 (ADR 034): the delivery re-run gets the SAME reject-only semantic
      // checker as a live chat turn, behind the same dormant env flags — a
      // delivered onboarding answer is exactly as user-visible.
      ...(process.env.SEMANTIC_CHECK_ENABLED === '1'
        ? {
            semanticCheck: {
              client: new AnthropicLlmClient(),
              mode:
                process.env.SEMANTIC_CHECK_FAILMODE === 'closed'
                  ? ('fail_closed' as const)
                  : ('fail_open' as const),
            },
          }
        : {}),
      // WP27 stage C: the measure-fit gate's client (Haiku pin in
      // onboarding-fit.ts). Dormant — and spend-free — until stage D applies
      // migration 015: pre-015 every row's candidate chain reads back [] (the
      // stage-B probe), which takes the legacy no-fit-gate path.
      fitClient: new AnthropicLlmClient(),
      notify: productionNotifier(db),
      referenceDate: referenceDate(),
    });

    // #23 (health-probe alert, session 110): AFTER the main job, re-run the
    // SAME checks /api/health runs (#114) and alert ONCE if the app itself is
    // broken on this live DB — between deploys nobody otherwise watches that
    // route at all. Fail-open, wrapped in its own try/catch so a probe/alert
    // failure can never turn a successful onboarding run into an error
    // response. Accepted limit: if the database itself were unreachable,
    // runOnboardingJob above would already have thrown and this code would
    // never be reached — that failure mode surfaces as the cron's own
    // Vercel-log error instead (see the #23 RUNBOOK note this session added).
    try {
      const healthResult = await runHealthChecks(db, {
        onboardingEnabled: process.env.ONBOARDING_ENABLED === '1',
        websearchEnabled: process.env.WEBSEARCH_ENABLED === '1',
        workspaceEnabled: process.env.WORKSPACE_ENABLED === '1',
      });
      await maybeAlertHealthProbeFailure({ failed: healthResult.failed });
    } catch (healthError) {
      console.warn('onboarding-cron: health-probe alert failed (job result unaffected):', healthError);
    }

    // #23: proactive owner alert on a terminally-failed onboarding row (the
    // on-demand single-table ingest for THIS run). Every 'failed' path in
    // onboarding.ts is exactly the #23 scope (a registerAndSync/quarantine
    // failure, or an unexpected throw) — never a plain 'unanswerable' (no fit
    // table, a normal refusal), which stays silent here on purpose. Same
    // fail-open contract as the rest of this route: an alert problem must
    // never turn a real job result into an error response.
    if (summary.processed?.outcome === 'failed') {
      try {
        const row = await getPendingRequest(db, summary.processed.id);
        const tableId = summary.processed.tableId;
        await maybeAlertIngestionRunProblems({
          problems: [
            {
              tableId,
              source: sourceKeyForTableId(tableId),
              check: 'onboarding-sync-failed',
              message: row?.failureSummary ?? '(no failure summary recorded)',
              // Not available here: registerAndSync (onboarding.ts) discards
              // the SyncResult's batchId once it maps a failure onto a plain
              // Dutch summary string. Documented residual — see the #23 row
              // in docs/open-questions.md — not threaded through further to
              // avoid touching src/ingestion/pipeline.ts (out of scope for
              // this change).
              batchId: null,
            },
          ],
        });
      } catch (alertError) {
        console.warn('onboarding-cron: owner alert failed (job result unaffected):', alertError);
      }
    }

    // #23 residual (missed-sync trigger, session 110): this route is the
    // cheapest existing scheduler (Vercel Cron, DAILY at 06:00, web/vercel.json)
    // — no new cron route, no new schema. Guarded exactly like the block
    // above: a failure here must never turn today's real onboarding-job
    // result into an error response. The cadence rule and the daily-alert-
    // fatigue dedupe both live in src/ingestion/stale-sync.ts and
    // maybeAlertMissedSyncs (src/answer/audit/alerts.ts) respectively — this
    // route only supplies "now" and the DB.
    try {
      const candidates = await loadStaleSyncCandidateRows(db);
      const overdue = findStaleSyncs(candidates, new Date());
      await maybeAlertMissedSyncs({ overdue });
    } catch (missedSyncError) {
      console.warn('onboarding-cron: missed-sync check failed (job result unaffected):', missedSyncError);
    }

    return Response.json(summary, { status: 200 });
  } catch (error) {
    // A throw here means the job's OWN orchestration failed (not a per-row
    // failure — those are caught inside runOnboardingJob and finalized). Log
    // loudly; the next 2-minute invocation retries, and any half-claimed row
    // is reclaimed by its stale-running check.
    console.error('onboarding-cron job failed:', error);
    return new Response('onboarding job error', { status: 500 });
  }
}
