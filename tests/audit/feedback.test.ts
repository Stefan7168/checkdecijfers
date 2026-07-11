// WP128 (#128): the write-only feedback store + its GDPR interplay. The
// frozen-brief pins: the in-statement ownership/kind/source guard (both
// insert AND upsert paths), text normalization, the retention interplay
// (self-service + purge hard-delete feedback INSIDE the same transaction,
// other users' feedback untouched, ledger byte-untouched), and the
// pre-migration deploy window (missing table → soft false / redaction still
// works). Hermetic on PGlite (ADR 009).
import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_TEXT_MAX_LENGTH,
  normalizeFeedbackText,
  upsertAnswerFeedback,
} from '../../src/answer/audit/feedback.ts';
import {
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

async function insertAuditRow(
  db: Db,
  opts: { userId: string; kind?: string; sourceTag?: string; createdAt?: string },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, created_at)
     values (1, $1, $2, $3, 'q', '2026-01-01', '{}'::jsonb, 'a', '{}'::jsonb, 100, coalesce($4::timestamptz, now()))
     returning id`,
    [opts.userId, opts.sourceTag ?? 'user', opts.kind ?? 'answer', opts.createdAt ?? null],
  );
  return Number(rows[0]!.id);
}

async function feedbackRows(db: Db): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query(
    `select audit_answer_id, user_id, verdict, feedback_text from answer_feedback order by id`,
  );
  return rows;
}

describe('upsertAnswerFeedback — the guarded write', () => {
  it('writes the caller’s feedback on their own answer, and upserts on verdict change', async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await upsertAnswerFeedback(db, { auditAnswerId: auditId, userId: 'user-1', verdict: 'up' })).toBe(true);
      // Change of heart: 👍 → 👎 with text — same row, overwritten.
      expect(
        await upsertAnswerFeedback(db, {
          auditAnswerId: auditId,
          userId: 'user-1',
          verdict: 'down',
          feedbackText: '  te vaag  ',
        }),
      ).toBe(true);
      const rows = await feedbackRows(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.verdict).toBe('down');
      expect(rows[0]!.feedback_text).toBe('te vaag');
    });
  });

  it("ownership guard: another user's audit row is untouchable (soft false, zero rows)", async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await upsertAnswerFeedback(db, { auditAnswerId: auditId, userId: 'user-2', verdict: 'up' })).toBe(false);
      expect(await feedbackRows(db)).toHaveLength(0);
    });
  });

  it('kind guard: refusals and clarifications never take feedback', async () => {
    await withDb(async (db) => {
      const refusal = await insertAuditRow(db, { userId: 'user-1', kind: 'refusal' });
      const clarification = await insertAuditRow(db, { userId: 'user-1', kind: 'clarification' });
      expect(await upsertAnswerFeedback(db, { auditAnswerId: refusal, userId: 'user-1', verdict: 'up' })).toBe(false);
      expect(await upsertAnswerFeedback(db, { auditAnswerId: clarification, userId: 'user-1', verdict: 'down' })).toBe(false);
      expect(await feedbackRows(db)).toHaveLength(0);
    });
  });

  it('source guard: a benchmark-tagged row never takes feedback — purge-exempt rows cannot accrete user text (structural, not an accident of runner scripts)', async () => {
    await withDb(async (db) => {
      const benchRow = await insertAuditRow(db, { userId: 'user-1', sourceTag: 'benchmark' });
      expect(await upsertAnswerFeedback(db, { auditAnswerId: benchRow, userId: 'user-1', verdict: 'up' })).toBe(false);
      expect(await feedbackRows(db)).toHaveLength(0);
    });
  });

  it('nonexistent audit id → soft false', async () => {
    await withDb(async (db) => {
      expect(await upsertAnswerFeedback(db, { auditAnswerId: 999999, userId: 'user-1', verdict: 'up' })).toBe(false);
    });
  });

  it('pre-migration window: a missing table returns soft false from the ACTION layer (helper throws, caller catches)', async () => {
    await withDb(async (db) => {
      await db.query('drop index answer_feedback_by_user');
      await db.query('drop table answer_feedback');
      // The helper itself throws (a plain query error)…
      await expect(
        upsertAnswerFeedback(db, { auditAnswerId: 1, userId: 'user-1', verdict: 'up' }),
      ).rejects.toThrow();
      // …which is exactly what the server action's whole-body try/catch turns
      // into { ok: false } (pinned in web/app tests); the REDACTION paths
      // however must keep working without the table — see the retention pin
      // below.
    });
  });
});

describe('normalizeFeedbackText', () => {
  it('trims, nulls empties, caps at the max length', () => {
    expect(normalizeFeedbackText(undefined)).toBeNull();
    expect(normalizeFeedbackText(null)).toBeNull();
    expect(normalizeFeedbackText('   ')).toBeNull();
    expect(normalizeFeedbackText('  prima  ')).toBe('prima');
    expect(normalizeFeedbackText('x'.repeat(FEEDBACK_TEXT_MAX_LENGTH + 50))).toHaveLength(FEEDBACK_TEXT_MAX_LENGTH);
  });
});

describe('GDPR interplay (frozen-brief F3 — same transaction, feedback first)', () => {
  it('deleteUserQuestionHistory hard-deletes the caller’s feedback and ONLY the caller’s', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'user-1' });
      const theirs = await insertAuditRow(db, { userId: 'user-2' });
      await upsertAnswerFeedback(db, { auditAnswerId: mine, userId: 'user-1', verdict: 'down', feedbackText: 'privé' });
      await upsertAnswerFeedback(db, { auditAnswerId: theirs, userId: 'user-2', verdict: 'up' });

      await deleteUserQuestionHistory(db, 'user-1');

      const rows = await feedbackRows(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.user_id).toBe('user-2');
    });
  });

  it('the 2-year purge deletes feedback attached to purged answers and leaves fresh feedback', async () => {
    await withDb(async (db) => {
      const old = await insertAuditRow(db, { userId: 'user-1', createdAt: '2020-01-01T00:00:00Z' });
      const fresh = await insertAuditRow(db, { userId: 'user-1' });
      await upsertAnswerFeedback(db, { auditAnswerId: old, userId: 'user-1', verdict: 'down', feedbackText: 'oud' });
      await upsertAnswerFeedback(db, { auditAnswerId: fresh, userId: 'user-1', verdict: 'up' });

      await purgeExpiredQuestionHistory(db, new Date('2024-01-01T00:00:00Z'));

      const rows = await feedbackRows(db);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.audit_answer_id)).toBe(fresh);
    });
  });

  it('both paths stay idempotent with feedback in play', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'user-1' });
      await upsertAnswerFeedback(db, { auditAnswerId: mine, userId: 'user-1', verdict: 'down' });
      await deleteUserQuestionHistory(db, 'user-1');
      const second = await deleteUserQuestionHistory(db, 'user-1');
      expect(second.length).toBeGreaterThanOrEqual(1); // same rows re-redacted, harmless
      expect(await feedbackRows(db)).toHaveLength(0);
    });
  });

  it('the ledger stays byte-untouched by a deletion that also removes feedback', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'user-1' });
      await upsertAnswerFeedback(db, { auditAnswerId: mine, userId: 'user-1', verdict: 'down' });
      const before = await db.query('select * from credit_transactions order by id');
      await deleteUserQuestionHistory(db, 'user-1');
      const after = await db.query('select * from credit_transactions order by id');
      expect(after.rows).toEqual(before.rows);
    });
  });

  it('pre-migration window: redaction still works when answer_feedback does not exist (the to_regclass guard)', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'user-1' });
      await db.query('drop index answer_feedback_by_user');
      await db.query('drop table answer_feedback');
      const redacted = await deleteUserQuestionHistory(db, 'user-1');
      expect(redacted.map((r) => r.id)).toContain(mine);
      const { rows } = await db.query('select question from audit_answers where id = $1', [mine]);
      expect(rows[0]!.question).toBe('Deze vraag is verwijderd.');
    });
  });
});
