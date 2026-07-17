// Server Component boundary: only Server Components may export the runtime
// segment config (ADR 018 decision 4) — 'nodejs' is already Next's default,
// set explicitly as insurance since the DB pool (pg) and the pinned-CA
// filesystem read cannot run on the Edge runtime.
export const runtime = 'nodejs';
// Measured live latency (WP11): median 6.5s, max ~14s.
// ⟨W2⟩ (WP129+130, ADR 032): raised 30 → 90. When the "Internet" chip is on,
// the web-search call (WEBSEARCH_TIMEOUT_MS = 45s) stacks ON TOP of the CBS
// pipeline INSIDE the same Server Action invocation. A 30s ceiling could kill
// the invocation between the web reserve and the settlement — orphaning a
// 10-credit debit AND skipping the audit write. 14s + 45s + margin fits in 90s;
// Vercel's current default ceiling is 300s on all plans (re-verify against the
// deployed plan in the RUNBOOK go-live step). Unconditional — a ceiling is not
// a hold, and a static segment-config export cannot be flag-conditional.
export const maxDuration = 90;

import {
  getActionClassPrice,
  getBalance,
  getQuestionHistory,
  getSignupGrantCredits,
} from '../backend/billing/index.ts';
import { Dashboard } from '../components/dashboard.tsx';
import { QuestionHistory } from '../components/question-history.tsx';
import { Workspace } from '../components/workspace.tsx';
import { listThreads } from '../backend/threads/index.ts';
import { currentUserId } from '../lib/current-user.ts';
import { Landing } from '../components/landing.tsx';
import { getDb } from '../lib/db.ts';
import { PURCHASE_PARAM, PURCHASE_SUCCESS_VALUE } from '../lib/purchase.ts';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [PURCHASE_PARAM]?: string }>;
}) {
  // Belt-and-suspenders (WP13 precedent, /credits/page.tsx): proxy.ts already
  // redirects unauthenticated visits away from "/", but a proxy matcher is
  // an optimistic check, never the authorization boundary for the balance/
  // history reads below.
  const { [PURCHASE_PARAM]: purchase } = await searchParams;
  const userId = await currentUserId();
  if (userId === null) {
    // Session-51 owner decision: '/' is the product's public face. A
    // logged-out visitor gets the landing (no chargeable entry point; its
    // only data reads are the cached, fail-safe Ontdek discovery charts —
    // session 52, ADR 035) instead of a context-free login redirect;
    // proxy.ts allowlists '/' exact-match to let them reach it.
    return <Landing />;
  }

  const db = getDb();
  // WP129+130 (#129/#130, ADR 032): the web-search add-on price is read ONLY
  // when the flag is on (the ONBOARDING_ENABLED dormancy pattern). Flag off ⇒
  // the read never runs — so getActionClassPrice('web_addon') can never throw
  // pre-`pricing:apply` (migration 018 seeds the row only in the supervised
  // go-live) — AND the websearch prop is absent, so the chat renders no chips
  // and behaves byte-identically to today (deploy-order-safe).
  const websearchEnabled = process.env.WEBSEARCH_ENABLED === '1';

  // WP135 (ADR 033 D7): dormant behind WORKSPACE_ENABLED (the WP129 pattern).
  // Flag ON → the chat workspace + site shell. Flag OFF → today's <Dashboard>,
  // rendered byte-identically below (no new props, no thread reads). The
  // workspace branch does NOT read the question history (it moved to
  // /geschiedenis, ⟨A5⟩).
  if (process.env.WORKSPACE_ENABLED === '1') {
    // Threads read server-side (like every other page read), handed to the
    // workspace as initialThreads — no client fetch-on-mount.
    const [wsBalance, wsSimplePrice, wsClarificationPrice, wsThreads, wsWebAddonPrice] =
      await Promise.all([
        getBalance(db, userId),
        getActionClassPrice(db, 'simple'),
        getActionClassPrice(db, 'clarification'),
        listThreads(db, userId),
        websearchEnabled ? getActionClassPrice(db, 'web_addon') : Promise.resolve(null),
      ]);
    return (
      <Workspace
        initialBalance={wsBalance}
        simplePrice={wsSimplePrice}
        clarificationPrice={wsClarificationPrice}
        initialThreads={wsThreads}
        purchaseSuccess={purchase === PURCHASE_SUCCESS_VALUE}
        {...(websearchEnabled && wsWebAddonPrice !== null
          ? { websearch: { enabled: true as const, addonPrice: wsWebAddonPrice } }
          : {})}
      />
    );
  }

  // simplePrice + signupGrantCredits: live pricing-config reads (ADR 006 --
  // the #69 warning threshold and #76 explainer copy must track the tables,
  // never a hardcoded number).
  const [balance, history, simplePrice, clarificationPrice, signupGrantCredits, webAddonPrice] =
    await Promise.all([
      getBalance(db, userId),
      // includeOnboarding rides the same master switch as the finder injection
      // (actions.ts): while ONBOARDING_ENABLED is unset, the history read never
      // touches the not-yet-migrated pending_table_requests table.
      getQuestionHistory(db, userId, { includeOnboarding: process.env.ONBOARDING_ENABLED === '1' }),
      getActionClassPrice(db, 'simple'),
      getActionClassPrice(db, 'clarification'),
      getSignupGrantCredits(db),
      websearchEnabled ? getActionClassPrice(db, 'web_addon') : Promise.resolve(null),
    ]);

  return (
    <Dashboard
      initialBalance={balance}
      simplePrice={simplePrice}
      clarificationPrice={clarificationPrice}
      signupGrantCredits={signupGrantCredits}
      history={<QuestionHistory items={history} />}
      purchaseSuccess={purchase === PURCHASE_SUCCESS_VALUE}
      {...(websearchEnabled && webAddonPrice !== null
        ? { websearch: { enabled: true as const, addonPrice: webAddonPrice } }
        : {})}
    />
  );
}
