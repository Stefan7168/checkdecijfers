// Stripe webhook handling (src/billing/stripe-webhook.ts, ADR 006 seam 4):
// signature verification and ledger-append, entirely hermetic — signed with
// Stripe's own `generateTestHeaderString` test helper against a hand-authored
// `checkout.session.completed` fixture. No network, no live Stripe account.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleStripeEvent } from '../../src/billing/stripe-webhook.ts';
import { getBalance } from '../../src/billing/ledger.ts';
import { getBucketBalance } from '../../src/billing/pro-bucket.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';
// WEBHOOK_SECRET/sign and the two Stripe-shape-sensitive fixture builders
// (subscriptionEventPayload, invoicePaidPayload) live in a shared, non-test
// helper module — not defined locally and exported from here — so that
// tests/billing/pro-subscription-e2e.test.ts (#205 Task 13) can import and
// call the real, already-corrected builders instead of re-deriving the
// installed `stripe` SDK's actual event shapes a second time, WITHOUT that
// import also re-executing this file's own describe/it suite as a side
// effect (see tests/helpers/stripe-fixtures.ts's header for why a plain
// test-to-test import would do that).
import { WEBHOOK_SECRET, invoicePaidPayload, sign, subscriptionEventPayload } from '../helpers/stripe-fixtures.ts';

/** #146: every checkout-session event now carries `payment_status` — default
 * 'paid' so every EXISTING call site below (a synchronous card/iDEAL-shaped
 * payment) is unaffected; the #146 describe block passes 'unpaid'/'processing'
 * explicitly to exercise the new delayed-notification gating. */
function checkoutEventPayload(
  type: 'checkout.session.completed' | 'checkout.session.async_payment_succeeded' | 'checkout.session.async_payment_failed',
  sessionId: string,
  userId: string,
  packId = 'pack_5',
  credits = '200',
  paymentStatus = 'paid',
): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        // #205 final review: a real one-time credit-pack session always
        // carries mode: 'payment' (buildCheckoutSessionParams). It was absent
        // from this fixture before the subscription tier existed, when
        // 'payment' was the only mode this app ever created; stated
        // explicitly now that the handler branches on it.
        mode: 'payment',
        payment_status: paymentStatus,
        metadata: { userId, packId, credits },
      },
    },
  });
}

/** #205 final whole-branch review: a Pro (`mode: 'subscription'`) Checkout
 * Session event — the SAME event type Stripe fires for a credit-pack
 * purchase, but carrying only `metadata.userId`, exactly as
 * `buildProSubscriptionCheckoutParams` (src/billing/stripe-checkout.ts)
 * builds it. Deliberately NOT checkoutEventPayload with a flag: the absence
 * of `packId`/`credits` is the whole point — it is what made the unguarded
 * pack-purchase handler throw (HTTP 400 → ~3 days of Stripe retries against
 * the destination the live credit-pack flow shares). */
function subscriptionCheckoutPayload(
  type: 'checkout.session.completed' | 'checkout.session.async_payment_succeeded',
  sessionId: string,
  userId: string,
  paymentStatus = 'paid',
): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'subscription',
        payment_status: paymentStatus,
        metadata: { userId },
      },
    },
  });
}

function checkoutCompletedPayload(
  sessionId: string,
  userId: string,
  packId = 'pack_5',
  credits = '200',
  paymentStatus = 'paid',
): string {
  return checkoutEventPayload('checkout.session.completed', sessionId, userId, packId, credits, paymentStatus);
}

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

describe('handleStripeEvent — valid signature', () => {
  it('credits the ledger exactly once for checkout.session.completed', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const sessionId = `cs_test_${randomUUID()}`;
      const payload = checkoutCompletedPayload(sessionId, userId, 'pack_5', '200');
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result).toMatchObject({ handled: true, alreadyProcessed: false });
      expect(result.ledgerId).not.toBeNull();
      expect(await getBalance(db, userId)).toBe(200);
    });
  });

  it('ignores event types it does not subscribe to', async () => {
    await withDb(async (db) => {
      const payload = JSON.stringify({ id: `evt_${randomUUID()}`, object: 'event', type: 'payment_intent.created', data: { object: {} } });
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result).toEqual({ handled: false, alreadyProcessed: false, ledgerId: null });
    });
  });
});

