// WP-A (docs/superpowers/plans/2026-09-12-journey-programme.md): hermetic
// pins for src/usage/report.ts. Pure PGlite + real migrations, the
// tests/audit + tests/billing pattern (createTestDb, no live database, no
// LLM calls). THE CRITICAL PIN in this file is the privacy guarantee: the
// aggregated report's JSON output must never contain an '@', question text,
// or a raw user/visitor id.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildUsageReport,
  feedbackReport,
  firstVsLaterOutcomesReport,
  onDemandFetchesReport,
  signupsReport,
  topRefusalReasonsReport,
  trialReport,
  usersActiveMultipleDaysReport,
  usersWithQuestionsReport,
  usersZeroBalanceNeverPurchasedReport,
} from '../../src/usage/report.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

const EMAIL_LIKE = 'stefanpeek00@gmail.com'; // never actually stored; used only to assert absence patterns

async function insertAudit(
  db: Db,
  opts: {
    userId: string | null;
    kind: 'answer' | 'clarification' | 'refusal';
    refusalReason?: string | null;
    sourceTag?: string;
    createdAt: string;
    question?: string;
  },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, refusal_reason, reference_date, response, final_text, prompt_versions, latency_ms, created_at)
     values (1, $1, $2, $3, $4, $5, '2026-01-01', '{}'::jsonb, $4, '{}'::jsonb, 100, $6::timestamptz)
     returning id`,
    [
      opts.userId,
      opts.sourceTag ?? 'user',
      opts.kind,
      opts.question ?? 'a real question about something real',
      opts.refusalReason ?? null,
      opts.createdAt,
    ],
  );
  return Number(rows[0]!.id);
}

async function insertLedger(
  db: Db,
  opts: {
    userId: string;
    delta: number;
    reason: 'signup_grant' | 'purchase' | 'question_cost' | 'compensation' | 'onboarding_cost';
    requestId?: string | null;
    stripeSessionId?: string | null;
    relatedId?: number | null;
    createdAt?: string;
  },
): Promise<number> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, stripe_checkout_session_id, related_transaction_id, note, created_at)
     values ($1, $2, $3, $4, $5, $6, 'test', coalesce($7::timestamptz, now()))
     returning id`,
    [
      opts.userId,
      opts.delta,
      opts.reason,
      opts.requestId ?? null,
      opts.stripeSessionId ?? null,
      opts.relatedId ?? null,
      opts.createdAt ?? null,
    ],
  );
  return Number(rows[0]!.id);
}

async function insertPendingRequest(
  db: Db,
  opts: { userId: string; status: string; debitTransactionId: number; createdAt: string },
): Promise<void> {
  await db.query(
    `insert into pending_table_requests
       (user_id, request_id, question_text, topic_term, table_id, finder_confidence, status, debit_transaction_id, created_at)
     values ($1, $2, 'question text here', 'topic', '85004NED', 0.9, $3, $4, $5::timestamptz)`,
    [opts.userId, randomUUID(), opts.status, opts.debitTransactionId, opts.createdAt],
  );
}

async function insertTrialQuestion(db: Db, createdAt: string): Promise<void> {
  await db.query(
    `insert into trial_questions (visitor_id, ip_hash, request_id, created_at)
     values ($1, 'hash', $2, $3::timestamptz)`,
    [randomUUID(), randomUUID(), createdAt],
  );
}

async function insertFeedback(
  db: Db,
  opts: { auditAnswerId: number; userId: string; verdict: 'up' | 'down'; createdAt: string },
): Promise<void> {
  await db.query(
    `insert into answer_feedback (audit_answer_id, user_id, verdict, created_at)
     values ($1, $2, $3, $4::timestamptz)`,
    [opts.auditAnswerId, opts.userId, opts.verdict, opts.createdAt],
  );
}

const NOW = new Date('2026-09-12T00:00:00.000Z');
const RECENT = '2026-09-10T00:00:00.000Z'; // within the last 12 ISO weeks of NOW
const OLD = '2020-01-01T00:00:00.000Z'; // well outside the 12-week window, still all-time

describe('signupsReport', () => {
  it('counts signup_grant transactions, weekly and all-time', async () => {
    await withDb(async (db) => {
      const u1 = randomUUID();
      const u2 = randomUUID();
      await insertLedger(db, { userId: u1, delta: 100, reason: 'signup_grant', createdAt: RECENT });
      await insertLedger(db, { userId: u2, delta: 100, reason: 'signup_grant', createdAt: OLD });
      // A purchase must never be counted as a signup.
      await insertLedger(db, {
        userId: u1,
        delta: 500,
        reason: 'purchase',
        stripeSessionId: 'cs_test_1',
        createdAt: RECENT,
      });

      const report = await signupsReport(db, NOW);
      expect(report.allTime).toBe(2);
      expect(report.weekly.reduce((sum, w) => sum + w.count, 0)).toBe(1);
    });
  });
});

