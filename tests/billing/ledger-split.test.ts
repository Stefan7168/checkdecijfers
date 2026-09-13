import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getBalance, QUESTION_DEBIT, reserveDebit, WEBSEARCH_DEBIT } from '../../src/billing/ledger.ts';
import { splitDebit, compensateSplit, getCurrentGrantId, getSpendableBalance } from '../../src/billing/ledger.ts';
import { grantBucket, getBucketBalance } from '../../src/billing/pro-bucket.ts';
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

async function seedSignup(db: Db, userId: string, credits: number): Promise<void> {
  await db.query(
    `insert into credit_transactions (user_id, delta, reason, note) values ($1, $2, 'signup_grant', 'test seed')`,
    [userId, credits],
  );
}

/** An active Pro subscription row, as the customer.subscription.* webhook
 * handlers will write it (Task 9) — inserted directly here so this file
 * stays independent of the Stripe plumbing. */
async function seedSubscription(db: Db, userId: string, grantId: string): Promise<void> {
  await db.query(
    `insert into pro_subscriptions
       (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
     values ($1, $2, $3, 'active', now() + interval '20 days', $4)`,
    [userId, `cus_${randomUUID()}`, `sub_${randomUUID()}`, grantId],
  );
}

async function countRows(db: Db, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await db.query(sql, params);
  return Number(rows[0]!.n);
}

function countLedgerDebits(db: Db, userId: string, requestId: string, reason: string): Promise<number> {
  return countRows(
    db,
    `select count(*) as n from credit_transactions
      where user_id = $1 and request_id = $2 and reason = $3`,
    [userId, requestId, reason],
  );
}

function countBucketDebits(db: Db, userId: string, requestId: string): Promise<number> {
  return countRows(
    db,
    `select count(*) as n from pro_bucket_ledger
      where user_id = $1 and request_id = $2 and reason = 'debit'`,
    [userId, requestId],
  );
}

describe('splitDebit — non-Pro user (no grant row)', () => {
  it('is byte-identical to a plain debitQuestion call: one ledger row, bucket untouched', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await seedSignup(db, userId, 100);
      const requestId = randomUUID();
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, requestId, 20, QUESTION_DEBIT, 'question debit'),
      );
      expect(split.fromBucket).toBe(0);
      expect(split.fromLedger).toBe(20);
      expect(split.bucketEntry).toBeNull();
      expect(split.ledgerEntry).not.toBeNull();
      expect(await getBalance(db, userId)).toBe(80);
    });
  });
});

describe('splitDebit — Pro user with an active bucket', () => {
  it('debits the bucket FIRST, only the remainder from the ledger', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, randomUUID(), 20, QUESTION_DEBIT, 'question debit', grantId),
      );
      expect(split.fromBucket).toBe(15);
      expect(split.fromLedger).toBe(5);
      expect(await getBucketBalance(db, userId, grantId)).toBe(0);
      expect(await getBalance(db, userId)).toBe(95); // 100 - 5
    });
  });

  it('debits ONLY the bucket when it fully covers the charge — zero credit_transactions rows written', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, randomUUID(), 20, QUESTION_DEBIT, 'question debit', grantId),
      );
      expect(split.fromBucket).toBe(20);
      expect(split.fromLedger).toBe(0);
      expect(split.ledgerEntry).toBeNull();
      expect(await getBalance(db, userId)).toBe(100); // untouched
      expect(await getBucketBalance(db, userId, grantId)).toBe(980);
    });
  });

  it('getSpendableBalance sums permanent balance + current bucket', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      expect(await getSpendableBalance(db, userId, grantId)).toBe(1100);
      expect(await getSpendableBalance(db, userId, null)).toBe(100);
    });
  });
});

