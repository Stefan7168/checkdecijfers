// Breadth step 5 (migration 038): table_lane_requests carries the reader's
// question and the CBS table id a second time, so the three retention legs
// (self-service whole history, per-thread, 2-year purge) hard-delete FINISHED
// rows. In-flight rows (pending/running) are left for their job. Hermetic
// PGlite, real migrations, no LLM.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deleteThreadQuestionHistory,
  deleteUserQuestionHistory,
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

async function ledgerDebit(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, note)
     values ($1, -20, 'question_cost', $2, 'question debit') returning id`,
    [userId, randomUUID()],
  );
  return Number(rows[0]!.id);
}

async function insertLaneRow(
  db: Db,
  opts: { userId: string; status: string; threadId?: number | null; createdAt?: string; routingAuditId?: number },
): Promise<number> {
  const debitId = await ledgerDebit(db, opts.userId);
  const { rows } = await db.query(
    `insert into table_lane_requests
       (user_id, request_id, thread_id, lang, question, table_id, finder_confidence,
        status, debit_transaction_id, debit_from_ledger, created_at, routing_audit_id)
     values ($1, $2, $3, 'nl', 'geheime vraag', '85000NED', 0.9, $4, $5, 20, coalesce($6::timestamptz, now()), $7)
     returning id`,
    [
      opts.userId,
      randomUUID(),
      opts.threadId ?? null,
      opts.status,
      debitId,
      opts.createdAt ?? null,
      opts.routingAuditId ?? null,
    ],
  );
  return Number(rows[0]!.id);
}

async function laneIds(db: Db): Promise<number[]> {
  const { rows } = await db.query('select id from table_lane_requests order by id');
  return rows.map((r) => Number(r.id));
}

/** The free routing turn: an audited refusal NOT attached to any thread. */
async function routingAuditRow(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, chart_emitted)
     values (1, $1, 'user', 'refusal', 'geheime vraag', '2026-01-01', '{"kind":"refusal"}'::jsonb, 'wordt voorbereid', '{}'::jsonb, 100, false)
     returning id`,
    [userId],
  );
  return Number(rows[0]!.id);
}

async function questionOf(db: Db, auditId: number): Promise<string> {
  const { rows } = await db.query('select question from audit_answers where id = $1', [auditId]);
  return String(rows[0]!.question);
}

