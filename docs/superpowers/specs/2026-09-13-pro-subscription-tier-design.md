# Pro subscription tier — design (owner-approved 2026-09-13, session 101 continued)

**Status:** design approved by the owner in chat (session 101 continued, 2026-09-13, owner present)
after a brainstorm. Not yet planned or built. Reverses ADR [006](../../decisions/006-auth-billing-seams.md)'s
"no subscription" decision and ADR [020](../../decisions/020-credit-ledger-and-billing-gate.md)'s
"one-time Checkout only, never recurring" decision — **this design needs its own ADR revision of
both, written alongside (or immediately after) the implementation plan, not deferred** — see
Consequences below. Tracked at [open-questions #205](../../open-questions.md); closes it once
built. Relationship to ADR [041](../../decisions/041-public-embed-pages.md)/[047](../../decisions/047-repositioning-embedded-sourced-chart.md):
this is the real mechanism behind the Live-embed Pro pitch those ADRs already shipped the UI for.

## In one paragraph, for the owner

A real, paid monthly subscription — €19.99/month, 1000 credits included, unlimited Live chart
embeds — replacing today's `PRO_ACCOUNT_EMAILS` allowlist (which stays, as an override for your
own testing accounts). The 1000 credits reset every renewal; anything unused is lost, same
discipline as a normal SaaS seat, a deliberate exception to "purchased credits never expire" that
applies ONLY to this subscription allowance (purchased packs and the signup grant are completely
unaffected — they stay exactly as permanent as they are today). Ships fully built — real Stripe
subscription product, real webhook handling, the upgrade button wired for real — but **behind a
new `PRO_SUBSCRIPTIONS_ENABLED` flag that stays off until you explicitly flip it**, same pattern
as `EMBED_TOKEN_SECRET`. No real charge is possible until that flag is on.

## Owner decisions recorded here (2026-09-13, in chat)

1. Scope: Live embeds (unlimited/forever-fresh) **+ a monthly credit allowance** — not just embeds
   alone, and not unlimited chat.
2. The allowance **resets to N each month; unused credits are lost** (explicitly chosen over
   "stacks, never expires" — a deliberate, acknowledged exception to the product's usual
   never-expiring-credits promise, scoped to this allowance only; see Consequences on how the
   public copy needs to say this honestly).
