// #120 (GDPR retention covers on-demand-onboarding data): the retention seam
// now redacts (a) audit_answers rows tagged source_tag='onboarding_delivery'
// (the delivery answer, carrying the verbatim question + intent + answer) and
// (b) the free-text columns of pending_table_requests (question_text/
// topic_term/failure_summary — migration 012's re-entry copy of the question),
// in BOTH the self-service and the 2-year-purge paths, inside the SAME
// transaction as the existing audit-row redaction.
//
// These pins mirror tests/audit/retention.test.ts + tests/audit/feedback.test.ts
// idioms exactly (hermetic PGlite, real migrations, no LLM). The load-bearing
// pins here: the cross-user scope on the NEW pending leg (⟨F2⟩/#14 discipline),
// preview===apply equivalence (⟨F2⟩), the UNguarded pending leg surviving a
// missing answer_feedback table (⟨F3⟩), and cutoff strictness (< not <=).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  REDACTED_QUESTION_TEXT,
  countPurgeableQuestionHistory,
  deleteUserQuestionHistory,
  purgeExpiredQuestionHistory,
  twoYearsBefore,
} from '../../src/answer/audit/retention.ts';
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

type SourceTag = 'user' | 'benchmark' | 'validation' | 'onboarding_delivery';

/** Minimal audit_answers row — same narrow builder shape as
 * tests/audit/retention.test.ts, extended with the 'onboarding_delivery' tag. */
async function insertAuditRow(
  db: Db,
  userId: string,
  opts: { question: string; sourceTag?: SourceTag; createdAt?: string },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, created_at)
     values (1, $1, $2, 'answer', $3, '2026-01-01', $4::jsonb, $3, '{}'::jsonb, 100, coalesce($5::timestamptz, now()))
     returning id`,
    [
      userId,
      opts.sourceTag ?? 'user',
      opts.question,
      JSON.stringify({ kind: 'answer', question: opts.question, text: opts.question }),
      opts.createdAt ?? null,
    ],
  );
  return Number(rows[0]!.id);
}

/** A pending_table_requests row needs its funding debit first (the NOT-NULL FK
 * to credit_transactions) — mirrors tests/db/migration-012.test.ts's helper. */
async function insertOnboardingDebit(db: Db, userId: string, requestId: string): Promise<number> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, note)
     values ($1, -100, 'onboarding_cost', $2, 'test debit')
     returning id`,
    [userId, requestId],
  );
  return Number(rows[0]!.id);
}

async function insertPendingRow(
  db: Db,
  opts: {
    userId: string;
    tableId: string;
    questionText?: string;
    topicTerm?: string;
    failureSummary?: string | null;
    status?: 'pending' | 'running' | 'delivered' | 'failed' | 'unanswerable';
    createdAt?: string;
  },
): Promise<number> {
  const requestId = randomUUID();
  const debitId = await insertOnboardingDebit(db, opts.userId, requestId);
  const { rows } = await db.query(
    `insert into pending_table_requests
       (user_id, request_id, question_text, topic_term, table_id, finder_confidence,
        debit_transaction_id, status, failure_summary, created_at)
     values ($1, $2, $3, $4, $5, 0.9, $6, $7, $8, coalesce($9::timestamptz, now()))
     returning id`,
    [
      opts.userId,
      requestId,
      opts.questionText ?? 'hoeveel inwoners heeft nederland',
      opts.topicTerm ?? 'inwoners',
      opts.tableId,
      debitId,
      opts.status ?? 'pending',
      opts.failureSummary === undefined ? null : opts.failureSummary,
      opts.createdAt ?? null,
    ],
  );
  return Number(rows[0]!.id);
}

async function loadPending(db: Db, id: number) {
  const { rows } = await db.query(
    `select id, user_id, table_id, status, question_text, topic_term, failure_summary
     from pending_table_requests where id = $1`,
    [id],
  );
  return rows[0] as {
    id: number;
    user_id: string;
    table_id: string;
    status: string;
    question_text: string;
    topic_term: string;
    failure_summary: string | null;
  };
}

async function loadAuditQuestion(db: Db, id: number): Promise<string> {
  const { rows } = await db.query('select question from audit_answers where id = $1', [id]);
  return rows[0]!.question as string;
}

const NOW = new Date('2026-07-05T00:00:00Z');

