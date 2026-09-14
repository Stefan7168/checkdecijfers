// The signed-in "mint an embed code" Server Action (spec Part B2). Kept to
// its own tiny file, same rationale as chart-style-actions.ts's own header
// comment: chart.tsx (a client component) must never drag this module's
// audit/db graph toward the client bundle by importing chart-style-actions.ts
// and this file from the same barrel.
'use server';

import { headers } from 'next/headers';
import Stripe from 'stripe';
import { loadAuditRecord } from '../backend/answer/audit/index.ts';
import { buildProSubscriptionCheckoutParams } from '../backend/billing/index.ts';
import { hasProPlan } from '../backend/billing/pro.ts';
import { signEmbedToken } from '../backend/chart/embed-token.ts';
import { currentUserEmail, currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';
import { proCancelledUrl, proSuccessUrl } from '../lib/purchase.ts';

/** The retention redaction sentinel (`src/answer/audit/retention.ts`'s
 * `redactedResponse()`) lives INSIDE the stored response envelope, not as a
 * column on `AuditRecord` — mirrors `scripts/verify-audit-rows.ts`'s own
 * `isRedacted` helper exactly, so a redacted row can never be embedded. */
function isRedacted(response: unknown): boolean {
  return typeof response === 'object' && response !== null && (response as { redacted?: unknown }).redacted === true;
}

export type CreateEmbedCodeResult =
  | { ok: true; token: string; pro: boolean }
  | { ok: false; reason: 'unauthenticated' | 'not_found' | 'forbidden' | 'unavailable' | 'error' };

export async function createEmbedCode(auditId: number): Promise<CreateEmbedCodeResult> {
  const userId = await currentUserId();
  if (userId === null) return { ok: false, reason: 'unauthenticated' };

  const secret = process.env.EMBED_TOKEN_SECRET;
  if (!secret) return { ok: false, reason: 'unavailable' };

  try {
    const db = getDb();
    const record = await loadAuditRecord(db, auditId);
    if (record === null) return { ok: false, reason: 'not_found' };

    if (
      record.userId !== userId ||
      record.response.kind !== 'answer' ||
      record.response.chart === null ||
      isRedacted(record.response)
    ) {
      return { ok: false, reason: 'forbidden' };
    }

    const email = await currentUserEmail();
    const pro = await hasProPlan(db, { id: userId, email });
    return { ok: true, token: signEmbedToken(auditId, secret), pro };
  } catch (e) {
    await reportError('createEmbedCode', e, { userId, extra: { auditId } });
    return { ok: false, reason: 'error' };
  }
}

/** Task 11 (open-questions #205): real Pro subscription Checkout, replacing
 * the embed dialog's interest-only "Upgrade" click when the flag is on.
 * Fails closed — `PRO_SUBSCRIPTIONS_ENABLED` unset or not exactly `'1'`
 * always returns `disabled` before anything else runs (never a crash, never
 * a silent Stripe call), matching the `EMBED_TOKEN_SECRET`/
 * `ONBOARDING_ENABLED` dormancy pattern used everywhere else in this file's
 * neighbourhood.
 *
 * A missing `STRIPE_SECRET_KEY`/`STRIPE_PRO_PRICE_ID` WHILE the flag is on
 * is a genuine deploy misconfiguration (RUNBOOK's live-wiring checklist,
 * Task 12, exists precisely so this never happens) — thrown, not swallowed
 * into a generic result, so it surfaces loudly in Vercel's function logs
 * rather than silently presenting as an inert button. */
export async function startProSubscriptionCheckout(): Promise<
  { ok: true; url: string } | { ok: false; reason: 'disabled' | 'not_signed_in' }
> {
  if (process.env.PRO_SUBSCRIPTIONS_ENABLED !== '1') {
    return { ok: false, reason: 'disabled' };
  }

  const userId = await currentUserId();
  if (userId === null) {
    return { ok: false, reason: 'not_signed_in' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('PRO_SUBSCRIPTIONS_ENABLED is set but STRIPE_SECRET_KEY is missing');
  }
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    throw new Error('PRO_SUBSCRIPTIONS_ENABLED is set but STRIPE_PRO_PRICE_ID is missing');
  }

  // Same origin resolution as the existing one-time-pack purchase action
  // (web/app/credits/actions.ts's createCheckoutSession): NEXT_PUBLIC_APP_URL
  // wins when set (production), falling back to the request's own Origin
  // header for local/preview environments where it isn't.
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? (await headers()).get('origin') ?? '';
  const params = buildProSubscriptionCheckoutParams(userId, priceId, proSuccessUrl(origin), proCancelledUrl(origin));

  // Same Stripe client construction as createCheckoutSession: a fresh client
  // per call, no module-level singleton (Stripe's own recommended pattern
  // for serverless — see that action's own precedent).
  const stripe = new Stripe(secretKey);
  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) {
    throw new Error('Stripe did not return a Checkout URL for the subscription session');
  }
  return { ok: true, url: session.url };
}