3. Price: **€19.99/month for 1000 credits** (the "power-user" option — roughly double the
   €10/500-credit pack's rate per credit, positioned as "this replaces your whole monthly credit
   spend," still far under Datawrapper Pro ($21/seat) and nowhere near LocalFocus (€530+/mo)).
4. Cancellation / failed payment: **access continues to `current_period_end`, then downgrades** —
   no mid-article embed freeze, matches how paid-for credits already behave everywhere else in
   the product.
5. The reset mechanic needs a **real separate accounting path** (not an approximation against the
   shared ledger balance) — see §2's `pro_grant_id` design, chosen specifically because a
   clawback-from-shared-balance approach has a genuine fairness bug (traced through in chat):
   it can wrongly take back credits from a purchased pack in a mixed-balance month.
6. Rollout: **build it fully, ship flag-gated off** — real mechanism, no real charges until you
   flip `PRO_SUBSCRIPTIONS_ENABLED`.

## §1. Data model (new migration)

```sql
create table pro_subscriptions (
  user_id uuid primary key references auth.users(id),
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  status text not null,                    -- stripe's own status string, stored verbatim
  current_period_end timestamptz not null,
  current_period_grant_id uuid not null,    -- rotates on every invoice.paid; see §2
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`credit_transactions` (migration 005) gets one new nullable column:

```sql
alter table credit_transactions add column pro_grant_id uuid null;
```

`null` for every existing row and every future non-Pro debit/grant — byte-identical to today by
construction. A row with `pro_grant_id` set is money spent from (or refunded to) that specific
month's Pro allowance, never the permanent balance.

**`hasProPlan`** (`src/billing/pro.ts`) becomes: allowlisted (unchanged — kept as your own testing
override) **OR** a `pro_subscriptions` row exists with `status in ('active','trialing','past_due')`
and `current_period_end > now()`. This single check also implements decision 4's grace period for
free: Stripe itself keeps `status: 'active'` with `cancel_at_period_end: true` set right up to the
period boundary when someone cancels, and keeps `status: 'past_due'` (not yet `'canceled'`) during
its own automatic payment-retry window — both cases correctly still read as Pro here, no extra
logic needed.

## §2. The credit allowance — tagged ledger rows, not a mutable counter

Rejected first draft (a mutable `pro_subscriptions.credits_remaining_this_period` integer,
decremented on spend, overwritten to 1000 on renewal) in favor of this, discovered while reading
`ledger.ts`'s actual implementation: **reuse the existing append-only ledger entirely**, tag rows
instead of inventing parallel state.

- `current_period_grant_id` (on `pro_subscriptions`) identifies "this month's allowance."
- **On `invoice.paid`** (every successful renewal, including the very first payment): generate a
  fresh UUID, store it as the new `current_period_grant_id`, insert one `credit_transactions` row
  — `delta: +1000`, `reason: 'pro_monthly_grant'`, `pro_grant_id: <the new uuid>` — idempotent per
  Stripe invoice ID (a unique index or `on conflict` keyed on a new `stripe_invoice_id` column, or
  reuse `request_id` with the invoice ID as its value — mirrors `debitQuestion`'s existing
  idempotency shape exactly).
- **The bucket's remaining balance for a user** = `SELECT COALESCE(SUM(delta),0) FROM
  credit_transactions WHERE user_id = $1 AND pro_grant_id = $2` (the CURRENT grant id, read from
  `pro_subscriptions`). A user's total spendable balance for display = this **plus** the existing
  `getBalance` (permanent ledger, `pro_grant_id is null`).
- **The reset needs no clawback transaction at all.** Rotating `current_period_grant_id` to a new
  UUID is the reset — last month's grant's rows simply stop being summed into "current," because
  nothing queries them by the OLD id any more. This is the piece that avoids §"owner decision 5"'s
  fairness bug entirely: the permanent ledger (`pro_grant_id is null`) is never touched by this
  mechanic, so a purchased pack's credits are structurally impossible to claw back — they live in
  rows this mechanism never looks at.

## §3. Spend order — every debit function gets a bucket-first step

The delicate part: `reserveDebit` (and the same-shaped `reserveOnboardingDebit`,
`reserveWebSearchDebit`, `reserveDatasetDebit`, and `triggerOnboarding`'s own composed version)
already does a **race-free check-and-debit inside one `pg_advisory_xact_lock`-guarded
transaction** — an adversarial-review fix from WP13. The bucket-first logic MUST live inside that
same locked transaction, not before or after it, or it reintroduces the exact race that lock
exists to prevent.

New shared primitive in `ledger.ts`, called from inside each `reserve*`'s existing transaction
(and from `triggerOnboarding`'s own composed transaction, matching how it already avoids nesting
`withTransaction` — see `debitOnboarding`'s doc comment):

```ts
// Inside the existing advisory-locked transaction, after the existing
// balance check passes (balance = permanent + bucket, both read together):
async function splitDebit(
  tx: Db, userId: string, requestId: string, credits: number, reason: ActionClass reason, grantId: string | null,
): Promise<{ fromBucket: number; fromLedger: number }> {
  const fromBucket = grantId === null ? 0 : Math.min(credits, await getBucketBalance(tx, userId, grantId));
  const fromLedger = credits - fromBucket;
  if (fromBucket > 0) {
    await tx.query(`insert into credit_transactions (user_id, delta, reason, request_id, pro_grant_id, note)
      values ($1, $2, $3, $4, $5, 'pro-allowance debit') on conflict (user_id, request_id) where reason = $3 do nothing`,
      [userId, -fromBucket, reason, requestId + ':bucket', grantId]);
  }
  if (fromLedger > 0) {
    await tx.query(`insert into credit_transactions (user_id, delta, reason, request_id, pro_grant_id, note)
      values ($1, $2, $3, $4, null, 'ledger debit') on conflict (user_id, request_id) where reason = $3 do nothing`,
      [userId, -fromLedger, reason, requestId, null]);
  }
  return { fromBucket, fromLedger };
}
```

(Sketch, not final code — the exact idempotency-key shape needs a design pass in the
implementation plan; the two-row split needs BOTH rows to share the caller's retry-idempotency
semantics, which the `requestId + ':bucket'` suffix above is a first attempt at, not a commitment.)

For a **non-Pro user** (`grantId` resolves to `null`, e.g. `hasProPlan` false or no active
allowance), `fromBucket` is always 0 and this collapses to exactly one ledger insert, identical in
shape to what `debitQuestion` writes today — **the existing test suite for every debit function
must keep passing unmodified as the byte-identical-for-non-Pro-users pin.**

**Compensation** (`compensate`): needs to know the original debit's bucket/ledger split (read it
back from the original transaction row(s) via `related_transaction_id`/`request_id`, rather than
threading it through every caller) and refund each portion to where it came from — a refund of a
bucket-funded charge is tagged with that debit's `pro_grant_id`, never with `null`, so a refund can
never convert Pro-allowance credits into permanent ones. Edge case, acceptable as noted:
if a subscription renews (rotating the grant id) WHILE a debited request is still in flight and
later gets refunded, the refund lands tagged to the now-stale grant id and is simply invisible to
the CURRENT bucket balance — a rare, self-correcting cosmetic loss (at most 1000 credits' worth,
once, only on that specific race), not a money-path correctness bug (nothing is double-spent or
fabricated). Worth a one-line note in the implementation plan, not a blocker.

## §4. Stripe mechanics

- `buildCheckoutSessionParams` (one-time packs, `mode: 'payment'`) gets a sibling,
  `buildProSubscriptionCheckoutParams` — `mode: 'subscription'`, referencing a real Stripe `Price`
  object (subscriptions need a Price, unlike one-time Checkout's inline `price_data`) created once
  in the Stripe dashboard (or via a one-off script) for "Pro — €19.99/month," not at request time.
- New webhook handlers in `stripe-webhook.ts`, alongside the existing
  `checkout.session.completed`/`async_payment_succeeded`/`async_payment_failed`:
  - `customer.subscription.created` / `.updated` / `.deleted` — upsert the `pro_subscriptions` row
    (`status`, `current_period_end`) from the event payload.
  - `invoice.paid` — the renewal trigger described in §2 (rotate `current_period_grant_id`, grant
    1000, idempotent per invoice ID). Fires for the FIRST payment too (Stripe always invoices a
    new subscription immediately), so no separate "welcome grant" path is needed.
  - `invoice.payment_failed` — no ledger action; `status` already reads `past_due` from the
    `customer.subscription.updated` event that accompanies it, which is what `hasProPlan` checks.
- The embed dialog's existing "Upgrade" click (ADR 041's session-101 addendum — currently
  interest-only, tracked, no charge) gets a real branch: `PRO_SUBSCRIPTIONS_ENABLED` on → opens
  the real subscription Checkout session; off → today's exact interest-tracking behavior,
  unchanged.

## §5. Rollout

New env flag `PRO_SUBSCRIPTIONS_ENABLED`, same posture as `EMBED_TOKEN_SECRET`/
`ONBOARDING_ENABLED`: absent/false → the mechanism exists in code and is fully tested, but every
user-facing path (the upgrade button, any pricing copy beyond what's already shipped) behaves
exactly as it does today. Flipping it to true is the owner's action alone, in Vercel's env store,
whenever the Stripe Price object and webhook are confirmed live-wired (RUNBOOK gets a new section
for this checklist, mirroring the existing "Live embeds" one).

## §6. Testing

Hermetic throughout, matching the existing Stripe-webhook test pattern exactly (signed fixture
payloads via Stripe's own `generateTestHeaderString`, no network, no live account):

- One fixture payload per new event type (`customer.subscription.created/updated/deleted`,
  `invoice.paid`, `invoice.payment_failed`).
- `splitDebit` gets its own unit tests per action type: bucket-only, ledger-only, split
  bucket+ledger, and the zero-bucket (non-Pro) byte-identical pin.
- Every existing `reserveDebit`/`reserveOnboardingDebit`/`reserveWebSearchDebit`/
  `reserveDatasetDebit`/`triggerOnboarding` test must still pass unmodified — the non-Pro path is
  the regression pin.
- A renewal-idempotency test: replaying the same `invoice.paid` webhook twice grants exactly once.
- An end-to-end test: subscribe (fixture webhook) → spend from bucket → renew (fixture webhook,
  new grant id) → confirm unspent bucket credits from the OLD grant no longer count, permanent
  ledger balance untouched throughout.

## Alternatives considered

- **Clawback debit against the shared ledger balance at renewal** (compute an estimate of unspent
  Pro credits, debit it back before granting the new month). Rejected: in a mixed-balance month
  (some Pro allowance left over AND some purchased/signup credits present), the ledger's fungible
  single-balance design cannot distinguish which credits are which, so the clawback estimate can
  wrongly debit purchased credits that are supposed to never expire — a real fairness bug, not
  merely an approximation, caught by tracing through a concrete mixed-balance scenario in chat.
- **A mutable `credits_remaining_this_period` counter**, decremented directly, reset by
  overwrite. Simpler to explain but throws away the ledger's existing append-only/idempotent/
  audit-trail machinery and would need its OWN compensation-refund logic built from scratch
  (§2/§3's tagged-row design gets this for free by staying inside the existing table).
- **"Stacks, never expires" instead of a monthly reset** (the option not picked) — would need zero
  `pro_grant_id` tagging or `splitDebit` surgery at all, just a plain recurring grant into the
  permanent ledger. Available as a fallback if the reset mechanic's implementation cost turns out
  higher than expected once the plan is written — flagged here so a future session doesn't have to
  rediscover this trade-off from scratch.

## Consequences

- **ADR 006 and ADR 020 both need a revision note** recording this reversal — decided here, not
  deferred, but the actual ADR edits happen alongside the implementation plan (writing-plans next),
  not in this design doc.
- **Public/marketing copy needs to say the reset honestly**: "credits never expire" (the packs'
  and signup grant's actual promise) must stay true and unambiguous; the Pro allowance's own copy
  needs its own, separate, honest statement ("your monthly Pro credits reset each period") so nothing
  reads as a broken promise. A copy pass is part of the implementation plan, not this design.
- `gate.ts`/`ledger.ts` — the most heavily invariant-tested code in the product — gets touched on
  every debit path. The implementation plan should sequence this as its own reviewed, tested slice
  before wiring any Stripe/webhook code, so the billing-gate surgery is validated against the
  EXISTING test suite (byte-identical non-Pro pin) independently of the new Stripe plumbing.
- Nothing here changes `EMBED_TOKEN_SECRET`, the existing one-time credit-pack Checkout flow, or
  any already-shipped ADR 041/047 UI — additive only, same posture as every other flag-gated
  feature in this product.

## Open questions / revisit triggers

- Exact Stripe `Price` object creation mechanics (dashboard vs. a one-off provisioning script) —
  decide in the implementation plan, not here; either is fine, no product-behavior difference.
- The `stripe_invoice_id` idempotency-key shape for `invoice.paid` (a new column vs. reusing
  `request_id`) — an implementation-plan detail, not a design fork.
- If real usage shows 1000 credits/month is mis-priced (too generous or too stingy) — `€/N`
  config-table edit per ADR 006's "prices must be easy to change," no migration needed for the
  price itself (the `pro_grant_id` mechanism is agnostic to the exact number).
