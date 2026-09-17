// #114: the auth-free synthetic health route — option (b) from the row,
// closing the smoke check's authenticated-only blind spot.
//
// Why it exists. The CI post-deploy smoke only ever saw pages an anonymous
// visitor can reach, so an authenticated-only regression kept CI fully green
// while the app was broken for every signed-in user. Twice, concretely: the
// session-27 incident (GET / 500'd on the missing pending_table_requests
// relation for every logged-in user; /login stayed 200) and the WP16 go-live
// proxy bug (a 307-to-/login on a real endpoint, invisible to a smoke that
// follows redirects into /login's 200).
//
// What it does. Runs the SAME real read functions the signed-in dashboard
// (web/app/page.tsx, /geschiedenis) runs — same tables, same joins, same
// flag gating — against a synthetic user id that matches no rows, so a
// missing relation/column or broken SQL shape fails HERE exactly as it would
// on the real dashboard, with no test-user credential for CI to hold or
// rotate. Accepted limit (the row records it): this misses auth-LAYER
// breakage — a Supabase outage or session-cookie bug still passes; the row
// stays open for that residue.
//
// What it can never leak. The synthetic id belongs to no one, and the
// response carries ONLY check names (ours) — never row data, never error
// text (raw messages could describe schema/SQL to anonymous callers; the
// detail goes to Vercel logs + error_log instead, #65).
//
// Auth-free ON PURPOSE (the point of option (b)) — proxy.ts allowlists
// '/api/health' exact-match; web/proxy.test.ts pins it. The CI smoke calls
// this WITHOUT following redirects, so a proxy regression that un-exempts
// the route fails the deploy instead of being masked by /login's 200.
export const runtime = 'nodejs';
// A statically-cached 200 baked at build time would be a health check that
// cannot fail. Force per-request execution (this GET reads no request input,
// so Next would otherwise consider it static).
export const dynamic = 'force-dynamic';

import { getDb } from '../../../lib/db.ts';
import { runHealthChecks, type HealthCheckFlags } from './checks.ts';

export async function GET(): Promise<Response> {
  const db = getDb();
  // Mirror page.tsx's flag gating EXACTLY: while a feature is dormant its
  // tables/price rows may not exist yet (the migration-before-flag deploy
  // order), so probing them would fail deploys for a table the product
  // itself never touches — and once a flag is on, the probe covers exactly
  // what the live dashboard now depends on (the session-27 class).
  const flags: HealthCheckFlags = {
    onboardingEnabled: process.env.ONBOARDING_ENABLED === '1',
    websearchEnabled: process.env.WEBSEARCH_ENABLED === '1',
    workspaceEnabled: process.env.WORKSPACE_ENABLED === '1',
  };

  const result = await runHealthChecks(db, flags);
  if (!result.ok) {
    // 503, not 500: "a dependency this service needs is unavailable" — and
    // only OUR check name in the body, never the error text.
    return Response.json(
      { ok: false, failed: result.failed[0] },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return Response.json(
    { ok: true, checks: result.checks },
    { headers: { 'cache-control': 'no-store' } },
  );
}