describe('usersWithQuestionsReport', () => {
  it('counts distinct real users with a question, excluding benchmark/validation rows', async () => {
    await withDb(async (db) => {
      const u1 = randomUUID();
      const u2 = randomUUID();
      await insertAudit(db, { userId: u1, kind: 'answer', createdAt: RECENT });
      await insertAudit(db, { userId: u1, kind: 'answer', createdAt: RECENT }); // same user, 2nd question
      await insertAudit(db, { userId: u2, kind: 'refusal', createdAt: OLD });
      await insertAudit(db, { userId: null, kind: 'answer', sourceTag: 'benchmark', createdAt: RECENT });

      const report = await usersWithQuestionsReport(db, NOW);
      expect(report.allTime).toBe(2);
      expect(report.weekly.reduce((sum, w) => sum + w.count, 0)).toBe(1);
    });
  });
});

describe('firstVsLaterOutcomesReport', () => {
  it('splits each user\'s first question from their later ones', async () => {
    await withDb(async (db) => {
      const u1 = randomUUID();
      await insertAudit(db, {
        userId: u1,
        kind: 'refusal',
        refusalReason: 'no_data',
        createdAt: '2026-09-01T00:00:00.000Z',
      });
      await insertAudit(db, { userId: u1, kind: 'answer', createdAt: '2026-09-02T00:00:00.000Z' });
      await insertAudit(db, { userId: u1, kind: 'answer', createdAt: '2026-09-03T00:00:00.000Z' });

      const { first, later } = await firstVsLaterOutcomesReport(db);
      expect(first).toEqual([{ kind: 'refusal', refusalReason: 'no_data', count: 1 }]);
      expect(later).toEqual([{ kind: 'answer', refusalReason: null, count: 2 }]);
    });
  });
});

describe('topRefusalReasonsReport', () => {
  it('ranks refusal reasons by count, descending', async () => {
    await withDb(async (db) => {
      const u1 = randomUUID();
      for (let i = 0; i < 3; i++) {
        await insertAudit(db, {
          userId: u1,
          kind: 'refusal',
          refusalReason: 'no_data',
          createdAt: `2026-09-0${i + 1}T00:00:00.000Z`,
        });
      }
      await insertAudit(db, {
        userId: u1,
        kind: 'refusal',
        refusalReason: 'stale',
        createdAt: '2026-09-04T00:00:00.000Z',
      });

      const top = await topRefusalReasonsReport(db);
      expect(top[0]).toEqual({ refusalReason: 'no_data', count: 3 });
      expect(top[1]).toEqual({ refusalReason: 'stale', count: 1 });
    });
  });
});

describe('onDemandFetchesReport', () => {
  it('counts pending_table_requests by outcome and sums the onboarding credit cost', async () => {
    await withDb(async (db) => {
      const u1 = randomUUID();
      const debit1 = await insertLedger(db, {
        userId: u1,
        delta: -100,
        reason: 'onboarding_cost',
        requestId: randomUUID(),
        createdAt: RECENT,
      });
      const debit2 = await insertLedger(db, {
        userId: u1,
        delta: -100,
        reason: 'onboarding_cost',
        requestId: randomUUID(),
        createdAt: RECENT,
      });
      const debit3 = await insertLedger(db, {
        userId: u1,
        delta: -100,
        reason: 'onboarding_cost',
        requestId: randomUUID(),
        createdAt: RECENT,
      });
      await insertPendingRequest(db, { userId: u1, status: 'delivered', debitTransactionId: debit1, createdAt: RECENT });
      await insertPendingRequest(db, { userId: u1, status: 'failed', debitTransactionId: debit2, createdAt: RECENT });
      await insertPendingRequest(db, { userId: u1, status: 'pending', debitTransactionId: debit3, createdAt: RECENT });

      const report = await onDemandFetchesReport(db);
      expect(report.started).toBe(3);
      expect(report.delivered).toBe(1);
      expect(report.failed).toBe(1);
      expect(report.pendingOrRunning).toBe(1);
      expect(report.creditsSpent).toBe(300);
    });
  });
});

describe('trialReport', () => {
  it('counts trial questions and marks visitor-signup conversion as not measurable', async () => {
    await withDb(async (db) => {
      await insertTrialQuestion(db, RECENT);
      await insertTrialQuestion(db, OLD);

      const report = await trialReport(db, NOW);
      expect(report.questions.allTime).toBe(2);
      expect(report.visitorsWhoSignedUp).toBe('not measurable');
      expect(report.notMeasurableReason.length).toBeGreaterThan(0);
    });
  });
});

