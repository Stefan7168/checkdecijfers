// The GDPR retention purge as a framework-agnostic JOB (#189, 2026-07-25).
//
// Why this file exists at all. The purge is the ONLY thing that enforces either
// retention window, and until now it lived entirely inside `scripts/gdpr-purge.ts`
// — a CLI nobody ran and nothing scheduled. Adding a cron route meant either
// duplicating the orchestration (two WHERE-shapes to drift apart, the exact
// failure the ⟨F2⟩ discipline exists to prevent) or lifting it here so the CLI
// and the route are two thin adapters over ONE implementation. This is the same
// shape `runOnboardingJob` uses for the same reason.
//
// Module direction (ADR 001). Billing wraps answer from the OUTSIDE, never the
// reverse — so this module does NOT import `src/billing`. The trial-bookkeeping
// leg is INJECTED by the caller, which is the composition root in both cases
// (the CLI and the route already import from both barrels). That keeps the
// dependency arrow pointing the way the architecture says it points, and it lets
// a test substitute the leg — which is how the "a failing trial read must
// propagate, not read as an honest skip" pin is written at all.
import type { Db } from '../../db/types.ts';
// #65 / WP25: the error_log 90-day sweep. Imported DIRECTLY, unlike the trial
// leg below — src/db/ is the shared layer beneath every ADR-001 module (this
// file already imports its types), so no arrow is violated and the two
// composition roots cannot drift by wiring it differently.
import {
  countPurgeableErrorLog,
  errorLogRetentionCutoff,
  purgeExpiredErrorLog,
} from '../../db/error-log.ts';
import {
  anonymousTrialCutoff,
  countPurgeableQuestionHistory,
  purgeExpiredQuestionHistory,
  twoYearsBefore,
} from './retention.ts';

/** A leg the job runs on behalf of a composition root — the trial-bookkeeping
 * sweep (ADR 036 D4) and, from WP218 phase 2, the chart-style preference
 * sweep. `null` means the caller deliberately runs without it — never "we
 * could not find it".
 *
 * `count`/`purge` return either a plain row count (the trial leg's functions
 * count/delete without listing what they touched) or the array of affected
 * rows (the chart-styles leg's `{ userId }[]` shape, src/chart/user-styles.ts)
 * — `legRowCount` below normalises either into the `rows: number` the summary
 * reports, so a leg never has to fake a count it did not measure.
 *
 * `present` is an optional table-presence gate, checked BEFORE `cutoff`/
 * `count`/`purge` run. The trial and error_log legs use their OWN hardcoded
 * to_regclass check instead (trialTableExists/errorLogTableExists below)
 * because there is no existing exported presence check for those tables; the
 * chart-styles leg wires in `chartStylesTablePresent`
 * (src/chart/user-styles.ts already exports it) here rather than duplicating
 * a third such query inside this file. */
export interface InjectedRetentionLeg {
  cutoff(now: Date): Date;
  count(db: Db, cutoff: Date): Promise<number | unknown[]>;
  purge(db: Db, cutoff: Date): Promise<number | unknown[]>;
  present?(db: Db): Promise<boolean>;
}

/** Alias kept so existing call sites — both composition roots' `TRIAL_LEG`,
 * this module's own barrel export — do not need to change: the trial leg is
 * exactly an `InjectedRetentionLeg` that happens not to set `present`. */
export type TrialRetentionLeg = InjectedRetentionLeg;

/** #322 I-3 (session 129): the own-data upload sweep (ADR 037 point 6,
 * src/attachments/retention.ts). Its own shape rather than an
 * `InjectedRetentionLeg`: it runs TWO windows — a dataset and its turns
 * (and, through redactTurnsForDatasets, its chart edits and any public
 * publication) are fully redacted at the SAME two-year account cutoff as
 * the audit leg, and the raw uploaded file bytes alone are cleared earlier,
 * at 90 days. Injected, like the trial leg, so this module never imports
 * src/attachments (whose retention module already imports this one's
 * sibling). */