describe('handleStripeEvent — invalid signature', () => {
  it('rejects a payload signed with the wrong secret, no ledger row written', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const payload = checkoutCompletedPayload(`cs_test_${randomUUID()}`, userId);
      const badHeader = sign(payload, 'whsec_wrong_secret');
      await expect(handleStripeEvent(db, payload, badHeader, WEBHOOK_SECRET)).rejects.toThrow();
      expect(await getBalance(db, userId)).toBe(0);
    });
  });

  it('rejects a tampered payload (signature no longer matches the bytes)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const payload = checkoutCompletedPayload(`cs_test_${randomUUID()}`, userId, 'pack_5', '200');
      const header = sign(payload);
      const tampered = payload.replace('"credits":"200"', '"credits":"999999"');
      await expect(handleStripeEvent(db, tampered, header, WEBHOOK_SECRET)).rejects.toThrow();
      expect(await getBalance(db, userId)).toBe(0);
    });
  });
});

describe('handleStripeEvent — replayed delivery', () => {
  it('a retried delivery of the same session is a no-op, never a double credit', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const sessionId = `cs_test_${randomUUID()}`;
      const payload = checkoutCompletedPayload(sessionId, userId, 'pack_10', '500');
      const header = sign(payload);

      const first = await handleStripeEvent(db, payload, header, WEBHOOK_SECRET);
      const second = await handleStripeEvent(db, payload, header, WEBHOOK_SECRET);

      expect(first.alreadyProcessed).toBe(false);
      expect(second).toEqual({ handled: true, alreadyProcessed: true, ledgerId: null });
      expect(await getBalance(db, userId)).toBe(500); // exactly once
    });
  });
});

describe('handleStripeEvent — malformed metadata', () => {
  it('throws on missing/invalid metadata rather than crediting garbage', async () => {
    await withDb(async (db) => {
      const payload = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        type: 'checkout.session.completed',
        // #146: payment_status: 'paid' — this must reach creditPurchase's
        // metadata check, not be short-circuited by the new payment_status
        // gate first (that gate has its own dedicated describe block below).
        data: {
          object: { id: `cs_test_${randomUUID()}`, object: 'checkout.session', payment_status: 'paid', metadata: {} },
        },
      });
      await expect(handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET)).rejects.toThrow(/metadata/);
    });
  });
});

