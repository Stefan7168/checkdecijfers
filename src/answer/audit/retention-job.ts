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

/** The trial-bookkeeping sweep (ADR 036 D4), injected. `null` means the caller
 * deliberately runs without it — never "we could not find it". */
export interface TrialRetentionLeg {
  cutoff(now: Date): Date;
  count(db: Db, cutoff: Date): Promise<number>;
  purge(db: Db, cutoff: Date): Promise<number>;
}

export interface RetentionPurgeOptions {
  db: Db;
  /** Injected clock — never `new Date()` inside, so a test can pin the cutoffs. */
  now: Date;
  /** false = report only, write nothing. The route defaults to this. */
  apply: boolean;
  trial: TrialRetentionLeg | null;
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
  const { db, now, apply, trial } = options;
  const auditCutoff = twoYearsBefore(now);
  // #181: anonymous trial CONTENT expires with its own bookkeeping at 90 days,
  // not at the account window. Derived from the SAME injected `now` as the
  // 2-year cutoff — one clock, two windows — so a run can never mix instants.
  const anonCutoff = anonymousTrialCutoff(now);

  const trialLeg = async (): Promise<RetentionPurgeSummary['trial']> => {
    if (trial === null) return { skipped: 'not-configured' };
    if (!(await trialTableExists(db))) return { skipped: 'table-absent' };
    const cutoff = trial.cutoff(now);
    const rows = apply ? await trial.purge(db, cutoff) : await trial.count(db, cutoff);
    return { cutoff: cutoff.toISOString(), rows };
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
  return {
    mode: 'applied',
    auditCutoff: auditCutoff.toISOString(),
    anonymousCutoff: anonCutoff.toISOString(),
    auditRows: redacted.length,
    pendingRows: null,
    ...(redacted.length > 0 ? { byKind } : {}),
    trial: trialResult,
    errorLog: errorLogResult,
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
  readonly leg: 'trial' | 'errorLog';

  constructor(
    message: string,
    auditRowsRedacted: number,
    reason: unknown,
    auditCutoff: string,
    leg: 'trial' | 'errorLog',
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
  return head + kinds + trial + errorLog;
}
