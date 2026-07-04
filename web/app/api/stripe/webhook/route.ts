// Stripe webhook (WP13, ADR 006 seam 4 / ADR 020) — a thin Route Handler
// adapter over src/billing/stripe-webhook.ts's framework-agnostic logic. A
// Route Handler, not a Server Action: Stripe POSTs here directly and needs
// the RAW request body for signature verification (a Server Action can't be
// invoked by an arbitrary external POST).
export const runtime = 'nodejs';

import { handleStripeEvent } from '../../../../backend/billing/index.ts';
import { getDb } from '../../../../lib/db.ts';

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return new Response('missing signature or webhook secret', { status: 400 });
  }

  const rawBody = await request.text();
  try {
    const result = await handleStripeEvent(getDb(), rawBody, signature, webhookSecret);
    return Response.json(result, { status: 200 });
  } catch (error) {
    // Webhook security: an unverified/malformed event must be REJECTED
    // (4xx), never processed — Stripe retries on non-2xx.
    console.error('stripe webhook failed:', error);
    return new Response('webhook error', { status: 400 });
  }
}