describe('#120 pending_table_requests leg — THE CRITICAL CROSS-USER PIN', () => {
  it('deleteUserQuestionHistory redacts the caller’s pending rows; another user’s rows survive byte-for-byte', async () => {
    await withDb(async (db) => {
      const userA = randomUUID();
      const userB = randomUUID();
      const mine = await insertPendingRow(db, {
        userId: userA,
        tableId: '11111NED',
        questionText: 'mijn onboarding vraag',
        topicTerm: 'mijnterm',
        failureSummary: 'mijn samenvatting',
      });
      const theirs = await insertPendingRow(db, {
        userId: userB,
        tableId: '22222NED',
        questionText: 'hun onboarding vraag',
        topicTerm: 'hunterm',
        failureSummary: 'hun samenvatting',
      });

      await deleteUserQuestionHistory(db, userA);

      const mineRow = await loadPending(db, mine);
      expect(mineRow.question_text).toBe(REDACTED_QUESTION_TEXT);
      expect(mineRow.topic_term).toBe(REDACTED_QUESTION_TEXT);
      expect(mineRow.failure_summary).toBe(REDACTED_QUESTION_TEXT);

      // Byte-for-byte untouched — not just "still present": exactly the inserted
      // free text, and the same owning user.
      const theirsRow = await loadPending(db, theirs);
      expect(theirsRow.question_text).toBe('hun onboarding vraag');
      expect(theirsRow.topic_term).toBe('hunterm');
      expect(theirsRow.failure_summary).toBe('hun samenvatting');
      expect(theirsRow.user_id).toBe(userB);
    });
  });

  it('a null failure_summary stays null after redaction (the case-when branch, never the sentinel)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const id = await insertPendingRow(db, {
        userId,
        tableId: '33333NED',
        questionText: 'vraag zonder samenvatting',
        failureSummary: null,
      });

      await deleteUserQuestionHistory(db, userId);

      const row = await loadPending(db, id);
      expect(row.question_text).toBe(REDACTED_QUESTION_TEXT);
      expect(row.failure_summary).toBeNull();
    });
  });

  it('redacts pending rows of EVERY status, including in-flight running/pending (a GDPR erasure is not a job-state change)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const ids: number[] = [];
      let n = 0;
      for (const status of ['pending', 'running', 'delivered', 'failed', 'unanswerable'] as const) {
        ids.push(
          await insertPendingRow(db, {
            userId,
            tableId: `4444${n++}NED`,
            questionText: `vraag ${status}`,
            topicTerm: `term ${status}`,
            status,
          }),
        );
      }

      await deleteUserQuestionHistory(db, userId);

      for (const id of ids) {
        const row = await loadPending(db, id);
        expect(row.question_text).toBe(REDACTED_QUESTION_TEXT);
        expect(row.topic_term).toBe(REDACTED_QUESTION_TEXT);
      }
    });
  });
});

describe('#120 onboarding_delivery audit rows — redacted by BOTH paths, fixtures survive', () => {
  it('self-service: onboarding_delivery + user rows redacted; same-user benchmark/validation survive', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const userRow = await insertAuditRow(db, userId, { question: 'gewone gebruikersvraag', sourceTag: 'user' });
      const deliveryRow = await insertAuditRow(db, userId, {
        question: 'onboarding leveringsvraag',
        sourceTag: 'onboarding_delivery',
      });
      const benchRow = await insertAuditRow(db, userId, { question: 'benchmark fixture', sourceTag: 'benchmark' });
      const valRow = await insertAuditRow(db, userId, { question: 'validation fixture', sourceTag: 'validation' });

      const redacted = await deleteUserQuestionHistory(db, userId);

      expect(new Set(redacted.map((r) => r.id))).toEqual(new Set([userRow, deliveryRow]));
      expect(await loadAuditQuestion(db, userRow)).toBe(REDACTED_QUESTION_TEXT);
      expect(await loadAuditQuestion(db, deliveryRow)).toBe(REDACTED_QUESTION_TEXT);
      // Regression fixtures live forever — untouched.
      expect(await loadAuditQuestion(db, benchRow)).toBe('benchmark fixture');
      expect(await loadAuditQuestion(db, valRow)).toBe('validation fixture');
    });
  });

  it('purge: an old onboarding_delivery row is redacted; an old benchmark/validation row of the same user survives', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const cutoff = twoYearsBefore(NOW);
      const old = new Date(cutoff.getTime() - 1000).toISOString();
      const deliveryRow = await insertAuditRow(db, userId, {
        question: 'oude onboarding leveringsvraag',
        sourceTag: 'onboarding_delivery',
        createdAt: old,
      });
      const benchRow = await insertAuditRow(db, userId, {
        question: 'oude benchmark fixture',
        sourceTag: 'benchmark',
        createdAt: old,
      });
      const valRow = await insertAuditRow(db, userId, {
        question: 'oude validation fixture',
        sourceTag: 'validation',
        createdAt: old,
      });

      const redacted = await purgeExpiredQuestionHistory(db, cutoff);

      expect(redacted.map((r) => r.id)).toEqual([deliveryRow]);
      expect(await loadAuditQuestion(db, deliveryRow)).toBe(REDACTED_QUESTION_TEXT);
      expect(await loadAuditQuestion(db, benchRow)).toBe('oude benchmark fixture');
      expect(await loadAuditQuestion(db, valRow)).toBe('oude validation fixture');
    });
  });
});

