import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { debitQuestion, getBalance } from '../../src/billing/ledger.ts';
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

describe('splitDebit — non-Pro user (no grant row)', () => {
  it('is byte-identical to a plain debitQuestion call: one ledger row, bucket untouched', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await seedSignup(db, userId, 100);
      const requestId = randomUUID();
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, requestId, 20, debitQuestion, 'question debit'),
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
        splitDebit(tx, userId, randomUUID(), 20, debitQuestion, 'question debit', grantId),
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
        splitDebit(tx, userId, randomUUID(), 20, debitQuestion, 'question debit', grantId),
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

describe('compensateSplit', () => {
  it('a full refund reverses both the bucket and the ledger portion, in the same proportion as the original charge', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, randomUUID(), 20, debitQuestion, 'question debit', grantId),
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
        splitDebit(tx, userId, randomUUID(), 20, debitQuestion, 'question debit', grantId),
      ); // fromBucket=15, fromLedger=5, balances now: ledger=95, bucket=0
      await compensateSplit(db, userId, split, 10, null); // refund 10: 10 back to bucket (capped at fromBucket=15), 0 to ledger
      expect(await getBucketBalance(db, userId, grantId)).toBe(10);
      expect(await getBalance(db, userId)).toBe(95);
    });
  });
});
