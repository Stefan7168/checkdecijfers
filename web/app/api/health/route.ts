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
  hasProPlan,
} from '../../../backend/billing/index.ts';
import type { Db } from '../../../backend/db/types.ts';
import { listThreads } from '../../../backend/threads/index.ts';
import { getDb } from '../../../lib/db.ts';
import { reportError } from '../../../lib/error-report.ts';

/** The nil uuid: valid for every uuid/text user_id column the dashboard reads
 * filter on (credit_transactions.user_id IS uuid-typed — a non-uuid string
 * would itself error), and never issued to a real account by Supabase. */
const SYNTHETIC_USER_ID = '00000000-0000-0000-0000-000000000000';

/** The same flags GET derives from process.env below, pulled out as a plain
 * argument so #23's cron reuse (onboarding-cron/route.ts) can pass its own
 * env reads without this module reaching into process.env a second time. */
export interface HealthCheckFlags {
  onboardingEnabled: boolean;
  websearchEnabled: boolean;
  workspaceEnabled: boolean;
}

export interface HealthCheckResult {
  ok: boolean;
  /** Every check name in this check set, in run order, regardless of
   * outcome — exactly the success-path body's own `checks` list. */
  checks: string[];
  /** Names of checks that failed. Execution stops at the first failure (the
   * route's own long-standing contract, kept here unchanged), so today this
   * holds at most one name — typed as an array for the alert-batching shape
   * the sibling #23 alerts share (never one email per table/check). */
  failed: string[];
}

function buildHealthChecks(
  db: Db,
  flags: HealthCheckFlags,
): Array<[name: string, run: () => Promise<unknown>]> {
  const checks: Array<[name: string, run: () => Promise<unknown>]> = [
    // credit_transactions (the balance read every signed-in page does).
    ['balance-read', () => getBalance(db, SYNTHETIC_USER_ID)],
    // audit_answers + credit_transactions netting join; with onboarding on,
    // also pending_table_requests — THE session-27 query.
    [
      'question-history-read',
      () => getQuestionHistory(db, SYNTHETIC_USER_ID, { includeOnboarding: flags.onboardingEnabled }),
    ],
    // action_class_prices (throws if pricing was never applied — a real
    // operational precondition, worth failing loudly).
    ['pricing-read-simple', () => getActionClassPrice(db, 'simple')],
    ['pricing-read-clarification', () => getActionClassPrice(db, 'clarification')],
    // signup_grant_config (the Dashboard explainer copy's live read).
    ['signup-grant-read', () => getSignupGrantCredits(db)],
    // pro_subscriptions: UNCONDITIONAL, not behind PRO_SUBSCRIPTIONS_ENABLED —
    // that flag only gates starting a NEW Pro checkout (embed-actions.ts); the
    // embed page's `hasProPlan` read runs on every embed view regardless of
    // the flag, so unlike the flag-gated checks below, skipping this one while
    // the flag is off would miss exactly the session-101 incident class (code
    // querying the table before its migration had run).
    ['pro-subscription-read', () => hasProPlan(db, { id: SYNTHETIC_USER_ID, email: null })],
  ];
  if (flags.websearchEnabled) {
    checks.push(['pricing-read-web-addon', () => getActionClassPrice(db, 'web_addon')]);
  }
  if (flags.workspaceEnabled) {
    checks.push(['threads-read', () => listThreads(db, SYNTHETIC_USER_ID)]);
  }
  return checks;
}

/** Runs the SAME dashboard-read probes GET below serves, extracted so #23's
 * daily onboarding cron can run them again after its own job — between
 * deploys nobody otherwise watches /api/health at all. Sequential, stopping
 * at the first failure (identical contract to GET's own loop); never throws
 * itself — a failing check is caught and reported the same way GET reports
 * it (console + the #65 durable copy), just returned instead of turned
 * straight into a Response here. */
export async function runHealthChecks(db: Db, flags: HealthCheckFlags): Promise<HealthCheckResult> {
  const checks = buildHealthChecks(db, flags);
  const names = checks.map(([name]) => name);
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
      return { ok: false, checks: names, failed: [name] };
    }
  }
  return { ok: true, checks: names, failed: [] };
}

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