// #205 final whole-branch review (HIGH finding): Stripe fires
// `checkout.session.completed` for BOTH one-time credit-pack sessions and
// Pro subscription sessions. Before the mode guard in
// src/billing/stripe-webhook.ts, a real Pro signup's event fell into the
// pack-purchase handler and threw on its missing packId/credits metadata —
// a 400 back to Stripe and ~3 days of retries per signup, against the same
// webhook destination the live credit-pack flow depends on.
describe('checkout.session.* for a Pro subscription session (#205 final review)', () => {
  it("does NOT attempt a credit-pack purchase for a mode: 'subscription' checkout.session.completed", async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const sessionId = `cs_test_${randomUUID()}`;
      const payload = subscriptionCheckoutPayload('checkout.session.completed', sessionId, userId);

      // (1) It must not throw — a throw is exactly what the Route Handler
      // turns into the 400 that triggers Stripe's 3-day retry storm.
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);

      // (2) Same "recognized, but no work for this branch" shape this file
      // already uses for a non-subscription invoice and for an unsubscribed
      // event type — a 200 back to Stripe, no retries.
      expect(result).toEqual({ handled: false, alreadyProcessed: false, ledgerId: null });

      // (3) It really did not run the pack-purchase path: no ledger row at
      // all for this user (a balance check alone could not distinguish a
      // zero-credit row from no row).
      expect(await getBalance(db, userId)).toBe(0);
      const { rows } = await db.query('select 1 from credit_transactions where user_id = $1', [userId]);
      expect(rows).toHaveLength(0);
      // Nor did it write anything against the session id under any user.
      const { rows: bySession } = await db.query(
        'select 1 from credit_transactions where stripe_checkout_session_id = $1',
        [sessionId],
      );
      expect(bySession).toHaveLength(0);
    });
  });

  it("does NOT attempt a credit-pack purchase for a mode: 'subscription' async_payment_succeeded either", async () => {
    // Dormant today (the destination isn't subscribed to this event type, and
    // the account is card-only) — guarded anyway: it calls the identical
    // creditPurchase on the identical object and would throw identically.
    await withDb(async (db) => {
      const userId = randomUUID();
      const sessionId = `cs_test_${randomUUID()}`;
      const payload = subscriptionCheckoutPayload('checkout.session.async_payment_succeeded', sessionId, userId);
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result).toEqual({ handled: false, alreadyProcessed: false, ledgerId: null });
      expect(await getBalance(db, userId)).toBe(0);
    });
  });

  it("still credits an ordinary mode: 'payment' pack purchase — the guard is exact, not a truthiness test", async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const payload = checkoutCompletedPayload(`cs_test_${randomUUID()}`, userId, 'pack_5', '200');
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result).toMatchObject({ handled: true, alreadyProcessed: false });
      expect(await getBalance(db, userId)).toBe(200);
    });
  });

  it('still credits a session with no mode field at all (older/absent mode is not treated as a subscription)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const payload = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_test_${randomUUID()}`,
            object: 'checkout.session',
            payment_status: 'paid',
            metadata: { userId, packId: 'pack_5', credits: '200' },
          },
        },
      });
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result).toMatchObject({ handled: true, alreadyProcessed: false });
      expect(await getBalance(db, userId)).toBe(200);
    });
  });
});

// #205 Task 9: `customer.subscription.*` events, via subscriptionEventPayload
// (imported above from tests/helpers/stripe-fixtures.ts — see its header for
// the shape notes vs. the task brief's original sample: current_period_end
// lives on the subscription ITEM, and every event carries its own top-level
// `created`, exercised by the out-of-order-delivery guard tests below).
describe('subscription lifecycle webhooks (#205 Task 9)', () => {
  it('customer.subscription.created upserts a pro_subscriptions row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 20 * 86400;
      const payload = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result).toEqual({ handled: true, alreadyProcessed: false, ledgerId: null });
      const { rows } = await db.query('select * from pro_subscriptions where user_id = $1', [userId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('active');
      expect(rows[0]!.stripe_subscription_id).toBe('sub_1');
      expect(Math.floor(new Date(rows[0]!.current_period_end as string).getTime() / 1000)).toBe(periodEnd);
    });
  });

  it('customer.subscription.updated updates status and current_period_end for an existing row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd1 = Math.floor(Date.now() / 1000) + 20 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd1);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const periodEnd2 = Math.floor(Date.now() / 1000) + 50 * 86400;
      const updated = subscriptionEventPayload('customer.subscription.updated', 'sub_1', 'cus_1', userId, 'past_due', periodEnd2);
      await handleStripeEvent(db, updated, sign(updated), WEBHOOK_SECRET);

      const { rows } = await db.query('select * from pro_subscriptions where user_id = $1', [userId]);
      expect(rows[0]!.status).toBe('past_due');
      expect(Math.floor(new Date(rows[0]!.current_period_end as string).getTime() / 1000)).toBe(periodEnd2);
    });
  });

  it('customer.subscription.deleted sets status to canceled', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 20 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const deleted = subscriptionEventPayload('customer.subscription.deleted', 'sub_1', 'cus_1', userId, 'canceled', periodEnd);
      await handleStripeEvent(db, deleted, sign(deleted), WEBHOOK_SECRET);

      const { rows } = await db.query('select * from pro_subscriptions where user_id = $1', [userId]);
      expect(rows[0]!.status).toBe('canceled');
    });
  });

  it('a subscription event missing metadata.userId throws (never silently dropped)', async () => {
    await withDb(async (db) => {
      const payload = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        created: Math.floor(Date.now() / 1000),
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_1',
            object: 'subscription',
            customer: 'cus_1',
            status: 'active',
            items: { object: 'list', data: [{ id: 'si_1', object: 'subscription_item', current_period_end: 0 }] },
            metadata: {},
          },
        },
      });
      await expect(handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET)).rejects.toThrow();
      // Prove it's a real throw, not a vacuous one that happens to reject for
      // an unrelated reason — no row should ever be written for this user.
      const { rows } = await db.query("select 1 from pro_subscriptions where stripe_subscription_id = 'sub_1'");
      expect(rows).toHaveLength(0);
    });
  });

  it('a subscription with no items throws rather than guessing a current_period_end', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const payload = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        created: Math.floor(Date.now() / 1000),
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_1',
            object: 'subscription',
            customer: 'cus_1',
            status: 'active',
            items: { object: 'list', data: [] },
            metadata: { userId },
          },
        },
      });
      await expect(handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET)).rejects.toThrow(/no items/);
    });
  });
});