describe('table_lane_requests retention', () => {
  it('deleteUserQuestionHistory deletes only the caller’s FINISHED rows', async () => {
    await withDb(async (db) => {
      const me = randomUUID();
      const other = randomUUID();
      const done = await insertLaneRow(db, { userId: me, status: 'done' });
      const failed = await insertLaneRow(db, { userId: me, status: 'failed' });
      const running = await insertLaneRow(db, { userId: me, status: 'running' });
      const pending = await insertLaneRow(db, { userId: me, status: 'pending' });
      const theirs = await insertLaneRow(db, { userId: other, status: 'done' });

      await deleteUserQuestionHistory(db, me);

      const ids = await laneIds(db);
      expect(ids).toEqual([running, pending, theirs].sort((a, b) => a - b));
      expect(ids).not.toContain(done);
      expect(ids).not.toContain(failed);
    });
  });

  it('deleteThreadQuestionHistory deletes only that thread’s finished rows', async () => {
    await withDb(async (db) => {
      const me = randomUUID();
      const { rows: t1 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [me]);
      const { rows: t2 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [me]);
      const thread1 = Number(t1[0]!.id);
      const thread2 = Number(t2[0]!.id);
      await insertLaneRow(db, { userId: me, status: 'done', threadId: thread1 });
      const otherThread = await insertLaneRow(db, { userId: me, status: 'done', threadId: thread2 });
      const inFlight = await insertLaneRow(db, { userId: me, status: 'running', threadId: thread1 });

      await deleteThreadQuestionHistory(db, me, thread1);

      expect(await laneIds(db)).toEqual([otherThread, inFlight].sort((a, b) => a - b));
    });
  });

  it('deleteThreadQuestionHistory also redacts the thread-less ROUTING turn of every lane row in that thread (final review I3)', async () => {
    await withDb(async (db) => {
      const me = randomUUID();
      const { rows: t1 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [me]);
      const { rows: t2 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [me]);
      const thread1 = Number(t1[0]!.id);
      const thread2 = Number(t2[0]!.id);
      const doneRouting = await routingAuditRow(db, me);
      const inFlightRouting = await routingAuditRow(db, me);
      const otherThreadRouting = await routingAuditRow(db, me);
      await insertLaneRow(db, { userId: me, status: 'done', threadId: thread1, routingAuditId: doneRouting });
      await insertLaneRow(db, { userId: me, status: 'running', threadId: thread1, routingAuditId: inFlightRouting });
      await insertLaneRow(db, { userId: me, status: 'done', threadId: thread2, routingAuditId: otherThreadRouting });

      const redacted = await deleteThreadQuestionHistory(db, me, thread1);

      expect(redacted.map((r) => r.id).sort((a, b) => a - b)).toEqual(
        [doneRouting, inFlightRouting].sort((a, b) => a - b),
      );
      expect(await questionOf(db, doneRouting)).not.toBe('geheime vraag');
      expect(await questionOf(db, inFlightRouting)).not.toBe('geheime vraag');
      expect(await questionOf(db, otherThreadRouting)).toBe('geheime vraag');
    });
  });

  it('per-thread deletion never reaches another user\'s routing turn, even through a forged link', async () => {
    await withDb(async (db) => {
      const me = randomUUID();
      const other = randomUUID();
      const { rows: t1 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [me]);
      const thread1 = Number(t1[0]!.id);
      const theirs = await routingAuditRow(db, other);
      await insertLaneRow(db, { userId: me, status: 'done', threadId: thread1, routingAuditId: theirs });
      await deleteThreadQuestionHistory(db, me, thread1);
      expect(await questionOf(db, theirs)).toBe('geheime vraag');
    });
  });

  it('per-thread deletion still works while migration 038 is unapplied (the routing leg is skipped, never errors)', async () => {
    await withDb(async (db) => {
      const me = randomUUID();
      const { rows: t1 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [me]);
      const thread1 = Number(t1[0]!.id);
      const { rows } = await db.query(
        `insert into audit_answers
           (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, chart_emitted, thread_id)
         values (1, $1, 'user', 'answer', 'geheime vraag', '2026-01-01', '{}'::jsonb, 'a', '{}'::jsonb, 100, false, $2)
         returning id`,
        [me, thread1],
      );
      const hide = (sql: string) => /table_lane_requests/.test(sql) && !/to_regclass/.test(sql);
      const wrap = (inner: Db): Db => ({
        query: async (sql, params) => {
          if (/to_regclass/.test(sql) && (sql + JSON.stringify(params ?? [])).includes('table_lane_requests')) {
            return { rows: [{ t: null }] };
          }
          if (hide(sql)) throw new Error('relation "table_lane_requests" does not exist');
          return inner.query(sql, params);
        },
        withTransaction: (fn) => inner.withTransaction((tx) => fn(wrap(tx))),
      });
      const redacted = await deleteThreadQuestionHistory(wrap(db), me, thread1);
      expect(redacted.map((r) => r.id)).toEqual([Number(rows[0]!.id)]);
    });
  });

  it('the 2-year purge deletes finished rows older than the cutoff and leaves fresh and in-flight ones', async () => {
    await withDb(async (db) => {
      const me = randomUUID();
      await insertLaneRow(db, { userId: me, status: 'done', createdAt: '2020-01-01T00:00:00Z' });
      const oldRunning = await insertLaneRow(db, { userId: me, status: 'running', createdAt: '2020-01-01T00:00:00Z' });
      const fresh = await insertLaneRow(db, { userId: me, status: 'done' });

      await purgeExpiredQuestionHistory(db, new Date('2024-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));

      expect(await laneIds(db)).toEqual([oldRunning, fresh].sort((a, b) => a - b));
    });
  });
});
