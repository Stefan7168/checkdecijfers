// The warm job's own logic (ADR 065 step 8; design 2026-09-30-one-route-warm-slices-design.md D4, D5):
// what the route /api/warm-job does, kept free of Next.js and of the live database and CBS so the hermetic
// suite can drive every branch with injected dependencies (web/lib/warm-job.test.ts).
//
// The job (src/ingestion/warm-job.ts, warmPinnedTables) refreshes every pinned slice-cache table until a
// deadline and resumes on the next call. One serverless invocation is killed at 300 s and a CBS request can
// take a minute or stall, so a big scope takes several invocations: the route kicks itself again while work
// is left (a "chain"), bounded, and the daily cron starts the chain.
import type { Db } from '../backend/db/types.ts';
import type { WarmTableResult } from '../backend/ingestion/warm-job.ts';
import { maybeAlertWarmFailures } from '../backend/answer/audit/warm-alert.ts';
import { kickCronRoute, type KickDeps } from './cron-kick.ts';

/** The chain counter's highest value: the daily run is 0, and the run numbered 20 kicks nothing more. */
export const WARM_MAX_CHAIN = 20;

// --- Time budget of ONE invocation (Vercel kills it at 300 s) ---------------------------------------------
// The adapter (src/cbs-adapter/odata-v4.ts) makes up to 3 attempts per call, each with its own time limit,
// and waits n x 1.5 s after attempt n (1.5 s, then 3 s; nothing after the last).
export const ADAPTER_ATTEMPTS = 3;
export const ADAPTER_BACKOFF_MS = 1_500;
/** Per-attempt limits, short so a stalled CBS call gives up early (the adapter's own defaults are 30 s and
 * 300 s, which suit a command line, not a 300 s invocation). */
export const WARM_METADATA_TIMEOUT_MS = 20_000;
export const WARM_OBSERVATIONS_TIMEOUT_MS = 45_000;
// One worst-case call, every attempt running to its limit:
//   data page  3 x 45 s + (1.5 + 3) s = 139.5 s        metadata call  3 x 20 s + 4.5 s = 64.5 s
// A planned request is one data page (WARM_MAX_CELLS = 25,000 cells is below CBS's page size), and the job
// checks its deadline before every request and every table, so the last request starts at or before the
// SOFT deadline:  120 s + 139.5 s = 259.5 s.
/** No new request or table starts after this many ms from the start of the invocation. */
export const WARM_SOFT_DEADLINE_MS = 120_000;
/** The end-of-run work: the next kick waits at most this long for its dispatch (cron-kick.ts KICK_TIMEOUT_MS),
 * and the failure alert (one database read, one e-mail capped at 5 s) runs beside it. */
export const KICK_WAIT_MS = 10_000;
// 259.5 s + 10 s = 269.5 s < 300 s. That is the case the limits above are chosen for; the hard stop below
// makes it hold for ANY request, including one that pages more than once or reads a schema first
// (metadata calls run in parallel: 64.5 s, then the data request).
/** Every CBS call is cut at this many ms from the start of the invocation (withHardStop). Then the worst
 * tail is 250 s + 4.5 s of backoff after the cut + 10 s end-of-run work + about 1 s of database = 265.5 s,
 * with 34 s left for a cold start and the response. A request cut here is reported as a failure of that
 * table (its stored cells are untouched) and the next run resumes it. */
export const WARM_HARD_STOP_MS = 250_000;

/** The chain counter from the query string: a whole number from 0 to WARM_MAX_CHAIN, digits only.
 * Anything else — missing, negative, fractional, padded, too big — is 0. */
export function parseChain(raw: string | null): number {
  if (raw === null || !/^\d{1,2}$/.test(raw)) return 0;
  const n = Number(raw);
  return n <= WARM_MAX_CHAIN ? n : 0;
}

/** A fetch that can never start or continue a call past `hardStopAt` (epoch ms): each call's own signal is
 * combined with one that fires at the stop. `now` is injectable for tests. */
export function withHardStop(inner: typeof fetch, hardStopAt: number, now: () => number = Date.now): typeof fetch {
  return (input, init) => {
    const stop = AbortSignal.timeout(Math.max(0, hardStopAt - now()));
    const signal = init?.signal ? AbortSignal.any([init.signal, stop]) : stop;
    return inner(input, { ...init, signal });
  };
}

