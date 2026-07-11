// GDPR retention + self-service deletion (#14, docs/08-build-plan.md WP14).
//
// Two callers share this module: the retention purge CLI (scripts/gdpr-purge.ts,
// `npm run gdpr:purge` — source_tag='user' rows older than 2 years) and the
// self-service "delete my question history" server action (web/app/actions.ts —
// a signed-in user's own source_tag='user' rows, any age). Both must apply
// EXACTLY the same redaction so the dashboard degrades identically either way
// (owner decision, session 23: a "verwijderde vraag" placeholder row survives —
// the ledger's credit amount stays visible, the question text does not).
//
// Why REDACT (UPDATE) instead of a physical DELETE, even though the #14 brief
// and open-questions #14 both say "delete": credit_transactions.audit_answer_id
// carries a plain FK to audit_answers(id) with NO ON DELETE clause (migration
// 005 — deliberately NOT cascade, "the real tension between GDPR erasure and an
// immutable financial trail is left open on purpose"). Any clarification or
// refusal row that received a compensation entry (gate.ts's compensate() calls,
// which pass result.auditId) is referenced by that FK. A hard `DELETE FROM
// audit_answers` on such a row throws a foreign-key violation and would either
// crash the purge/self-service action or require conditioning the delete on
// row kind — this is confirmed empirically in tests/audit/retention.test.ts.
// Redacting is also a strictly BETTER match for the owner's UX decision: a
// placeholder row that keeps its id (so the ledger's request_id/audit_answer_id
// joins in src/billing/history.ts keep working byte-for-byte) is exactly what
// "the credit amount stays, the question text is gone" describes. No schema
// change: every column touched already exists (migrations 004/010).
//
// Scope, both callers: source_tag = 'user' ONLY. A benchmark or validation row
// must never be touched (docs/05 audit-trail section: those rows still "live
// forever" — they are this project's own regression fixtures, not a real
// user's personal data). This is enforced by a `where source_tag = 'user'`
// clause on every statement in this module, never trusted to a caller.
import type { Db } from '../../db/types.ts';

/** The exact Dutch copy shown in place of a deleted question's text — the
 * "verwijderde vraag" placeholder (owner decision, session 23). Exported so
 * the dashboard (web/components/question-history.tsx) can detect a redacted
 * row by exact match, without a new column. */
export const REDACTED_QUESTION_TEXT = 'Deze vraag is verwijderd.' as const;

/** Redacted response envelope stored in place of the original. Keeps `kind`
 * and `schemaVersion` (both already promoted to their own columns and
 * harmless — neither carries free text) so a reader that happens to parse
 * `response` as a ComposedResponse-shaped object still finds a `text` field,
 * but drops everything else (answer bodies, chart specs, parse/query
 * internals) — those can echo dimension labels derived from the question's
 * resolved intent, and the #14 brief's scope is "delete a user's question
 * history," not "delete everything except three columns." */
function redactedResponse(kind: 'answer' | 'clarification' | 'refusal'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind,
    question: REDACTED_QUESTION_TEXT,
    text: REDACTED_QUESTION_TEXT,
    redacted: true,
  };
}

/** Redacted PendingClarification content: the `reply_round_complete` CHECK
 * constraint (migration 004) requires `reply_text is null` to equal
 * `pending_clarification is null` — a row that HAD a reply (reply_text set)
 * must therefore keep pending_clarification non-null after redaction, so
 * this replaces its free-text fields (question, questionNl, options) with
 * the sentinel rather than nulling the column outright. `version`/`axes`/
 * `referenceDate` are registry-vocabulary/structural, not free text — kept
 * so the object still resembles its original shape, harmlessly. */
function redactedPendingClarification(): Record<string, unknown> {
  return {
    version: 1,
    question: REDACTED_QUESTION_TEXT,
    questionNl: REDACTED_QUESTION_TEXT,
    options: [],
    axes: [],
    redacted: true,
  };
}

/** One row's before-state, returned so callers can log/count what was
 * touched without a second query. */
export interface RedactedRow {
  id: number;
  kind: 'answer' | 'clarification' | 'refusal';
}

/** WP128: the paired answer_feedback hard-delete a caller wants to run in the
 * SAME transaction as its redaction, feedback-delete FIRST (frozen-brief F3,
 * a three-lens review convergence: a crash between the two steps must never
 * leave feedback text behind an already-redacted row). */
interface FeedbackDelete {
  sql: string;
  params: unknown[];
}

