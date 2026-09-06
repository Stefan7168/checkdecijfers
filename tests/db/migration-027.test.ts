// Migration 027 (WP202a, ADR 037): the ledger widening for the new
// 'dataset_cost' reason + the 'dataset_ingest'/'dataset_turn' action-class
// prices. Verifies the constraint behavior the migration claims, not just
// "the file applies" — per CLAUDE.md's "structural, never pattern-based"
// standard, these must be enforced by the database itself. Mirrors
// migration-018.test.ts's shape exactly (same ledger-widening pattern one
// reason later).
//
// Deliberately NOT testing "pricing-apply seeds dataset_turn at N credits"
// (unlike migration-018.test.ts's web_addon equivalent): the owner has
// decided the MECHANISM (free CSV ingest, pay-per-turn) but not the exact
// credit amounts yet (open-questions #201/#202 §8 Q1) — seeding a guessed
// number into pricing-defaults.ts would be presenting an assumption as
// settled. The CHECK constraint accepting the class names is proven here;
// the actual price row is a config-only addition (ADR 006) once the owner
// picks a number, needing no migration.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compensate, debitQuestion } from '../../src/billing/ledger.ts';
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

/** A raw negative-delta dataset_cost debit — deliberately NOT via a
 * debitDataset helper (which doesn't exist yet at this layer), so the
 * constraints are proven independent of any future application code. */
async function insertDatasetDebit(db: Db, userId: string, requestId: string): Promise<number> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, note)
     values ($1, -10, 'dataset_cost', $2, 'test dataset debit')
     returning id`,
    [userId, requestId],
  );
  return Number(rows[0]!.id);
}

describe('migration 027 is picked up by the migration scan', () => {
  it('applyMigrations records 027_dataset_cost_ledger.sql as applied', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        "select name from schema_migrations where name like '027_%' order by name",
      );
      expect(rows.map((r) => r.name)).toEqual(['027_dataset_cost_ledger.sql']);
    });
  });

  it('re-running applyMigrations against the same db is a no-op (idempotent scan)', async () => {
    await withDb(async (db) => {
      const applied = await applyMigrations(db, MIGRATIONS_DIR);
      expect(applied).toEqual([]);
    });
  });
});

describe('credit_transactions — widened reason/delta-sign/request_id CHECKs accept dataset_cost', () => {
  it('accepts a negative dataset_cost delta with a request_id', async () => {
    await withDb(async (db) => {
      await expect(insertDatasetDebit(db, randomUUID(), randomUUID())).resolves.toBeTypeOf('number');
    });
  });

  it('rejects a positive dataset_cost delta (delta-sign CHECK widened, not dropped)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, request_id, note)
           values ($1, 10, 'dataset_cost', $2, 'bad sign')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a dataset_cost row with no request_id (request_id_scope CHECK widened)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, note)
           values ($1, -10, 'dataset_cost', 'missing request id')`,
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

describe('credit_transactions — one dataset debit per (user, request)', () => {
  it('rejects a second dataset_cost row for the same (user, request_id) — raw insert must fail independent of any app-level debit function', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      await insertDatasetDebit(db, userId, requestId);
      await expect(insertDatasetDebit(db, userId, requestId)).rejects.toThrow();
    });
  });

  it('the same request_id for a different user is not a conflict', async () => {
    await withDb(async (db) => {
      const requestId = randomUUID();
      await expect(insertDatasetDebit(db, randomUUID(), requestId)).resolves.toBeTypeOf('number');
      await expect(insertDatasetDebit(db, randomUUID(), requestId)).resolves.toBeTypeOf('number');
    });
  });

  it('a question_cost and a dataset_cost row for the same (user, request_id) coexist (different partial indexes)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      const questionDebit = await debitQuestion(db, userId, requestId, 20);
      expect(questionDebit).not.toBeNull();
      await expect(insertDatasetDebit(db, userId, requestId)).resolves.toBeTypeOf('number');
    });
  });
});

describe('credit_transactions_validate_compensation — widened to reverse a dataset_cost debit', () => {
  it('accepts a compensation reversing a dataset_cost debit (trigger allowlist widened)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debitId = await insertDatasetDebit(db, userId, randomUUID());
      const comp = await compensate(db, userId, debitId, 10, null);
      expect(comp).not.toBeNull();
    });
  });

  it('still raises when a compensation targets a signup_grant (allowlist widened, not opened up)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const { rows } = await db.query(
        "select id from credit_transactions where user_id = $1 and reason = 'signup_grant'",
        [userId],
      );
      const grantId = Number(rows[0]!.id);
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, related_transaction_id, note)
           values ($1, 5, 'compensation', $2, 'wrong reason target')`,
          [userId, grantId],
        ),
      ).rejects.toThrow(/must reverse a question_cost, onboarding_cost, websearch_cost or dataset_cost row/);
    });
  });

  it('IMPORTANT (D12, "Fixed in review"): a dataset_cost compensation must be called with auditAnswerId: null — a non-null value referencing a non-existent audit_answers row is rejected by the real FK, not silently accepted', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debitId = await insertDatasetDebit(db, userId, randomUUID());
      // A dataset_turns id (or any made-up bigint) is NOT an audit_answers id
      // — passing one as auditAnswerId must fail loudly, proving the FK
      // itself is the backstop against the exact mistake the review found
      // was easy to make by pattern-matching off settleWebAddon.
      await expect(compensate(db, userId, debitId, 10, 999999)).rejects.toThrow();
    });
  });
});

describe('action_class_prices — CHECK widened to accept dataset_ingest and dataset_turn', () => {
  it('accepts the dataset_ingest class (the auto-generated constraint name was found and re-added)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into action_class_prices (action_class, credits) values ('dataset_ingest', 5)`,
        ),
      ).resolves.toBeTruthy();
    });
  });

  it('accepts the dataset_turn class', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into action_class_prices (action_class, credits) values ('dataset_turn', 10)`,
        ),
      ).resolves.toBeTruthy();
    });
  });

  it('still rejects an unknown action_class (the CHECK was widened, not dropped)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into action_class_prices (action_class, credits) values ('not_a_class', 5)`,
        ),
      ).rejects.toThrow();
    });
  });
});
