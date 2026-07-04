// Billing module surface (WP13, ADR 006 seams 2-4, ADR 020): the credit
// ledger, pricing config, and the billing gate that wraps the audited answer
// entry points from the outside.
//
// Deliberately does NOT re-export from pricing-apply.ts (import it directly:
// `import { applyPricingDefaults } from '../src/billing/pricing-apply.ts'`).
// That file's CLI entry point dynamically imports src/db/migrate.ts, whose
// `MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url))`
// Turbopack statically treats as a client-asset reference (the exact bug
// class ADR 018/lessons-learned already documented for src/db/client.ts) --
// pointing at a directory that doesn't exist as a bundleable asset. Nothing
// in web/ needs applyPricingDefaults (it's an ops/CLI-only operation, run via
// `npm run pricing:apply`, never from the deployed app) -- keeping it out of
// this barrel is the correct scope, not a workaround: importing ANYTHING
// from a barrel pulls the whole barrel's module graph into Turbopack's
// resolution, even code paths a consumer never executes.
export type { ActionClass, ActionClassPrice, CreditPack, GatedResponse, LedgerReason } from './types.ts';
export { compensate, debitQuestion, getActionClassPrice, getBalance, reserveDebit } from './ledger.ts';
export type { LedgerEntry, ReserveDebitResult } from './ledger.ts';
export { chargeAndRun } from './gate.ts';
export { getQuestionHistory } from './history.ts';
export type { QuestionHistoryEntry } from './history.ts';
export { ACTION_CLASS_PRICES, CREDIT_PACKS, SIGNUP_GRANT_CREDITS } from './pricing-defaults.ts';
export { getActivePacks, getPack } from './pricing-read.ts';
export { buildCheckoutSessionParams } from './stripe-checkout.ts';
export { handleStripeEvent } from './stripe-webhook.ts';
export type { StripeWebhookResult } from './stripe-webhook.ts';
