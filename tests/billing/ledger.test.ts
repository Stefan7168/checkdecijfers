// Credit ledger (migration 005, ADR 020): append-only enforcement, the
// reason/delta-sign CHECK, signup-grant idempotency, and the idempotent
// debit/compensate primitives gate.ts relies on.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compensate, debitQuestion, getActionClassPrice, getBalance, reserveDebit } from '../../src/billing/ledger.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
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

describe('credit_transactions — append-only, structurally enforced', () => {
  it('rejects UPDATE against a real row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await debitQuestion(db, userId, randomUUID(), 1); // negative delta, valid
      await expect(db.query('update credit_transactions set delta = 0 where user_id = $1', [userId])).rejects.toThrow(
        /append-only/,
      );
    });
  });

  it('rejects DELETE against a real row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await debitQuestion(db, userId, randomUUID(), 1);
      await expect(db.query('delete from credit_transactions where user_id = $1', [userId])).rejects.toThrow(
        /append-only/,
      );
    });
  });
});

describe('credit_transactions — reason/delta-sign CHECK', () => {
  it('rejects a positive question_cost delta', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, request_id, note)
           values ($1, 1, 'question_cost', $2, 'bad sign')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a negative signup_grant delta', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, note)
           values ($1, -5, 'signup_grant', 'bad sign')`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a question_cost row with no request_id (the scope CHECK)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, note)
           values ($1, -1, 'question_cost', 'missing request id')`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  // The matched set's other two scope CHECKs (adversarial-review finding,
  // WP13: only request_id_scope had a direct test; stripe_scope and
  // related_scope did not, despite being structurally identical guarantees).
  it('rejects a purchase row with no stripe_checkout_session_id (the stripe scope CHECK)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, note)
           values ($1, 10, 'purchase', 'missing stripe session id')`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a compensation row with no related_transaction_id (the related scope CHECK)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, note)
           values ($1, 1, 'compensation', 'missing related transaction id')`,
          [randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('credit_transactions_validate_compensation (migration 008, adversarial-review finding)', () => {
  it('rejects a compensation whose user_id does not match the debit it reverses', async () => {
    await withDb(async (db) => {
      const debtorId = randomUUID();
      const otherUserId = randomUUID();
      const debit = await debitQuestion(db, debtorId, randomUUID(), 20);
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, related_transaction_id, note)
           values ($1, 20, 'compensation', $2, 'wrong user')`,
          [otherUserId, debit!.id],
        ),
      ).rejects.toThrow(/does not match/);
    });
  });

  it('rejects a compensation whose related_transaction_id points at a non-question_cost row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      // A signup_grant row is a legitimate credit_transactions row, but not
      // something a compensation should ever "reverse".
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
      ).rejects.toThrow(/must reverse a question_cost row/);
    });
  });

  it('accepts a well-formed compensation reversing the caller\'s own debit (the real path)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debit = await debitQuestion(db, userId, randomUUID(), 20);
      const comp = await compensate(db, userId, debit!.id, 10, null);
      expect(comp).not.toBeNull();
    });
  });
});

describe('action_class_prices_validate_clarification_price (migration 008, adversarial-review finding)', () => {
  it('rejects raising clarification above the current simple price', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db); // clarification=10, simple=20
      await expect(
        db.query("update action_class_prices set credits = 25 where action_class = 'clarification'"),
      ).rejects.toThrow(/must never exceed the simple price/);
    });
  });

  it('rejects lowering simple below the current clarification price', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db); // clarification=10, simple=20
      await expect(
        db.query("update action_class_prices set credits = 5 where action_class = 'simple'"),
      ).rejects.toThrow(/must never exceed the simple price/);
    });
  });

  it('accepts clarification == simple (the boundary gate.ts treats as "no refund needed")', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      await db.query("update action_class_prices set credits = 20 where action_class = 'clarification'");
      const { rows } = await db.query("select credits from action_class_prices where action_class = 'clarification'");
      expect(Number(rows[0]!.credits)).toBe(20);
    });
  });
});

describe('grant_signup_credits — idempotent, security-definer trigger target', () => {
  it('grants the configured signup amount exactly once, even called twice', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      await db.query('select public.grant_signup_credits($1)', [userId]);
      expect(await getBalance(db, userId)).toBe(100); // docs/09-pricing.md signup grant
      const { rows } = await db.query(
        "select count(*) c from credit_transactions where user_id = $1 and reason = 'signup_grant'",
        [userId],
      );
      expect(Number(rows[0]!.c)).toBe(1);
    });
  });

  it('reads the amount from signup_grant_config, not a hardcoded literal', async () => {
    await withDb(async (db) => {
      await db.query('update signup_grant_config set credits = 7');
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      expect(await getBalance(db, userId)).toBe(7);
    });
  });
});

describe('getBalance — SUM(delta), no mutable balance column', () => {
  it('sums signup grant + purchase + debit + compensation correctly', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]); // +100
      const debit = await debitQuestion(db, userId, randomUUID(), 1); // -1
      expect(debit).not.toBeNull();
      expect(await getBalance(db, userId)).toBe(99);
      await compensate(db, userId, debit!.id, 1, null); // +1
      expect(await getBalance(db, userId)).toBe(100);
    });
  });

  it('a user with no rows has balance 0', async () => {
    await withDb(async (db) => {
      expect(await getBalance(db, randomUUID())).toBe(0);
    });
  });
});

describe('debitQuestion — idempotent per (user, request)', () => {
  it('a repeated requestId is a no-op, never a second charge', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      const first = await debitQuestion(db, userId, requestId, 1);
      const second = await debitQuestion(db, userId, requestId, 1);
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await getBalance(db, userId)).toBe(-1);
    });
  });

  it('the same requestId for a DIFFERENT user is not a conflict', async () => {
    await withDb(async (db) => {
      const requestId = randomUUID();
      const a = await debitQuestion(db, randomUUID(), requestId, 1);
      const b = await debitQuestion(db, randomUUID(), requestId, 1);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    });
  });
});

describe('reserveDebit — atomic check-and-debit (adversarial-review fix, WP13)', () => {
  it('debits when balance is sufficient', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]); // +100
      const result = await reserveDebit(db, userId, randomUUID(), 20);
      expect(result.kind).toBe('debited');
      expect(await getBalance(db, userId)).toBe(80);
    });
  });

  it('returns "insufficient" (never calling debitQuestion) for a zero balance', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const result = await reserveDebit(db, userId, randomUUID(), 20);
      expect(result).toEqual({ kind: 'insufficient', balance: 0 });
      expect(await getBalance(db, userId)).toBe(0);
    });
  });

  // The general comparison (balance < required) covers more than "balance is
  // exactly zero" — this pins the nonzero-but-still-short case a
  // zero-balance-only regression would not catch (adversarial-review finding).
  it('returns "insufficient" for a nonzero balance that still falls short', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]); // +100
      await reserveDebit(db, userId, randomUUID(), 85); // balance -> 15
      const result = await reserveDebit(db, userId, randomUUID(), 20); // 15 < 20
      expect(result).toEqual({ kind: 'insufficient', balance: 15 });
    });
  });

  it('a repeated requestId returns "duplicate", never a second debit', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const requestId = randomUUID();
      const first = await reserveDebit(db, userId, requestId, 20);
      const second = await reserveDebit(db, userId, requestId, 20);
      expect(first.kind).toBe('debited');
      expect(second).toEqual({ kind: 'duplicate' });
      expect(await getBalance(db, userId)).toBe(80);
    });
  });

  // The actual proof of the adversarial-review fix: getBalance and
  // debitQuestion used to be two independent statements, so two concurrent
  // calls with DIFFERENT requestIds for a user at EXACTLY enough balance for
  // one debit could both read the same pre-debit balance and both pass the
  // check. With the per-user advisory-lock transaction, exactly one must
  // succeed and the other must see the already-reduced balance.
  //
  // Honest limitation: PGlite (this test's engine, ADR 009) serves one
  // connection only — tests/helpers/pglite-db.ts's own mutex means the whole
  // reserveDebit transaction body already runs as one indivisible unit here,
  // so this test would pass even without pg_advisory_xact_lock, as long as
  // the check-and-debit are bundled into one db.withTransaction call. What
  // it DOES prove: the observable contract (concurrent same-user debits
  // never both succeed past the balance). The advisory lock is what makes
  // that hold on the real, multi-connection pg.Pool in production, where
  // Postgres's default READ COMMITTED isolation would otherwise let two
  // separate pooled connections each take their own snapshot and both pass
  // the check — this hermetic suite cannot exercise true multi-connection
  // concurrency, per ADR 009's own tradeoff.
  it('serializes two concurrent debits for the SAME user at exactly-enough balance — only one succeeds', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]); // +100
      // Spend down to exactly one debit's worth (20), so a second concurrent
      // debit of 20 can only succeed if the race actually exists.
      await reserveDebit(db, userId, randomUUID(), 80); // balance -> 20

      const [a, b] = await Promise.all([
        reserveDebit(db, userId, randomUUID(), 20),
        reserveDebit(db, userId, randomUUID(), 20),
      ]);

      const outcomes = [a.kind, b.kind].sort();
      expect(outcomes).toEqual(['debited', 'insufficient']);
      // Net balance proves exactly one debit landed, not zero and not two.
      expect(await getBalance(db, userId)).toBe(0);
    });
  });

  it('concurrent debits for DIFFERENT users never contend with each other', async () => {
    await withDb(async (db) => {
      const userA = randomUUID();
      const userB = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userA]);
      await db.query('select public.grant_signup_credits($1)', [userB]);

      const [a, b] = await Promise.all([
        reserveDebit(db, userA, randomUUID(), 20),
        reserveDebit(db, userB, randomUUID(), 20),
      ]);

      expect(a.kind).toBe('debited');
      expect(b.kind).toBe('debited');
      expect(await getBalance(db, userA)).toBe(80);
      expect(await getBalance(db, userB)).toBe(80);
    });
  });
});

describe('compensate — idempotent per debit', () => {
  it('a repeated call for the same debitId is a no-op, never a double refund', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debit = await debitQuestion(db, userId, randomUUID(), 1);
      const first = await compensate(db, userId, debit!.id, 1, null);
      const second = await compensate(db, userId, debit!.id, 1, null);
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await getBalance(db, userId)).toBe(0);
    });
  });
});

describe('getActionClassPrice', () => {
  it('reads the configured price once pricing-apply has run', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      expect(await getActionClassPrice(db, 'simple')).toBe(20);
      expect(await getActionClassPrice(db, 'analysis')).toBe(60);
      expect(await getActionClassPrice(db, 'heavy')).toBe(100);
      expect(await getActionClassPrice(db, 'clarification')).toBe(10);
    });
  });

  it('fails loudly, never a silent 0, when pricing has never been applied', async () => {
    await withDb(async (db) => {
      await expect(getActionClassPrice(db, 'simple')).rejects.toThrow(/pricing:apply/);
    });
  });
});
