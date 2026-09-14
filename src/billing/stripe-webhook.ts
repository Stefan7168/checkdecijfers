// Stripe webhook business logic (ADR 006 seam 4, ADR 020) — framework-
// agnostic and hermetically testable: signature verification is pure crypto
// (Stripe.webhooks.constructEvent, no network), and the ledger write uses
// `ON CONFLICT ... RETURNING` rather than a caught exception, so a retried
// delivery of the same event is a no-op, never a double credit. The Next.js
// Route Handler (web/app/api/stripe/webhook/route.ts) is a thin adapter over
// this — raw body + signature header in, nothing else.
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import type { Db } from '../db/types.ts';
import { grantBucket } from './pro-bucket.ts';
import { PRO_MONTHLY_CREDITS } from './pro.ts';

export interface StripeWebhookResult {
  /** False for anything this handler deliberately does no work for — an
   * event type it doesn't act on at all (Stripe accounts emit many we don't
   * subscribe to), and equally an event of a type it DOES handle whose
   * payload is for a different flow: a non-subscription `invoice.paid`, or a
   * `mode: 'subscription'` checkout session (whose money is handled by the
   * subscription branches instead). Not an error either way — the Route
   * Handler still answers 200, so Stripe does not retry.
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

/** Mode guard for the checkout-session branches (#205 final whole-branch
 * review, HIGH finding — a cross-seam bug neither side could see alone).
 *
 * Stripe fires `checkout.session.completed` (and, for a delayed-notification
 * method, `checkout.session.async_payment_succeeded`) for EVERY completed
 * Checkout Session, whatever its `mode`. This app now creates two kinds:
 * one-time credit-pack sessions (`mode: 'payment'`,
 * `buildCheckoutSessionParams`, metadata `{userId, packId, credits}`) and Pro
 * subscription sessions (`mode: 'subscription'`,
 * `buildProSubscriptionCheckoutParams`, metadata `{userId}` only — see
 * stripe-checkout.ts). Without this guard a real Pro signup's
 * checkout-completed event falls into `creditPurchase`, which throws on the
 * missing `packId`/`credits` — the Route Handler turns that into a 400, and
 * Stripe then retries the event for ~3 days, per signup, against the SAME
 * webhook destination the live credit-pack flow depends on (a chronically
 * failing destination is one Stripe may disable outright).
 *
 * A subscription checkout has nothing for THIS branch to do: the money side
 * of a subscription is handled entirely by the dedicated
 * `customer.subscription.*` (mirror row) and `invoice.paid` (the actual
 * credit grant) branches below — `invoice.paid` fires for the first period
 * too, so nothing is missed by ignoring the checkout event. Hence the same
 * `{handled: false, …}` shape this file already uses for an event it
 * recognizes but has no work for (see `grantMonthlyAllowance`'s
 * non-subscription invoice, and the final fall-through) — `handled: false`
 * still returns HTTP 200, so Stripe stops retrying. Logged because Vercel
 * logs are the owner's only production visibility (WP12 review), and during
 * the Pro go-live smoke test this line is the proof the event arrived and was
 * deliberately ignored rather than silently lost.
 *
 * Returns null when the session is NOT subscription-mode, i.e. "carry on with
 * the ordinary credit-pack path". */
function subscriptionModeNoOp(
  session: Stripe.Checkout.Session,
  eventType: string,
): StripeWebhookResult | null {
  if (session.mode !== 'subscription') return null;
  console.log(
    `stripe webhook: ${eventType} ${session.id} is a mode='subscription' (Pro) checkout — not a ` +
      'credit-pack purchase; the subscription is handled by customer.subscription.*/invoice.paid, no-op here',
  );
  return { handled: false, alreadyProcessed: false, ledgerId: null };
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
 * Stripe SDK's own type, `Stripe.Event.created: number`). This is tracked in
 * a DEDICATED column, `pro_subscriptions.last_event_at` (migration 030,
 * amended for this guard before it was ever applied anywhere — see that
 * migration's own comment) — NOT the existing `updated_at`, which stays
 * ordinary "wall-clock time of the last DB write": a first attempt at this
 * reused `updated_at` directly, but task review (correctly) caught that
 * `updated_at` already carries that plain meaning for 11+ other direct
 * writes elsewhere in this codebase, and — more concretely — Task 10's
 * `invoice.paid` handler writes this SAME row (rotating
 * `current_period_grant_id`) using ordinary `now()`. At an ordinary
 * renewal, Stripe fires `invoice.paid` and `customer.subscription.updated`
 * within the same second; whichever write used real wall-clock time (which,
 * via ordinary network latency, lands slightly AFTER that event's own
 * `created` second) would then look newer than the other event's `created`
 * timestamp under a shared column, incorrectly rejecting a same-second
 * legitimate write on every ordinary renewal — not a rare race. A separate
 * column with its own single, consistent meaning (always Stripe's
 * `event.created`, never wall-clock time) avoids that entirely. The
 * upsert's `where` clause only applies an incoming event if its `created` is
 * `>=` the stored value, so a genuinely OLDER event is a silent no-op
 * instead of corrupting state. `>=`, not `>`: Stripe's `created` has
 * ONE-SECOND resolution, and a `created` event immediately followed by an
 * `updated` event (e.g. a Checkout-driven subscription settling within the
 * same second) commonly share a timestamp — strict `>` would silently drop
 * that legitimate same-second update. `>=` preserves plain last-write-wins
 * behavior for ties (verified empirically against PGlite) and only ever
 * rejects a STRICTLY older event. (Named, accepted residual: `>=` cannot
 * distinguish two DIFFERENT same-second events from each other — same-second
 * reordering is not fully resolved, only strictly-older staleness is. Left
 * as-is; not worth chasing sub-second precision Stripe's own `created` field
 * doesn't provide.) */
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
       (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id, last_event_at)
     values ($1, $2, $3, $4, to_timestamp($5), gen_random_uuid(), to_timestamp($6))
     on conflict (user_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       status = excluded.status,
       current_period_end = excluded.current_period_end,
       last_event_at = excluded.last_event_at,
       updated_at = now()
     where excluded.last_event_at >= pro_subscriptions.last_event_at`,
    [userId, subscription.customer as string, subscription.id, subscription.status, currentPeriodEnd, eventCreated],
  );
  return { handled: true, alreadyProcessed: false, ledgerId: null };
}

/** Extracts the subscription id an invoice belongs to, or null for a
 * non-subscription invoice (e.g. a one-off invoice item — `billing_reason`
 * values like 'manual'). Deviation from the brief, same class of bug Task 9
 * hit for `Subscription.current_period_end`: the brief's sample reads
 * `invoice.subscription` directly, but this repo's actual `stripe` package
 * (22.6.1, flexible-billing API shape) has NO top-level `subscription` field
 * on `Stripe.Invoice` at all — confirmed against
 * `node_modules/stripe/cjs/resources/Invoices.d.ts`. The real id now lives at
 * `invoice.parent.subscription_details.subscription`, and `parent` (and
 * `subscription_details` within it) is `| null` for an invoice that isn't
 * tied to a subscription. `subscription_details.subscription` is typed
 * `string | Stripe.Subscription` (expanded vs. unexpanded); this webhook
 * never expands it, so it is always the bare id string in practice, but both
 * shapes are handled rather than assuming. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return typeof subscription === 'string' ? subscription : subscription.id;
}

/** `invoice.paid` — the renewal grant trigger (Task 10, open-questions #205).
 * Grants `PRO_MONTHLY_CREDITS` to the user's Pro bucket and rotates
 * `pro_subscriptions.current_period_grant_id` to the fresh grant.
 *
 * Deliberately does NOT create a `pro_subscriptions` row itself — throws on
 * an unknown subscription instead (task brief's carried-forward invariant,
 * tied to Task 9's out-of-order-delivery guard on `last_event_at`: only
 * `upsertProSubscription` is allowed to create that row, and only it sets
 * `last_event_at` from `event.created`. If this function ever needs to
 * create the row, it MUST do the same — never leave `last_event_at` at a
 * bare `default now()`, or a genuinely-earlier-but-later-delivered
 * subscription-lifecycle event would be wrongly rejected by that guard
 * afterward). In practice `customer.subscription.created` always precedes
 * `invoice.paid` for a brand-new subscription's first payment (Stripe
 * invoices immediately, but Checkout confirms the subscription object first),
 * so an unknown subscription here means a genuinely out-of-order delivery,
 * not the ordinary case — throwing (not silently dropping) matches principle
 * (c): never guess, and lets Stripe's own retry mechanism redeliver once
 * `customer.subscription.created` has landed.
 *
 * Idempotency and ordering (task brief's explicit requirement — verified
 * against the real implementations, not assumed):
 * - `grantBucket` (pro-bucket.ts) is a single `insert ... on conflict
 *   (stripe_invoice_id) where reason = 'grant' do nothing returning id`
 *   statement. A single INSERT with ON CONFLICT is atomic at the database
 *   level regardless of what transaction wraps it: two concurrent inserts
 *   racing on the same conflicting key serialize at the unique index — the
 *   second waits for the first to commit (or abort), then re-evaluates ON
 *   CONFLICT and returns no row. So a genuinely concurrent replay of the
 *   SAME invoice can never have both deliveries "pass the check" before
 *   either commits — at most one ever gets a non-null grant back, and the
 *   loser takes the `granted === null` branch below and skips the
 *   `pro_subscriptions` update entirely, exactly per the brief's "order
 *   matters" note.
 * - This whole function is additionally wrapped in `db.withTransaction`
 *   (this codebase's established money-path pattern — see
 *   `ledger.ts`'s `reserveDebit`/`reserveOnboardingDebit`), which the brief's
 *   sample code did not do (two bare `db.query` calls). That wrap isn't
 *   needed for the concurrent-replay race above (already race-free per the
 *   ON CONFLICT semantics), but it closes a real crash-safety gap the bare
 *   two-statement version has: if the process died AFTER `grantBucket`
 *   committed but BEFORE the `pro_subscriptions` update ran, a Stripe retry
 *   would generate a NEW `grantId`, call `grantBucket` again for the same
 *   invoice id, get `null` back (already granted, under the FIRST grantId,
 *   which this retry no longer knows), and skip the update forever — credits
 *   permanently granted to a `grant_id` `current_period_grant_id` never
 *   points to. Wrapping both statements in one transaction makes them
 *   all-or-nothing: either both land, or neither does and a retry starts
 *   clean. No `pg_advisory_xact_lock` is added (unlike `reserveDebit`): that
 *   lock exists there to make a balance-check-then-debit sequence atomic
 *   against a concurrent read of stale state; this function has no such
 *   check-then-act on mutable state (the `current_period_grant_id` write is
 *   unconditional, not gated on its current value), so the transaction wrap
 *   alone is sufficient. */
async function grantMonthlyAllowance(db: Db, invoice: Stripe.Invoice): Promise<StripeWebhookResult> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    // Not a subscription invoice (e.g. a one-off invoice item) — nothing for
    // this feature to do.
    return { handled: false, alreadyProcessed: false, ledgerId: null };
  }
  return db.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      'select user_id from pro_subscriptions where stripe_subscription_id = $1',
      [subscriptionId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error(
        `${invoice.id}: invoice.paid for unknown subscription ${subscriptionId} — expected ` +
          'customer.subscription.created to have arrived first',
      );
    }
    const userId = String(row.user_id);
    const newGrantId = randomUUID();
    const granted = await grantBucket(tx, userId, newGrantId, PRO_MONTHLY_CREDITS, invoice.id);
    if (granted === null) {
      // Replayed delivery of the same invoice — already granted (under
      // whatever grant id that first delivery used). current_period_grant_id
      // already points at it; skip the update, per the brief's explicit
      // "order matters" note.
      return { handled: true, alreadyProcessed: true, ledgerId: null };
    }
    await tx.query(
      'update pro_subscriptions set current_period_grant_id = $1, updated_at = now() where user_id = $2',
      [newGrantId, userId],
    );
    return { handled: true, alreadyProcessed: false, ledgerId: null };
  });
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
    // #205 final review: a Pro (mode: 'subscription') checkout fires this
    // same event type but carries no pack metadata — see subscriptionModeNoOp.
    // Checked BEFORE the payment_status gate below so a subscription session
    // never logs a misleading "not settled yet" line either.
    const notAPackPurchase = subscriptionModeNoOp(session, event.type);
    if (notAPackPurchase !== null) return notAPackPurchase;
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
    const session = event.data.object as Stripe.Checkout.Session;
    // Same mode guard as `completed` above. The final review named only the
    // `completed` branch (the one Stripe actually delivers today), but this
    // branch calls the identical `creditPurchase` on the identical object and
    // would throw identically the day both a delayed-notification method and
    // this event subscription are enabled — guarding only one of the two
    // would leave a known, identical seam two lines away.
    const notAPackPurchase = subscriptionModeNoOp(session, event.type);
    if (notAPackPurchase !== null) return notAPackPurchase;
    return await creditPurchase(db, session);
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

  if (event.type === 'invoice.paid') {
    return await grantMonthlyAllowance(db, event.data.object as Stripe.Invoice);
  }

  return { handled: false, alreadyProcessed: false, ledgerId: null };
}
