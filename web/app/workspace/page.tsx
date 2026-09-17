// The SIGNED-IN half of `/` (session 110 route split, ADR 033 D8).
//
// `/` used to be one Server Component that statically imported `Landing`,
// `Dashboard` AND `Workspace` and picked one at request time. Next builds a
// route's client-reference manifest from its STATIC IMPORT GRAPH, not from
// which runtime branch executes, so every anonymous visitor's browser
// downloaded the whole signed-in workspace (chat, thread sidebar, visual
// dock) before it could paint the landing — measured, byte-for-byte
// identical script tags for both audiences
// (docs/session-briefs/2026-09-13-build-performance-diagnosis.md,
// "Logged-in workspace bundle"). `next/dynamic()` was measured twice and does
// NOT fix it (pass 3 Target B): Next still emits an unconditional
// `<script src>` for every chunk reachable from the route's graph. The only
// mechanism that works is a genuinely separate route segment — this file.
//
// The URL does not change. web/proxy.ts rewrites `/` to this path when (and
// only when) the request carries a valid Supabase session, so the address
// bar, bookmarks, the header's home link, the purchase redirect and the e2e
// tests all still say `/`. A DIRECT request to this path is redirected back
// to `/` by that same proxy (see `isInternalAppPath` there) — the rewrite is
// internal and never a URL a browser can ask for.
export const runtime = 'nodejs';
// Same ⟨W2⟩ (WP129+130, ADR 032) budget the single `/` page carried before
// the split, and for the same reason: a Server Action posts to the URL the
// browser is on (`/`), which this proxy rewrite resolves to THIS segment, so
// this segment's ceiling is the one that governs askQuestion. When the
// "Internet" chip is on, the web-search call (WEBSEARCH_TIMEOUT_MS = 45s)
// stacks ON TOP of the CBS pipeline inside the same invocation; 14s + 45s +
// margin fits in 90s. Unconditional — a ceiling is not a hold, and a static
// segment-config export cannot be flag-conditional. `/`'s own page.tsx keeps
// an identical export for the anonymous trial chat's Server Action.
export const maxDuration = 90;
// The flag reads below (WORKSPACE_ENABLED, WEBSEARCH_ENABLED,
// ATTACHMENTS_ENABLED, BRANDFETCH_API_KEY) must happen per REQUEST, never
// once at build time — the /geschiedenis + /login precedent (#135 residual,
// session 55): a build-time prerender with a flag off freezes that branch
// until the next build, so flipping the flag on in production would silently
// do nothing. This page also reads cookies (currentUserId), which already
// forces dynamic rendering; the explicit export states the requirement
// instead of relying on that side effect surviving a future refactor.
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import {
  getActionClassPrice,
  getActivePacks,
  getBalance,
  getQuestionHistory,
  getSignupGrantCredits,
} from '../../backend/billing/index.ts';
import { Dashboard } from '../../components/dashboard.tsx';
import { QuestionHistory } from '../../components/question-history.tsx';
import { Workspace } from '../../components/workspace.tsx';
import { listThreads } from '../../backend/threads/index.ts';
import { getUserChartStyle } from '../../backend/chart/user-styles.ts';
import { currentUserId } from '../../lib/current-user.ts';
import { getDb } from '../../lib/db.ts';
import { loadCoverageDisclosure } from '../../lib/coverage-disclosure.ts';
import { PURCHASE_PARAM, PURCHASE_SUCCESS_VALUE } from '../../lib/purchase.ts';

export default async function WorkspaceRoute({
  searchParams,
}: {
  searchParams: Promise<{ [PURCHASE_PARAM]?: string }>;
}) {
  // Belt-and-suspenders (WP13 precedent, /credits/page.tsx): proxy.ts only
  // rewrites `/` here for a request whose JWT it just validated, but a proxy
  // matcher is an optimistic check, never the authorization boundary for the
  // balance/history reads below. No session ⇒ back to `/`, which serves the
  // public landing (and cannot loop: the proxy never rewrites an anonymous
  // `/`).
  const { [PURCHASE_PARAM]: purchase } = await searchParams;
  const userId = await currentUserId();
  if (userId === null) {
    redirect('/');
  }
  // WP-E (R4): the coverage disclosure feeds the chat composer's collapsed
  // link, from its own 30-min cache (web/lib/coverage-disclosure.ts) — one
  // server read per request at most, never a per-question read.
  const coverage = await loadCoverageDisclosure();

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

  // Row 11 (session 110 UX audit pass 5, still-broken recheck): a plain env
  // presence check, no dormancy flag involved (Brandfetch itself has been
  // live since WP218 phase 3) — this is the SAME fact chart-style-actions.ts's
  // `lookupBrand` checks before any per-user work, read here once so it can
  // reach the render instead of only surfacing after a failed click.
  const brandLookupAvailable = Boolean(process.env.BRANDFETCH_API_KEY);

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
        brandLookupAvailable={brandLookupAvailable}
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