export interface DatasetRetentionLeg {
  present(db: Db): Promise<boolean>;
  filesCutoff(now: Date): Date;
  count(db: Db, cellsCutoff: Date, filesCutoff: Date): Promise<{ datasets: number; fileBytesOnly: number }>;
  purge(
    db: Db,
    cellsCutoff: Date,
    filesCutoff: Date,
  ): Promise<{ datasets: number; turns: number; fileBytesCleared: number }>;
}

export interface RetentionPurgeOptions {
  db: Db;
  /** Injected clock — never `new Date()` inside, so a test can pin the cutoffs. */
  now: Date;
  /** false = report only, write nothing. The route defaults to this. */
  apply: boolean;
  trial: TrialRetentionLeg | null;
  /** WP218 phase 2: the user_chart_styles preference-row sweep, injected
   * exactly like `trial` — `null` means this run deliberately skips it. */
  chartStyles: InjectedRetentionLeg | null;
  /** #322 I-3: the uploaded-dataset sweep. Omitted/`null` = this run
   * deliberately skips it (both composition roots wire it). */
  datasets?: DatasetRetentionLeg | null;
}

export interface RetentionPurgeSummary {
  mode: 'dry-run' | 'applied';
  auditCutoff: string;
  /** #181: the 90-day cutoff the anonymous-trial half of the audit sweep used.
   * Always present, so an operator reading a summary never has to remember that
   * two windows exist — the summary says so. */
  anonymousCutoff: string;
  /** Rows redacted (applied) or that WOULD be redacted (dry run) — both windows. */
  auditRows: number;
  /** Dry run only: the same total split by window, because the two are 21
   * months apart and "12 rows" does not say which clock is about to bite.
   * Absent after an apply — `purgeExpiredQuestionHistory` returns one list and
   * a split there would be a number we did not measure. */
  accountRows?: number;
  anonymousTrialRows?: number;
  /** pending_table_requests rows at the same cutoff. A NUMBER on a dry run.
   * `null` after an apply — the pending leg runs inside
   * purgeExpiredQuestionHistory's own transaction (#120) and is not itemised in
   * its return, so any number here would be one we did not measure. Null says
   * "covered, not separately counted"; 0 would say "nothing was covered". */
  pendingRows: number | null;
  /** Present only when rows were actually redacted. */
  byKind?: Record<string, number>;
  trial:
    | { cutoff: string; rows: number }
    /** Migration 020 genuinely not applied — the ONLY reason this leg is
     * skipped. A read that throws propagates instead (see below). */
    | { skipped: 'table-absent' }
    | { skipped: 'not-configured' };
  /** #65 / WP25: the error_log housekeeping sweep — DELETED at 90 days
   * (src/db/error-log.ts; an ops log, not a user-facing record — no personal
   * data by construction, so this is table hygiene, not GDPR erasure; it rides
   * this job because the job is the one scheduled sweep that exists).
   * 'table-absent' is the EXPECTED state until migration 024's supervised
   * live apply — the composition roots must not alert on it (unlike the trial
   * leg, whose migration is live). */
  errorLog: { cutoff: string; rows: number } | { skipped: 'table-absent' };
  /** WP218 phase 2: the user_chart_styles preference-row sweep, same
   * two-year account window as the audit leg (ADR 037). `'table-absent'` is
   * the EXPECTED state until migration 028's supervised apply (the file's own
   * header says so) — mirrors the error_log leg's posture, not the trial
   * leg's: the composition roots must not alert on it. */
  chartStyles:
    | { cutoff: string; rows: number }
    | { skipped: 'table-absent' }
    | { skipped: 'not-configured' };
  /** #322 I-3: uploaded datasets. Dry run: `datasets` = full redactions due
   * (2-year cutoff), `fileBytesOnly` = datasets whose raw file would be
   * cleared at 90 days (a pre-apply count that also includes the 2-year
   * ones — countPurgeableDatasets' own documented contract), `turns` null
   * (not counted ahead of time). Applied: what was actually done. */
  datasets:
    | { cellsCutoff: string; filesCutoff: string; datasets: number; turns: number | null; fileBytes: number }
    | { skipped: 'table-absent' }
    | { skipped: 'not-configured' };
}

