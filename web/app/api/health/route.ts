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

import {
  getActionClassPrice,
  getBalance,
  getQuestionHistory,
  getSignupGrantCredits,
} from '../../../backend/billing/index.ts';
import { listThreads } from '../../../backend/threads/index.ts';
import { getDb } from '../../../lib/db.ts';
import { reportError } from '../../../lib/error-report.ts';

/** The nil uuid: valid for every uuid/text user_id column the dashboard reads
 * filter on (credit_transactions.user_id IS uuid-typed — a non-uuid string
 * would itself error), and never issued to a real account by Supabase. */
const SYNTHETIC_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function GET(): Promise<Response> {
  const db = getDb();
  // Mirror page.tsx's flag gating EXACTLY: while a feature is dormant its
  // tables/price rows may not exist yet (the migration-before-flag deploy
  // order), so probing them would fail deploys for a table the product
  // itself never touches — and once a flag is on, the probe covers exactly
  // what the live dashboard now depends on (the session-27 class).
  const onboardingEnabled = process.env.ONBOARDING_ENABLED === '1';
  const websearchEnabled = process.env.WEBSEARCH_ENABLED === '1';
  const workspaceEnabled = process.env.WORKSPACE_ENABLED === '1';

  const checks: Array<[name: string, run: () => Promise<unknown>]> = [
    // credit_transactions (the balance read every signed-in page does).
    ['balance-read', () => getBalance(db, SYNTHETIC_USER_ID)],
    // audit_answers + credit_transactions netting join; with onboarding on,
    // also pending_table_requests — THE session-27 query.
    [
      'question-history-read',
      () => getQuestionHistory(db, SYNTHETIC_USER_ID, { includeOnboarding: onboardingEnabled }),
    ],
    // action_class_prices (throws if pricing was never applied — a real
    // operational precondition, worth failing loudly).
    ['pricing-read-simple', () => getActionClassPrice(db, 'simple')],
    ['pricing-read-clarification', () => getActionClassPrice(db, 'clarification')],
    // signup_grant_config (the Dashboard explainer copy's live read).
    ['signup-grant-read', () => getSignupGrantCredits(db)],
  ];
  if (websearchEnabled) {
    checks.push(['pricing-read-web-addon', () => getActionClassPrice(db, 'web_addon')]);
  }
  if (workspaceEnabled) {
    checks.push(['threads-read', () => listThreads(db, SYNTHETIC_USER_ID)]);
  }

  // Sequential on purpose: `failed` must name the precise check, and six
  // zero-row reads are cheap enough that parallelism buys nothing here.
  for (const [name, run] of checks) {
    try {
      await run();
    } catch (error) {
      console.error(`health check '${name}' failed:`, error);
      // #65: durable copy (fail-open — cannot change the 503 below; until
      // migration 024's supervised apply it lands in console only).
      await reportError('health', error, { extra: { check: name } });
      // 503, not 500: "a dependency this service needs is unavailable" — and
      // only OUR check name in the body, never the error text.
      return Response.json(
        { ok: false, failed: name },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
  }

  return Response.json(
    { ok: true, checks: checks.map(([name]) => name) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
