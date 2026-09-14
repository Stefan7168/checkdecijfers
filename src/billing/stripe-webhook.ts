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

/** Stripe moved `current_period_end` off the top-level `Subscription` object
 * onto each subscription ITEM (flexible billing — confirmed against the
 * installed `stripe` package's own types: this SDK version has no
 * `current_period_end` field on `Stripe.Subscription`, only on
 * `Stripe.SubscriptionItem`). The brief this function was built from assumed
 * the older top-level field; this repo's actual `stripe` dependency (22.6.1)
 * does not have it, so this reads the real shape instead. This plan is
 * single-price (one item per Pro subscription), but for robustness against a
 * subscription with more than one item this takes the MINIMUM across items —
 * Stripe's own convention elsewhere (its subscription list/search params
 * describe filtering by "the minimum item current_period_end"). Throws
 * rather than guessing when there are no items at all: this value gates
 * `hasProPlan`/`getCurrentGrantId` (billing-relevant), so principle (c)
 * applies — never fabricate a period end. */
function subscriptionPeriodEnd(subscription: Stripe.Subscription): number {
  const periodEnds = subscription.items.data.map((item) => item.current_period_end);
  if (periodEnds.length === 0) {
    throw new Error(`${subscription.id}: subscription has no items, cannot determine current_period_end`);
  }
  return Math.min(...periodEnds);
}

/** Upserts a `pro_subscriptions` row from a `customer.subscription.created|
 * updated|deleted` event. `ledgerId` stays null — these events never touch
 * the credit ledger, only the subscription mirror; the actual credit grant
 * is triggered by `invoice.paid` (Task 10), keyed off this row's
 * `current_period_grant_id`.
 *
 * Out-of-order delivery guard (#205 Task 9 investigation — see task-9-report
 * .md for the full writeup): Stripe does NOT guarantee webhook delivery in
 * order — network retries and redelivery after an outage can land a
 * DIFFERENT, older event after a newer one for the same object (Stripe's own
 * docs call this out explicitly). The `checkout.session.completed` path
 * above doesn't need to worry about this: it's a CREATE-ONLY idempotent
 * insert keyed by session id (`on conflict ... do nothing`) — a retried
 * delivery of the SAME event is a no-op, but two DIFFERENT checkout sessions
 * never collide with each other, so there is nothing to reorder. This
 * function is different: it's a genuine last-write-wins upsert keyed by
 * user_id, so a `deleted` event for an old, already-superseded subscription
 * arriving after a newer `created`/`updated` event (cancel, then resubscribe
 * later, with the cancellation's webhook delayed past the resubscription's)
 * would otherwise stomp the correct "active" state back to "canceled" — a
 * state-staleness bug, not a money-correctness one (ledgerId stays null
 * here; nothing is ever credited from this function).
 *
 * Every Stripe event carries its own top-level `created` (unix seconds,
 * separate from any timestamp on the nested object — confirmed against the
 * Stripe SDK's own type, `Stripe.Event.created: number`). Rather than adding
 * a new column (a migration) to track it, this repurposes the EXISTING
 * `updated_at` column to hold the event's `created` time instead of
 * wall-clock write time — checked that nothing else in the codebase reads
 * `pro_subscriptions.updated_at` (only `status`, `current_period_end`, and
 * `current_period_grant_id` are read elsewhere: src/billing/pro.ts,
 * src/billing/ledger.ts), so this repurposing is safe and needs no schema
 * change — the cheapest viable mechanism, per this repo's own default. The
 * upsert's `where` clause then only applies an incoming event if its
 * `created` is `>=` the stored value, so a genuinely OLDER event is a silent
 * no-op instead of corrupting state. `>=`, not `>`: Stripe's `created` has
 * ONE-SECOND resolution, and a `created` event immediately followed by an
 * `updated` event (e.g. a Checkout-driven subscription settling within the
 * same second) commonly share a timestamp — strict `>` would silently drop
 * that legitimate same-second update. `>=` preserves today's plain
 * last-write-wins behavior for ties (verified empirically against PGlite)
 * and only ever rejects a STRICTLY older event. */
async function upsertProSubscription(
  db: Db,
  subscription: Stripe.Subscription,
  eventCreated: number,
): Promise<StripeWebhookResult> {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    throw new Error(`${subscription.id}: missing metadata.userId`);
  }
  const currentPeriodEnd = subscriptionPeriodEnd(subscription);
  // current_period_grant_id is only ever SET by invoice.paid (Task 10) — on
  // first insert it needs SOME value (the column is not-null), so a fresh
  // placeholder grant id is used; invoice.paid always fires for a brand-new
  // subscription's first payment too (Stripe invoices immediately), so this
  // placeholder is overwritten before anything could ever read it as "the
  // current grant." gen_random_uuid() is used directly (not the brief's
  // suggested PGlite-safe fallback): empirically confirmed to work
  // unextended against this repo's actual @electric-sql/pglite version — it
  // is a built-in Postgres core function since PG13, no pgcrypto extension
  // required — rather than trusting "no existing usage in migrations/" alone.
  await db.query(
    `insert into pro_subscriptions
       (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id, updated_at)
     values ($1, $2, $3, $4, to_timestamp($5), gen_random_uuid(), to_timestamp($6))
     on conflict (user_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       status = excluded.status,
       current_period_end = excluded.current_period_end,
       updated_at = excluded.updated_at
     where excluded.updated_at >= pro_subscriptions.updated_at`,
    [userId, subscription.customer as string, subscription.id, subscription.status, currentPeriodEnd, eventCreated],
  );
  return { handled: true, alreadyProcessed: false, ledgerId: null };
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

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    return await upsertProSubscription(db, event.data.object as Stripe.Subscription, event.created);
  }

  return { handled: false, alreadyProcessed: false, ledgerId: null };
}
