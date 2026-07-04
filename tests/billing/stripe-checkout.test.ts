// Stripe Checkout Session params builder (src/billing/stripe-checkout.ts) —
// pure, no network: correct amounts/metadata, and the deliberate omission of
// `payment_method_types` (Stripe's dynamic payment-method selection is what
// will surface iDEAL once enabled on the account).
import { describe, expect, it } from 'vitest';
import { buildCheckoutSessionParams } from '../../src/billing/stripe-checkout.ts';
import { CREDIT_PACKS } from '../../src/billing/pricing-defaults.ts';

describe('buildCheckoutSessionParams', () => {
  it('builds a one-time payment session with the pack price and currency', () => {
    const pack = CREDIT_PACKS[0]!;
    const params = buildCheckoutSessionParams(pack, 'user-123', 'https://example.com/ok', 'https://example.com/cancel');
    expect(params.mode).toBe('payment');
    expect(params.success_url).toBe('https://example.com/ok');
    expect(params.cancel_url).toBe('https://example.com/cancel');
    expect(params.line_items).toHaveLength(1);
    const lineItem = params.line_items![0]!;
    expect(lineItem.price_data?.unit_amount).toBe(pack.priceCents);
    expect(lineItem.price_data?.currency).toBe(pack.currency);
    expect(lineItem.quantity).toBe(1);
  });

  it('never sets payment_method_types (Stripe dynamic selection surfaces iDEAL)', () => {
    const pack = CREDIT_PACKS[0]!;
    const params = buildCheckoutSessionParams(pack, 'user-123', 'https://example.com/ok', 'https://example.com/cancel');
    expect(params).not.toHaveProperty('payment_method_types');
  });

  it('carries userId/packId/credits in metadata for the webhook to read back', () => {
    const pack = CREDIT_PACKS[1]!;
    const params = buildCheckoutSessionParams(pack, 'user-abc', 'https://example.com/ok', 'https://example.com/cancel');
    expect(params.metadata).toEqual({ userId: 'user-abc', packId: pack.id, credits: String(pack.credits) });
  });

  it('every pack produces a distinct, valid session', () => {
    for (const pack of CREDIT_PACKS) {
      const params = buildCheckoutSessionParams(pack, 'user-x', 'https://example.com/ok', 'https://example.com/cancel');
      expect(params.line_items![0]!.price_data?.unit_amount).toBe(pack.priceCents);
    }
  });
});
