// tests/audit/retention-chart-headlines.test.ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deleteUserQuestionHistory,
  deleteThreadQuestionHistory,
  purgeExpiredQuestionHistory,
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

async function insertAuditRow(
  db: Db,
  opts: { userId: string; threadId?: number | null; createdAt?: string },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, thread_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, chart_emitted, created_at)
     values (1, $1, $2, 'user', 'answer', 'q', '2026-01-01', '{}'::jsonb, 'a', '{}'::jsonb, 100, true, coalesce($3::timestamptz, now()))
     returning id`,
    [opts.userId, opts.threadId ?? null, opts.createdAt ?? null],
  );
  return Number(rows[0]!.id);
}

async function insertHeadline(db: Db, auditId: number, headline: string): Promise<void> {
  await db.query(`insert into chart_headlines (audit_answer_id, headline) values ($1, $2)`, [auditId, headline]);
}

async function headlineRows(db: Db): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query(`select audit_answer_id, headline from chart_headlines order by audit_answer_id`);
  return rows;
}

describe('chart_headlines GDPR interplay', () => {
  it('deleteUserQuestionHistory hard-deletes only the caller’s headlines', async () => {
    await withDb(async (db) => {
      const user1 = randomUUID();
      const user2 = randomUUID();
      const mine = await insertAuditRow(db, { userId: user1 });
      const theirs = await insertAuditRow(db, { userId: user2 });
      await insertHeadline(db, mine, 'Mijn kop');
      await insertHeadline(db, theirs, 'Hun kop');

      await deleteUserQuestionHistory(db, user1);

      const rows = await headlineRows(db);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.audit_answer_id)).toBe(theirs);
    });
  });

  it('deleteThreadQuestionHistory only deletes the named thread’s headline', async () => {
    await withDb(async (db) => {
      const user1 = randomUUID();
      // audit_answers.thread_id is a real FK to chat_threads(id) (migration
      // 019) — a real chat_threads row must exist first, or the insert
      // below violates the constraint. Matches the exact pattern used by
      // tests/audit/retention.test.ts:272 and tests/threads/dataset-
      // threads.test.ts (confirmed this session, not guessed).
      const { rows: t1 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [user1]);
      const { rows: t2 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [user1]);
      const thread1 = Number(t1[0]!.id);
      const thread2 = Number(t2[0]!.id);
      const inThread = await insertAuditRow(db, { userId: user1, threadId: thread1 });
      const otherThread = await insertAuditRow(db, { userId: user1, threadId: thread2 });
      await insertHeadline(db, inThread, 'In thread 1');
      await insertHeadline(db, otherThread, 'In thread 2');

      await deleteThreadQuestionHistory(db, user1, thread1);

      const rows = await headlineRows(db);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.audit_answer_id)).toBe(otherThread);
    });
  });

  it('the 2-year purge deletes headlines attached to purged answers and leaves fresh ones', async () => {
    await withDb(async (db) => {
      const old = await insertAuditRow(db, { userId: 'user-1', createdAt: '2020-01-01T00:00:00Z' });
      const fresh = await insertAuditRow(db, { userId: 'user-1' });
      await insertHeadline(db, old, 'Oude kop');
      await insertHeadline(db, fresh, 'Verse kop');

      await purgeExpiredQuestionHistory(db, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'));

      const rows = await headlineRows(db);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.audit_answer_id)).toBe(fresh);
    });
  });

  it('pre-migration window: redaction still works when chart_headlines does not exist', async () => {
    await withDb(async (db) => {
      const user1 = randomUUID();
      const mine = await insertAuditRow(db, { userId: user1 });
      await db.query('drop table chart_headlines');
      const redacted = await deleteUserQuestionHistory(db, user1);
      expect(redacted.map((r) => r.id)).toContain(mine);
    });
  });
});
