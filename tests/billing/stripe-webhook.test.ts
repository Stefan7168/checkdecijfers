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

function checkoutCompletedPayload(sessionId: string, userId: string, packId = 'pack_5', credits = '200'): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        metadata: { userId, packId, credits },
      },
    },
  });
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
        data: { object: { id: `cs_test_${randomUUID()}`, object: 'checkout.session', metadata: {} } },
      });
      await expect(handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET)).rejects.toThrow(/metadata/);
    });
  });
});
