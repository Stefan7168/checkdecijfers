# Pricing & credits — current values (Phase 1 / WP13)

**What this is:** the single, current-state reference for what things cost — action classes, credit packs, the signup grant. **Not** the decision history (that's [open-questions.md](open-questions.md) #3/#4/#58, which keeps the "was X, revised to Y, because Z" trail); **not** the schema (that's migrations [005](../migrations/005_credit_ledger.sql)/[006](../migrations/006_pricing_config.sql)); **not** the design rationale for *why* billing works this way at all (that's ADR [006](decisions/006-auth-billing-seams.md)). This doc exists so a later session — or Stefan — can see "what does X cost right now" without reconstructing it from three files' worth of superseded numbers.

**Status: target values for WP13, not yet built.** `src/billing/` doesn't exist yet; nothing here is live. Values below are what the implementing session should encode in `src/billing/pricing-defaults.ts` and apply via `pricing:apply`.

**All values are starting points, not frozen law** (ADR 006: "prices must be easy to change") — a config-table row edit, not a code change.

## Action classes (cost per action, in credits)

| Class | Credits | Status |
|---|---|---|
| `clarification` | **10** | Live — every doorvraag (clarification round) costs this, flat |
| `simple` | **20** | Live — every current pipeline *answer* is `simple`; no classifier exists yet for the two rows below |
| `analysis` | **60** | Inert placeholder — forward compatibility for a later classifier (drill-down / comparison-heavy questions) |
| `heavy` | **100** | Inert placeholder — forward compatibility (multi-table / claim-verification questions) |

**An outright refusal costs 0 credits, always** — it is not a class; there is nothing to price because there is nothing to explore (see settlement policy below).

## Debit-before-answer, then settle

The billing gate is a reservation pattern, not "charge after success":

1. **Estimate** the class before running the pipeline. Today this is always `simple` (20 credits) — no classifier exists that could estimate `analysis`/`heavy` up front.
2. **Debit** that amount immediately (`credit_transactions`, reason `question_cost`) — before the expensive pipeline call, so a user can never run the pipeline for free by cancelling mid-flight.
3. **Settle** once the pipeline's outcome is known, via a `compensation` entry (append-only — never edits the original debit):
   - **Answer:** debit stands, no compensation.
   - **Clarification:** compensate **10 credits** back (20 debited − 10 owed = 10 refunded), net cost 10 — the flat `clarification` price.
   - **Refusal:** compensate the full amount back, net cost 0.

**Structural invariant:** the `clarification` price must never exceed the cheapest answer-class price (10 ≤ 20 today), or a compensation row would need a non-positive delta — which the ledger's CHECK constraint (migration 005) forbids by design. Keep this in mind if `simple`'s price ever drops below 10.

## Signup grant

**100 credits**, granted once at account creation, never refreshed, never expires (`signup_grant_config`, migration 005). Equivalent to 5 free `simple` questions at current prices.

## Credit packs (Stripe Checkout, test mode until [open-questions #54](open-questions.md) clears)

| Pack price | Credits | €/credit |
|---|---|---|
| €5 | 200 | €0.025 |
| €10 | 500 | €0.020 |
| €30 | 2,000 | €0.015 |
| €250 | 25,000 | €0.010 |

The price-per-credit steps down by exactly €0.005 per tier — a deliberate, consistent progression, not four independently-chosen discounts. The €250 tier is aimed at power users / newsroom-scale volume, not an individual journalist's typical pack.

In euro terms, a `simple` question costs **€0.50 → €0.30** depending which pack the credits came from (unchanged from the pre-rescale numbers — the whole scale was multiplied by 20 specifically so the euro price a user actually pays stayed the same).

## What's easy to change vs. what isn't

- **Easy (config-table edit, no migration):** any credit amount above — action-class prices, pack prices/credits, the signup grant.
- **Needs a migration:** adding a fifth action class, changing which `reason` values exist in the ledger, or changing the settlement policy's shape (e.g. introducing a third settlement outcome beyond "stands / compensate to clarification price / compensate to zero").

## Decision trail (for *why*, not *what*)

- [open-questions #3](open-questions.md) — signup grant amount and mechanism (one-time, never refreshed)
- [open-questions #4](open-questions.md) — action-class and pack pricing (originally 1/3/5 + €5/10·€10/25·€30/100; superseded 2026-07-04 by the 10–100 scale + fourth pack above)
- [open-questions #58](open-questions.md) — why a clarification round costs credits at all (anti-abuse: free doorvragen invited cross-topic fishing at real API cost), and why the class scale is four fixed values rather than a continuous 1–100 score