async function redactMatchingRows(
  db: Db,
  whereClause: string,
  params: unknown[],
  feedbackDelete?: FeedbackDelete,
): Promise<RedactedRow[]> {
  // Single statement: select the rows to redact (id + kind, to build the
  // per-kind envelope) and update them, atomically, so a concurrent read
  // between "find" and "redact" can't observe a half-redacted row. Postgres
  // has no UPDATE ... RETURNING-before-image, so this runs as SELECT ... FOR
  // UPDATE followed by UPDATE inside one transaction instead.
  return db.withTransaction(async (tx) => {
    if (feedbackDelete) {
      // Guarded on table existence: migration 017 may not be applied yet (the
      // deploy window) — and then no feedback can exist, by construction. The
      // guard must be a check, not a catch: an error inside a transaction
      // aborts the whole redaction.
      const { rows: reg } = await tx.query(`select to_regclass('public.answer_feedback') as t`);
      if (reg[0]?.t != null) {
        await tx.query(feedbackDelete.sql, feedbackDelete.params);
      }
    }
    const { rows } = await tx.query(
      `select id, kind from audit_answers where ${whereClause} for update`,
      params,
    );
    const targets: RedactedRow[] = rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind as RedactedRow['kind'],
    }));
    for (const target of targets) {
      // Owner decision (session 23): "wis de inhoud volledig". Beyond the
      // free-text columns, clear the PROMOTED query-plan columns too — `intent`
      // (canonical measure key + region codes + periods), `intent_hash`,
      // `result_ids`, `table_ids`, `tables` and `conversation_context` all
      // reveal WHAT the user asked about (topic/region/period) even after the
      // question text is gone, so a true "delete my question history" must
      // erase them. Skeleton columns (id, user_id, created_at, request_id,
      // reference_date, kind, token/latency metadata) survive — the minimal
      // record the ledger join + the "verwijderde vraag" placeholder need, and
      // the financial trail we retain by law (open-questions #59).
      await tx.query(
        `update audit_answers set
           question = $1,
           final_text = $1,
           response = $2::jsonb,
           reply_text = case when reply_text is null then null else $1 end,
           pending_clarification = case when pending_clarification is null then null else $3::jsonb end,
           intent = null,
           intent_hash = null,
           result_ids = '{}',
           table_ids = '{}',
           tables = '[]'::jsonb,
           conversation_context = null
         where id = $4`,
        [
          REDACTED_QUESTION_TEXT,
          JSON.stringify(redactedResponse(target.kind)),
          JSON.stringify(redactedPendingClarification()),
          target.id,
        ],
      );
    }
    return targets;
  });
}

/** Self-service deletion (#14 piece 2): every source_tag='user' row belonging
 * to THIS user, any age. THE CRITICAL SECURITY SCOPE: the where clause binds
 * user_id as a parameter — there is no code path in this function that can
 * touch a different user's rows, by construction (no dynamic SQL, no string
 * interpolation of userId). Idempotent: redacting an already-redacted row is
 * a harmless no-op (same target values written again). */
export async function deleteUserQuestionHistory(db: Db, userId: string): Promise<RedactedRow[]> {
  return redactMatchingRows(db, `user_id = $1 and source_tag = 'user'`, [userId], {
    // WP128: "wis de inhoud volledig" extends to the user's feedback text —
    // hard DELETE (nothing references answer_feedback; the ledger has no
    // feedback FK), same-parameter scoping as the redaction itself.
    sql: `delete from answer_feedback where user_id = $1`,
    params: [userId],
  });
}

/** Retention purge (#14 piece 1): every source_tag='user' row older than the
 * given cutoff, across ALL users — the scheduled 2-year sweep. `cutoff` is
 * an injected Date (never `new Date()` inside this function) so the purge is
 * testable against a fixed clock, mirroring the rest of the codebase's
 * reference-date discipline (web/app/actions.ts's referenceDate()). */
export async function purgeExpiredQuestionHistory(db: Db, cutoff: Date): Promise<RedactedRow[]> {
  return redactMatchingRows(db, `source_tag = 'user' and created_at < $1`, [cutoff.toISOString()], {
    // WP128: feedback attached to purged answers goes with them — scoped by
    // the SAME cutoff + source_tag window the redaction uses (the feedback
    // row's own age is irrelevant; it inherits its answer's retention).
    sql: `delete from answer_feedback where audit_answer_id in
            (select id from audit_answers where source_tag = 'user' and created_at < $1)`,
    params: [cutoff.toISOString()],
  });
}

/** Two-year retention window (#14, open-questions #14: "Decided … 2-year
 * retention"). A plain function of "now" so both the CLI and its tests can
 * inject the reference instant explicitly. */
export function twoYearsBefore(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  return cutoff;
}
