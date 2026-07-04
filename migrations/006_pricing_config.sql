-- 006 — pricing config (WP13, ADR 006 seam 3): credit costs per action class
-- and credit-pack prices, in their own tables so they're editable by a plain
-- UPDATE, never inline in code (ADR 006: "prices must be easy to change").
-- Mirrors migration 002's canonical_measures precedent exactly: this file
-- creates the (empty) table shape only -- data lives in
-- src/billing/pricing-defaults.ts and is applied idempotently by
-- src/billing/pricing-apply.ts (`npm run pricing:apply`), so a price change
-- is one reviewable code diff, not a hand-run SQL statement.

-- Credits charged per action class. Phase 1 note (docs/08-build-plan.md WP13,
-- open-questions #4): every current *answer* is 'simple' -- no code path yet
-- produces 'analysis'/'heavy' -- those two rows exist for forward
-- compatibility (drill-down / claim-verification, a later WP) and are inert
-- until a real classifier exists. 'clarification' IS live from day one
-- (open-questions #58): a doorvraag round is priced separately from a real
-- answer, deliberately kept <= 'simple' so gate.ts's compensate-on-outcome
-- logic (migration 005) never needs a non-positive delta. Deliberately a
-- small, fixed set of classes rather than a continuous 1-100 scale (Stefan's
-- first proposal, open-questions #58): there's no complexity classifier yet
-- to make finer numbers mean anything, and a plain `credits integer` column
-- per class extends to a finer scale later without a migration once one does.
create table action_class_prices (
  action_class text primary key check (action_class in ('simple', 'analysis', 'heavy', 'clarification')),
  credits integer not null check (credits > 0)
);

-- Launch credit packs sold via Stripe Checkout (test mode until
-- open-questions #54 clears). `id` is the stable key threaded through the
-- Checkout Session's metadata so the webhook knows what was bought.
create table credit_packs (
  id text primary key,
  label text not null,
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'eur',
  credits integer not null check (credits > 0),
  active boolean not null default true
);
