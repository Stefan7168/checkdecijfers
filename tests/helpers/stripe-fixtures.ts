// Shared Stripe webhook event fixture builders (#205 Task 13). Pulled out of
// tests/billing/stripe-webhook.test.ts into their own non-test module,
// rather than exported and imported directly from that test file, because
// vitest re-executes every top-level describe()/it() in a module as a side
// effect of merely importing it — a plain import of stripe-webhook.test.ts
// from another test file would silently double-run its entire suite inside
// that other file's run. Living here, these builders can be shared without
// that hazard.
//
// These are the REAL, SDK-shape-correct builders — see
// src/billing/stripe-webhook.ts's own doc comments for the full shape
// rationale. Two deviations from the plan/brief's original illustrative
// JSON, both confirmed against the installed `stripe` package (22.6.1,
// flexible-billing API shape):
//  - `current_period_end` lives on the subscription's ITEM
//    (`items.data[].current_period_end`), not a top-level field on
//    `Stripe.Subscription`.
//  - An invoice's subscription id lives at
//    `invoice.parent.subscription_details.subscription`, not a top-level
//    `invoice.subscription` field.
// #205 Task 9 and Task 10 each independently rediscovered this the hard way
// when it was duplicated as raw JSON in a plan document; this file is now
// the SINGLE place these shapes are encoded for tests, specifically so nothing
// else ever needs to hand-roll one of these payloads again.
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';

export const WEBHOOK_SECRET = 'whsec_test_fixture_secret';

export function sign(payload: string, secret = WEBHOOK_SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

/** Every event carries its own top-level `created` (unix seconds),
 * exercised by stripe-webhook.test.ts's out-of-order-delivery guard tests;
 * defaults to "now" so order-agnostic callers don't need to care about it. */
export function subscriptionEventPayload(
  type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted',
  subscriptionId: string,
  customerId: string,
  userId: string,
  status: string,
  currentPeriodEnd: number, // unix seconds, matches Stripe's own item field shape
  eventCreated: number = Math.floor(Date.now() / 1000),
): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    created: eventCreated,
    type,
    data: {
      object: {
        id: subscriptionId,
        object: 'subscription',
        customer: customerId,
        status,
        items: {
          object: 'list',
          data: [{ id: `si_${randomUUID()}`, object: 'subscription_item', current_period_end: currentPeriodEnd }],
        },
        metadata: { userId },
      },
    },
  });
}

export function invoicePaidPayload(invoiceId: string, subscriptionId: string, userId: string): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type: 'invoice.paid',
    data: {
      object: {
        id: invoiceId,
        object: 'invoice',
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: subscriptionId },
        },
        metadata: { userId },
      },
    },
  });
}