describe('#120 purge cutoff strictness on the pending leg (< not <=)', () => {
  it('redacts only pending rows OLDER than the cutoff; one exactly at the cutoff and a newer one survive', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const cutoff = twoYearsBefore(NOW);
      const olderId = await insertPendingRow(db, {
        userId,
        tableId: '55551NED',
        questionText: 'oude pending vraag',
        topicTerm: 'oudeterm',
        createdAt: new Date(cutoff.getTime() - 1000).toISOString(),
      });
      const atCutoffId = await insertPendingRow(db, {
        userId,
        tableId: '55552NED',
        questionText: 'pending op de grens',
        topicTerm: 'grensterm',
        createdAt: cutoff.toISOString(),
      });
      const newerId = await insertPendingRow(db, {
        userId,
        tableId: '55553NED',
        questionText: 'recente pending vraag',
        topicTerm: 'recentterm',
        createdAt: new Date(cutoff.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      });

      await purgeExpiredQuestionHistory(db, cutoff);

      expect((await loadPending(db, olderId)).question_text).toBe(REDACTED_QUESTION_TEXT);
      // Strict `<`: exactly at the cutoff is NOT purged.
      expect((await loadPending(db, atCutoffId)).question_text).toBe('pending op de grens');
      expect((await loadPending(db, atCutoffId)).topic_term).toBe('grensterm');
      expect((await loadPending(db, newerId)).question_text).toBe('recente pending vraag');
    });
  });
});

describe('#120 idempotency with the new legs', () => {
  it('a second self-service deletion re-redacts the same audit + pending rows, no error, no further change', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const auditId = await insertAuditRow(db, userId, {
        question: 'onboarding leveringsvraag',
        sourceTag: 'onboarding_delivery',
      });
      const pendingId = await insertPendingRow(db, {
        userId,
        tableId: '66661NED',
        questionText: 'pending vraag',
        topicTerm: 'pendterm',
        failureSummary: 'samenvatting',
      });

      const first = await deleteUserQuestionHistory(db, userId);
      const auditAfterFirst = await loadAuditQuestion(db, auditId);
      const pendingAfterFirst = await loadPending(db, pendingId);
      const second = await deleteUserQuestionHistory(db, userId);
      const auditAfterSecond = await loadAuditQuestion(db, auditId);
      const pendingAfterSecond = await loadPending(db, pendingId);

      expect(first.map((r) => r.id)).toContain(auditId);
      expect(second.map((r) => r.id)).toContain(auditId); // still matches — no-op re-write
      expect(auditAfterSecond).toBe(auditAfterFirst);
      expect(pendingAfterSecond).toEqual(pendingAfterFirst);
    });
  });
});

describe('#120 ledger byte-untouched with the new legs in play', () => {
  it('a deletion that redacts audit + pending rows never writes credit_transactions', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertAuditRow(db, userId, { question: 'onboarding vraag', sourceTag: 'onboarding_delivery' });
      // The pending row's own funding debit is a credit_transactions row —
      // exactly the ledger shape the redaction must leave byte-identical.
      await insertPendingRow(db, { userId, tableId: '77771NED', questionText: 'pending vraag', topicTerm: 't' });

      const before = await db.query('select * from credit_transactions order by id');
      await deleteUserQuestionHistory(db, userId);
      const after = await db.query('select * from credit_transactions order by id');
      expect(after.rows).toEqual(before.rows);
    });
  });
});