/** Work is left when a table stopped part-way or was not reached before the deadline. (Other skips — not
 * pinned, quarantined, whole-table — are not work; a failed table is not "left", it is reported.) */
function isUnfinished(r: WarmTableResult): boolean {
  return r.outcome === 'partial' || (r.outcome === 'skipped' && r.skippedReason === 'deadline');
}

/** Chain again only when work is left AND this invocation moved it forward (at least one request fetched or
 * confirmed) AND the maximum is not reached. A run that only failed never chains, so a failing source is
 * asked again by the next daily run, not by a burst of 20. */
export function shouldChainWarmJob(results: readonly WarmTableResult[], chain: number): boolean {
  if (chain >= WARM_MAX_CHAIN) return false;
  if (!results.some(isUnfinished)) return false;
  return results.some((r) => r.fetched + r.confirmed > 0);
}

export interface WarmSummaryEntry {
  tableId: string;
  outcome: WarmTableResult['outcome'];
  planned: number;
  fetched: number;
  confirmed: number;
  remaining: number;
  failureStage?: string;
  quarantined?: boolean;
}

/** The response body: per table the outcome, the counters and the failing stage. Built field by field so
 * nothing else — no failure text, no cell — can reach a response or a log line. */
export function summarizeWarmResults(results: readonly WarmTableResult[]): WarmSummaryEntry[] {
  return results.map((r) => ({
    tableId: r.tableId,
    outcome: r.outcome,
    planned: r.planned,
    fetched: r.fetched,
    confirmed: r.confirmed,
    remaining: r.remaining,
    ...(r.failure ? { failureStage: r.failure.stage, quarantined: r.failure.quarantined } : {}),
  }));
}

/** Kick the warm-job route once, fail-soft (cron-kick.ts: cannot throw, waits only for the dispatch — the job
 * runs as its own invocation, so this path must never enable supportsCancellation). The daily cron kicks the
 * bare route; the route kicks itself with the next counter. */
export async function kickWarmJob(chain = 0, deps: KickDeps = {}): Promise<void> {
  return kickCronRoute(
    {
      path: chain > 0 ? `/api/warm-job?chain=${chain}` : '/api/warm-job',
      label: 'warm-job kick',
      routeLabel: 'job route',
      backstopNote: chain > 0 ? 'the next daily run resumes the work' : 'the next daily cron kicks it again',
    },
    deps,
  );
}

export interface WarmJobDeps {
  /** Epoch ms at which this invocation began (the budget is measured from here). */
  startedAt: number;
  warm(opts: { deadline: number }): Promise<WarmTableResult[]>;
  kickNext(chain: number): Promise<void>;
  /** The owner alert for failed tables; `dailyRun` is true for the first run of a chain. */
  alert(results: readonly WarmTableResult[], dailyRun: boolean): Promise<void>;
}

export interface WarmJobOutcome {
  chain: number;
  chained: boolean;
  tables: WarmSummaryEntry[];
}

/** One invocation of the job: warm to the soft deadline, then — beside each other, both fail-soft — kick the
 * next invocation if work is left and alert about failures. */
export async function runWarmJob(deps: WarmJobDeps, chain: number): Promise<WarmJobOutcome> {
  const results = await deps.warm({ deadline: deps.startedAt + WARM_SOFT_DEADLINE_MS });
  const chained = shouldChainWarmJob(results, chain);
  const guard = (label: string, work: Promise<void>): Promise<void> =>
    work.catch((err: unknown) => {
      console.warn(`warm-job: ${label} failed (job result unaffected):`, err instanceof Error ? err.message : String(err));
    });
  await Promise.all([
    chained ? guard('chain kick', deps.kickNext(chain + 1)) : Promise.resolve(),
    guard('failure alert', deps.alert(results, chain === 0)),
  ]);
  return { chain, chained, tables: summarizeWarmResults(results) };
}

/** The production alert: the failure e-mail (src/answer/audit/warm-alert.ts) for this run's results. */
export function warmFailureAlert(db: Db): WarmJobDeps['alert'] {
  return (results, dailyRun) => maybeAlertWarmFailures({ db, results, dailyRun });
}
