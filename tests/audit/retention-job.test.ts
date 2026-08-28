// #189: the retention purge as a shared JOB.
//
// Precisely what was uncovered, since an earlier draft of this comment
// overstated it: the purge FUNCTIONS have had thorough coverage for a long time
// (tests/audit/retention.test.ts, retention-onboarding.test.ts's F2
// preview-equals-apply pin, tests/billing/trial-pot.test.ts for both trial
// legs). What had none was the ORCHESTRATION — which legs run, in what order,
// under dry-run vs apply — because it lived only in scripts/gdpr-purge.ts and
// scripts/ has no harness. That is the gap this file closes, and it is the gap
// that let "nothing ever runs this" go unnoticed.
//
// These pins are the ones that matter for a job about to run UNATTENDED on a
// cron: that a dry run writes nothing, that apply actually applies, that the
// trial leg is skipped only for a genuinely absent table, and — the important
// one — that a FAILING trial read propagates instead of being reported as an
// honest skip.
import { describe, expect, it } from 'vitest';
import {
  describeRetentionPurge,
  RetentionPurgePartialError,
  runRetentionPurge,
  type TrialRetentionLeg,
} from '../../src/answer/audit/retention-job.ts';
import { REDACTED_QUESTION_TEXT } from '../../src/answer/audit/retention.ts';
import {
  countPurgeableTrialBookkeeping,
  purgeExpiredTrialBookkeeping,
  setTrialPot,
  takeTrialQuestion,
  trialRetentionCutoff,
} from '../../src/billing/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

/** The same injection both composition roots use (the CLI and the cron route). */
const TRIAL_LEG: TrialRetentionLeg = {
  cutoff: trialRetentionCutoff,
  count: countPurgeableTrialBookkeeping,
  purge: purgeExpiredTrialBookkeeping,
};

const NOW = new Date('2026-07-25T12:00:00.000Z');
const VISITOR = '11111111-1111-4111-8111-111111111111';
const REQ = '00000000-0000-4000-8000-000000000001';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

/** An expired audit row + an expired trial bookkeeping row, both older than
 * their own window relative to NOW. */
