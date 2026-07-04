// WP22 (open-questions #95): the redirect leaves /credits for the main page.
import { describe, expect, it } from 'vitest';
import { PURCHASE_PARAM, PURCHASE_SUCCESS_VALUE, purchaseSuccessUrl } from './purchase.ts';

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
