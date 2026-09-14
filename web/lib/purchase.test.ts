// WP22 (open-questions #95): the redirect leaves /credits for the main page.
import { describe, expect, it } from 'vitest';
import {
  PRO_CANCELLED_VALUE,
  PRO_PARAM,
  PRO_SUCCESS_VALUE,
  PURCHASE_PARAM,
  PURCHASE_SUCCESS_VALUE,
  proCancelledUrl,
  proSuccessUrl,
  purchaseSuccessUrl,
} from './purchase.ts';

describe('purchaseSuccessUrl', () => {
  it('targets the main page, never the pack list (#95 owner decision)', () => {
    expect(purchaseSuccessUrl('https://checkdecijfers.vercel.app')).toBe(
      'https://checkdecijfers.vercel.app/?purchase=success',
    );
  });

  it('keeps writer and reader on one definition', () => {
    expect(PURCHASE_PARAM).toBe('purchase');
    expect(PURCHASE_SUCCESS_VALUE).toBe('success');
  });
});

// Task 11 (open-questions #205): the Pro subscription Checkout's own
// success/cancel pair — a separate `pro` param from PURCHASE_PARAM above,
// landing on /credits (the same page the one-time pack flow's own cancel_url
// already uses) rather than the main page.
describe('proSuccessUrl / proCancelledUrl', () => {
  it('targets /credits with the pro=success param, never colliding with PURCHASE_PARAM', () => {
    expect(proSuccessUrl('https://checkdecijfers.vercel.app')).toBe(
      'https://checkdecijfers.vercel.app/credits?pro=success',
    );
  });

  it('targets /credits with the pro=cancelled param', () => {
    expect(proCancelledUrl('https://checkdecijfers.vercel.app')).toBe(
      'https://checkdecijfers.vercel.app/credits?pro=cancelled',
    );
  });

  it('keeps writer and reader on one definition, distinct from the pack flow\'s own', () => {
    expect(PRO_PARAM).toBe('pro');
    expect(PRO_SUCCESS_VALUE).toBe('success');
    expect(PRO_CANCELLED_VALUE).toBe('cancelled');
    expect(PRO_PARAM).not.toBe(PURCHASE_PARAM);
  });
});
