// Pricing work package data: action_class_prices + credit_packs (migration
// 006) and the signup_grant_config singleton (migration 005). Mirrors
// src/registry/defaults.ts's pattern exactly: curated content, not measured
// data, applied idempotently by pricing-apply.ts (`npm run pricing:apply`) --
// ADR 006's "prices must be easy to change" means a price is a code diff to
// this file, never a hand-run SQL statement.
//
// Current values: docs/09-pricing.md is the single up-to-date reference --
// read that instead of reconstructing numbers from decision history. This
// file is that reference's implementation, and must stay in sync with it.
import type { ActionClassPrice, CreditPack } from './types.ts';

// Owner decision (2026-07-04, open-questions #4/#58): a 10-100 scale, not the
// original 1/3/5 -- widened so future small a-la-carte features (chart
// edits, exports) can be priced in whole credits later without rescaling
// everything again. 'clarification' is deliberately HALF of 'simple' (10 vs
// 20): a clarification round is not free (open-questions #58 -- a free
// doorvraag invited cross-topic fishing at real API cost), but a
// 'simple'-assumed debit must still be able to compensate DOWN to it, so it
// must never exceed 'simple' (a compensation row needs a positive delta --
// the ledger's CHECK constraint, migration 005, forbids the reverse).
// 'analysis'/'heavy' stay inert forward-compatibility rows until a real
// complexity classifier exists (docs/08-build-plan.md WP13).
export const ACTION_CLASS_PRICES: ActionClassPrice[] = [
  { actionClass: 'clarification', credits: 10 },
  { actionClass: 'simple', credits: 20 },
  { actionClass: 'analysis', credits: 60 },
  { actionClass: 'heavy', credits: 100 },
  // WP129+130 (ADR 032 decision 4): the +10-credit add-on charged when the
  // "Internet" source chip is on. A SEPARATE 'websearch_cost' ledger debit
  // (migration 018), not part of any answer class — priced here so it stays a
  // one-line code diff like every other price. See docs/09-pricing.md.
  { actionClass: 'web_addon', credits: 10 },
];

// Owner decision (2026-07-04, open-questions #4): launch packs, credits
// scaled x20 alongside the action classes so the euro cost of a 'simple'
// question is unchanged (EUR 0.50 -> EUR 0.30 depending on pack). The
// price-per-credit steps down by a consistent EUR 0.005 per tier
// (0.025 -> 0.020 -> 0.015 -> 0.010) -- a deliberate progression, not four
// independently-chosen discounts; the EUR 250 tier targets power-user/
// newsroom-scale volume, not an individual journalist's typical pack.
export const CREDIT_PACKS: CreditPack[] = [
  { id: 'pack_5', label: '€5 — 200 credits', priceCents: 500, currency: 'eur', credits: 200 },
  { id: 'pack_10', label: '€10 — 500 credits', priceCents: 1000, currency: 'eur', credits: 500 },
  { id: 'pack_30', label: '€30 — 2.000 credits', priceCents: 3000, currency: 'eur', credits: 2000 },
  { id: 'pack_250', label: '€250 — 25.000 credits', priceCents: 25000, currency: 'eur', credits: 25000 },
];

// Owner decision (2026-07-04, open-questions #3): 100 one-time signup
// credits, never refreshed -- revised from 5 to hold the same real value (5
// free 'simple' questions) at the widened x20 scale above. The trigger that
// actually grants credits (public.grant_signup_credits, migration 005) runs
// inside Postgres and has no way to consult this file directly -- it reads
// signup_grant_config instead, which pricing-apply.ts keeps in sync with
// this constant, so there is still exactly one reviewable source of truth
// even though two places store the value.
export const SIGNUP_GRANT_CREDITS = 100;