/** Normalises a leg's count/purge result into the plain row count the
 * summary reports. The trial leg's functions already return a count; the
 * chart-styles leg's return the affected rows themselves (its `{ userId }[]`
 * shape) — only the length is used here, since the summary's `rows` field is
 * a count for every leg, trial included. */
function legRowCount(result: number | unknown[]): number {
  return Array.isArray(result) ? result.length : result;
}

/** A CHECK, not a catch — `retention.ts` states the rule for its own
 * migration-017 guard: "the guard must be a check, not a catch". A bare catch
 * here would report a lock timeout, a permissions problem or a connection blip
 * as an honest skip while the job still succeeded, and a retention mechanism
 * that reports success when it did nothing is worse than one that is absent. */
async function trialTableExists(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.trial_questions') as t`, []);
  return rows[0]?.t != null;
}

/** Same check-not-catch rule for the error_log leg (#65). Until migration
 * 024's supervised live apply this is FALSE on production and the leg skips
 * honestly; after it, a throwing read propagates like any real failure. */
async function errorLogTableExists(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.error_log') as t`, []);
  return rows[0]?.t != null;
}

/**
 * Runs both retention clocks and returns what happened. Throws on any real
 * failure — callers decide how loud that is (the CLI exits non-zero, the route
 * alerts the owner). It deliberately does NOT swallow errors: silence is the
 * bug #189 is about, one level up.
 *
 * Idempotent for a fixed `now`: redacting an already-redacted row writes the
 * same sentinel, and the trial DELETE finds nothing left.
 */
