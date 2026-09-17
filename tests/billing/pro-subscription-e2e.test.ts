// #205 Task 13 — one end-to-end walk through the whole Pro subscription
// lifecycle, through PUBLIC surfaces only (webhook events in, ledger/bucket
// balances out): subscribe -> spend from bucket -> renew -> old grant lost
// -> cancel. The integration proof that every task (1-12) above composes
// correctly, on top of real webhook signature verification and the real
// transaction/lock paths (reserveDebit's advisory lock, grantMonthlyAllowance's
// db.withTransaction) — nothing here is mocked.
//
// Deliberately does NOT hand-roll the Stripe event JSON itself (task brief's
// own carried-forward warning, already the cause of two review rounds in
// this plan — Task 9 and Task 10 each independently rediscovered the same
// bug: the installed `stripe` SDK (22.6.1) uses per-ITEM
// `current_period_end` and `invoice.parent.subscription_details.subscription`,
// not the flatter shapes an earlier draft of this plan illustrated). Instead
// this imports the real, already-corrected fixture builders from
// tests/helpers/stripe-fixtures.ts (the same module
// tests/billing/stripe-webhook.test.ts itself now uses) so a third silent
// regression to the wrong shape is structurally impossible — there is
// exactly one place these payloads are built, and every test that needs one
// shares it. (Not imported directly from stripe-webhook.test.ts: a plain
// module import of a test file re-executes its own top-level describe/it
// calls as a side effect, which would silently double-run that file's whole
// suite inside this one — see stripe-fixtures.ts's header.)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleStripeEvent } from '../../src/billing/stripe-webhook.ts';
import { getBalance, reserveDebit } from '../../src/billing/ledger.ts';
import { getBucketBalance } from '../../src/billing/pro-bucket.ts';
import { hasProPlan } from '../../src/billing/pro.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';
import { WEBHOOK_SECRET, invoicePaidPayload, sign, subscriptionEventPayload } from '../helpers/stripe-fixtures.ts';

// Per this codebase's own convention (every tests/billing/*.test.ts file
// defines its own local withDb rather than sharing one) — see
// tests/billing/stripe-webhook.test.ts, ledger.test.ts, pro.test.ts, etc.
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

describe('Pro subscription — full lifecycle', () => {
  it('subscribe -> spend from bucket -> renew -> old grant is lost, permanent ledger never touched', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(
        `insert into credit_transactions (user_id, delta, reason, note) values ($1, 100, 'signup_grant', 'seed')`,
        [userId],
      );

      // 1. Subscribe: subscription.created + first invoice.paid
      const periodEnd1 = Math.floor(Date.now() / 1000) + 30 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd1);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);
      const invoice1 = invoicePaidPayload('in_1', 'sub_1', userId);
      await handleStripeEvent(db, invoice1, sign(invoice1), WEBHOOK_SECRET);

      expect(await hasProPlan(db, { id: userId, email: null })).toBe(true);
      const grant1 = (await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId]))
        .rows[0]!.current_period_grant_id as string;
      expect(await getBucketBalance(db, userId, grant1)).toBe(1000);

      // 2. Spend 300 from the bucket via the real reserveDebit path
      const result = await reserveDebit(db, userId, randomUUID(), 300);
      expect(result.kind).toBe('debited');
      expect(await getBucketBalance(db, userId, grant1)).toBe(700);
      expect(await getBalance(db, userId)).toBe(100); // permanent ledger untouched

      // 3. Renew: a second invoice.paid rotates the grant
      const invoice2 = invoicePaidPayload('in_2', 'sub_1', userId);
      await handleStripeEvent(db, invoice2, sign(invoice2), WEBHOOK_SECRET);
      const grant2 = (await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId]))
        .rows[0]!.current_period_grant_id as string;

      expect(grant2).not.toBe(grant1);
      expect(await getBucketBalance(db, userId, grant2)).toBe(1000); // fresh allowance
      expect(await getBucketBalance(db, userId, grant1)).toBe(700); // old grant's history is still queryable, just no longer current

      // 4. The 700 leftover credits from grant1 are structurally invisible to
      // new spend — reserveDebit only ever reads the CURRENT grant id
      // (getCurrentGrantId), so this is verified structurally (grant2 !==
      // grant1, and grant1's own balance is untouched by this spend), not
      // just "happens to equal zero."
      const secondSpend = await reserveDebit(db, userId, randomUUID(), 20);
      expect(secondSpend.kind).toBe('debited');
      expect(await getBucketBalance(db, userId, grant2)).toBe(980); // drawn from the NEW grant
      expect(await getBucketBalance(db, userId, grant1)).toBe(700); // untouched, permanently unreachable
      expect(await getBalance(db, userId)).toBe(100); // permanent ledger STILL untouched throughout

      // 5. Cancel: subscription.deleted, but current_period_end is still
      // future — status='canceled' is never Pro-eligible regardless (Stripe's
      // own convention: 'canceled' means immediately over; a grace period is
      // expressed via 'active'+cancel_at_period_end staying 'active' until
      // the boundary, never via a future-dated 'canceled').
      const deleted = subscriptionEventPayload('customer.subscription.deleted', 'sub_1', 'cus_1', userId, 'canceled', periodEnd1);
      await handleStripeEvent(db, deleted, sign(deleted), WEBHOOK_SECRET);
      expect(await hasProPlan(db, { id: userId, email: null })).toBe(false);
    });
  });
});
