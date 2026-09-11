// WP-A (docs/superpowers/plans/2026-09-12-journey-programme.md, phase 0 R1):
// usage report aggregation. Pure functions over the `Db` — no writes, no LLM
// calls, no schema change (see migrations 004/005/007/012/017/019/020 for the
// real column names this file's SQL is checked against).
//
// HARD RULE (Invariants section of the plan + docs/05-data-rules.md's GDPR
// posture, #14): every function here returns AGGREGATES ONLY — counts and
// group labels (ISO week strings, refusal-reason codes, status enums). Never
// question text, never an e-mail address, never a user id. A `user_id` is
// used INSIDE the SQL (to count DISTINCT users, or to detect "active on >=2
// days"), but is never selected out or returned to the caller — grep this
// file: no `select ... user_id` appears anywhere, only `count(distinct
// user_id)` style aggregation.
//
// scripts/usage-report.ts only prints what these functions return; all the
// SQL lives here so it is unit-testable against the same PGlite/fake-db
// harness tests/audit and tests/billing already use (tests/usage/report.test.ts).
import type { Db } from '../db/types.ts';

/** One ISO-week bucket's count, e.g. {week: '2026-W37', count: 4}. Grouped
 * with Postgres's own ISO week numbering (`IYYY`/`IW`), so a week boundary
 * always matches the calendar's Monday-start ISO weeks — never a
 * home-rolled date-math reimplementation. */
export interface WeeklyCount {
  week: string;
  count: number;
}

/** The common shape for a metric reported both as the last N ISO weeks AND
 * an all-time total. `weekly` only ever covers the last `weeks` ISO weeks
 * (default 12, per the WP-A brief); `allTime` is unfiltered. */
export interface WeeklyReport {
  weekly: WeeklyCount[];
  allTime: number;
}

const DEFAULT_WEEKS = 12;

/** Postgres ISO-week label for a `created_at` expression — the single place
 * this format string is written, so every weekly metric buckets identically. */
const ISO_WEEK_EXPR = `to_char(created_at, 'IYYY-"W"IW')`;

async function weeklyReport(
  db: Db,
  table: string,
  whereClause: string,
  params: unknown[],
  weeks: number,
  now: Date,
): Promise<WeeklyReport> {
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - weeks * 7);
  const sinceIso = since.toISOString();
  const sinceParamIndex = params.length + 1;

  const { rows: weeklyRows } = await db.query(
    `select ${ISO_WEEK_EXPR} as week, count(*)::int as n
       from ${table}
      where ${whereClause} and created_at >= $${sinceParamIndex}
      group by week
      order by week`,
    [...params, sinceIso],
  );
  const { rows: totalRows } = await db.query(
    `select count(*)::int as n from ${table} where ${whereClause}`,
    params,
  );
  return {
    weekly: weeklyRows.map((r) => ({ week: String(r.week), count: Number(r.n) })),
    allTime: Number(totalRows[0]?.n ?? 0),
  };
}

/** Signups: `credit_transactions` rows with `reason = 'signup_grant'`
 * (migration 005) — one per user, ever (the table's own partial unique
 * index). */
export async function signupsReport(db: Db, now: Date, weeks = DEFAULT_WEEKS): Promise<WeeklyReport> {
  return weeklyReport(db, 'credit_transactions', `reason = 'signup_grant'`, [], weeks, now);
}

/** Distinct users who asked >=1 real question in the window — `audit_answers`
 * rows with `source_tag = 'user'` (migration 007; excludes benchmark/
 * validation/onboarding_delivery/anonymous_trial rows, none of which is a
 * real signed-in user's own question). Weekly = distinct users active THAT
 * week; all-time = distinct users ever. */
export async function usersWithQuestionsReport(db: Db, now: Date, weeks = DEFAULT_WEEKS): Promise<WeeklyReport> {
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - weeks * 7);
  const { rows: weeklyRows } = await db.query(
    `select ${ISO_WEEK_EXPR} as week, count(distinct user_id)::int as n
       from audit_answers
      where source_tag = 'user' and user_id is not null and created_at >= $1
      group by week
      order by week`,
    [since.toISOString()],
  );
  const { rows: totalRows } = await db.query(
    `select count(distinct user_id)::int as n
       from audit_answers
      where source_tag = 'user' and user_id is not null`,
  );
  return {
    weekly: weeklyRows.map((r) => ({ week: String(r.week), count: Number(r.n) })),
    allTime: Number(totalRows[0]?.n ?? 0),
  };
}

/** One outcome bucket: an answer/clarification kind, or a refusal broken
 * down by `refusal_reason`. */
export interface OutcomeCount {
  kind: 'answer' | 'clarification' | 'refusal';
  refusalReason: string | null;
  count: number;
}

