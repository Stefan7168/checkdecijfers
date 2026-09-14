// ADR 041 / spec Part B4, extended for open-questions #205: "Pro" was a
// plain owner-set allowlist; now it's ALSO a real subscription row
// (pro_subscriptions, migration 030). The allowlist stays, as an owner
// testing override — either check passing is sufficient. Fails closed on
// every path: an unset env var, a caller with no email, no DB row, an
// expired period, or a canceled subscription are all "not Pro".
import type { Db } from '../db/types.ts';

/** The monthly credit allowance a Pro subscriber's bucket is topped up with
 * on each `invoice.paid` renewal (stripe-webhook.ts's `grantMonthlyAllowance`,
 * Task 10, open-questions #205). Co-located here rather than in
 * stripe-webhook.ts because it is a Pro-plan fact, not a webhook-handling
 * detail — Task 12 (and any future direct read of "how many credits does a
 * renewal grant") imports it from here. */
export const PRO_MONTHLY_CREDITS = 1000;

export function hasProPlanAllowlist(user: { id: string; email: string | null }): boolean {
  const raw = process.env.PRO_ACCOUNT_EMAILS;
  if (!raw || user.email === null) return false;
  const allowed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(user.email.toLowerCase());
}

export async function hasProPlan(db: Db, user: { id: string; email: string | null }): Promise<boolean> {
  if (hasProPlanAllowlist(user)) return true;
  const { rows } = await db.query(
    `select 1 from pro_subscriptions
     where user_id = $1 and status in ('active', 'trialing', 'past_due') and current_period_end > now()`,
    [user.id],
  );
  return rows.length > 0;
}