export async function runRetentionPurge(
  options: RetentionPurgeOptions,
): Promise<RetentionPurgeSummary> {
  const { db, now, apply, trial, chartStyles } = options;
  const datasets = options.datasets ?? null;
  const auditCutoff = twoYearsBefore(now);
  // #181: anonymous trial CONTENT expires with its own bookkeeping at 90 days,
  // not at the account window. Derived from the SAME injected `now` as the
  // 2-year cutoff — one clock, two windows — so a run can never mix instants.
  const anonCutoff = anonymousTrialCutoff(now);

  const trialLeg = async (): Promise<RetentionPurgeSummary['trial']> => {
    if (trial === null) return { skipped: 'not-configured' };
    if (!(await trialTableExists(db))) return { skipped: 'table-absent' };
    const cutoff = trial.cutoff(now);
    const result = apply ? await trial.purge(db, cutoff) : await trial.count(db, cutoff);
    return { cutoff: cutoff.toISOString(), rows: legRowCount(result) };
  };

  // WP218 phase 2: the chart-style preference sweep. Presence is checked via
  // the leg's OWN injected `present` (chartStylesTablePresent), not a
  // hardcoded query here — see InjectedRetentionLeg's doc comment for why.
  const chartStylesLeg = async (): Promise<RetentionPurgeSummary['chartStyles']> => {
    if (chartStyles === null) return { skipped: 'not-configured' };
    if (chartStyles.present !== undefined && !(await chartStyles.present(db))) {
      return { skipped: 'table-absent' };
    }
    const cutoff = chartStyles.cutoff(now);
    const result = apply
      ? await chartStyles.purge(db, cutoff)
      : await chartStyles.count(db, cutoff);
    return { cutoff: cutoff.toISOString(), rows: legRowCount(result) };
  };

  // #322 I-3: uploaded datasets. The full-redaction cutoff IS the audit
  // leg's own 2-year cutoff (one clock, and ADR 037 §8 Q2's "the same #14
  // account window"); only the file-bytes cutoff comes from the leg.
  const datasetsLeg = async (): Promise<RetentionPurgeSummary['datasets']> => {
    if (datasets === null) return { skipped: 'not-configured' };
    if (!(await datasets.present(db))) return { skipped: 'table-absent' };
    const filesCutoff = datasets.filesCutoff(now);
    const base = { cellsCutoff: auditCutoff.toISOString(), filesCutoff: filesCutoff.toISOString() };
    if (!apply) {
      const c = await datasets.count(db, auditCutoff, filesCutoff);
      return { ...base, datasets: c.datasets, turns: null, fileBytes: c.fileBytesOnly };
    }
    const r = await datasets.purge(db, auditCutoff, filesCutoff);
    return { ...base, datasets: r.datasets, turns: r.turns, fileBytes: r.fileBytesCleared };
  };

  // #65: the 90-day error_log sweep — the same one-clock rule (cutoff derived
  // from the injected `now`), the same dry-run/apply split, the same ⟨F2⟩
  // guarantee (count and purge share one WHERE in src/db/error-log.ts).
  const errorLogLeg = async (): Promise<RetentionPurgeSummary['errorLog']> => {
    if (!(await errorLogTableExists(db))) return { skipped: 'table-absent' };
    const cutoff = errorLogRetentionCutoff(now);
    const rows = apply
      ? await purgeExpiredErrorLog(db, cutoff)
      : await countPurgeableErrorLog(db, cutoff);
    return { cutoff: cutoff.toISOString(), rows };
  };

  if (!apply) {
    // ⟨F2⟩: the preview counts come from the purge's OWN scope fragments, so a
    // dry run can never disagree with what --apply would redact.
    const { auditRows, accountRows, anonymousTrialRows, pendingRows } =
      await countPurgeableQuestionHistory(db, auditCutoff, anonCutoff);
    return {
      mode: 'dry-run',
      auditCutoff: auditCutoff.toISOString(),
      anonymousCutoff: anonCutoff.toISOString(),
      auditRows,
      accountRows,
      anonymousTrialRows,
      pendingRows,
      trial: await trialLeg(),
      errorLog: await errorLogLeg(),
      chartStyles: await chartStylesLeg(),
      datasets: await datasetsLeg(),
    };
  }

  const redacted = await purgeExpiredQuestionHistory(db, auditCutoff, anonCutoff);
  const byKind = redacted.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});
  // The audit leg has now COMMITTED. If the trial leg throws from here, the
  // caller must not be told "nothing expired" — the 2-year sweep already ran,
  // and a GDPR job that redacts rows and then reports only a failure has lost
  // the record of work it actually did. Carry the committed counts on the error
  // so both adapters can say what landed before it broke.
  let trialResult: RetentionPurgeSummary['trial'];
  try {
    trialResult = await trialLeg();
  } catch (error) {
    throw new RetentionPurgePartialError(
      `trial leg failed AFTER the audit leg committed ${redacted.length} redaction(s)`,
      redacted.length,
      error,
      auditCutoff.toISOString(),
      'trial',
      redacted.length > 0 ? byKind : undefined,
    );
  }
  // #65: same "carry what committed" rule — by here the audit leg (and the
  // trial DELETE) already landed, so an error_log failure must not be
  // reported as "nothing expired".
  let errorLogResult: RetentionPurgeSummary['errorLog'];
  try {
    errorLogResult = await errorLogLeg();
  } catch (error) {
    throw new RetentionPurgePartialError(
      `error_log leg failed AFTER the audit leg committed ${redacted.length} redaction(s) ` +
        `(the trial leg also already ran)`,
      redacted.length,
      error,
      auditCutoff.toISOString(),
      'errorLog',
      redacted.length > 0 ? byKind : undefined,
    );
  }
  // WP218 phase 2: same "carry what committed" rule as the two legs above —
  // by here the audit leg, the trial leg and the error_log leg have all
  // already run, so a chart-styles failure must not be reported as "nothing
  // expired" either.
  let chartStylesResult: RetentionPurgeSummary['chartStyles'];
  try {
    chartStylesResult = await chartStylesLeg();
  } catch (error) {
    throw new RetentionPurgePartialError(
      `chart-style leg failed AFTER the audit leg committed ${redacted.length} redaction(s) ` +
        `(the trial leg and the error_log leg also already ran)`,
      redacted.length,
      error,
      auditCutoff.toISOString(),
      'chartStyles',
      redacted.length > 0 ? byKind : undefined,
    );
  }
  // #322 I-3: same "carry what committed" rule — every earlier leg has run.
  let datasetsResult: RetentionPurgeSummary['datasets'];
  try {
    datasetsResult = await datasetsLeg();
  } catch (error) {
    throw new RetentionPurgePartialError(
      `dataset leg failed AFTER the audit leg committed ${redacted.length} redaction(s) ` +
        `(the trial, error_log and chart-style legs also already ran)`,
      redacted.length,
      error,
      auditCutoff.toISOString(),
      'datasets',
      redacted.length > 0 ? byKind : undefined,
    );
  }
  return {
    mode: 'applied',
    auditCutoff: auditCutoff.toISOString(),
    anonymousCutoff: anonCutoff.toISOString(),
    auditRows: redacted.length,
    pendingRows: null,
    ...(redacted.length > 0 ? { byKind } : {}),
    trial: trialResult,
    errorLog: errorLogResult,
    chartStyles: chartStylesResult,
    datasets: datasetsResult,
  };
}

