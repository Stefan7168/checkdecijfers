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
   * error — Stripe accounts emit many event types we don't subscribe to).
   * Also true (not false) for a `checkout.session.completed` whose payment
   * has not settled yet (#146 below) — that IS a recognized, handled event,
   * it just credits nothing this delivery. */
  handled: boolean;
  /** True when this exact checkout session was already credited — a
   * retried webhook delivery, not a new purchase. */
  alreadyProcessed: boolean;
  ledgerId: number | null;
}

/** #146 (session-47 hunt, closed session 66): for a DELAYED-notification
 * payment method (SEPA Direct Debit, Bacs/ACH, bank transfer — verified
 * against Stripe's own docs to NOT include card or iDEAL, both of which
 * settle synchronously), Stripe fires `checkout.session.completed` with
 * `payment_status: 'unpaid'` while the session is still `processing`, and
 * settles LATER via `checkout.session.async_payment_succeeded` (credit then)
 * or `…async_payment_failed` (the money never arrived — no-op). Crediting
 * unconditionally on `completed` — the previous behavior — would credit a
 * payment that can still fail. `session.payment_status` is the Stripe SDK's
 * own typed union (`'paid' | 'unpaid' | 'no_payment_required'`), and `'paid'`
 * is the only status this function ever credits on, on ANY event type: same
 * rule, same function, for both the synchronous and the eventual-consistency
 * case.
 *
 * DORMANT today: the live Stripe account is card-only and test-mode
 * (RUNBOOK) — a real `completed` delivery already always carries
 * `payment_status: 'paid'`, so this changes nothing for any event Stripe
 * actually sends today. It only starts mattering the day a delayed method is
 * enabled in the Dashboard (a config change, not a deploy) — the RUNBOOK's
 * live-mode checklist gates that on the webhook destination ALSO being
 * subscribed to the two async event types below, which is a separate,
 * still-owner-supervised Dashboard step this code change does not perform. */
async function creditPurchase(db: Db, session: Stripe.Checkout.Session): Promise<StripeWebhookResult> {
  const userId = session.metadata?.userId;
  const packId = session.metadata?.packId;
  const credits = Number(session.metadata?.credits);
  if (!userId || !packId || !Number.isFinite(credits) || credits <= 0) {
    throw new Error(`${session.id}: missing or invalid metadata`);
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    // #146: only credit a SETTLED payment. For the synchronous methods this
    // account actually offers today (card; iDEAL if ever enabled — verified
    // immediate-notification per Stripe's docs), payment_status is already
    // 'paid' by the time `completed` fires, so this is a no-op in production
    // today. For a delayed method it is not — see creditPurchase's doc above.
    if (session.payment_status !== 'paid') {
      console.log(
        `stripe webhook: checkout.session.completed ${session.id} has payment_status=` +
          `'${session.payment_status}' (not settled yet) — awaiting async_payment_succeeded/` +
          `async_payment_failed, no credit on this delivery`,
      );
      return { handled: true, alreadyProcessed: false, ledgerId: null };
    }
    return await creditPurchase(db, session);
  }

  // #146: the eventual-consistency settlement for a delayed-notification
  // method's `completed`-but-`unpaid` session above. DORMANT until the
  // Stripe Dashboard webhook destination is subscribed to these two event
  // types (RUNBOOK's live-mode checklist, a config step, not a deploy) —
  // until then Stripe never sends them, so neither branch below ever runs,
  // the same dormancy shape as ONBOARDING_ENABLED/WEBSEARCH_ENABLED elsewhere
  // in this codebase (gated by external config rather than an env flag here,
  // since Stripe event subscriptions are per-webhook-destination Dashboard
  // state, not something this app's own environment controls).
  if (event.type === 'checkout.session.async_payment_succeeded') {
    return await creditPurchase(db, event.data.object as Stripe.Checkout.Session);
  }
  if (event.type === 'checkout.session.async_payment_failed') {
    // The payment never arrived — nothing was ever credited for this session
    // (the `completed` delivery above only logged), so there is nothing to
    // reverse. No-op, logged for operator visibility (WP12 review: Vercel
    // logs are the owner's only production visibility).
    const session = event.data.object as Stripe.Checkout.Session;
    console.log(
      `stripe webhook: checkout.session.async_payment_failed ${session.id} — payment did not settle, ` +
        'no-op (nothing was credited for this session)',
    );
    return { handled: true, alreadyProcessed: false, ledgerId: null };
  }

  return { handled: false, alreadyProcessed: false, ledgerId: null };
}
