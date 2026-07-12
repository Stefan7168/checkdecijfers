// Migration 018 (WP129+130, ADR 032): the ledger widening for the new
// 'websearch_cost' reason + the 'web_addon' action-class price. Verifies the
// constraint behavior the migration claims, not just "the file applies" — per
// CLAUDE.md's "structural, never pattern-based" standard, these must be
// enforced by the database itself. Mirrors migration-012.test.ts's shape.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compensate, debitQuestion } from '../../src/billing/ledger.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
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

/** A raw negative-delta websearch_cost debit — deliberately NOT via
 * debitWebSearch, so the constraints are proven independent of the app code. */
async function insertWebSearchDebit(db: Db, userId: string, requestId: string): Promise<number> {
  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, request_id, note)
     values ($1, -10, 'websearch_cost', $2, 'test web debit')
     returning id`,
    [userId, requestId],
  );
  return Number(rows[0]!.id);
}

describe('migration 018 is picked up by the migration scan', () => {
  it('applyMigrations records 018_websearch_ledger.sql as applied', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        "select name from schema_migrations where name like '018_%' order by name",
      );
      expect(rows.map((r) => r.name)).toEqual(['018_websearch_ledger.sql']);
    });
  });

  it('re-running applyMigrations against the same db is a no-op (idempotent scan)', async () => {
    await withDb(async (db) => {
      const applied = await applyMigrations(db, MIGRATIONS_DIR);
      expect(applied).toEqual([]);
    });
  });
});

describe('credit_transactions — widened reason/delta-sign/request_id CHECKs accept websearch_cost', () => {
  it('accepts a negative websearch_cost delta with a request_id', async () => {
    await withDb(async (db) => {
      await expect(insertWebSearchDebit(db, randomUUID(), randomUUID())).resolves.toBeTypeOf('number');
    });
  });

  it('rejects a positive websearch_cost delta (delta-sign CHECK widened, not dropped)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, request_id, note)
           values ($1, 10, 'websearch_cost', $2, 'bad sign')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a websearch_cost row with no request_id (request_id_scope CHECK widened)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, note)
           values ($1, -10, 'websearch_cost', 'missing request id')`,
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

  it('question_cost and onboarding_cost still behave exactly as before (regression guard on the widened CHECKs)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const entry = await debitQuestion(db, userId, randomUUID(), 20);
      expect(entry).not.toBeNull();
      // onboarding_cost negative-delta + request_id still accepted.
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, request_id, note)
           values ($1, -100, 'onboarding_cost', $2, 'ok')`,
          [userId, randomUUID()],
        ),
      ).resolves.toBeTruthy();
      // ...and a positive question_cost is still rejected.
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

describe('credit_transactions — one websearch debit per (user, request)', () => {
  it('rejects a second websearch_cost row for the same (user, request_id) — raw insert must fail independent of debitWebSearch', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      await insertWebSearchDebit(db, userId, requestId);
      await expect(insertWebSearchDebit(db, userId, requestId)).rejects.toThrow();
    });
  });

  it('the same request_id for a different user is not a conflict', async () => {
    await withDb(async (db) => {
      const requestId = randomUUID();
      await expect(insertWebSearchDebit(db, randomUUID(), requestId)).resolves.toBeTypeOf('number');
      await expect(insertWebSearchDebit(db, randomUUID(), requestId)).resolves.toBeTypeOf('number');
    });
  });

  it('a question_cost and a websearch_cost row for the same (user, request_id) coexist (different partial indexes)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      const questionDebit = await debitQuestion(db, userId, requestId, 20);
      expect(questionDebit).not.toBeNull();
      await expect(insertWebSearchDebit(db, userId, requestId)).resolves.toBeTypeOf('number');
    });
  });
});

describe('credit_transactions_validate_compensation — widened to reverse a websearch_cost debit', () => {
  it('accepts a compensation reversing a websearch_cost debit (trigger allowlist widened)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debitId = await insertWebSearchDebit(db, userId, randomUUID());
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
      ).rejects.toThrow(/must reverse a question_cost, onboarding_cost or websearch_cost row/);
    });
  });
});

describe('action_class_prices — CHECK widened to accept web_addon', () => {
  it('accepts the web_addon class (the auto-generated constraint name was found and re-added)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into action_class_prices (action_class, credits) values ('web_addon', 10)`,
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

  it('pricing-apply seeds the web_addon price at 10 (defaults + migration agree)', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const { rows } = await db.query(
        "select credits from action_class_prices where action_class = 'web_addon'",
      );
      expect(Number(rows[0]!.credits)).toBe(10);
    });
  });
});
