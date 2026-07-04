// Billing module surface (WP13, ADR 006 seams 2-4, ADR 020): the credit
// ledger, pricing config, and the billing gate that wraps the audited answer
// entry points from the outside.
export type { ActionClass, ActionClassPrice, CreditPack, GatedResponse, LedgerReason } from './types.ts';
export { compensate, debitQuestion, getActionClassPrice, getBalance, reserveDebit } from './ledger.ts';
export type { LedgerEntry, ReserveDebitResult } from './ledger.ts';
export { chargeAndRun } from './gate.ts';
export { ACTION_CLASS_PRICES, CREDIT_PACKS, SIGNUP_GRANT_CREDITS } from './pricing-defaults.ts';
export { applyPricingDefaults } from './pricing-apply.ts';
export type { PricingApplyResult } from './pricing-apply.ts';
export { getActivePacks, getPack } from './pricing-read.ts';
export { buildCheckoutSessionParams } from './stripe-checkout.ts';
export { handleStripeEvent } from './stripe-webhook.ts';
export type { StripeWebhookResult } from './stripe-webhook.ts';
