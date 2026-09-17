// The health-check SET behind /api/health (#114) and the daily health-probe
// alert (#23, session 110). Lives in its own module because a Next.js
// `route.ts` may only export route handlers + segment config: Next 16's
// generated route types (`.next/types/app/api/health/route.ts`, produced by
// a webpack build) reject any other export, which a Turbopack build does
// not check — found session 110 when a worktree build fell back to webpack.
// Nothing here is a Route Handler; route.ts imports runHealthChecks from here.
import {
  getActionClassPrice,
  getBalance,
  getQuestionHistory,
  getSignupGrantCredits,
  hasProPlan,
} from '../../../backend/billing/index.ts';
import type { Db } from '../../../backend/db/types.ts';
import { listThreads } from '../../../backend/threads/index.ts';
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

