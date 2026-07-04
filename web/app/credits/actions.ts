// Credit-pack checkout (WP13, ADR 006 seam 4 / ADR 020). Stripe TEST MODE
// ONLY until open-questions #54 (KvK) clears — the actual crediting never
// happens here or on the success-page redirect; it happens exclusively via
// the webhook (web/app/api/stripe/webhook/route.ts), which fires
// server-to-server regardless of whether the user's browser ever reaches
// the success page.
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Stripe from 'stripe';
import { buildCheckoutSessionParams, getPack } from '../../backend/billing/index.ts';
import { currentUserId } from '../../lib/current-user.ts';
import { getDb } from '../../lib/db.ts';

export async function createCheckoutSession(packId: string): Promise<{ error: string } | undefined> {
  const userId = await currentUserId();
  if (userId === null) {
    return { error: 'Je bent niet ingelogd.' };
  }

  const pack = await getPack(getDb(), packId);
  if (pack === null) {
    return { error: 'Onbekend of niet meer beschikbaar pakket.' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('createCheckoutSession: STRIPE_SECRET_KEY is not set');
    return { error: 'Betalen is momenteel niet beschikbaar.' };
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? (await headers()).get('origin') ?? '';
  const params = buildCheckoutSessionParams(
    pack,
    userId,
    `${origin}/credits?purchase=success`,
    `${origin}/credits?purchase=cancelled`,
  );

  let url: string | null;
  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create(params);
    url = session.url;
  } catch (error) {
    console.error('createCheckoutSession failed:', error);
    return { error: 'Er ging iets mis bij het starten van de betaling.' };
  }

  if (!url) {
    return { error: 'Stripe gaf geen checkout-URL terug.' };
  }
  // redirect() throws internally (Next's own control-flow mechanism) — kept
  // OUTSIDE the try/catch above so that throw is never accidentally caught
  // and swallowed as an "error".
  redirect(url);
}
