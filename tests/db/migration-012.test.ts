// Migration 012 (WP16 sub-part 2, design §1): pending_table_requests + the
// ledger widening for the new 'onboarding_cost' reason. Verifies the
// constraint behavior the migration claims, not just "the file applies" —
// per CLAUDE.md's "structural, never pattern-based" standard, these must be
// enforced by the database itself.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { debitQuestion } from '../../src/billing/ledger.ts';
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

/** Inserts a pending_table_requests row's required debit + row in one go,
 * for tests that only care about pending_table_requests' own constraints. */
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
  opts: { userId: string; requestId: string; tableId: string; debitId: number },
): Promise<number> {
  const { rows } = await db.query(
    `insert into pending_table_requests
       (user_id, request_id, question_text, topic_term, table_id, finder_confidence, debit_transaction_id)
     values ($1, $2, 'hoeveel inwoners heeft nederland', 'inwoners', $3, 0.9, $4)
     returning id`,
    [opts.userId, opts.requestId, opts.tableId, opts.debitId],
  );
  return Number(rows[0]!.id);
}

describe('migration 012 is picked up by the migration scan', () => {
  it('applyMigrations records 012_pending_table_requests.sql as applied', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        "select name from schema_migrations where name like '012_%' order by name",
      );
      expect(rows.map((r) => r.name)).toEqual(['012_pending_table_requests.sql']);
    });
  });

  it('re-running applyMigrations against the same db is a no-op (idempotent scan)', async () => {
    await withDb(async (db) => {
      const applied = await applyMigrations(db, MIGRATIONS_DIR);
      expect(applied).toEqual([]);
    });
  });
});

describe('pending_table_requests — status CHECK', () => {
  it('rejects a status outside the enum', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      const debitId = await insertOnboardingDebit(db, userId, requestId);
      await expect(
        db.query(
          `insert into pending_table_requests
             (user_id, request_id, question_text, topic_term, table_id, finder_confidence, debit_transaction_id, status)
           values ($1, $2, 'q', 't', 'X1NED', 0.9, $3, 'bogus')`,
          [userId, requestId, debitId],
        ),
      ).rejects.toThrow();
    });
  });

  it('accepts every documented status value', async () => {
    await withDb(async (db) => {
      for (const status of ['pending', 'running', 'delivered', 'failed', 'unanswerable']) {
        const userId = randomUUID();
        const requestId = randomUUID();
        const debitId = await insertOnboardingDebit(db, userId, requestId);
        await db.query(
          `insert into pending_table_requests
             (user_id, request_id, question_text, topic_term, table_id, finder_confidence, debit_transaction_id, status)
           values ($1, $2, 'q', 't', 'X1NED', 0.9, $3, $4)`,
          [userId, requestId, debitId, status],
        );
      }
    });
  });

  it('requires debit_transaction_id to reference a real credit_transactions row', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pending_table_requests
             (user_id, request_id, question_text, topic_term, table_id, finder_confidence, debit_transaction_id)
           values ($1, $2, 'q', 't', 'X1NED', 0.9, 999999)`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('pending_table_requests — one active row per (user, table)', () => {
  it('rejects a second pending row for the same user+table while one is pending', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debit1 = await insertOnboardingDebit(db, userId, randomUUID());
      await insertPendingRow(db, { userId, requestId: randomUUID(), tableId: 'X1NED', debitId: debit1 });

      const debit2 = await insertOnboardingDebit(db, userId, randomUUID());
      await expect(
        insertPendingRow(db, { userId, requestId: randomUUID(), tableId: 'X1NED', debitId: debit2 }),
      ).rejects.toThrow();
    });
  });

  it('rejects a second pending row while the first is running (partial index covers both statuses)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debit1 = await insertOnboardingDebit(db, userId, randomUUID());
      const id1 = await insertPendingRow(db, { userId, requestId: randomUUID(), tableId: 'X1NED', debitId: debit1 });
      await db.query("update pending_table_requests set status = 'running' where id = $1", [id1]);

      const debit2 = await insertOnboardingDebit(db, userId, randomUUID());
      await expect(
        insertPendingRow(db, { userId, requestId: randomUUID(), tableId: 'X1NED', debitId: debit2 }),
      ).rejects.toThrow();
    });
  });

  it('allows a new pending row once the prior one reached a terminal status', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debit1 = await insertOnboardingDebit(db, userId, randomUUID());
      const id1 = await insertPendingRow(db, { userId, requestId: randomUUID(), tableId: 'X1NED', debitId: debit1 });
      await db.query("update pending_table_requests set status = 'delivered' where id = $1", [id1]);

      const debit2 = await insertOnboardingDebit(db, userId, randomUUID());
      await expect(
        insertPendingRow(db, { userId, requestId: randomUUID(), tableId: 'X1NED', debitId: debit2 }),
      ).resolves.not.toThrow();
    });
  });

  it('different users may each have a pending row for the same table', async () => {
    await withDb(async (db) => {
      const userA = randomUUID();
      const userB = randomUUID();
      const debitA = await insertOnboardingDebit(db, userA, randomUUID());
      const debitB = await insertOnboardingDebit(db, userB, randomUUID());
      await insertPendingRow(db, { userId: userA, requestId: randomUUID(), tableId: 'X1NED', debitId: debitA });
      await expect(
        insertPendingRow(db, { userId: userB, requestId: randomUUID(), tableId: 'X1NED', debitId: debitB }),
      ).resolves.not.toThrow();
    });
  });
});

describe('credit_transactions — widened reason CHECK accepts onboarding_cost', () => {
  it('accepts a negative onboarding_cost delta with a request_id', async () => {
    await withDb(async (db) => {
      await expect(insertOnboardingDebit(db, randomUUID(), randomUUID())).resolves.toBeTypeOf('number');
    });
  });

  it('rejects a positive onboarding_cost delta (delta-sign CHECK widened, not dropped)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, request_id, note)
           values ($1, 100, 'onboarding_cost', $2, 'bad sign')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects an onboarding_cost row with no request_id (request_id_scope CHECK widened)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, note)
           values ($1, -100, 'onboarding_cost', 'missing request id')`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('still rejects an unrelated bogus reason (the enum was widened, not opened up)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, note)
           values ($1, 1, 'not_a_real_reason', 'bogus')`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('question_cost still behaves exactly as before (regression guard on the widened CHECKs)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const entry = await debitQuestion(db, userId, randomUUID(), 20);
      expect(entry).not.toBeNull();
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, request_id, note)
           values ($1, 20, 'question_cost', $2, 'bad sign')`,
          [userId, randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('credit_transactions — one onboarding debit per (user, request)', () => {
  it('rejects a second onboarding_cost row for the same (user, request_id) — no ON CONFLICT here, raw insert must fail', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      await insertOnboardingDebit(db, userId, requestId);
      await expect(insertOnboardingDebit(db, userId, requestId)).rejects.toThrow();
    });
  });

  it('the same request_id for a different user is not a conflict', async () => {
    await withDb(async (db) => {
      const requestId = randomUUID();
      await expect(insertOnboardingDebit(db, randomUUID(), requestId)).resolves.toBeTypeOf('number');
      await expect(insertOnboardingDebit(db, randomUUID(), requestId)).resolves.toBeTypeOf('number');
    });
  });

  it('a question_cost and an onboarding_cost row for the same (user, request_id) coexist (different partial indexes)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      const questionDebit = await debitQuestion(db, userId, requestId, 20);
      expect(questionDebit).not.toBeNull();
      await expect(insertOnboardingDebit(db, userId, requestId)).resolves.toBeTypeOf('number');
    });
  });
});