/** First-question outcome mix vs later questions, all-time (not bucketed by
 * week — the "first" label is a per-user, whole-history property, so a
 * weekly slice would double-count "later" incorrectly). "First" = the
 * earliest `source_tag = 'user'` row for that `user_id`, found with
 * `row_number() over (partition by user_id order by created_at)`. */
export async function firstVsLaterOutcomesReport(
  db: Db,
): Promise<{ first: OutcomeCount[]; later: OutcomeCount[] }> {
  const { rows } = await db.query(
    `select is_first, kind, refusal_reason, count(*)::int as n
       from (
         select
           user_id,
           kind,
           refusal_reason,
           row_number() over (partition by user_id order by created_at) = 1 as is_first
         from audit_answers
        where source_tag = 'user' and user_id is not null
       ) ranked
      group by is_first, kind, refusal_reason
      order by is_first desc, kind, refusal_reason`,
  );
  const first: OutcomeCount[] = [];
  const later: OutcomeCount[] = [];
  for (const r of rows) {
    const entry: OutcomeCount = {
      kind: r.kind as OutcomeCount['kind'],
      refusalReason: r.refusal_reason == null ? null : String(r.refusal_reason),
      count: Number(r.n),
    };
    if (r.is_first) first.push(entry);
    else later.push(entry);
  }
  return { first, later };
}

/** One refusal-reason bucket, ranked by count descending. */
export interface RefusalReasonCount {
  refusalReason: string;
  count: number;
}

/** Top refusal reasons, all-time (a ranking, not a weekly series). Scoped to
 * `source_tag = 'user'` real-question refusals only — same reasoning as
 * `usersWithQuestionsReport`. */
