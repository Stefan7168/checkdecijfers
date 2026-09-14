// Stripe Checkout Session params (ADR 006 seam 4, ADR 020) — a pure builder,
// no network call, so it is hermetically testable. The actual
// `stripe.checkout.sessions.create(...)` call happens in web/app/actions.ts
// (a live network call, not on the hermetic gate — verified once real test
// keys are wired in, per this WP's "code first" sequencing).
import type Stripe from 'stripe';
import type { CreditPack } from './types.ts';

/** Deliberately omits `payment_method_types` so Stripe's dynamic
 * payment-method selection can surface iDEAL once enabled on the account —
 * a Dashboard setting, not code (see RUNBOOK's live-wiring pass). One-time
 * `mode: 'payment'` (never a subscription, per the decided no-subscription
 * model — docs/06-roadmap.md). */
export function buildCheckoutSessionParams(
  pack: CreditPack,
  userId: string,
  successUrl: string,
  cancelUrl: string,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: pack.currency,
          unit_amount: pack.priceCents,
          product_data: { name: pack.label },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Read back by src/billing/stripe-webhook.ts on checkout.session.completed
    // — the only place a purchase actually gets credited (never the
    // success-page redirect, which the user could close before it loads).
    metadata: { userId, packId: pack.id, credits: String(pack.credits) },
  };
}

/** Subscription Checkout (open-questions #205) — `mode: 'subscription'`
 * referencing a real Stripe Price object (`priceId`, provisioned once in
 * the Dashboard or via a one-off script, per the design's §4 — subscriptions
 * cannot use one-time Checkout's inline `price_data`, unlike
 * buildCheckoutSessionParams above). `metadata.userId` is read back by the
 * customer.subscription.created webhook handler (Task 9) to link the new
 * Stripe customer/subscription to this app's user row — Stripe subscription
 * events don't otherwise carry an app-specific user id.
 *
 * **`subscription_data.metadata`, not just the session-level `metadata`
 * (bug found by task review, fixed post-Task-9):** Stripe does NOT copy a
 * Checkout Session's own `metadata` onto the Subscription object it
 * creates — that only lands on the Session/PaymentIntent. The
 * `customer.subscription.*` webhook handler (src/billing/stripe-webhook.ts)
 * reads `subscription.metadata.userId`, so without `subscription_data
 * .metadata` set here, every real subscription webhook would arrive with an
 * EMPTY `metadata` and the handler's own "missing metadata.userId" guard
 * would throw for every real paying customer — no `pro_subscriptions` row
 * would ever get written. The session-level `metadata` is kept too
 * (harmless, and some Stripe features/reporting read it), but
 * `subscription_data.metadata` is what actually makes the webhook work. */
export function buildProSubscriptionCheckoutParams(
  userId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId },
    subscription_data: { metadata: { userId } },
  };
}