describe('feedbackReport', () => {
  it('counts up/down feedback separately', async () => {
    await withDb(async (db) => {
      const u1 = randomUUID();
      const a1 = await insertAudit(db, { userId: u1, kind: 'answer', createdAt: RECENT });
      const a2 = await insertAudit(db, { userId: u1, kind: 'answer', createdAt: RECENT });
      await insertFeedback(db, { auditAnswerId: a1, userId: u1, verdict: 'up', createdAt: RECENT });
      await insertFeedback(db, { auditAnswerId: a2, userId: u1, verdict: 'down', createdAt: RECENT });

      const report = await feedbackReport(db, NOW);
      expect(report.up.allTime).toBe(1);
      expect(report.down.allTime).toBe(1);
    });
  });
});

describe('usersActiveMultipleDaysReport', () => {
  it('counts users with real questions on 2+ distinct calendar days', async () => {
    await withDb(async (db) => {
      const u1 = randomUUID();
      const u2 = randomUUID();
      await insertAudit(db, { userId: u1, kind: 'answer', createdAt: '2026-09-01T00:00:00.000Z' });
      await insertAudit(db, { userId: u1, kind: 'answer', createdAt: '2026-09-02T00:00:00.000Z' });
      await insertAudit(db, { userId: u2, kind: 'answer', createdAt: '2026-09-01T00:00:00.000Z' });
      await insertAudit(db, { userId: u2, kind: 'answer', createdAt: '2026-09-01T12:00:00.000Z' });

      expect(await usersActiveMultipleDaysReport(db)).toBe(1);
    });
  });
});

describe('usersZeroBalanceNeverPurchasedReport', () => {
  it('counts users at <=0 balance who never bought a pack', async () => {
    await withDb(async (db) => {
      const spentAll = randomUUID();
      const purchased = randomUUID();
      const stillHasCredits = randomUUID();
      await insertLedger(db, { userId: spentAll, delta: 100, reason: 'signup_grant', createdAt: OLD });
      await insertLedger(db, {
        userId: spentAll,
        delta: -100,
        reason: 'question_cost',
        requestId: randomUUID(),
        createdAt: RECENT,
      });
      await insertLedger(db, { userId: purchased, delta: 100, reason: 'signup_grant', createdAt: OLD });
      await insertLedger(db, {
        userId: purchased,
        delta: -100,
        reason: 'question_cost',
        requestId: randomUUID(),
        createdAt: RECENT,
      });
      await insertLedger(db, {
        userId: purchased,
        delta: 500,
        reason: 'purchase',
        stripeSessionId: 'cs_test_2',
        createdAt: RECENT,
      });
      await insertLedger(db, { userId: stillHasCredits, delta: 100, reason: 'signup_grant', createdAt: OLD });

      expect(await usersZeroBalanceNeverPurchasedReport(db)).toBe(1);
    });
  });
});

describe('buildUsageReport privacy guarantee', () => {
  it('never emits an e-mail, question text, or a raw user/visitor id', async () => {
    await withDb(async (db) => {
      const u1 = randomUUID();
      await insertLedger(db, { userId: u1, delta: 100, reason: 'signup_grant', createdAt: RECENT });
      const a1 = await insertAudit(db, {
        userId: u1,
        kind: 'answer',
        createdAt: RECENT,
        question: 'how many people live in Amsterdam',
      });
      await insertAudit(db, {
        userId: u1,
        kind: 'refusal',
        refusalReason: 'no_data',
        createdAt: RECENT,
        question: 'a very specific personal question',
      });
      await insertFeedback(db, { auditAnswerId: a1, userId: u1, verdict: 'up', createdAt: RECENT });
      const debit = await insertLedger(db, {
        userId: u1,
        delta: -100,
        reason: 'onboarding_cost',
        requestId: randomUUID(),
        createdAt: RECENT,
      });
      await insertPendingRequest(db, { userId: u1, status: 'delivered', debitTransactionId: debit, createdAt: RECENT });
      await insertTrialQuestion(db, RECENT);

      const report = await buildUsageReport(db, NOW);
      const json = JSON.stringify(report);

      expect(json).not.toContain('@');
      expect(json).not.toContain(EMAIL_LIKE);
      expect(json).not.toContain(u1);
      expect(json.toLowerCase()).not.toContain('amsterdam');
      expect(json.toLowerCase()).not.toContain('personal question');
      expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    });
  });
});
