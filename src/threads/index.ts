// WP135 chat workspace (ADR 033): persisted conversation threads. This module
// is the backend seam the web layer reaches through the `web/backend -> ../src`
// symlink (web/backend/threads). A NEW top-level module per ADR 001's as-built
// list — it owns the thread entity's read/write SQL, mirroring the
// bound-parameter + user-scoping discipline of src/answer/audit/retention.ts
// and the ledger-join shape of src/billing/history.ts.
//
// Two structural GDPR facts make this safe by construction (ADR 033 D1/D2):
//   - chat_threads holds NO text (migration 019) — a thread stores WHEN, never
//     WHAT — so it needs no place in the #14/#120 retention purge.
//   - Thread titles are DERIVED at read time from the first non-redacted audit
//     row's question, so redacting the audit rows automatically empties the
//     sidebar (a fully-redacted thread is filtered out here, not deleted).
//
// THE CRITICAL SECURITY DISCIPLINE (the #14 cross-user pins, extended to the
// two new read paths): every statement binds `user_id` as a parameter. There
// is no code path here that can touch another user's threads or rows — no
// dynamic SQL, no string interpolation of a caller id. A forged thread id is
// coerced to a number and filtered out by the WHERE, never trusted.
//
// Note the deliberate id-type split (migration 004 predates the auth provider,
// ADR 006): chat_threads.user_id is `uuid` (matching auth.users), while
// audit_answers.user_id is `text`. The queries below scope chat_threads by
// `user_id = $n::uuid` (index-friendly; the session id is always a real uuid)
// and audit_answers by the plain text `user_id = $n` — never mixing the two.
import type { Db } from '../db/types.ts';
import { REDACTED_QUESTION_TEXT } from '../answer/audit/retention.ts';
import type { ComposedResponse } from '../answer/respond/types.ts';

/** Sidebar entry: identity + read-time-derived title + last activity. No text
 * is stored — `title` is computed from the audit rows every read. */
export interface ThreadSummary {
  id: number;
  title: string;
  lastActivityAt: string;
}

/** One thread turn, read back for replay/resume (getThreadRows). The full
 * envelope rides along (same zero-loss posture as src/billing/history.ts) plus
 * the per-row net cost from the ledger join — the live cost caption comes from
 * gated.netCost, which is NOT in the stored envelope, so replay must recompute
 * it from the ledger or the caption silently vanishes on resume (⟨A3⟩). */
export interface ThreadRow {
  id: number;
  kind: 'answer' | 'clarification' | 'refusal';
  question: string;
  finalText: string;
  replyText: string | null;
  createdAt: string;
  response: ComposedResponse;
  creditsCharged: number | null;
}

/** Max title length (chars), truncated in TS so the SQL stays a plain first-row
 * lookup (ADR 033 D2: titles are derived, never stored). */
const TITLE_MAX_LENGTH = 60;

/** Untrusted client thread id → a safe positive integer, or null. A malformed,
 * negative, non-integer, or out-of-safe-range value degrades to null (a fresh
 * thread / an empty result), never an error that could leak a thread's
 * existence (⟨A1⟩ fail-safe, the ADR-021 invalid-context treatment). */