describe('#120 ⟨F3⟩ — the pending leg runs UNguarded (survives a missing answer_feedback table)', () => {
  it('with answer_feedback DROPPED, deletion still redacts BOTH the audit rows AND the pending rows', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const auditId = await insertAuditRow(db, userId, {
        question: 'onboarding leveringsvraag',
        sourceTag: 'onboarding_delivery',
      });
      const pendingId = await insertPendingRow(db, {
        userId,
        tableId: '88881NED',
        questionText: 'pending vraag',
        topicTerm: 'pendterm',
        failureSummary: 'samenvatting',
      });

      // Simulate the pre-migration-017 deploy window: no answer_feedback table.
      // The feedback delete is to_regclass-guarded and skips; the pending leg is
      // UNguarded (⟨F3⟩) and must STILL run — coupling it to answer_feedback's
      // existence would silently skip a real GDPR leg.
      await db.query('drop index answer_feedback_by_user');
      await db.query('drop table answer_feedback');

      const redacted = await deleteUserQuestionHistory(db, userId);

      expect(redacted.map((r) => r.id)).toContain(auditId);
      expect(await loadAuditQuestion(db, auditId)).toBe(REDACTED_QUESTION_TEXT);
      const pending = await loadPending(db, pendingId);
      expect(pending.question_text).toBe(REDACTED_QUESTION_TEXT);
      expect(pending.topic_term).toBe(REDACTED_QUESTION_TEXT);
      expect(pending.failure_summary).toBe(REDACTED_QUESTION_TEXT);
    });
  });
});

describe('#120 ⟨F2⟩ — countPurgeableQuestionHistory preview === what the purge actually redacts', () => {
  it('on a mixed seed (source_tags, ages, users), preview counts equal the applied redaction', async () => {
    await withDb(async (db) => {
      const userA = randomUUID();
      const userB = randomUUID();
      const cutoff = twoYearsBefore(NOW);
      const old = new Date(cutoff.getTime() - 1000).toISOString();
      const recent = new Date(cutoff.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();

      // Audit rows: which SHOULD be counted+redacted = old rows in AUDIT_SCOPE
      // (user + onboarding_delivery). Everything else must be excluded.
      await insertAuditRow(db, userA, { question: 'A oude user', sourceTag: 'user', createdAt: old }); // ✔
      await insertAuditRow(db, userA, { question: 'A oude delivery', sourceTag: 'onboarding_delivery', createdAt: old }); // ✔
      await insertAuditRow(db, userA, { question: 'A recente user', sourceTag: 'user', createdAt: recent }); // ✘ too new
      await insertAuditRow(db, userA, { question: 'A oude benchmark', sourceTag: 'benchmark', createdAt: old }); // ✘ fixture
      await insertAuditRow(db, userA, { question: 'A oude validation', sourceTag: 'validation', createdAt: old }); // ✘ fixture
      await insertAuditRow(db, userB, { question: 'B oude user', sourceTag: 'user', createdAt: old }); // ✔
      await insertAuditRow(db, userB, { question: 'B oude delivery', sourceTag: 'onboarding_delivery', createdAt: old }); // ✔
      const expectedAuditRows = 4;

      // Pending rows: which SHOULD be counted+redacted = old ones (any user).
      await insertPendingRow(db, { userId: userA, tableId: '90001NED', questionText: 'A oude pending', createdAt: old }); // ✔
      await insertPendingRow(db, { userId: userA, tableId: '90002NED', questionText: 'A recente pending', createdAt: recent }); // ✘ too new
      await insertPendingRow(db, { userId: userB, tableId: '90003NED', questionText: 'B oude pending', createdAt: old }); // ✔
      const expectedPendingRows = 2;

      const preview = await countPurgeableQuestionHistory(db, cutoff);
      expect(preview.auditRows).toBe(expectedAuditRows);
      expect(preview.pendingRows).toBe(expectedPendingRows);

      const redacted = await purgeExpiredQuestionHistory(db, cutoff);

      // Equivalence: the audit preview equals the returned RedactedRow[] length.
      expect(preview.auditRows).toBe(redacted.length);

      // Equivalence: the pending preview equals the number of pending rows whose
      // question_text actually became the sentinel.
      const { rows } = await db.query(
        `select count(*)::int as n from pending_table_requests where question_text = $1`,
        [REDACTED_QUESTION_TEXT],
      );
      expect(preview.pendingRows).toBe(Number(rows[0]!.n));
    });
  });
});
