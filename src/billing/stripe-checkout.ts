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