async function seedExpired(db: Db): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, kind, source_tag, question, reference_date, response,
        final_text, prompt_versions, latency_ms, created_at)
     values (1, 'answer', 'user', 'Wat was de inflatie?', '2023-01-01', '{}'::jsonb,
             'Het antwoord.', '{}'::jsonb, 0, $1)
     returning id`,
    [new Date('2023-01-01T00:00:00.000Z').toISOString()],
  );
  await setTrialPot(db, 25);
  const take = await takeTrialQuestion(db, VISITOR, 'ip-hash', REQ);
  expect(take.kind).toBe('taken');
  // Age the bookkeeping row past its 90-day window.
  await db.query(`update trial_questions set created_at = $1`, [
    new Date('2026-01-01T00:00:00.000Z').toISOString(),
  ]);
  return Number(rows[0]!.id);
}

describe('#189 runRetentionPurge — the shared job behind the CLI and the cron', () => {
  it('a dry run REPORTS both legs and writes absolutely nothing', async () => {
    await withDb(async (db) => {
      const auditId = await seedExpired(db);

      const summary = await runRetentionPurge({ db, now: NOW, apply: false, trial: TRIAL_LEG });

      expect(summary.mode).toBe('dry-run');
      expect(summary.auditRows).toBe(1);
      expect(summary.trial).toEqual({
        cutoff: trialRetentionCutoff(NOW).toISOString(),
        rows: 1,
      });

      // The point of a dry run: nothing moved.
      const audit = await db.query('select question from audit_answers where id = $1', [auditId]);
      expect(audit.rows[0]!.question).toBe('Wat was de inflatie?');
      const trial = await db.query('select count(*)::int as n from trial_questions', []);
      expect(Number(trial.rows[0]!.n)).toBe(1);
    });
  });

  it('apply redacts the audit row and DELETES the trial bookkeeping row', async () => {
    await withDb(async (db) => {
      const auditId = await seedExpired(db);

      const summary = await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG });

      expect(summary.mode).toBe('applied');
      expect(summary.auditRows).toBe(1);
      expect(summary.trial).toMatchObject({ rows: 1 });
      // Not a number we measured — null says "covered in the same transaction",
      // where 0 would say "nothing was covered".
      expect(summary.pendingRows).toBeNull();

      const audit = await db.query('select question from audit_answers where id = $1', [auditId]);
      expect(audit.rows[0]!.question).toBe(REDACTED_QUESTION_TEXT);
      const trial = await db.query('select count(*)::int as n from trial_questions', []);
      expect(Number(trial.rows[0]!.n)).toBe(0);
    });
  });

  it('is idempotent for a fixed clock — a second apply finds nothing new', async () => {
    await withDb(async (db) => {
      await seedExpired(db);
      await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG });
      const second = await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG });
      expect(second.trial).toMatchObject({ rows: 0 });
    });
  });

  it('leaves rows INSIDE their window alone', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into audit_answers
           (schema_version, kind, source_tag, question, reference_date, response,
            final_text, prompt_versions, latency_ms, created_at)
         values (1, 'answer', 'user', 'Recent.', '2026-07-01', '{}'::jsonb, 'x',
                 '{}'::jsonb, 0, $1)`,
        [new Date('2026-07-01T00:00:00.000Z').toISOString()],
      );
      const summary = await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG });
      expect(summary.auditRows).toBe(0);
    });
  });

  // THE pin that matters for an unattended cron. Until earlier today the script
  // wrapped this in a bare `catch {}` that blamed "migration 020 not applied",
  // so a lock timeout, a permissions problem or a connection blip was reported
  // as an honest skip while the run still succeeded (fixed in PR #67, the same
  // night as this). This test PRESERVES that fix through the refactor rather
  // than introducing it — which is the point: a retention mechanism that reports
  // success when it did nothing is worse than one that is absent, and a
  // re-homing is exactly where such a guarantee gets dropped by accident.
  it('PROPAGATES a failing trial read instead of reporting an honest skip', async () => {
    await withDb(async (db) => {
      const exploding: TrialRetentionLeg = {
        cutoff: trialRetentionCutoff,
        count: () => Promise.reject(new Error('lock timeout')),
        purge: () => Promise.reject(new Error('lock timeout')),
      };
      await expect(
        runRetentionPurge({ db, now: NOW, apply: false, trial: exploding }),
      ).rejects.toThrow('lock timeout');
    });
  });

  // The APPLY-mode partial path, with the REAL error class. Both composition
  // roots' "what landed" messaging depends on it, and it was previously only
  // exercised via a fake class in the route's module mock — so a narrowed try
  // or a reordered constructor would have left both suites green while
  // production partial failures fell into the generic-failure branch, whose
  // wording says nothing is expiring about a run that redacted rows.
  it('throws RetentionPurgePartialError carrying what COMMITTED before the trial leg failed', async () => {
    await withDb(async (db) => {
      await seedExpired(db);
      const exploding: TrialRetentionLeg = {
        cutoff: trialRetentionCutoff,
        count: () => Promise.reject(new Error('lock timeout')),
        purge: () => Promise.reject(new Error('lock timeout')),
      };
      const err = await runRetentionPurge({ db, now: NOW, apply: true, trial: exploding }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(RetentionPurgePartialError);
      const partial = err as RetentionPurgePartialError;
      expect(partial.leg).toBe('trial');
      expect(partial.auditRowsRedacted).toBe(1);
      expect(partial.auditCutoff).toBe(new Date('2024-07-25T12:00:00.000Z').toISOString());
      expect(partial.byKind).toEqual({ answer: 1 });
      expect(partial.message).toContain('lock timeout');
      // The audit leg really did commit — that is the whole point of reporting it.
      const audit = await db.query('select question from audit_answers limit 1', []);
      expect(audit.rows[0]!.question).toBe(REDACTED_QUESTION_TEXT);
    });
  });

  // The symmetric case to the trial-leg test above (a review finding): the
  // error_log leg can ALSO throw after the audit leg commits, and its own
  // `leg` tag is what both composition roots now depend on to say which leg
  // failed — a hardcoded guess there previously self-contradicted this same
  // error's `message` on exactly this path.
  it('throws RetentionPurgePartialError tagged leg:errorLog when the error_log leg fails after commit', async () => {
    await withDb(async (db) => {
      await seedExpired(db);
      // errorLogTableExists checks to_regclass, which still finds the table
      // once its expected column is gone — the read itself then throws, the
      // same "check-not-catch" shape as the trial leg's exploding mock above.
      await db.query('alter table error_log rename column occurred_at to renamed_away', []);
      const err = await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(RetentionPurgePartialError);
      const partial = err as RetentionPurgePartialError;
      expect(partial.leg).toBe('errorLog');
      expect(partial.auditRowsRedacted).toBe(1);
      expect(partial.message).toContain('error_log leg failed');
      expect(partial.message).toContain('the trial leg also already ran');
      // The audit leg really did commit, same guarantee as the trial-leg case.
      const audit = await db.query('select question from audit_answers limit 1', []);
      expect(audit.rows[0]!.question).toBe(REDACTED_QUESTION_TEXT);
    });
  });

  it('reports table-absent ONLY when the table is genuinely gone', async () => {
    await withDb(async (db) => {
      await db.query('drop table if exists trial_questions cascade', []);
      const summary = await runRetentionPurge({ db, now: NOW, apply: false, trial: TRIAL_LEG });
      expect(summary.trial).toEqual({ skipped: 'table-absent' });
    });
  });

  it('describeRetentionPurge says WOULD for a dry run and never invents a trial line', async () => {
    await withDb(async (db) => {
      await seedExpired(db);
      const dry = describeRetentionPurge(
        await runRetentionPurge({ db, now: NOW, apply: false, trial: TRIAL_LEG }),
      );
      expect(dry).toContain('DRY RUN');
      expect(dry).toContain('WOULD be');
      const none = describeRetentionPurge(
        await runRetentionPurge({ db, now: NOW, apply: false, trial: null }),
      );
      expect(none).toContain('trial leg not configured');
    });
  });

  // #65 / WP25: the error_log housekeeping leg — same job, third clock.
  describe('the error_log leg (#65): 90-day DELETE, table-absent honest skip', () => {
    async function seedErrorLogRow(db: Db, occurredAt: string, message: string): Promise<void> {
      await db.query(
        `insert into error_log (source, message, occurred_at) values ('askQuestion', $1, $2)`,
        [message, occurredAt],
      );
    }

    it('dry run counts expired rows and deletes nothing; apply DELETEs exactly those', async () => {
      await withDb(async (db) => {
        // 91 days before NOW: expired. 1 day before NOW: must survive.
        await seedErrorLogRow(db, '2026-04-25T00:00:00.000Z', 'old failure');
        await seedErrorLogRow(db, '2026-07-24T00:00:00.000Z', 'recent failure');

        const dry = await runRetentionPurge({ db, now: NOW, apply: false, trial: TRIAL_LEG });
        expect(dry.errorLog).toMatchObject({ rows: 1 });
        expect(Number((await db.query('select count(*)::int as n from error_log', [])).rows[0]!.n)).toBe(2);

        const applied = await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG });
        // ⟨F2⟩: apply deleted what the dry run promised.
        expect(applied.errorLog).toEqual(dry.errorLog);
        const left = await db.query('select message from error_log', []);
        expect(left.rows).toHaveLength(1);
        expect(left.rows[0]!.message).toBe('recent failure');

        // Idempotent for a fixed clock.
        const second = await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG });
        expect(second.errorLog).toMatchObject({ rows: 0 });
      });
    });

    it('reports table-absent when migration 024 is not applied — the EXPECTED pre-apply state, never a throw', async () => {
      await withDb(async (db) => {
        // Production today: the cron runs daily against a database where
        // migration 024 has not had its supervised apply yet. The job must
        // skip honestly and keep running the GDPR legs.
        await db.query('drop table if exists error_log cascade', []);
        const summary = await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG });
        expect(summary.errorLog).toEqual({ skipped: 'table-absent' });
        const line = describeRetentionPurge(summary);
        expect(line).toContain('migration 024 not applied yet');
        expect(line).toContain('expected until its supervised apply');
      });
    });

    it('the operator line names the error_log leg on a real run', async () => {
      await withDb(async (db) => {
        await seedErrorLogRow(db, '2026-04-25T00:00:00.000Z', 'old failure');
        const line = describeRetentionPurge(
          await runRetentionPurge({ db, now: NOW, apply: false, trial: TRIAL_LEG }),
        );
        expect(line).toContain('1 error_log row(s) WOULD be DELETED');
        expect(line).toContain('90-day ops-log retention');
      });
    });
  });

  // #181: for an unattended cron run this line is the ONLY view an operator ever
  // gets of what happened. Two windows now run in one sweep, 21 months apart, so
  // a line that names one of them — or reports a bare total — is the
  // doc-contradicts-code bug this project treats as a real defect, in the one
  // place where the doc IS the interface.
  describe('the operator line reports BOTH windows (#181)', () => {
    async function seedAnonymous(db: Db, question: string, createdAt: string): Promise<void> {
      await db.query(
        `insert into audit_answers
           (schema_version, kind, source_tag, question, reference_date, response,
            final_text, prompt_versions, latency_ms, created_at)
         values (1, 'answer', 'anonymous_trial', $1, '2026-01-01', '{}'::jsonb,
                 'Het antwoord.', '{}'::jsonb, 0, $2)`,
        [question, createdAt],
      );
    }

    it('names both cutoffs and splits the dry-run count by window', async () => {
      await withDb(async (db) => {
        await seedExpired(db); // one 2023 ACCOUNT row
        // 91 days before NOW: past the anonymous window, far inside the account one.
        await seedAnonymous(db, 'Wat is de inflatie?', '2026-04-24T00:00:00.000Z');
        const summary = await runRetentionPurge({ db, now: NOW, apply: false, trial: TRIAL_LEG });
        expect(summary.accountRows).toBe(1);
        expect(summary.anonymousTrialRows).toBe(1);
        expect(summary.auditRows).toBe(2);
        // The two cutoffs are genuinely different instants, not the same date twice.
        expect(summary.anonymousCutoff).not.toBe(summary.auditCutoff);
        const line = describeRetentionPurge(summary);
        expect(line).toContain(summary.auditCutoff);
        expect(line).toContain(summary.anonymousCutoff);
        expect(line).toContain('1 account @ 2y');
        expect(line).toContain('1 anonymous_trial @ 90d');
        // The pre-#181 line said this over a sweep that now also runs 90 days.
        expect(line).not.toContain('older than 2 years');
      });
    });

    it('the applied line names both windows too', async () => {
      await withDb(async (db) => {
        await seedExpired(db);
        await seedAnonymous(db, 'Wat is de inflatie?', '2026-04-24T00:00:00.000Z');
        const summary = await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG });
        expect(summary.auditRows).toBe(2);
        const line = describeRetentionPurge(summary);
        expect(line).toContain('anonymous_trial @ 90 days');
        expect(line).toContain(summary.anonymousCutoff);
      });
    });

    // ⟨F2⟩ across the NEW split: what a dry run promises is what an apply does.
    // Named for what it actually proves, after a review pointed out the earlier
    // name overstated it: both paths derive their cutoffs from the SAME
    // anonymousTrialCutoff(now) call, so this can only catch the two paths
    // DISAGREEING — it is blind to a bug that shifts both consistently (a wrong
    // constant, say). The absolute counts are pinned by its sibling above.
    it('dry-run and apply agree with each other (F2), though neither pins the constant', async () => {
      await withDb(async (db) => {
        await seedExpired(db);
        await seedAnonymous(db, 'Wat is de inflatie?', '2026-04-24T00:00:00.000Z');
        await seedAnonymous(db, 'En het bbp?', '2026-07-24T00:00:00.000Z'); // 1 day old, survives
        const dry = await runRetentionPurge({ db, now: NOW, apply: false, trial: TRIAL_LEG });
        const applied = await runRetentionPurge({ db, now: NOW, apply: true, trial: TRIAL_LEG });
        expect(applied.auditRows).toBe(dry.auditRows);
        expect((dry.accountRows ?? 0) + (dry.anonymousTrialRows ?? 0)).toBe(applied.auditRows);
      });
    });
  });
});