// #205 Task 10: `invoice.paid`, via invoicePaidPayload (imported above from
// tests/helpers/stripe-fixtures.ts — see its header for the shape deviation
// vs. the task brief's original sample: the real subscription id lives at
// `invoice.parent.subscription_details.subscription`, not a top-level
// `invoice.subscription` field; see also stripe-webhook.ts's own
// `invoiceSubscriptionId` doc comment).
describe('invoice.paid — the renewal grant (#205 Task 10)', () => {
  it('grants 1000 credits to a fresh bucket, rotating current_period_grant_id', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const invoice = invoicePaidPayload('in_1', 'sub_1', userId);
      const result = await handleStripeEvent(db, invoice, sign(invoice), WEBHOOK_SECRET);
      expect(result).toEqual({ handled: true, alreadyProcessed: false, ledgerId: null });

      const { rows } = await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId]);
      const grantId = rows[0]!.current_period_grant_id as string;
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
    });
  });

  it('a replayed invoice.paid delivery grants exactly once', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const invoice = invoicePaidPayload('in_1', 'sub_1', userId);
      const first = await handleStripeEvent(db, invoice, sign(invoice), WEBHOOK_SECRET);
      const second = await handleStripeEvent(db, invoice, sign(invoice), WEBHOOK_SECRET);

      expect(first.alreadyProcessed).toBe(false);
      expect(second).toEqual({ handled: true, alreadyProcessed: true, ledgerId: null });

      const { rows } = await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId]);
      expect(await getBucketBalance(db, userId, rows[0]!.current_period_grant_id as string)).toBe(1000);
    });
  });

  it("a second renewal rotates the grant id — the old grant's leftover credits no longer count", async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const invoice1 = invoicePaidPayload('in_1', 'sub_1', userId);
      await handleStripeEvent(db, invoice1, sign(invoice1), WEBHOOK_SECRET);
      const before = (await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId]))
        .rows[0]!.current_period_grant_id as string;

      const invoice2 = invoicePaidPayload('in_2', 'sub_1', userId);
      await handleStripeEvent(db, invoice2, sign(invoice2), WEBHOOK_SECRET);
      const after = (await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId]))
        .rows[0]!.current_period_grant_id as string;

      expect(after).not.toBe(before);
      expect(await getBucketBalance(db, userId, before)).toBe(1000); // old grant still shows its own history
      expect(await getBucketBalance(db, userId, after)).toBe(1000); // new grant has its own fresh 1000
      // getSpendableBalance / getCurrentGrantId only ever look at the CURRENT
      // grant id, so the old grant's 1000 is invisible to spend once rotated
      // — this is the "unused credits are lost" behavior, verified
      // structurally (via the grant ids differing and each bucket's own
      // balance), not by calling getSpendableBalance directly here.
    });
  });

  it('invoice.paid for an unknown subscription throws (never silently dropped)', async () => {
    await withDb(async (db) => {
      const payload = invoicePaidPayload('in_1', 'sub_unknown', randomUUID());
      await expect(handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET)).rejects.toThrow();
    });
  });

  it('is a no-op for a non-subscription invoice (e.g. a one-off invoice item)', async () => {
    await withDb(async (db) => {
      const payload = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        type: 'invoice.paid',
        data: {
          object: { id: 'in_manual', object: 'invoice', parent: null, metadata: {} },
        },
      });
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result).toEqual({ handled: false, alreadyProcessed: false, ledgerId: null });
    });
  });
});

