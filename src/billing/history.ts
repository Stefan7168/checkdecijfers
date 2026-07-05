// Question history for the user dashboard: reads audit_answers (WP10) joined
// against credit_transactions to reconstruct each past question's net cost.
// Read-only, additive -- no change to the append-only ledger. See migration
// 010 for why this join needs audit_answers.request_id.
//
// WP19 (open-questions #67): a clarification round -- the kind='clarification'
// row plus the reply row that answered it -- collapses into ONE entry, so the
// dashboard no longer shows the same original question twice with two
// different outcomes. The link is reconstructed at read time from data both
// rows already carry (no migration): the reply row's `question` column echoes
// the original question (respond-audited.ts stores pending.question), and its
// `pending_clarification.questionNl` is the clarify row's own offered
// question verbatim (response->'pending'->>'questionNl'). A round is
// structurally at most those two rows: respondToClarificationReply converts
// any residual ambiguity into a still_ambiguous REFUSAL, never a second
// clarification. (The schema itself does not forbid a hypothetical
// kind='clarification' row with reply_text set; such a row would take the
// reply branch below and never re-open -- bounded degradation, no crash.)
//
// LIMITATION (adversarial-review verdict, WP19): the pairing is a VALUE-MATCH
// over fields the client influences (the pending is client-held; only its
// embedded conversationContext is rewritten server-side), not a stored row
// link. Two simultaneously-open clarifications with byte-identical
// (question, questionNl) -- e.g. the same ambiguous question in two tabs --
// can therefore swap partners in the display, leaving the second reply as a
// standalone entry (test-pinned as intended degradation). This is
// display-only, strictly per-user (the where clause scopes to one user_id),
// and cost-safe: each row's creditsCharged joins the ledger on that row's
// OWN request_id, never through the pairing. A guaranteed link would need a
// schema + PendingClarification change -- deliberately not done for a
// display concern; revisit if real users hit it.
//
// #14 (GDPR retention + self-service deletion, WP14): a redacted row (the
// purge CLI or the self-service delete action, both src/answer/audit/
// retention.ts) keeps its id and credit trail but overwrites question/
// final_text with the REDACTED_QUESTION_TEXT sentinel -- never removes the
// row (removing it would violate credit_transactions.audit_answer_id's FK
// for any clarification/refusal row a compensation entry points at, and
// would also drop the ledger-joinable id the #67 round-grouping and the
// dashboard's per-answer cost display both depend on). `isDeleted` is
// derived HERE, once, from the sentinel match, so the UI never needs to know
// the redaction implementation -- it just renders the placeholder branch.
import type { Db } from '../db/types.ts';
import { REDACTED_QUESTION_TEXT } from '../answer/audit/retention.ts';

export interface QuestionHistoryEntry {
  id: number;
  /** Final outcome of the entry -- for a collapsed round, the REPLY row's
   * kind ('answer' | 'refusal'); a clarification the user never answered
   * stays kind 'clarification'. */
  kind: 'answer' | 'clarification' | 'refusal';
  question: string;
  finalText: string;
  createdAt: string;
  /** Net credits actually charged (debit minus any refund) -- summed over
   * both turns for a collapsed round. Null if the cost cannot be honestly
   * attributed: a row predating migration 010 (no request_id), or a round
   * where EITHER side is unattributable (a partial sum must never be
   * presented as the round's total). */
  creditsCharged: number | null;
  /** Set only on a collapsed clarification round: what we asked (the clarify
   * row's full rendered text) and what the user replied. */
  clarification: { text: string; reply: string } | null;
  /** #14: true when this row (or, for a collapsed round, either constituent
   * row) was redacted by the purge or self-service deletion -- the
   * "verwijderde vraag" placeholder case (owner decision, session 23): the
   * credit amount above still reflects what was charged; only the question
   * text is gone. */
  isDeleted: boolean;
}

interface HistoryRow {
  id: number;
  kind: QuestionHistoryEntry['kind'];
  question: string;
  finalText: string;
  createdAt: string;
  creditsCharged: number | null;
  replyText: string | null;
  /** questionNl of the pending this row REPLIED to (reply rows only). */
  repliedQuestionNl: string | null;
  /** questionNl this row OFFERED (kind='clarification' rows only). */
  offeredQuestionNl: string | null;
}

