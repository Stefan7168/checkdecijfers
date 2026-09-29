// The shared cron-route KICK (fix round 1 of breadth step 5 Task 4, controller
// ruling R11): ONE implementation of the fail-soft "fire a cron-secret-guarded
// route and stop waiting" contract, used by the onboarding kick
// (web/lib/onboarding-kick.ts, #113) and the table-lane kick
// (web/lib/table-lane-kick.ts). The contract, first written for the onboarding
// kick and unchanged here:
//
// Fail-soft contract (#113, binding): a failed kick may NEVER affect money or
// the acknowledgment. Every failure mode — missing config, non-OK response,
// network/DNS/abort throw — degrades to a logged skip; the daily backstop cron
// still sweeps the queued row. This function is therefore structurally
// incapable of throwing.
//
// Framework-free ON PURPOSE: it must not import anything from 'next/*' so the
// jsdom vitest suite can exercise it directly with an injected fetch and env.
// The Server Function wires it through next/server's after(), so this file
// stays a plain testable unit.
//
// Why a bounded timeout, and why aborting is SAFE: the cron route only responds
// once the WHOLE onboarding job finishes (fetch + ingest + LLM re-run — can be
// tens of seconds). We only need to DISPATCH it, not wait it out: the route is
// its own function invocation with its own 300s budget. Vercel request
// cancellation is OPT-IN (`supportsCancellation` in vercel.json, which neither
// the onboarding-cron nor the table-lane-job path sets), so a client disconnect —
// whether our timeout-abort here or the caller's own 30s maxDuration expiring —
// does NOT cancel the running job. We therefore abort the wait after
// KICK_TIMEOUT_MS (dispatch is sub-second; failures like 401/DNS return fast
// and still log), which keeps the kick well inside the page's 30s after()
// budget so its own outcome is always logged, instead of the caller being
// silently killed mid-await on any job longer than 30s. If either kicked
// path ever enables supportsCancellation, this abort would kill the job — don't.

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

/** Which route a kick fires, and the words its log lines use. */
export interface CronKickTarget {
  /** Absolute path on the production host, e.g. '/api/onboarding-cron'. */
  path: string;
  /** Log prefix, e.g. 'onboarding kick'. */
  label: string;
  /** How the route is named in the "responded ok" line, e.g. 'cron route'. */
  routeLabel: string;
  /** What still picks the work up when the kick is skipped. */
  backstopNote: string;
}

/**
 * Fire one cron-secret-guarded route once, fail-soft. Resolves normally on
 * every path; it cannot throw.
 *
 * The Authorization header is `Bearer <secret>` — this must byte-match what
 * the target route checks (`Bearer ${cronSecret}` in web/app/api/onboarding-cron
 * and web/app/api/table-lane-job), which is also exactly the header Vercel Cron
 * itself sends.
 */
export async function kickCronRoute(target: CronKickTarget, deps: KickDeps = {}): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const secret = deps.secret ?? process.env.CRON_SECRET;
  const host = deps.host ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const timeoutMs = deps.timeoutMs ?? KICK_TIMEOUT_MS;

  // Missing config → skip, don't throw. The backstop cron still sweeps.
  if (!secret || !host) {
    console.warn(
      `${target.label} skipped (CRON_SECRET or VERCEL_PROJECT_PRODUCTION_URL unset) — ${target.backstopNote}`,
    );
    return;
  }

  try {
    const res = await fetchImpl(`https://${host}${target.path}`, {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
      // Stop WAITING after timeoutMs — not stop the JOB (see the header note:
      // cancellation is opt-in and off for this path, so the route runs on).
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // A non-OK response is not fatal: the row is queued, the backstop sweeps.
      console.error(`${target.label} returned non-OK status ${res.status}`);
    } else {
      console.info(`${target.label} dispatched (${target.routeLabel} responded ok)`);
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
      console.info(`${target.label} dispatched (not awaiting job completion)`);
    } else {
      console.error(`${target.label} failed (fetch threw):`, error);
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
