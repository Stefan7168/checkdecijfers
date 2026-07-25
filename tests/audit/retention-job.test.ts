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
});
