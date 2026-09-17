// `/` — the PUBLIC face of the product, and since the session-110 route split
// (ADR 033 D8) nothing else. A logged-out visitor gets the landing (no
// chargeable entry point; its only data reads are the cached, fail-safe Ontdek
// discovery charts — session 52, ADR 035 — and, since the journey programme
// (session 97, R4), the equally cached, fail-safe coverage disclosure: one
// registry read + one freshest-period read per measure every 30 minutes, never
// per request) instead of a context-free login redirect (session-51 owner
// decision); proxy.ts allowlists '/' exact-match to let them reach it.
//
// THE SIGNED-IN PRODUCT IS NOT IMPORTED HERE, DELIBERATELY. Next builds a
// route's client-reference manifest from its static import graph, not from
// which runtime branch executes, so while this one file imported `Dashboard`
// and `Workspace` too, every anonymous visitor downloaded the entire chat
// workspace before the landing could paint (measured: the anonymous and the
// signed-in response shipped the exact same 15 script tags / ~1.50 MB —
// docs/session-briefs/2026-09-13-build-performance-diagnosis.md). `next/dynamic()`
// was measured twice and does not help. The signed-in tree now lives in its own
// route segment, web/app/workspace/page.tsx, which web/proxy.ts rewrites `/` to
// when the request carries a valid session — same URL, separate bundle.
// `app/workspace/page.test.tsx` pins that this file never imports it again.
export const runtime = 'nodejs';
// Kept from the pre-split page: the anonymous TRIAL chat (components/trial.tsx →
// trial-chat.tsx) posts its Server Action to THIS route, and that action runs
// the same CBS pipeline the signed-in one does (measured median 6.5s, max ~14s,
// WP11). A ceiling is not a hold.
export const maxDuration = 90;
// This page no longer reads cookies (the session branch moved out), so nothing
// else forces per-request rendering — without this export Next could prerender
// the landing at BUILD time and freeze the coverage disclosure and the Ontdek
// gallery into the build output. Both are deliberately request-time reads
// behind their own 30-minute caches (ADR 035/046), so the landing must stay
// dynamic, exactly as it was before the split.
export const dynamic = 'force-dynamic';

import { Landing } from '../components/landing.tsx';
import { loadCoverageDisclosure } from '../lib/coverage-disclosure.ts';

export default async function Home() {
  // WP-E (R4): read from the 30-min cache (web/lib/coverage-disclosure.ts), so
  // a single server read serves the whole request.
  const coverage = await loadCoverageDisclosure();
  return <Landing coverage={coverage} />;
}
