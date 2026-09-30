// The warm-job route (ADR 065 step 8; design 2026-09-30-one-route-warm-slices-design.md D4/D5): a thin Route
// Handler over web/lib/warm-job.ts and src/ingestion/warm-job.ts's warmPinnedTables. The daily cron
// (/api/onboarding-cron) kicks it once; while work is left it kicks itself again with ?chain=<n>, up to
// WARM_MAX_CHAIN times. A Route Handler, not a Server Action, for the same reason as the other job routes: it
// is invoked with a plain GET carrying the Bearer secret.
//
// This is where the pinned slice tables' stored cells are refreshed from CBS (principle b: out-of-band, never
// the request path). No AI is called. Today no table is in slice mode, so the run finds nothing and returns an
// empty summary; it starts doing work as tables are converted one by one.
export const runtime = 'nodejs';
// One invocation works to WARM_SOFT_DEADLINE_MS, every CBS call is cut at WARM_HARD_STOP_MS (web/lib/warm-job.ts
// has the arithmetic), and the platform limit is 300 s.
export const maxDuration = 300;

import { ODataV4Source } from '../../../backend/cbs-adapter/odata-v4.ts';
import { warmPinnedTables } from '../../../backend/ingestion/warm-job.ts';
import { getDb } from '../../../lib/db.ts';
import {
  WARM_HARD_STOP_MS,
  WARM_METADATA_TIMEOUT_MS,
  WARM_OBSERVATIONS_TIMEOUT_MS,
  kickWarmJob,
  parseChain,
  runWarmJob,
  warmFailureAlert,
  withHardStop,
} from '../../../lib/warm-job.ts';

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  // Fail CLOSED when the secret is unconfigured (same rule as the other job routes): an open job route would
  // let anyone make us hammer CBS.
  if (!cronSecret) {
    console.error('warm-job: CRON_SECRET is not set — refusing to run (fail closed)');
    return new Response('cron secret not configured', { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  // Anything but a small whole number is 0 (the daily run).
  const chain = parseChain(new URL(request.url).searchParams.get('chain'));

  try {
    const startedAt = Date.now();
    const db = getDb();
    // Short per-attempt limits, and no call may outlive the hard stop.
    const source = new ODataV4Source({
      metadataTimeoutMs: WARM_METADATA_TIMEOUT_MS,
      observationsTimeoutMs: WARM_OBSERVATIONS_TIMEOUT_MS,
      fetchFn: withHardStop((input, init) => fetch(input, init), startedAt + WARM_HARD_STOP_MS),
    });
    const outcome = await runWarmJob(
      {
        startedAt,
        warm: ({ deadline }) => warmPinnedTables(db, source, { deadline }),
        kickNext: (next) => kickWarmJob(next),
        alert: warmFailureAlert(db),
      },
      chain,
    );
    console.info(`warm-job: ${JSON.stringify(outcome)}`);
    return Response.json(outcome, { status: 200 });
  } catch (error) {
    // The job's OWN orchestration failed (expected failures — CBS down, a refused slice — are results, not
    // throws): a database error. Stored cells are untouched; the next daily run retries.
    console.error('warm-job: job failed:', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return new Response('warm job error', { status: 500 });
  }
}