export async function topRefusalReasonsReport(db: Db, limit = 10): Promise<RefusalReasonCount[]> {
  const { rows } = await db.query(
    `select refusal_reason, count(*)::int as n
       from audit_answers
      where source_tag = 'user' and kind = 'refusal' and refusal_reason is not null
      group by refusal_reason
      order by n desc, refusal_reason
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({ refusalReason: String(r.refusal_reason), count: Number(r.n) }));
}

/** On-demand CBS table onboarding fetches (`pending_table_requests`,
 * migration 012): counts by terminal-ish bucket, plus the credit cost spent
 * on them. "Started" = every row ever created; "delivered"/"failed" map to
 * the table's own `status` values ('failed' folds in 'unanswerable' — both
 * are non-delivery terminal outcomes from the requester's point of view).
 * `creditsSpent` = NET credits spent, AFTER refunds: the sum of the
 * `onboarding_cost` ledger debits those rows reserved
 * (`credit_transactions.reason = 'onboarding_cost'`, migration 012's ledger
 * widening) MINUS every `compensation` row that reversed one of them
 * (`related_transaction_id`, migration 005; migration 023 bounds a
 * compensation to reversing exactly such a debit). Strong-tier review
 * MEDIUM-3: summing the debits alone counted a REFUNDED failed fetch as
 * spend, which is exactly the number the owner would read as cost. Reported
 * as a POSITIVE credit amount (the ledger stores debits as negative deltas,
 * compensations as positive ones). */
export interface OnDemandFetchReport {
  started: number;
  delivered: number;
  failed: number;
  pendingOrRunning: number;
  /** Net credits spent (after refunds) — see the doc comment above. */
  creditsSpent: number;
}

export async function onDemandFetchesReport(db: Db): Promise<OnDemandFetchReport> {
  const { rows: statusRows } = await db.query(
    `select status, count(*)::int as n from pending_table_requests group by status`,
  );
  let delivered = 0;
  let failed = 0;
  let pendingOrRunning = 0;
  let started = 0;
  for (const r of statusRows) {
    const n = Number(r.n);
    started += n;
    if (r.status === 'delivered') delivered += n;
    else if (r.status === 'failed' || r.status === 'unanswerable') failed += n;
    else pendingOrRunning += n;
  }
  // MEDIUM-3: net of refunds. Migration 005's partial unique index on
  // `related_transaction_id where reason = 'compensation'` guarantees at most
  // ONE compensation per debit, so the left join can never multiply a debit
  // row. A debit's delta is negative and its compensation's positive, so
  // `-d.delta - c.delta` is 0 for a fully refunded fetch.
  const { rows: costRows } = await db.query(
    `select coalesce(sum(-d.delta - coalesce(c.delta, 0)), 0)::int as spent
       from credit_transactions d
       left join credit_transactions c
         on c.related_transaction_id = d.id
        and c.reason = 'compensation'
      where d.reason = 'onboarding_cost'`,
  );
  return {
    started,
    delivered,
    failed,
    pendingOrRunning,
    creditsSpent: Number(costRows[0]?.spent ?? 0),
  };
}

/** Trial questions (`trial_questions`, migration 020, ADR 036) and whether a
 * trial visitor later signed up. The second half is deliberately NOT computed:
 * `trial_questions.visitor_id` is a random per-browser cookie UUID (ADR 036
 * D2) and carries no relationship to `credit_transactions`/`auth.users`'s
 * account id — there is no join key linking an anonymous trial visitor to
 * the account they may later create, without adding new personal-data
 * tracking (which the plan explicitly rules out: "if not joinable without
 * personal data, print 'not measurable' and say why"). */
export interface TrialReport {
  questions: WeeklyReport;
  visitorsWhoSignedUp: 'not measurable';
  notMeasurableReason: string;
}

export async function trialReport(db: Db, now: Date, weeks = DEFAULT_WEEKS): Promise<TrialReport> {
  const questions = await weeklyReport(db, 'trial_questions', 'true', [], weeks, now);
  return {
    questions,
    visitorsWhoSignedUp: 'not measurable',
    notMeasurableReason:
      'trial_questions.visitor_id (an anonymous cookie UUID, ADR 036 D2) shares no join key with an ' +
      'authenticated account id — computing this would require adding new personal-data tracking, which ' +
      'is out of scope for an aggregates-only report.',
  };
}

/** 👍/👎 counts (`answer_feedback`, migration 017). */
export interface FeedbackReport {
  up: WeeklyReport;
  down: WeeklyReport;
}

export async function feedbackReport(db: Db, now: Date, weeks = DEFAULT_WEEKS): Promise<FeedbackReport> {
  const up = await weeklyReport(db, 'answer_feedback', `verdict = 'up'`, [], weeks, now);
  const down = await weeklyReport(db, 'answer_feedback', `verdict = 'down'`, [], weeks, now);
  return { up, down };
}

/** Distinct users active on >=2 distinct calendar days (all-time, not a
 * weekly series — a whole-history property of the user, same reasoning as
 * `firstVsLaterOutcomesReport`). "Active" = has a `source_tag = 'user'`
 * audit_answers row on that UTC date. */
export async function usersActiveMultipleDaysReport(db: Db): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from (
       select user_id
         from audit_answers
        where source_tag = 'user' and user_id is not null
        group by user_id
       having count(distinct created_at::date) >= 2
     ) t`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** Distinct users whose current ledger balance is <= 0 (`sum(delta) <= 0`)
 * AND who never made a `reason = 'purchase'` transaction — signup-grant
 * credits used up, never converted to a paying customer. All-time only (a
 * balance is a point-in-time property of "now", not a weekly series). */
export async function usersZeroBalanceNeverPurchasedReport(db: Db): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from (
       select user_id
         from credit_transactions
        group by user_id
       having coalesce(sum(delta), 0) <= 0
          and count(*) filter (where reason = 'purchase') = 0
     ) t`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** The full report — one call the script wraps. */
export interface UsageReport {
  generatedAt: string;
  weeks: number;
  signups: WeeklyReport;
  usersWithQuestions: WeeklyReport;
  firstVsLaterOutcomes: { first: OutcomeCount[]; later: OutcomeCount[] };
  topRefusalReasons: RefusalReasonCount[];
  onDemandFetches: OnDemandFetchReport;
  trial: TrialReport;
  feedback: FeedbackReport;
  usersActiveMultipleDays: number;
  usersZeroBalanceNeverPurchased: number;
}

export async function buildUsageReport(db: Db, now: Date = new Date(), weeks = DEFAULT_WEEKS): Promise<UsageReport> {
  const [
    signups,
    usersWithQuestions,
    firstVsLaterOutcomes,
    topRefusalReasons,
    onDemandFetches,
    trial,
    feedback,
    usersActiveMultipleDays,
    usersZeroBalanceNeverPurchased,
  ] = await Promise.all([
    signupsReport(db, now, weeks),
    usersWithQuestionsReport(db, now, weeks),
    firstVsLaterOutcomesReport(db),
    topRefusalReasonsReport(db),
    onDemandFetchesReport(db),
    trialReport(db, now, weeks),
    feedbackReport(db, now, weeks),
    usersActiveMultipleDaysReport(db),
    usersZeroBalanceNeverPurchasedReport(db),
  ]);
  return {
    generatedAt: now.toISOString(),
    weeks,
    signups,
    usersWithQuestions,
    firstVsLaterOutcomes,
    topRefusalReasons,
    onDemandFetches,
    trial,
    feedback,
    usersActiveMultipleDays,
    usersZeroBalanceNeverPurchased,
  };
}
