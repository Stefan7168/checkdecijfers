// The table-lane job KICK (breadth step 5, Task 4): after askQuestion /
// replyToTableLane queue a table_lane_requests row, the Server Action fires the
// job route itself (through next/server's after()) so the answer starts within
// seconds instead of waiting for the daily onboarding-cron sweep (which also
// runs the table-lane job once — the backstop for a failed kick).
//
// A copy of web/lib/onboarding-kick.ts (#113) with the same contract, for the
// same reasons: fail-soft (a failed kick may NEVER affect money or the routing
// turn — every failure mode degrades to a logged skip; this function cannot
// throw), framework-free (no 'next/*' import, so jsdom tests drive it with an
// injected fetch and env), and a bounded dispatch wait: the job route runs as
// its own invocation with its own 300 s budget, and Vercel request cancellation
// is opt-in (`supportsCancellation`, NOT set for this path), so aborting the
// WAIT never cancels the job. If that path ever enables supportsCancellation,
// this abort would kill the job — don't.

/** Long enough to dispatch the request and catch fast failures (401/DNS), short
 * enough to stay well inside the page's 30s after() budget so the kick's own
 * outcome is always logged rather than silently platform-killed. */
const KICK_TIMEOUT_MS = 10_000;

/** Injectable dependencies so the hermetic suite can drive every branch with no
 * real network and no ambient env. Defaults read the production values:
 * fetchImpl = global fetch, secret = CRON_SECRET, host =
 * VERCEL_PROJECT_PRODUCTION_URL. */
export interface KickDeps {
  fetchImpl?: typeof fetch;
  /** The cron shared secret. Byte-matches what the route checks. */
  secret?: string;
  /** The bare production host (NO protocol) — Vercel's system env var
   * VERCEL_PROJECT_PRODUCTION_URL, e.g. 'checkdecijfers.vercel.app'. */
  host?: string;
  /** Override the dispatch-wait timeout (ms) so the hermetic suite can drive the
   * timeout branch without real-time delays. Defaults to KICK_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Fire the table-lane job route once, fail-soft. Resolves normally on every
 * path; it cannot throw.
 *
 * The Authorization header is `Bearer <secret>` — this must byte-match what
 * web/app/api/table-lane-job/route.ts checks (`Bearer ${cronSecret}`) — the
 * same secret and header shape as the onboarding-cron route.
 */
export async function kickTableLaneJob(deps: KickDeps = {}): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const secret = deps.secret ?? process.env.CRON_SECRET;
  const host = deps.host ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const timeoutMs = deps.timeoutMs ?? KICK_TIMEOUT_MS;

  // Missing config → skip, don't throw. The backstop cron still sweeps.
  if (!secret || !host) {
    console.warn(
      'table-lane kick skipped (CRON_SECRET or VERCEL_PROJECT_PRODUCTION_URL unset) — the daily onboarding-cron sweep will pick the row up',
    );
    return;
  }

  try {
    const res = await fetchImpl(`https://${host}/api/table-lane-job`, {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
      // Stop WAITING after timeoutMs — not stop the JOB (see the header note:
      // cancellation is opt-in and off for this path, so the route runs on).
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // A non-OK response is not fatal: the row is queued, the backstop sweeps.
      console.error(`table-lane kick returned non-OK status ${res.status}`);
    } else {
      console.info('table-lane kick dispatched (job route responded ok)');
    }
  } catch (error) {
    // A timeout abort is the EXPECTED long-job path, not a failure: the request
    // was dispatched, the job runs server-side, we simply stopped waiting for
    // its response. Log it as benign; reserve console.error for real failures
    // (network, DNS). Either way we never throw — the row is committed and the
    // daily backstop cron will pick it up if the kick genuinely failed.
    // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError' —
    // and a DOMException is NOT an instanceof Error in Node, so match on .name
    // directly rather than narrowing to Error first.
    if (isTimeoutAbort(error)) {
      console.info('table-lane kick dispatched (not awaiting job completion)');
    } else {
      console.error('table-lane kick failed (fetch threw):', error);
    }
  }
}

/** True for the DOMException AbortSignal.timeout() rejects with. Matches on the
 * standard `.name` ('TimeoutError') rather than instanceof, since a
 * DOMException does not extend Error in Node. */
function isTimeoutAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'TimeoutError'
  );
}
