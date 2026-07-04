// WP22 (open-questions #95): the post-purchase redirect target and its query
// flag — ONE definition shared by the checkout action (the writer) and the
// dashboard page (the reader), so the two can never drift apart.
export const PURCHASE_PARAM = 'purchase';
export const PURCHASE_SUCCESS_VALUE = 'success';

/** Stripe success_url: back to the main page — the dashboard IS the app;
 * buying credits is instrumental, never the destination (owner decision,
 * open-questions #95, 2026-07-05). */
export function purchaseSuccessUrl(origin: string): string {
  return `${origin}/?${PURCHASE_PARAM}=${PURCHASE_SUCCESS_VALUE}`;
}
