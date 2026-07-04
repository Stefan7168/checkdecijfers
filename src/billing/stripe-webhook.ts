// Stripe webhook business logic (ADR 006 seam 4, ADR 020) — framework-
// agnostic and hermetically testable: signature verification is pure crypto
// (Stripe.webhooks.constructEvent, no network), and the ledger write uses
// `ON CONFLICT ... RETURNING` rather than a caught exception, so a retried
// delivery of the same event is a no-op, never a double credit. The Next.js
// Route Handler (web/app/api/stripe/webhook/route.ts) is a thin adapter over
// this — raw body + signature header in, nothing else.
import Stripe from 'stripe';
import type { Db } from '../db/types.ts';

export interface StripeWebhookResult {
  /** False for event types this handler doesn't act on (ignored, not an
   * error — Stripe accounts emit many event types we don't subscribe to). */
  handled: boolean;
  /** True when this exact checkout session was already credited — a
   * retried webhook delivery, not a new purchase. */
  alreadyProcessed: boolean;
  ledgerId: number | null;
}

export async function handleStripeEvent(
  db: Db,
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): Promise<StripeWebhookResult> {
  // Throws on a bad/missing signature — the caller (the Route Handler) must
  // let that reject the request (4xx), never swallow it (webhook security:
  // an unverified event must never be processed).
  const event = Stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);

  if (event.type !== 'checkout.session.completed') {
    return { handled: false, alreadyProcessed: false, ledgerId: null };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const userId = session.metadata?.userId;
  const packId = session.metadata?.packId;
  const credits = Number(session.metadata?.credits);
  if (!userId || !packId || !Number.isFinite(credits) || credits <= 0) {
    throw new Error(`checkout.session.completed ${session.id}: missing or invalid metadata`);
  }

  const { rows } = await db.query(
    `insert into credit_transactions (user_id, delta, reason, stripe_checkout_session_id, note)
     values ($1, $2, 'purchase', $3, $4)
     on conflict (stripe_checkout_session_id) where reason = 'purchase' do nothing
     returning id`,
    [userId, credits, session.id, `stripe purchase: ${packId}`],
  );
  const row = rows[0];
  return row === undefined
    ? { handled: true, alreadyProcessed: true, ledgerId: null }
    : { handled: true, alreadyProcessed: false, ledgerId: Number(row.id) };
}