describe('subscription lifecycle webhooks — out-of-order delivery guard (#205 Task 9 investigation)', () => {
  it('a stale (older) deleted event delivered after a newer created event does not clobber the newer state', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const oldPeriodEnd = now + 20 * 86400;
      const newPeriodEnd = now + 30 * 86400;

      // The user's ORIGINAL subscription, created some time ago.
      const originalCreated = subscriptionEventPayload(
        'customer.subscription.created',
        'sub_old',
        'cus_1',
        userId,
        'active',
        oldPeriodEnd,
        now - 200,
      );
      await handleStripeEvent(db, originalCreated, sign(originalCreated), WEBHOOK_SECRET);

      // The user resubscribes with a NEW Stripe subscription object (Stripe
      // subscriptions are terminal once canceled) — a genuinely newer event.
      const resubscribed = subscriptionEventPayload(
        'customer.subscription.created',
        'sub_new',
        'cus_1',
        userId,
        'active',
        newPeriodEnd,
        now,
      );
      await handleStripeEvent(db, resubscribed, sign(resubscribed), WEBHOOK_SECRET);

      // The OLD subscription's cancellation event — generated BEFORE the
      // resubscribe, but delivered LATE (redelivery after an outage, e.g.).
      const staleDeleted = subscriptionEventPayload(
        'customer.subscription.deleted',
        'sub_old',
        'cus_1',
        userId,
        'canceled',
        oldPeriodEnd,
        now - 100,
      );
      await handleStripeEvent(db, staleDeleted, sign(staleDeleted), WEBHOOK_SECRET);

      const { rows } = await db.query('select * from pro_subscriptions where user_id = $1', [userId]);
      expect(rows[0]!.status).toBe('active');
      expect(rows[0]!.stripe_subscription_id).toBe('sub_new');
      expect(Math.floor(new Date(rows[0]!.current_period_end as string).getTime() / 1000)).toBe(newPeriodEnd);
    });
  });

  it('a genuinely newer update still applies even when it arrives in the same second as the prior event (tie -> last wins)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const periodEnd1 = now + 20 * 86400;
      const periodEnd2 = now + 50 * 86400;

      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd1, now);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      // Same top-level `created` second as the row above (Checkout-driven
      // subscriptions commonly fire created+updated within the same
      // second) — must NOT be silently dropped by the guard.
      const updated = subscriptionEventPayload(
        'customer.subscription.updated',
        'sub_1',
        'cus_1',
        userId,
        'past_due',
        periodEnd2,
        now,
      );
      await handleStripeEvent(db, updated, sign(updated), WEBHOOK_SECRET);

      const { rows } = await db.query('select * from pro_subscriptions where user_id = $1', [userId]);
      expect(rows[0]!.status).toBe('past_due');
      expect(Math.floor(new Date(rows[0]!.current_period_end as string).getTime() / 1000)).toBe(periodEnd2);
    });
  });

  it('a retried delivery of the same subscription event is a harmless no-op (same event, same created, idempotent in effect)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const periodEnd = now + 20 * 86400;
      const payload = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd, now);
      const header = sign(payload);

      await handleStripeEvent(db, payload, header, WEBHOOK_SECRET);
      await handleStripeEvent(db, payload, header, WEBHOOK_SECRET);

      const { rows } = await db.query('select * from pro_subscriptions where user_id = $1', [userId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('active');
    });
  });
});

