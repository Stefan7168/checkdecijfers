// ADR 065 step 8 (design 2026-09-30-one-route-warm-slices-design.md D5): the owner alert for a pinned
// table the warm job could NOT refresh. Same posture as every sibling in alerts.ts: console.error is
// the floor, the Resend e-mail (sendAdminAlertEmail) is sent when configured, fail-soft always, AT MOST
// ONE e-mail per check, batched.
//
// De-duplication reuses the sibling mechanism, which stores nothing: the rule is recomputed on every run
// from a date that is already stored (missed-sync alert: shouldAlertToday, src/ingestion/stale-sync.ts;
// new-data alert: freshness.ts). Here the clock is the day of the table's last COMPLETE warm run
// (cbs_tables.last_sync_at, stamped only when a run finishes the whole scope; a never-completed table is
// counted from its registration, created_at). A table that keeps failing therefore ages one day per day:
// mailed the day after its last success, then on every 7th day after, never daily.
//
// Two facts the rule leans on, both properties of the job rather than new state:
//  - The daily run is the only one that mails a plain failure. A run the job chained to itself the same day
//    (web/lib/warm-job.ts) sees the same clock value and would mail it again; it stays quiet instead.
//  - A quarantined table (status needs_review) is no longer picked up by later runs, so the run that
//    quarantined it is the ONLY sighting: it is mailed from any run. The status flip is that alert's
//    once-only latch.
import type { Db } from '../../db/types.ts';
import type { WarmTableResult } from '../../ingestion/warm-job.ts';
import { shouldAlertToday } from '../../ingestion/stale-sync.ts';
import { sendAdminAlertEmail } from './alerts.ts';

/** The most of a failure text that leaves this module: enough to name the cause, too short to carry data. */
const SUMMARY_MAX_CHARS = 300;

export interface WarmFailureEntry {
  tableId: string;
  /** The stage that failed (e.g. 'fetch', 'validate', 'plan', 'threw'). */
  stage: string;
  summary: string;
  /** True when the failure took the table out of service (needs_review). */
  quarantined: boolean;
  /** Whole UTC calendar days since the table's last complete warm run (or its registration when it never
   * completed one); null when that date could not be read. */
  daysSinceLastComplete: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const utcDay = (d: Date): number => Math.floor(d.getTime() / MS_PER_DAY);

/** Pure. See the header for the rule; `dailyRun` is true only for the first run of a chain. */
export function shouldAlertAboutWarmFailure(entry: WarmFailureEntry, dailyRun: boolean): boolean {
  if (entry.quarantined) return true;
  if (!dailyRun) return false;
  // An unreadable clock is told rather than guessed away (principle (c)).
  if (entry.daysSinceLastComplete === null) return true;
  return shouldAlertToday(entry.daysSinceLastComplete);
}

/** The failed results as alert entries, each with its clock read from cbs_tables. Anything that did not fail
 * is dropped before any database read. Only the stage, the (capped) summary and the flag are copied. */
export async function loadWarmFailureEntries(
  db: Db,
  results: readonly WarmTableResult[],
  now: Date,
): Promise<WarmFailureEntry[]> {
  const failedResults = results.filter((r) => r.outcome === 'failed');
  if (failedResults.length === 0) return [];
  const rows = (
    await db.query('select id, last_sync_at, created_at from cbs_tables where id = any($1::text[])', [
      failedResults.map((r) => r.tableId),
    ])
  ).rows;
  const clockOf = new Map<string, Date | null>();
  for (const row of rows) {
    const raw = row.last_sync_at ?? row.created_at;
    const date = raw == null ? null : new Date(raw as string | Date);
    clockOf.set(String(row.id), date && !Number.isNaN(date.getTime()) ? date : null);
  }
  return failedResults.map((r): WarmFailureEntry => {
    const since = clockOf.get(r.tableId) ?? null;
    return {
      tableId: r.tableId,
      stage: r.failure?.stage ?? 'unknown',
      summary: (r.failure?.summary ?? '(no summary recorded)').slice(0, SUMMARY_MAX_CHARS),
      quarantined: r.failure?.quarantined === true,
      daysSinceLastComplete: since === null ? null : Math.max(0, utcDay(now) - utcDay(since)),
    };
  });
}

export interface WarmFailureAlert {
  failures: WarmFailureEntry[];
}

export async function alertWarmFailures(alert: WarmFailureAlert, fetchImpl: typeof fetch = fetch): Promise<void> {
  const subject =
    alert.failures.length === 1
      ? `graphmaker.studio: table ${alert.failures[0]!.tableId} could not be refreshed`
      : `graphmaker.studio: ${alert.failures.length} tables could not be refreshed`;
  const lines = alert.failures.flatMap((f) => [
    // Rebuilt field by field, so nothing but these five values can reach the mail.
    `- ${f.tableId}: failed at stage "${f.stage}": ${String(f.summary).slice(0, SUMMARY_MAX_CHARS)}`,
    f.quarantined
      ? `  The table is quarantined: it refuses to answer until a person re-baselines it. In a session with Claude, ` +
        `run: npm run ingest -- rebaseline-slices ${f.tableId} --yes`
      : '  Not quarantined: the next daily run retries automatically; nothing needs doing unless this mail repeats.',
  ]);
  const body = [
    'The daily refresh could not update the table(s) below from CBS (ADR 065, the warm job).',
    '',
    'What this means: figures already stored and checked stay as they were, with the dates they carry. This ' +
      'failure changed nothing that readers see, except that a quarantined table stops answering.',
    '',
    ...lines,
    '',
    'You get one mail the day after a table first fails to refresh, then a reminder every 7 days while it keeps ' +
      'failing. A quarantined table is mailed once, when it is taken out of service.',
    `Time: ${new Date().toISOString()}`,
  ].join('\n');
  await sendAdminAlertEmail(subject, body, fetchImpl);
}

export interface WarmFailureCheck {
  db: Db;
  results: readonly WarmTableResult[];
  now?: Date;
  /** True for the first run of a chain (the one the daily cron starts). */
  dailyRun: boolean;
}

/** Fail-soft wrapper: logs the floor, never throws — the warm job must never fail or block on this. Names only
 * the tables that are due today (shouldAlertAboutWarmFailure); a run with nothing failed sends nothing, logs
 * nothing and reads nothing. */
export async function maybeAlertWarmFailures(
  check: WarmFailureCheck,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let due: WarmFailureEntry[];
  try {
    const entries = await loadWarmFailureEntries(check.db, check.results, check.now ?? new Date());
    due = entries.filter((e) => shouldAlertAboutWarmFailure(e, check.dailyRun));
  } catch (err) {
    console.error('[warm-failure] the alert could not be prepared:', err instanceof Error ? err.message : String(err));
    return;
  }
  if (due.length === 0) return;
  for (const e of due) {
    console.error(
      `[warm-failure] ${e.tableId}: stage ${e.stage}${e.quarantined ? ' (quarantined)' : ''} — ${e.summary}`,
    );
  }
  try {
    await alertWarmFailures({ failures: due }, fetchImpl);
  } catch (err) {
    console.error('[warm-failure] alert e-mail failed:', err);
  }
}
