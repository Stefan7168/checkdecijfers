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
  getActivePacks,
  getBalance,
  getQuestionHistory,
  getSignupGrantCredits,
} from '../backend/billing/index.ts';
import { Dashboard } from '../components/dashboard.tsx';
import { QuestionHistory } from '../components/question-history.tsx';
import { Workspace } from '../components/workspace.tsx';
import { listThreads } from '../backend/threads/index.ts';
import { getUserChartStyle } from '../backend/chart/user-styles.ts';
import { currentUserId } from '../lib/current-user.ts';
import { Landing } from '../components/landing.tsx';
import { getDb } from '../lib/db.ts';
import { loadCoverageDisclosure } from '../lib/coverage-disclosure.ts';
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
  // WP-E (R4): the coverage disclosure is read in BOTH branches below —
  // logged-out (Landing's "Dit weten we nu" section) and logged-in (the
  // chat composer's collapsed link) — from its own 30-min cache
  // (web/lib/coverage-disclosure.ts), so a single server read serves the
  // whole request regardless of which branch runs.
  const coverage = await loadCoverageDisclosure();
  if (userId === null) {
    // Session-51 owner decision: '/' is the product's public face. A
    // logged-out visitor gets the landing (no chargeable entry point; its
    // only data reads are the cached, fail-safe Ontdek discovery charts —
    // session 52, ADR 035) instead of a context-free login redirect;
    // proxy.ts allowlists '/' exact-match to let them reach it.
    return <Landing coverage={coverage} />;
  }

  const db = getDb();
  // WP129+130 (#129/#130, ADR 032): the web-search add-on price is read ONLY
  // when the flag is on (the ONBOARDING_ENABLED dormancy pattern). Flag off ⇒
  // the read never runs — so getActionClassPrice('web_addon') can never throw
  // pre-`pricing:apply` (migration 018 seeds the row only in the supervised
  // go-live) — AND the websearch prop is absent, so the chat renders no chips
  // and behaves byte-identically to today (deploy-order-safe).
  const websearchEnabled = process.env.WEBSEARCH_ENABLED === '1';

  // ADR 037 D14/WP202a: the same dormancy pattern as `websearchEnabled` above
  // — Workspace/Chat are already built and tested against `attachments`'
  // presence, so this flag is the ONLY remaining step to reach it (no price
  // read needed here: dataset_turn/dataset_ingest prices aren't in
  // pricing-defaults.ts yet, §8 Q1 still open, unrelated to this flag).
  // Dashboard has no dataset-chat integration at all, so this only ever
  // matters inside the WORKSPACE_ENABLED branch below.
  const attachmentsEnabled = process.env.ATTACHMENTS_ENABLED === '1';

  // WP135 (ADR 033 D7): dormant behind WORKSPACE_ENABLED (the WP129 pattern).
  // Flag ON → the chat workspace + site shell. Flag OFF → today's <Dashboard>,
  // rendered byte-identically below (no new props, no thread reads). The
  // workspace branch does NOT read the question history (it moved to
  // /geschiedenis, ⟨A5⟩).
  if (process.env.WORKSPACE_ENABLED === '1') {
    // Threads read server-side (like every other page read), handed to the
    // workspace as initialThreads — no client fetch-on-mount.
    const [wsBalance, wsSimplePrice, wsClarificationPrice, wsThreads, wsWebAddonPrice, wsChartStyle, wsPacks] =
      await Promise.all([
        getBalance(db, userId),
        getActionClassPrice(db, 'simple'),
        getActionClassPrice(db, 'clarification'),
        listThreads(db, userId),
        websearchEnabled ? getActionClassPrice(db, 'web_addon') : Promise.resolve(null),
        // WP218 phase 2 (owner C): the account default for chart styling.
        // getUserChartStyle already degrades to null on an absent table
        // (deploy-order safety, see the store's own header); this extra
        // `.catch` is belt-and-suspenders against any OTHER throw (a real
        // connection failure, say) so a chart-style read can never take
        // down the whole workspace page the way an un-caught Promise.all
        // rejection would.
        getUserChartStyle(db, userId).catch(() => null),
        // R2.2 (WP-D, #69/#75/#211): the same server read /credits/page.tsx
        // already does (ADR 006), narrowed to the plain {id, label, credits}
        // shape Chat's insufficient-credits message needs — never priced
        // client-side, /credits stays the one place that quotes € amounts.
        getActivePacks(db),
      ]);
    return (
      <Workspace
        initialBalance={wsBalance}
        simplePrice={wsSimplePrice}
        clarificationPrice={wsClarificationPrice}
        initialThreads={wsThreads}
        purchaseSuccess={purchase === PURCHASE_SUCCESS_VALUE}
        chartStyle={wsChartStyle?.style ?? null}
        packs={wsPacks.map((pack) => ({ id: pack.id, label: pack.label, credits: pack.credits }))}
        coverage={coverage}
        {...(websearchEnabled && wsWebAddonPrice !== null
          ? { websearch: { enabled: true as const, addonPrice: wsWebAddonPrice } }
          : {})}
        {...(attachmentsEnabled ? { attachments: { enabled: true as const } } : {})}
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