/** Thrown when the audit leg committed and a later leg failed. Carries what
 * landed, so an operator is never told "nothing expired" about a run that
 * redacted rows. */
export class RetentionPurgePartialError extends Error {
  readonly auditRowsRedacted: number;
  /** The cutoff those redactions ran under, and what kinds they were. The old
   * progressive-print CLI had already emitted both before the trial leg ran;
   * building one summary at the end lost them on exactly the runs where the
   * GDPR record matters most (a review finding). */
  readonly auditCutoff: string;
  readonly byKind: Record<string, number> | undefined;
  /** Which leg actually failed — callers must brand their own "what ran"
   * wording off this, not off a hardcoded guess. A review caught both
   * composition roots hardcoding "the trial leg" regardless of which leg
   * threw, which self-contradicts this error's own `message` on an
   * error_log-leg failure. */
  readonly leg: 'trial' | 'errorLog' | 'chartStyles' | 'datasets';

  constructor(
    message: string,
    auditRowsRedacted: number,
    reason: unknown,
    auditCutoff: string,
    leg: 'trial' | 'errorLog' | 'chartStyles' | 'datasets',
    byKind?: Record<string, number>,
  ) {
    super(`${message}: ${reason instanceof Error ? reason.message : String(reason)}`, {
      cause: reason,
    });
    this.name = 'RetentionPurgePartialError';
    this.auditRowsRedacted = auditRowsRedacted;
    this.auditCutoff = auditCutoff;
    this.byKind = byKind;
    this.leg = leg;
  }
}

/** One-line operator summary, shared by the CLI and the cron log so the two
 * never describe the same run differently. */
