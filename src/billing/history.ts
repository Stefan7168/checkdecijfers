// Question history for the user dashboard: reads audit_answers (WP10) joined
// against credit_transactions to reconstruct each past question's net cost.
// Read-only, additive -- no change to the append-only ledger. See migration
// 010 for why this join needs audit_answers.request_id.
import type { Db } from '../db/types.ts';

export interface QuestionHistoryEntry {
  id: number;
  kind: 'answer' | 'clarification' | 'refusal';
  question: string;
  finalText: string;
  createdAt: string;
  /** Net credits actually charged (debit minus any refund) -- null only if
   * the row predates migration 010 / has no request_id, so no debit can be
   * found to attribute a cost to. */
  creditsCharged: number | null;
}

/** Most recent rows first, capped at `limit` (default 20) -- no pagination
 * yet (deliberately out of scope this round, docs/08-build-plan.md). */
export async function getQuestionHistory(
  db: Db,
  userId: string,
  { limit = 20 }: { limit?: number } = {},
): Promise<QuestionHistoryEntry[]> {
  const { rows } = await db.query(
    `select
       a.id,
       a.kind,
       a.question,
       a.final_text,
       a.created_at,
       case when debit.id is null then null
            else -coalesce(debit.delta, 0) - coalesce(comp.delta, 0)
       end as credits_charged
     from audit_answers a
     left join credit_transactions debit
       -- credit_transactions.user_id is uuid; audit_answers.user_id is text
       -- (migration 004 predates the auth provider, ADR 006) -- cast the
       -- uuid side rather than the text side, since a text->uuid cast can
       -- fail at runtime on a malformed value while uuid->text never does.
       on debit.user_id::text = a.user_id
      and debit.request_id = a.request_id
      and debit.reason = 'question_cost'
     left join credit_transactions comp
       on comp.audit_answer_id = a.id
      and comp.reason = 'compensation'
     where a.user_id = $1
     -- id as the tie-breaker: two questions asked close enough together can
     -- share a created_at timestamp (observed under PGlite's clock
     -- resolution in tests), and "most recent first" should still mean
     -- insertion order, not an arbitrary tie.
     order by a.created_at desc, a.id desc
     limit $2`,
    [userId, limit],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind as QuestionHistoryEntry['kind'],
    question: String(row.question),
    finalText: String(row.final_text),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    creditsCharged: row.credits_charged === null ? null : Number(row.credits_charged),
  }));
}
