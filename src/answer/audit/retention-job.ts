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
import {
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
  /** Rows redacted (applied) or that WOULD be redacted (dry run). */
  auditRows: number;
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

  const trialLeg = async (): Promise<RetentionPurgeSummary['trial']> => {
    if (trial === null) return { skipped: 'not-configured' };
    if (!(await trialTableExists(db))) return { skipped: 'table-absent' };
    const cutoff = trial.cutoff(now);
    const rows = apply ? await trial.purge(db, cutoff) : await trial.count(db, cutoff);
    return { cutoff: cutoff.toISOString(), rows };
  };

  if (!apply) {
    // ⟨F2⟩: the preview counts come from the purge's OWN scope fragments, so a
    // dry run can never disagree with what --apply would redact.
    const { auditRows, pendingRows } = await countPurgeableQuestionHistory(db, auditCutoff);
    return {
      mode: 'dry-run',
      auditCutoff: auditCutoff.toISOString(),
      auditRows,
      pendingRows,
      trial: await trialLeg(),
    };
  }

  const redacted = await purgeExpiredQuestionHistory(db, auditCutoff);
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
      redacted.length > 0 ? byKind : undefined,
    );
  }
  return {
    mode: 'applied',
    auditCutoff: auditCutoff.toISOString(),
    auditRows: redacted.length,
    pendingRows: null,
    ...(redacted.length > 0 ? { byKind } : {}),
    trial: trialResult,
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

  constructor(
    message: string,
    auditRowsRedacted: number,
    reason: unknown,
    auditCutoff: string,
    byKind?: Record<string, number>,
  ) {
    super(`${message}: ${reason instanceof Error ? reason.message : String(reason)}`, {
      cause: reason,
    });
    this.name = 'RetentionPurgePartialError';
    this.auditRowsRedacted = auditRowsRedacted;
    this.auditCutoff = auditCutoff;
    this.byKind = byKind;
  }
}

/** One-line operator summary, shared by the CLI and the cron log so the two
 * never describe the same run differently. */
export function describeRetentionPurge(s: RetentionPurgeSummary): string {
  const head =
    s.mode === 'dry-run'
      ? `DRY RUN — audit cutoff ${s.auditCutoff}: ${s.auditRows} audit_answers row(s) ` +
        `(source_tag user + onboarding_delivery + anonymous_trial) and ${s.pendingRows ?? 0} ` +
        `pending_table_requests row(s) older than 2 years WOULD be redacted.`
      : `Applied — audit cutoff ${s.auditCutoff}: redacted ${s.auditRows} audit_answers row(s) ` +
        `(source_tag user + onboarding_delivery + anonymous_trial); expired ` +
        `pending_table_requests free text was redacted in the SAME transaction.`;
  const kinds = s.byKind ? `\n  by kind: ${JSON.stringify(s.byKind)}` : '';
  const trial =
    'skipped' in s.trial
      ? s.trial.skipped === 'table-absent'
        ? '\n  note: trial_questions absent (migration 020 not applied) — trial leg skipped.'
        : '\n  note: trial leg not configured for this run.'
      : `\n  trial cutoff ${s.trial.cutoff}: ${s.trial.rows} trial_questions bookkeeping row(s) ` +
        `${s.mode === 'dry-run' ? 'WOULD be' : 'were'} DELETED (ADR 036 D4).`;
  return head + kinds + trial;
}