function coerceThreadId(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** jsonb column → typed envelope. pg and PGlite both return a parsed object for
 * a jsonb select; a string fallback keeps this driver-agnostic (the
 * context/build.ts expected_dimensions precedent). */
function decodeResponse(raw: unknown): ComposedResponse {
  return (typeof raw === 'string' ? (JSON.parse(raw) as ComposedResponse) : (raw as ComposedResponse));
}

/** ⟨A1⟩ READ-ONLY ownership check — NEVER an INSERT. Returns the validated
 * thread id when it exists AND belongs to `userId`, else null (null/malformed
 * id, or a thread owned by someone else). A forged id can therefore never
 * attach rows to another user's thread and never errors in a way that leaks
 * existence. Bound parameters only. */
export async function validateThreadOwnership(
  db: Db,
  userId: string,
  rawThreadId: unknown,
): Promise<number | null> {
  const threadId = coerceThreadId(rawThreadId);
  if (threadId === null) return null;
  const { rows } = await db.query(
    'select id from chat_threads where id = $1 and user_id = $2::uuid',
    [threadId, userId],
  );
  return rows.length === 0 ? null : threadId;
}

/** ⟨A1⟩ The ONLY place a chat_threads row is created — atomically, and ONLY
 * called on a gated-ok outcome with a real audit id (insufficient_credits,
 * duplicate_request, the ⟨W4⟩ early return, and thrown pipeline exceptions
 * never reach this call). Thread creation is thereby lazy BY CONSTRUCTION (ADR
 * 033 D1: no empty threads).
 *
 * One transaction: create the thread if `validatedThreadId` is null, then
 * attach the audit row (UPDATE scoped by the caller's `user_id`, only when
 * `thread_id IS NULL`), then touch `last_activity_at`. If the audit row is not
 * the caller's or is already attached, the UPDATE matches nothing and the whole
 * transaction rolls back (throwing) — so a freshly-created thread is never left
 * empty, and the caller (web/app/actions.ts) treats a failed attach as a
 * threadless-but-still-audited answer (degraded, logged; never blocks or rolls
 * back the answer itself). Returns the attached thread id.
 *
 * This module NEVER touches src/billing/** — thread attach is a post-hoc UPDATE
 * on audit rows (UPDATE-on-audit-rows is precedented by redaction). */
export async function attachOrCreateThread(
  db: Db,
  userId: string,
  validatedThreadId: number | null,
  auditId: number,
): Promise<number> {
  return db.withTransaction(async (tx) => {
    let threadId = validatedThreadId;
    if (threadId === null) {
      const { rows } = await tx.query(
        'insert into chat_threads (user_id) values ($1::uuid) returning id',
        [userId],
      );
      threadId = Number(rows[0]!.id);
    }
    const { rows: attached } = await tx.query(
      `update audit_answers set thread_id = $1
         where id = $2 and user_id = $3 and thread_id is null
         returning id`,
      [threadId, auditId, userId],
    );
    if (attached.length === 0) {
      // Not the caller's audit row, or already attached: never leave a
      // freshly-created empty thread behind (ADR 033 D1). Throwing rolls the
      // whole transaction back; the caller degrades to a threadless answer.
      throw new Error(`attachOrCreateThread: audit row ${auditId} is not attachable for this user`);
    }
    await tx.query('update chat_threads set last_activity_at = now() where id = $1', [threadId]);
    return threadId;
  });
}

/** The sidebar list: a user's threads, most-recent-activity first. Each title
 * is the first NON-redacted row's question (created_at asc, id asc), truncated
 * in TS. A thread whose every row is redacted (title source NULL) is filtered
 * OUT — self-service deletion and the 2-year purge empty the sidebar with zero
 * new machinery (ADR 033 D2). Bound parameters; scoped to `userId`. */
export async function listThreads(db: Db, userId: string, limit = 50): Promise<ThreadSummary[]> {
  const { rows } = await db.query(
    `select
       t.id,
       t.last_activity_at,
       (
         select a.question
         from audit_answers a
         where a.thread_id = t.id
           and a.user_id = $1
           and a.question <> $2
         order by a.created_at asc, a.id asc
         limit 1
       ) as title_source
     from chat_threads t
     where t.user_id = $1::uuid
     order by t.last_activity_at desc, t.id desc
     limit $3`,
    [userId, REDACTED_QUESTION_TEXT, limit],
  );
  const summaries: ThreadSummary[] = [];
  for (const row of rows) {
    // title_source NULL ⇒ the thread has no non-redacted row (fully redacted,
    // or — defensively — no rows at all): filter it out of the sidebar.
    if (row.title_source === null || row.title_source === undefined) continue;
    const title = String(row.title_source).slice(0, TITLE_MAX_LENGTH);
    summaries.push({ id: Number(row.id), title, lastActivityAt: toIso(row.last_activity_at) });
  }
  return summaries;
}

/** A thread's turns for replay/resume: every audit row in the thread (created_at
 * asc, id asc), full envelope + the per-row net cost from the SAME
 * debit/compensation ledger arithmetic src/billing/history.ts implements — but
 * EXTENDED (⟨A3⟩, unlike history.ts's dashboard join) to net the 'websearch_cost'
 * add-on debit as well as the base 'question_cost' debit, so a resumed web turn
 * shows the same cost the live chat showed (gated.netCost including a kept +10).
 * Mind the cast: audit_answers.user_id is TEXT, credit_transactions.user_id is
 * uuid — cast the uuid side to text, as history.ts does. Redacted rows are
 * INCLUDED (a partially-redacted thread shows its live rows + placeholders on
 * replay); the replay layer detects them by the sentinel. Scoped to `userId`
 * (defense in depth even after validateThreadOwnership — loadMyThread reads this
 * directly). */
export async function getThreadRows(db: Db, userId: string, threadId: number): Promise<ThreadRow[]> {
  const { rows } = await db.query(
    `select
       a.id,
       a.kind,
       a.question,
       a.final_text,
       a.reply_text,
       a.created_at,
       a.response,
       -- ⟨A3⟩ per-row net cost = the LIVE gated.netCost caption a resumed turn
       -- must reproduce byte-for-byte. A turn's net is EVERY debit on its
       -- (user_id, request_id) — the 'question_cost' debit AND, on a web-opted
       -- turn, the SEPARATE 'websearch_cost' add-on debit (migration 018, ADR
       -- 032), AND, on an on-demand-onboarding trigger turn, the SEPARATE
       -- 100-credit 'onboarding_cost' debit (WP16 sub-part 2, ADR 026) —
       -- minus every compensation that reversed one of those debits.
       -- Each debit is independently refundable: a KEPT add-on stands with no
       -- compensation and lifts netCost by +10 (settleWebAddon bumps netCost in
       -- memory only — the debit is the sole persisted trace, so replay MUST
       -- net it or the resumed cost silently drops the add-on); a refunded one
       -- carries its own compensation row (related_transaction_id -> the web
       -- debit). The onboarding case is the same shape: the ACK turn's
       -- question_cost debit is fully refunded (nets 0) while its separate
       -- onboarding_cost debit stands (maybeTriggerOnboarding overrides the LIVE
       -- netCost to 100), so replay MUST net onboarding_cost too or the resumed
       -- ack bubble silently drops to "0 credits" for a turn the user paid 100
       -- (bug found by adversarial review, 2026-07-13). A later verification
       -- failure refunds it via a compensation on the onboarding debit, netting
       -- it back to 0 — the same debit-minus-compensation rule. No double-count:
       -- the onboarding DELIVERY row (source_tag 'onboarding_delivery', which the
       -- dashboard attributes the 100 to) is a background cron re-run and is
       -- NEVER thread-attached (attachThread runs only on the live chat turn),
       -- so it never appears in this thread scan — the ACK row is the sole
       -- in-thread carrier of that request_id's onboarding_cost. Aggregated as
       -- correlated subqueries, NOT extra LEFT JOINs: several debits plus their
       -- compensations would multiply the row (cartesian product) under a join.
       -- Null ONLY when the turn has no attributable debit at all (a
       -- pre-migration-010 row, or a benchmark/validation turn). NB history.ts's
       -- dashboard shows onboarding on the DELIVERY row + excludes the ack row
       -- (the opposite surface), so the two files handle onboarding by design
       -- differently — a separate, reviewed change; do not read across.
       case
         when not exists (
           select 1
           from credit_transactions d
           where d.user_id::text = a.user_id
             and d.request_id = a.request_id
             and d.reason in ('question_cost', 'websearch_cost', 'onboarding_cost')
         ) then null
         else
           coalesce((
             select -sum(d.delta)
             from credit_transactions d
             where d.user_id::text = a.user_id
               and d.request_id = a.request_id
               and d.reason in ('question_cost', 'websearch_cost', 'onboarding_cost')
           ), 0)
           - coalesce((
             select sum(c.delta)
             from credit_transactions c
             where c.reason = 'compensation'
               and c.related_transaction_id in (
                 select d.id
                 from credit_transactions d
                 where d.user_id::text = a.user_id
                   and d.request_id = a.request_id
                   and d.reason in ('question_cost', 'websearch_cost', 'onboarding_cost')
               )
           ), 0)
       end as credits_charged
     from audit_answers a
     where a.thread_id = $1
       and a.user_id = $2
     order by a.created_at asc, a.id asc`,
    [threadId, userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind as ThreadRow['kind'],
    question: String(row.question),
    finalText: String(row.final_text),
    replyText: row.reply_text === null ? null : String(row.reply_text),
    createdAt: toIso(row.created_at),
    response: decodeResponse(row.response),
    creditsCharged: row.credits_charged === null ? null : Number(row.credits_charged),
  }));
}
