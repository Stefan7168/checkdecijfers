// WP128 (#128): migration 017 — the answer_feedback table. One test per claim
// in the migration header: shape, verdict CHECK, one-per-(answer,user) unique
// (the upsert seam), and the FK to audit_answers. Hermetic on PGlite
// (ADR 009) — createTestDb applies every migration incl. 017.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';

let sharedDb: Db;
let closeSharedDb: () => Promise<void>;

beforeAll(async () => {
  ({ db: sharedDb, close: closeSharedDb } = await createTestDb());
});

afterAll(async () => {
  await closeSharedDb();
});

beforeEach(async () => {
  await resetTestDb(sharedDb);
});

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  await fn(sharedDb);
}

async function insertAnswerRow(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms)
     values (1, $1, 'user', 'answer', 'q', '2026-01-01', '{}'::jsonb, 'a', '{}'::jsonb, 100)
     returning id`,
    [userId],
  );
  return Number(rows[0]!.id);
}

describe('migration 017 — answer_feedback', () => {
  it('accepts a well-formed feedback row and defaults created_at', async () => {
    await withDb(async (db) => {
      const auditId = await insertAnswerRow(db, 'user-1');
      const { rows } = await db.query(
        `insert into answer_feedback (audit_answer_id, user_id, verdict, feedback_text)
         values ($1, 'user-1', 'down', 'te vaag') returning id, created_at`,
        [auditId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.created_at).toBeTruthy();
    });
  });

  it("enforces the verdict CHECK — only 'up' and 'down' exist", async () => {
    await withDb(async (db) => {
      const auditId = await insertAnswerRow(db, 'user-1');
      await expect(
        db.query(
          `insert into answer_feedback (audit_answer_id, user_id, verdict) values ($1, 'user-1', 'meh')`,
          [auditId],
        ),
      ).rejects.toThrow(/check|verdict/i);
    });
  });

  it('enforces one feedback per (answer, user) — the upsert seam is a database fact', async () => {
    await withDb(async (db) => {
      const auditId = await insertAnswerRow(db, 'user-1');
      await db.query(
        `insert into answer_feedback (audit_answer_id, user_id, verdict) values ($1, 'user-1', 'up')`,
        [auditId],
      );
      await expect(
        db.query(
          `insert into answer_feedback (audit_answer_id, user_id, verdict) values ($1, 'user-1', 'down')`,
          [auditId],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
      // A DIFFERENT user on the same answer is fine.
      const { rows } = await db.query(
        `insert into answer_feedback (audit_answer_id, user_id, verdict) values ($1, 'user-2', 'down') returning id`,
        [auditId],
      );
      expect(rows).toHaveLength(1);
    });
  });

  it('enforces the FK — feedback cannot point at a nonexistent audit row', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into answer_feedback (audit_answer_id, user_id, verdict) values (999999, 'user-1', 'up')`,
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });
});
