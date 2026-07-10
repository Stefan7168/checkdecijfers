// Migration 015 (WP27 stage B/C, ADR 027 D2a): the candidate chain + fit-gate
// columns on pending_table_requests. Verifies the behavior the migration
// claims — defaults, nullability, and that the new columns sit OUTSIDE the
// asking-twice dedupe identity — enforced by the database itself, per
// CLAUDE.md's "structural, never pattern-based" standard.
//
// NOTE: the file is applied here (PGlite) and in CI only — production waits
// for stage D's owner-supervised live step. The code-side half of that
// deploy-order story (the store's column probe) is pinned in
// tests/ingestion/onboarding-store.test.ts and onboarding-trigger.test.ts.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { applyMigrations, MIGRATIONS_DIR } from '../../src/db/migrate.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

async function insertOnboardingDebit(db: Db, userId: string, requestId: string): Promise<number> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, note)
     values ($1, -100, 'onboarding_cost', $2, 'test debit')
     returning id`,
    [userId, requestId],
  );
  return Number(rows[0]!.id);
}

/** A LEGACY-shaped insert: names none of the 015 columns — the exact SQL an
 * old deploy (or the store's pre-015 fallback branch) runs. */
async function insertLegacyPendingRow(
  db: Db,
  opts: { userId: string; requestId: string; tableId: string; debitId: number },
): Promise<number> {
  const { rows } = await db.query(
    `insert into pending_table_requests
       (user_id, request_id, question_text, topic_term, table_id, finder_confidence, debit_transaction_id)
     values ($1, $2, 'hoeveel mensen zaten er in 2023 in de bijstand', 'bijstand', $3, 0.9, $4)
     returning id`,
    [opts.userId, opts.requestId, opts.tableId, opts.debitId],
  );
  return Number(rows[0]!.id);
}

describe('migration 015 is picked up by the migration scan', () => {
  it('applyMigrations records 015_candidate_chain.sql as applied', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        "select name from schema_migrations where name like '015_%' order by name",
      );
      expect(rows.map((r) => r.name)).toEqual(['015_candidate_chain.sql']);
    });
  });

  it('re-running applyMigrations against the same db is a no-op (idempotent scan)', async () => {
    await withDb(async (db) => {
      const applied = await applyMigrations(db, MIGRATIONS_DIR);
      expect(applied).toEqual([]);
    });
  });
});

describe('migration 015 column behavior (ADR 027 D2a/D2c)', () => {
  it("a legacy insert (no new columns named) gets candidate_ids '[]', resolved_table_id + fit_note null", async () => {
    // '[]' is the legacy-row marker stage C's job branches on: EXACTLY
    // today's path, no fit gate (D2c). NULL resolved_table_id = the fit gate
    // has not accepted anything (the job then reads table_id as today).
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      const debitId = await insertOnboardingDebit(db, userId, requestId);
      const id = await insertLegacyPendingRow(db, { userId, requestId, tableId: '37789ksz', debitId });
      const { rows } = await db.query(
        'select candidate_ids, resolved_table_id, fit_note from pending_table_requests where id = $1',
        [id],
      );
      expect(rows[0]!.candidate_ids).toEqual([]);
      expect(rows[0]!.resolved_table_id).toBeNull();
      expect(rows[0]!.fit_note).toBeNull();
    });
  });

  it('the new columns sit OUTSIDE the asking-twice dedupe: same (user, table) with a DIFFERENT chain still collides', async () => {
    // The pending_one_active_per_user_table unique index keys on the
    // UNCHANGED table_id (D2a: table_id is never mutated; the fit choice
    // lives in resolved_table_id) — a different candidate_ids value must not
    // open a second active row.
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      const debitId = await insertOnboardingDebit(db, userId, requestId);
      await db.query(
        `insert into pending_table_requests
           (user_id, request_id, question_text, topic_term, table_id, finder_confidence,
            candidate_ids, debit_transaction_id)
         values ($1, $2, 'q1', 't', '37789ksz', 0.9, '["37789ksz","85615NED"]'::jsonb, $3)`,
        [userId, requestId, debitId],
      );
      const secondRequest = randomUUID();
      const secondDebit = await insertOnboardingDebit(db, userId, secondRequest);
      await expect(
        db.query(
          `insert into pending_table_requests
             (user_id, request_id, question_text, topic_term, table_id, finder_confidence,
              candidate_ids, debit_transaction_id)
           values ($1, $2, 'q2', 't', '37789ksz', 0.9, '["37789ksz"]'::jsonb, $3)`,
          [userId, secondRequest, secondDebit],
        ),
      ).rejects.toThrow(/unique|duplicate key/i);
    });
  });

  it('resolved_table_id is writable independently of table_id (the D2a seam stage C uses)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      const debitId = await insertOnboardingDebit(db, userId, requestId);
      const id = await insertLegacyPendingRow(db, { userId, requestId, tableId: '85585NED', debitId });
      await db.query(
        `update pending_table_requests set resolved_table_id = '37789ksz', fit_note = 'stub note' where id = $1`,
        [id],
      );
      const { rows } = await db.query(
        'select table_id, resolved_table_id, fit_note from pending_table_requests where id = $1',
        [id],
      );
      // table_id untouched — the dedupe identity survives the fit choice.
      expect(rows[0]!.table_id).toBe('85585NED');
      expect(rows[0]!.resolved_table_id).toBe('37789ksz');
      expect(rows[0]!.fit_note).toBe('stub note');
    });
  });
});
