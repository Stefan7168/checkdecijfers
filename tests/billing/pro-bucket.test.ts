import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compensateBucket,
  debitBucket,
  getBucketBalance,
  grantBucket,
} from '../../src/billing/pro-bucket.ts';
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

describe('pro-bucket ledger', () => {
  it('a fresh grant balance is 0 before any grant', async () => {
    await withDb(async (db) => {
      expect(await getBucketBalance(db, randomUUID(), randomUUID())).toBe(0);
    });
  });

  it('grantBucket credits the balance; a repeated stripeInvoiceId is a no-op', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      const invoiceId = `in_${randomUUID()}`;
      const first = await grantBucket(db, userId, grantId, 1000, invoiceId);
      expect(first).not.toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
      const second = await grantBucket(db, userId, grantId, 1000, invoiceId);
      expect(second).toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
    });
  });

  it('debitBucket debits the balance; a repeated requestId is a no-op', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const requestId = randomUUID();
      const first = await debitBucket(db, userId, grantId, requestId, 300, 'test debit');
      expect(first).not.toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(700);
      const second = await debitBucket(db, userId, grantId, requestId, 300, 'test debit');
      expect(second).toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(700);
    });
  });

  it('a debit against a DIFFERENT grantId than the current one still writes (caller decides which grant is current) but does not affect the other grant\'s balance', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantA = randomUUID();
      const grantB = randomUUID();
      await grantBucket(db, userId, grantA, 1000, `in_${randomUUID()}`);
      await grantBucket(db, userId, grantB, 1000, `in_${randomUUID()}`);
      await debitBucket(db, userId, grantA, randomUUID(), 400, 'test');
      expect(await getBucketBalance(db, userId, grantA)).toBe(600);
      expect(await getBucketBalance(db, userId, grantB)).toBe(1000);
    });
  });

  it('compensateBucket refunds credits tied to the original debit; a repeated call for the same debit is a no-op', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const debit = await debitBucket(db, userId, grantId, randomUUID(), 400, 'test');
      const first = await compensateBucket(db, userId, debit!.id, 400);
      expect(first).not.toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
      const second = await compensateBucket(db, userId, debit!.id, 400);
      expect(second).toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
    });
  });

  it('the append-only trigger rejects an UPDATE against a real row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      const entry = await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      await expect(
        db.query('update pro_bucket_ledger set delta = 0 where id = $1', [entry!.id]),
      ).rejects.toThrow(/append-only/);
    });
  });
});