/** null-safe round total: a partial sum would silently understate what the
 * round actually cost, so any unattributable side nulls the whole total. */
function sumCosts(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/** #14: a row is "deleted" iff its question text is exactly the redaction
 * sentinel (src/answer/audit/retention.ts) -- the one place this project's
 * redaction and its dashboard rendering agree on what "deleted" means. */
function isRedacted(question: string): boolean {
  return question === REDACTED_QUESTION_TEXT;
}

/** The pairing signature a reply row shares with the clarification row it
 * answered. NUL (\u0000) as separator: it cannot occur in either component (Postgres
 * text never contains NUL), so distinct pairs can never collide. */
function roundKey(question: string, questionNl: string): string {
  return `${question}\u0000${questionNl}`;
}

/** Most recent entries first, capped at `limit` (default 20) -- no pagination
 * yet (deliberately out of scope, docs/08-build-plan.md WP17). The row fetch
 * over-reads 2x the entry cap (a round is at most two rows), then the cap
 * applies to grouped ENTRIES. */
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
       a.reply_text,
       a.pending_clarification->>'questionNl' as replied_question_nl,
       a.response->'pending'->>'questionNl' as offered_question_nl,
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
    [userId, limit * 2],
  );
  const fetched: HistoryRow[] = rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind as QuestionHistoryEntry['kind'],
    question: String(row.question),
    finalText: String(row.final_text),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    creditsCharged: row.credits_charged === null ? null : Number(row.credits_charged),
    replyText: row.reply_text === null ? null : String(row.reply_text),
    repliedQuestionNl: row.replied_question_nl === null ? null : String(row.replied_question_nl),
    offeredQuestionNl: row.offered_question_nl === null ? null : String(row.offered_question_nl),
  }));

  // Group oldest -> newest so a reply always sees its clarification first.
  // `open` maps a round signature to the entry awaiting its reply; a newer
  // clarification with the identical signature overwrites the map slot (the
  // older one simply stays in `entries` as a standalone clarification --
  // honest: it was asked and never answered).
  interface Grouped {
    entry: QuestionHistoryEntry;
    /** Newest constituent row, for most-recent-activity ordering. */
    sortAt: string;
    sortId: number;
  }
  const entries: Grouped[] = [];
  const open = new Map<string, Grouped>();
  for (const row of [...fetched].reverse()) {
    if (row.replyText !== null && row.repliedQuestionNl !== null) {
      const match = open.get(roundKey(row.question, row.repliedQuestionNl));
      if (match !== undefined) {
        const clarifyText = match.entry.finalText;
        match.entry.kind = row.kind;
        match.entry.finalText = row.finalText;
        match.entry.creditsCharged = sumCosts(match.entry.creditsCharged, row.creditsCharged);
        match.entry.clarification = { text: clarifyText, reply: row.replyText };
        // Either side of a collapsed round can be independently redacted (the
        // purge/self-service action touches whole rows, not rounds) -- the
        // round is a placeholder if EITHER constituent row is.
        match.entry.isDeleted = match.entry.isDeleted || isRedacted(row.question);
        match.sortAt = row.createdAt;
        match.sortId = row.id;
        // One reply closes the round; a second reply to the same pending
        // (only reachable by a crafted client) stays a standalone entry.
        open.delete(roundKey(row.question, row.repliedQuestionNl));
        continue;
      }
      // No matching clarification in the fetched window (it fell outside, or
      // predates this feature's rows) -- the reply row stands alone.
    }
    const grouped: Grouped = {
      entry: {
        id: row.id,
        kind: row.kind,
        question: row.question,
        finalText: row.finalText,
        // A collapsed round keeps the clarify row's createdAt: the moment the
        // user asked the question, which is what the history lists.
        createdAt: row.createdAt,
        creditsCharged: row.creditsCharged,
        clarification: null,
        isDeleted: isRedacted(row.question),
      },
      sortAt: row.createdAt,
      sortId: row.id,
    };
    entries.push(grouped);
    if (row.kind === 'clarification' && row.offeredQuestionNl !== null && row.replyText === null) {
      open.set(roundKey(row.question, row.offeredQuestionNl), grouped);
    }
  }

  return entries
    .sort((a, b) => (a.sortAt === b.sortAt ? b.sortId - a.sortId : a.sortAt < b.sortAt ? 1 : -1))
    .slice(0, limit)
    .map((g) => g.entry);
}
