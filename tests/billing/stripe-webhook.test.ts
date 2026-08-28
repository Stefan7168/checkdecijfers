// Stripe webhook handling (src/billing/stripe-webhook.ts, ADR 006 seam 4):
// signature verification and ledger-append, entirely hermetic — signed with
// Stripe's own `generateTestHeaderString` test helper against a hand-authored
// `checkout.session.completed` fixture. No network, no live Stripe account.
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { handleStripeEvent } from '../../src/billing/stripe-webhook.ts';
import { getBalance } from '../../src/billing/ledger.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const WEBHOOK_SECRET = 'whsec_test_fixture_secret';

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
        payment_status: paymentStatus,
        metadata: { userId, packId, credits },
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

function sign(payload: string, secret = WEBHOOK_SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
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
