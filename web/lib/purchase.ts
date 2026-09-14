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

// Task 11 (open-questions #205): the Pro subscription Checkout's own
// success/cancel pair — a SEPARATE param from PURCHASE_PARAM above (never
// `purchase=success`) so the two flows can never be confused on the page
// that reads them. Lands on /credits, the same page the one-time
// credit-pack flow already uses for its own cancel_url (`/credits?purchase
// =cancelled`, web/app/credits/actions.ts) and which already reads a query
// param for a dismissible-free, no-client-state confirmation line — the
// smallest existing pattern to reuse, rather than the dashboard/workspace
// dismissible purchase banner (a bigger mechanism, not needed here).
export const PRO_PARAM = 'pro';
export const PRO_SUCCESS_VALUE = 'success';
export const PRO_CANCELLED_VALUE = 'cancelled';

export function proSuccessUrl(origin: string): string {
  return `${origin}/credits?${PRO_PARAM}=${PRO_SUCCESS_VALUE}`;
}

export function proCancelledUrl(origin: string): string {
  return `${origin}/credits?${PRO_PARAM}=${PRO_CANCELLED_VALUE}`;
}
