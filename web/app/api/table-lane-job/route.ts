// The table-lane job route (breadth step 5, Task 4; spec D5): a thin Route
// Handler over src/ingestion/table-lane-job.ts's framework-agnostic job, fired
// by the kick (web/lib/table-lane-kick.ts) right after a request is queued. The
// daily onboarding-cron route also runs the job once (the backstop sweep). A
// Route Handler, not a Server Action, for the same reason as onboarding-cron:
// it is invoked with a plain GET carrying the Bearer secret.
//
// This is where the table lane contacts CBS (principle b — never the request
// path) and spends the table parse + compose tokens (normal per-question
// spend, already funded by the row's question debit).
export const runtime = 'nodejs';
// A row can take tens of seconds (CBS schema + slice fetch, parse, compose);
// the job stops claiming new rows after its own 240 s budget.
export const maxDuration = 300;

import { runTableLaneJob } from '../../../backend/ingestion/table-lane-job.ts';
import { getDb } from '../../../lib/db.ts';
import { tableLaneJobDeps } from '../../../lib/table-lane-job-deps.ts';

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  // Fail CLOSED when the secret is unconfigured (same rule as onboarding-cron):
  // an open job route would let anyone spend LLM tokens and hammer CBS.
  if (!cronSecret) {
    console.error('table-lane-job: CRON_SECRET is not set — refusing to run (fail closed)');
    return new Response('cron secret not configured', { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    const summary = await runTableLaneJob(tableLaneJobDeps(getDb()));
    console.info(`table-lane-job: ${JSON.stringify(summary)}`);
    return Response.json(summary, { status: 200 });
  } catch (error) {
    // The job's OWN orchestration failed (per-row failures are handled inside
    // it). A half-processed row is reclaimed once stale; the daily sweep and
    // the next kick retry. Orchestration errors come from the queue queries
    // (claim / exhausted-row scan), which never carry a question text.
    console.error('table-lane-job: job failed:', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return new Response('table-lane job error', { status: 500 });
  }
}