describe('handleStripeEvent — delayed-notification payment methods (#146)', () => {
  it("does NOT credit checkout.session.completed while payment_status is not 'paid' (SEPA/Bacs/bank transfer still processing)", async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const sessionId = `cs_test_${randomUUID()}`;
      const payload = checkoutCompletedPayload(sessionId, userId, 'pack_5', '200', 'unpaid');
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      // Recognized and handled (not the "unknown event type" shape) — just no
      // credit on THIS delivery, because the money has not settled yet.
      expect(result).toEqual({ handled: true, alreadyProcessed: false, ledgerId: null });
      expect(await getBalance(db, userId)).toBe(0);
    });
  });

  it('credits on checkout.session.async_payment_succeeded — the delayed method\'s real settlement', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const sessionId = `cs_test_${randomUUID()}`;
      // The Dashboard did not credit the earlier `completed` (unpaid); this
      // is a DIFFERENT event, for the SAME session, once Stripe confirms the
      // money actually arrived.
      const payload = checkoutEventPayload(
        'checkout.session.async_payment_succeeded',
        sessionId,
        userId,
        'pack_5',
        '200',
        'paid',
      );
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result).toMatchObject({ handled: true, alreadyProcessed: false });
      expect(result.ledgerId).not.toBeNull();
      expect(await getBalance(db, userId)).toBe(200);
    });
  });

  it('does NOT credit on checkout.session.async_payment_failed — the money never arrived, no-op', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const sessionId = `cs_test_${randomUUID()}`;
      const payload = checkoutEventPayload(
        'checkout.session.async_payment_failed',
        sessionId,
        userId,
        'pack_5',
        '200',
        'unpaid',
      );
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result).toEqual({ handled: true, alreadyProcessed: false, ledgerId: null });
      expect(await getBalance(db, userId)).toBe(0);
    });
  });

  it('a retried async_payment_succeeded delivery is a no-op, never a double credit (same idempotent insert as completed)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const sessionId = `cs_test_${randomUUID()}`;
      const payload = checkoutEventPayload(
        'checkout.session.async_payment_succeeded',
        sessionId,
        userId,
        'pack_10',
        '500',
        'paid',
      );
      const header = sign(payload);

      const first = await handleStripeEvent(db, payload, header, WEBHOOK_SECRET);
      const second = await handleStripeEvent(db, payload, header, WEBHOOK_SECRET);

      expect(first.alreadyProcessed).toBe(false);
      expect(second).toEqual({ handled: true, alreadyProcessed: true, ledgerId: null });
      expect(await getBalance(db, userId)).toBe(500); // exactly once
    });
  });

  it('an unpaid completed followed by its real async_payment_succeeded credits exactly once, never twice', async () => {
    // The realistic end-to-end delayed-method sequence: Stripe fires
    // `completed` (unpaid, no credit — the #146 gate), then later
    // `async_payment_succeeded` for the SAME session id (credited). Two
    // deliveries, one ledger row — proven via the SAME
    // stripe_checkout_session_id unique-purchase-per-session index the
    // synchronous replay test above exercises.
    await withDb(async (db) => {
      const userId = randomUUID();
      const sessionId = `cs_test_${randomUUID()}`;
      const completedPayload = checkoutCompletedPayload(sessionId, userId, 'pack_5', '200', 'unpaid');
      const settledPayload = checkoutEventPayload(
        'checkout.session.async_payment_succeeded',
        sessionId,
        userId,
        'pack_5',
        '200',
        'paid',
      );

      const first = await handleStripeEvent(db, completedPayload, sign(completedPayload), WEBHOOK_SECRET);
      expect(first).toEqual({ handled: true, alreadyProcessed: false, ledgerId: null });
      expect(await getBalance(db, userId)).toBe(0);

      const second = await handleStripeEvent(db, settledPayload, sign(settledPayload), WEBHOOK_SECRET);
      expect(second).toMatchObject({ handled: true, alreadyProcessed: false });
      expect(second.ledgerId).not.toBeNull();
      expect(await getBalance(db, userId)).toBe(200); // exactly once
    });
  });
});