export function describeRetentionPurge(s: RetentionPurgeSummary): string {
  // #181: the sweep runs TWO windows, so the operator line names both. Saying
  // "older than 2 years" over a run that also redacts 90-day-old anonymous rows
  // would be the doc-contradicts-code bug this project treats as a real defect —
  // and here the doc IS the operator's only view of what happened.
  const split =
    s.accountRows === undefined || s.anonymousTrialRows === undefined
      ? ''
      : ` [${s.accountRows} account @ 2y, ${s.anonymousTrialRows} anonymous_trial @ 90d]`;
  const head =
    s.mode === 'dry-run'
      ? `DRY RUN — account cutoff ${s.auditCutoff}, anonymous-trial cutoff ${s.anonymousCutoff}: ` +
        `${s.auditRows} audit_answers row(s)${split} and ${s.pendingRows ?? 0} ` +
        `pending_table_requests row(s) WOULD be redacted.`
      : `Applied — account cutoff ${s.auditCutoff}, anonymous-trial cutoff ${s.anonymousCutoff}: ` +
        `redacted ${s.auditRows} audit_answers row(s) (source_tag user + onboarding_delivery @ 2 years, ` +
        `anonymous_trial @ 90 days); expired ` +
        `pending_table_requests free text was redacted in the SAME transaction.`;
  const kinds = s.byKind ? `\n  by kind: ${JSON.stringify(s.byKind)}` : '';
  const trial =
    'skipped' in s.trial
      ? s.trial.skipped === 'table-absent'
        ? '\n  note: trial_questions absent (migration 020 not applied) — trial leg skipped.'
        : '\n  note: trial leg not configured for this run.'
      : `\n  trial cutoff ${s.trial.cutoff}: ${s.trial.rows} trial_questions bookkeeping row(s) ` +
        `${s.mode === 'dry-run' ? 'WOULD be' : 'were'} DELETED (ADR 036 D4).`;
  // #65: the error_log line. Table-absent is EXPECTED until migration 024's
  // supervised apply — say so, so an operator reading the daily cron log does
  // not misread the normal pre-apply state as an incident.
  const errorLog =
    'skipped' in s.errorLog
      ? '\n  note: error_log absent (migration 024 not applied yet — expected until its supervised apply); error-log leg skipped.'
      : `\n  error_log cutoff ${s.errorLog.cutoff}: ${s.errorLog.rows} error_log row(s) ` +
        `${s.mode === 'dry-run' ? 'WOULD be' : 'were'} DELETED (90-day ops-log retention, #65).`;
  // WP218 phase 2: the chart-style line. Table-absent is EXPECTED until
  // migration 028's supervised apply — same posture as error_log above, not
  // trial's (whose migration is already live) — so an operator reading the
  // daily cron log does not misread the normal pre-apply state as an incident.
  const chartStyle =
    'skipped' in s.chartStyles
      ? s.chartStyles.skipped === 'table-absent'
        ? '\n  note: user_chart_styles absent (migration 028 not applied) — chart-style leg skipped.'
        : '\n  note: chart-style leg not configured for this run.'
      : `\n  chart-style cutoff ${s.chartStyles.cutoff}: ${s.chartStyles.rows} user_chart_styles row(s) ` +
        `${s.mode === 'dry-run' ? 'WOULD be' : 'were'} DELETED (WP218 phase 2, two-year account window).`;
  // #322 I-3: the uploaded-dataset line.
  const d = s.datasets;
  const datasetLine =
    'skipped' in d
      ? d.skipped === 'table-absent'
        ? '\n  note: user_datasets absent (migration 026 not applied) — dataset leg skipped.'
        : '\n  note: dataset leg not configured for this run.'
      : s.mode === 'dry-run'
        ? `\n  datasets cutoff ${d.cellsCutoff}: ${d.datasets} uploaded dataset(s) WOULD be redacted with their ` +
          `chat turns, chart edits and publications (two-year account window, ADR 037); files cutoff ` +
          `${d.filesCutoff}: ${d.fileBytes} dataset(s) with raw file bytes older than 90 days (incl. the ` +
          `two-year ones) WOULD have them cleared.`
        : `\n  datasets cutoff ${d.cellsCutoff}: ${d.datasets} uploaded dataset(s) and ${d.turns ?? 0} chat turn(s) ` +
          `were redacted (with their chart edits and publications, ADR 037); files cutoff ${d.filesCutoff}: ` +
          `raw file bytes cleared on ${d.fileBytes} further dataset(s).`;
  return head + kinds + trial + errorLog + chartStyle + datasetLine;
}
