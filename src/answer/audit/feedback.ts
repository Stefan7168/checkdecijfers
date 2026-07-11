// WP128 (open-questions #128): the WRITE-ONLY answer-feedback store.
// Feedback POINTS at an audit_answers row and never modifies it — the R8
// record stays the frozen source of truth; this table is the raw signal the
// WP26 answer-quality lane later reads (👎 rows = the experience-audit
// shortlist). No read path ships in WP128.
//
// Security shape (frozen brief F2): the ownership + kind + source guard lives
// IN the insert statement itself — a row can only come into existence from a
// select over the caller's OWN, USER-tagged ANSWER row, and the upsert's
// conflict path is only reachable FROM such a guarded row, so the guard holds
// on both the insert and the update path. Zero rows returned = the guard did
// not match (someone else's row, a refusal/clarification, a benchmark row, or
// a nonexistent id) — reported as a soft `false`, never an error.
//
// This module never calls a billing function: feedback is free (no gate, no
// debit) — the same structural discipline retention.ts keeps.
import type { Db } from '../../db/types.ts';

export const FEEDBACK_TEXT_MAX_LENGTH = 2000;

export interface AnswerFeedbackInput {
  auditAnswerId: number;
  userId: string;
  verdict: 'up' | 'down';
  feedbackText?: string | null;
}

/** Trim, empty → null, hard cap (the action validates the same bound — this
 * is the belt behind it). */
export function normalizeFeedbackText(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, FEEDBACK_TEXT_MAX_LENGTH);
}

/**
 * Insert-or-update the caller's feedback on ONE answer (one row per
 * (answer, user) — migration 017's unique constraint; a changed verdict
 * overwrites in place, last write wins, created_at refreshed).
 *
 * Returns `true` when a row was written, `false` when the guard matched
 * nothing (soft — the caller shows "kon niet worden opgeslagen", nothing
 * throws). `returning id` is the zero-rows signal: the Db interface exposes
 * only `rows`, not a rowCount.
 */
export async function upsertAnswerFeedback(db: Db, input: AnswerFeedbackInput): Promise<boolean> {
  const text = normalizeFeedbackText(input.feedbackText);
  const { rows } = await db.query(
    `insert into answer_feedback (audit_answer_id, user_id, verdict, feedback_text)
     select a.id, a.user_id, $3::text, $4::text
       from audit_answers a
      where a.id = $1
        and a.user_id = $2
        and a.kind = 'answer'
        and a.source_tag = 'user'
     on conflict (audit_answer_id, user_id) do update
       set verdict = excluded.verdict,
           feedback_text = excluded.feedback_text,
           created_at = now()
     returning id`,
    [input.auditAnswerId, input.userId, input.verdict, text],
  );
  return rows.length > 0;
}