// Regression pins for the cross-ledger idempotency gap found by review on
// 2026-09-13 and reproduced against a real migrated database: splitDebit used
// to pick a leg from the CURRENT bucket balance and then lean on that one
// table's own `on conflict`, which is blind to a retry that lands on the
// OTHER table. Both directions below cost real money when they regress — 40
// credits taken for one logical request, and gate.ts re-running the whole
// answer pipeline for it.
describe('splitDebit — cross-ledger idempotency (one logical request, one charge)', () => {
  it('a retry whose bucket was funded in between is a duplicate, not a second charge', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      const requestId = randomUUID();

      // 1. First attempt: no subscription at all, so the whole charge goes to
      //    the permanent ledger.
      const first = await reserveDebit(db, userId, requestId, 20);
      expect(first.kind).toBe('debited');
      expect(await getBalance(db, userId)).toBe(80);

      // 2. A Stripe invoice.paid webhook lands and funds the Pro bucket.
      await seedSubscription(db, userId, grantId);
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);

      // 3. The SAME requestId is retried (auto-retry, double submit). The leg
      //    splitDebit would now pick has changed under it.
      const retry = await reserveDebit(db, userId, requestId, 20);

      // (b) the result reflects the original debit, not a fresh one.
      expect(retry).toEqual({ kind: 'duplicate' });
      // (a) no second write to EITHER table.
      expect(await countLedgerDebits(db, userId, requestId, 'question_cost')).toBe(1);
      expect(await countBucketDebits(db, userId, requestId)).toBe(0);
      // (c) exactly 20 credits removed in total, not 40.
      expect(await getBalance(db, userId)).toBe(80);
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
    });
  });

  it('the mirror case: a bucket-funded debit retried after the grant lapsed is a duplicate too', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await seedSubscription(db, userId, grantId);
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const requestId = randomUUID();

      const first = await reserveDebit(db, userId, requestId, 20);
      expect(first.kind).toBe('debited');
      expect(await getBucketBalance(db, userId, grantId)).toBe(980);
      expect(await getBalance(db, userId)).toBe(100);

      // The subscription lapses before the retry — getCurrentGrantId now
      // returns null, so the old code would have debited the permanent ledger
      // for the full amount a second time.
      await db.query(
        `update pro_subscriptions set status = 'canceled', current_period_end = now() - interval '1 day'
          where user_id = $1`,
        [userId],
      );

      const retry = await reserveDebit(db, userId, requestId, 20);

      expect(retry).toEqual({ kind: 'duplicate' });
      expect(await countLedgerDebits(db, userId, requestId, 'question_cost')).toBe(0);
      expect(await countBucketDebits(db, userId, requestId)).toBe(1);
      expect(await getBalance(db, userId)).toBe(100);
      expect(await getBucketBalance(db, userId, grantId)).toBe(980);
    });
  });

  it('splitDebit itself returns the both-entries-null duplicate shape and writes nothing', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      const requestId = randomUUID();

      await db.withTransaction((tx) =>
        splitDebit(tx, userId, requestId, 20, QUESTION_DEBIT, 'question debit'),
      );
      await seedSubscription(db, userId, grantId);
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);

      const retry = await db.withTransaction((tx) =>
        splitDebit(tx, userId, requestId, 20, QUESTION_DEBIT, 'question debit', grantId),
      );

      expect(retry).toEqual({ fromBucket: 0, fromLedger: 0, bucketEntry: null, ledgerEntry: null });
      expect(await getBalance(db, userId)).toBe(80);
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
    });
  });

  it('the bucket-only half stands on its own: an unchanged, fully-funded bucket retried is one charge', async () => {
    // Isolates the pro_bucket_ledger side of the check from every cross-ledger
    // case above: the original debit AND the retry both resolve to a
    // bucket-only charge, subscription active and bucket still covering the
    // full amount at both moments, so credit_transactions is never involved
    // at all. Passes with and without the cross-ledger guard (the bucket's own
    // `on conflict` already covered it) — that is the point: it pins that the
    // guard's bucket half did not break same-table idempotency, and that the
    // bucket-only path is idempotent on its own terms.
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await seedSubscription(db, userId, grantId);
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const requestId = randomUUID();

      const first = await reserveDebit(db, userId, requestId, 20);
      expect(first.kind).toBe('debited');
      const retry = await reserveDebit(db, userId, requestId, 20);

      expect(retry).toEqual({ kind: 'duplicate' });
      expect(await countBucketDebits(db, userId, requestId)).toBe(1);
      expect(await countLedgerDebits(db, userId, requestId, 'question_cost')).toBe(0);
      expect(await getBucketBalance(db, userId, grantId)).toBe(980); // 20 once, not 40
      expect(await getBalance(db, userId)).toBe(100); // permanent balance never touched
    });
  });

  it('a DIFFERENT action type sharing the requestId is still a real charge (the ledger check is reason-scoped)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await seedSignup(db, userId, 100);
      const requestId = randomUUID();

      await db.withTransaction((tx) =>
        splitDebit(tx, userId, requestId, 20, QUESTION_DEBIT, 'question debit'),
      );
      // The web-search add-on deliberately rides along on the same requestId
      // as the question it augments (ADR 032) — a distinct, legitimate debit
      // under its own reason, never a duplicate of the question debit.
      const addon = await db.withTransaction((tx) =>
        splitDebit(tx, userId, requestId, 10, WEBSEARCH_DEBIT, 'websearch debit'),
      );

      expect(addon.ledgerEntry).not.toBeNull();
      expect(addon.fromLedger).toBe(10);
      expect(await getBalance(db, userId)).toBe(70);
    });
  });
});

describe('compensateSplit', () => {
  it('a full refund reverses both the bucket and the ledger portion, in the same proportion as the original charge', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, randomUUID(), 20, QUESTION_DEBIT, 'question debit', grantId),
      );
      await compensateSplit(db, userId, split, 20, null);
      expect(await getBalance(db, userId)).toBe(100);
      expect(await getBucketBalance(db, userId, grantId)).toBe(15);
    });
  });

  it('a partial refund reverses the bucket portion first, then the ledger', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, randomUUID(), 20, QUESTION_DEBIT, 'question debit', grantId),
      ); // fromBucket=15, fromLedger=5, balances now: ledger=95, bucket=0
      await compensateSplit(db, userId, split, 10, null); // refund 10: 10 back to bucket (capped at fromBucket=15), 0 to ledger
      expect(await getBucketBalance(db, userId, grantId)).toBe(10);
      expect(await getBalance(db, userId)).toBe(95);
    });
  });
});
