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
import { getLang } from '../../lib/i18n/server.ts';
import { t } from '../../lib/i18n/messages.ts';
import { purchaseSuccessUrl } from '../../lib/purchase.ts';

// WP218 phase 4 (#219): a Server Action cannot see the client's
// LangProvider, so it reads getLang() itself and returns the already-
// translated string (design doc §2.4/§3).
export async function createCheckoutSession(packId: string): Promise<{ error: string } | undefined> {
  const lang = await getLang();
  // Server Action arguments are attacker-controlled and their declared types
  // are erased at runtime — the same belt actions.ts applies to `question` /
  // `reply` / `requestId`. Benign here (the checkout amount and currency come
  // from the DB row, never from this input), but it is the one remaining
  // action argument that did not meet the standard, and an unchecked value
  // reaching a query parameter is not a habit worth keeping.
  if (typeof packId !== 'string' || packId.length === 0 || packId.length > 100) {
    return { error: t(lang, 'credits.unknownPack') };
  }

  const userId = await currentUserId();
  if (userId === null) {
    return { error: t(lang, 'credits.notLoggedIn') };
  }

  const pack = await getPack(getDb(), packId);
  if (pack === null) {
    return { error: t(lang, 'credits.unknownPack') };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('createCheckoutSession: STRIPE_SECRET_KEY is not set');
    return { error: t(lang, 'credits.unavailable') };
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? (await headers()).get('origin') ?? '';
  const params = buildCheckoutSessionParams(
    pack,
    userId,
    // WP22 (#95): success returns to the main page — the dashboard IS the
    // app; cancel stays on the pack list (only success was decided).
    purchaseSuccessUrl(origin),
    `${origin}/credits?purchase=cancelled`,
  );

  let url: string | null;
  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create(params);
    url = session.url;
  } catch (error) {
    console.error('createCheckoutSession failed:', error);
    return { error: t(lang, 'credits.startFailed') };
  }

  if (!url) {
    return { error: t(lang, 'credits.noCheckoutUrl') };
  }
  // redirect() throws internally (Next's own control-flow mechanism) — kept
  // OUTSIDE the try/catch above so that throw is never accidentally caught
  // and swallowed as an "error".
  redirect(url);
}
