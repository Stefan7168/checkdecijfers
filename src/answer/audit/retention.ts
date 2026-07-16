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
// Scope, both callers (#120): source_tag in ('user', 'onboarding_delivery').
// The delivery answer row an on-demand-onboarding job writes (source_tag =
// 'onboarding_delivery') carries the verbatim question + intent + answer, so it
// is a real user's personal data the retention seam must cover too — widened in
// session 39 from the original source_tag='user'-ONLY scope. A benchmark or
// validation row must STILL never be touched (docs/05 audit-trail section:
// those rows "live forever" — this project's own regression fixtures, not a
// real user's personal data), which is exactly why the scope stays an explicit
// allowlist (never `!= 'benchmark'`). The single shared `AUDIT_SCOPE` fragment
// below is the ONE place this allowlist is written — both WHERE clauses, the
// purge's feedback subselect, AND the dry-run count reference it, never a
// hand-copied clause, and it is never trusted to a caller.
//
// Beyond audit_answers, both callers ALSO redact the user's pending onboarding
// requests (#120): pending_table_requests.question_text/topic_term/
// failure_summary are the SECOND place a question's free text is stored
// (migration 012's deliberate re-entry copy, re-run verbatim at delivery). The
// same-transaction pending leg keeps that promise honest — see redactMatchingRows.
import type { Db } from '../../db/types.ts';
import { stableStringify } from '../llm/client.ts';
import type { AuditRecord } from './types.ts';

/** The exact Dutch copy shown in place of a deleted question's text — the
 * "verwijderde vraag" placeholder (owner decision, session 23). Exported so
 * the dashboard (web/components/question-history.tsx) can detect a redacted
 * row by exact match, without a new column. */
export const REDACTED_QUESTION_TEXT = 'Deze vraag is verwijderd.' as const;

/** #151 (session-47 GDPR hunt): the sentinel written into pending_table_requests
 * table-identity columns (table_id / resolved_table_id) on a TERMINAL row when
 * its owner erases their history. A CBS table id (e.g. '85004NED') is a public
 * catalog lookup key that discloses the TOPIC the user asked about — the same
 * class of data audit_answers.table_ids is already cleared for (redactMatchingRows
 * below, "reveal WHAT the user asked about … even after the question text is
 * gone"). `table_id` is NOT NULL, so it needs a non-null sentinel rather than a
 * null; a distinct 'REDACTED' value (never a real CBS id) is unmistakably a
 * redaction marker. Only terminal rows are cleared — a pending/running row's
 * in-flight job still needs its real table_id/resolved_table_id to finish the
 * fetch (the documented in-flight residual: a redacted-while-running row's
 * identity is swept by the next deletion/purge once it terminates). */
export const REDACTED_TABLE_ID = 'REDACTED' as const;

/** #120: the single source of truth for WHICH audit_answers rows this module's
 * retention touches. An explicit ALLOWLIST, deliberately not a `!= 'benchmark'`
 * denylist: benchmark/validation rows are regression fixtures that live forever,
 * while 'onboarding_delivery' rows (the on-demand-onboarding delivery answer,
 * carrying the verbatim question + intent + answer) ARE personal data — added
 * to the scope in session 39. Every scoped statement in this module — the
 * self-service WHERE, the purge WHERE, the purge's answer_feedback subselect,
 * and the ⟨F2⟩ dry-run count — is built from THIS fragment, so the scope can
 * only ever widen in one place. */
const AUDIT_SCOPE = `source_tag in ('user', 'onboarding_delivery')` as const;

/** #120: the purge's age predicate, shared by the pending-table redaction leg
 * AND the dry-run count so preview and apply can never drift (⟨F2⟩). `$1` is
 * always the cutoff ISO string in both callers. */
const PENDING_PURGE_WHERE = `created_at < $1` as const;

/** #151 (session-47 GDPR hunt): the ONE place the pending_table_requests
 * redaction SET clause is written — both legs (self-service + purge) apply it,
 * so the scope can only ever widen in one place (same discipline as AUDIT_SCOPE).
 * `$2` = REDACTED_QUESTION_TEXT (free text), `$3` = REDACTED_TABLE_ID (the
 * terminal-row table-id sentinel). Two tiers:
 *  - question_text / topic_term / failure_summary / fit_note — cleared on EVERY
 *    in-scope row: all four are free text about the user's question (fit_note is
 *    the fit-gate LLM's Dutch sentence explaining the pick — it paraphrases the
 *    topic/period), and none is needed by an in-flight job (diagnostic only).
 *  - candidate_ids / resolved_table_id / table_id — the CBS-catalog identifiers
 *    that disclose the TOPIC (the same class audit_answers.table_ids is cleared
 *    for). Cleared ONLY on a TERMINAL row: a pending/running row's background job
 *    still needs its real table id to finish the fetch, so its identity is swept
 *    by the next deletion/purge once it terminates (the documented in-flight
 *    residual, extended to these columns). */
const PENDING_REDACTION_SET = `
        question_text = $2,
        topic_term = $2,
        failure_summary = case when failure_summary is null then null else $2 end,
        fit_note = case when fit_note is null then null else $2 end,
        candidate_ids = case when status in ('delivered', 'failed', 'unanswerable') then '[]'::jsonb else candidate_ids end,
        resolved_table_id = case when status in ('delivered', 'failed', 'unanswerable') then null else resolved_table_id end,
        table_id = case when status in ('delivered', 'failed', 'unanswerable') then $3 else table_id end` as const;

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

/** #120: the paired pending_table_requests redaction a caller runs in the SAME
 * transaction as its audit-row redaction — the second write point for a
 * question's free text (migration 012). UNLIKE the feedback delete, this runs
 * WITHOUT a to_regclass existence guard (⟨F3⟩): pending_table_requests has
 * existed since migration 012 (not a deploy-window table like answer_feedback),
 * so guarding it on another table's existence could only silently skip a real
 * GDPR leg. */
interface PendingRedaction {
  sql: string;
  params: unknown[];
}

async function redactMatchingRows(
  db: Db,
  whereClause: string,
  params: unknown[],
  feedbackDelete?: FeedbackDelete,
  pendingRedaction?: PendingRedaction,
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
    // #120: the pending_table_requests leg runs LAST — after the audit-row
    // updates — and UNguarded (see PendingRedaction). It redacts the free-text
    // columns of the caller's/expired pending onboarding requests in this same
    // transaction, so a crash can never leave the question text behind in one
    // store while it is gone from the other.
    if (pendingRedaction) {
      await tx.query(pendingRedaction.sql, pendingRedaction.params);
    }
    return targets;
  });
}

/** Self-service deletion (#14 piece 2): every in-scope audit row (AUDIT_SCOPE:
 * source_tag in ('user', 'onboarding_delivery')) belonging to THIS user, any
 * age, PLUS the user's pending_table_requests free text (#120). THE CRITICAL
 * SECURITY SCOPE: every where clause binds user_id as a parameter — there is no
 * code path in this function that can touch a different user's rows, by
 * construction (no dynamic SQL, no string interpolation of userId). Idempotent:
 * redacting an already-redacted row is a harmless no-op (same target values
 * written again). */
export async function deleteUserQuestionHistory(db: Db, userId: string): Promise<RedactedRow[]> {
  return redactMatchingRows(
    db,
    `user_id = $1 and ${AUDIT_SCOPE}`,
    [userId],
    {
      // WP128: "wis de inhoud volledig" extends to the user's feedback text —
      // hard DELETE (nothing references answer_feedback; the ledger has no
      // feedback FK), same-parameter scoping as the redaction itself.
      sql: `delete from answer_feedback where user_id = $1`,
      params: [userId],
    },
    {
      // #120/#151: this user's pending onboarding requests carry the question a
      // SECOND time (migration 012's re-entry copy) PLUS the fit-gate LLM note
      // and the topic-disclosing CBS table identity (migration 015). Redact them
      // in the same transaction, scoped by the SAME bound user_id (no dynamic SQL
      // — the critical cross-user pin holds here too), via the shared
      // PENDING_REDACTION_SET. Free text is cleared on ALL statuses; the table
      // identity only on TERMINAL rows (a running job still needs it — the
      // documented in-flight residual). Money/status/skeleton columns untouched.
      sql: `update pending_table_requests set ${PENDING_REDACTION_SET}
            where user_id = $1`,
      params: [userId, REDACTED_QUESTION_TEXT, REDACTED_TABLE_ID],
    },
  );
}

/** Retention purge (#14 piece 1): every in-scope audit row (AUDIT_SCOPE:
 * source_tag in ('user', 'onboarding_delivery')) older than the given cutoff,
 * across ALL users — the scheduled 2-year sweep — PLUS pending_table_requests
 * rows older than the cutoff (#120). `cutoff` is an injected Date (never
 * `new Date()` inside this function) so the purge is testable against a fixed
 * clock, mirroring the rest of the codebase's reference-date discipline
 * (web/app/actions.ts's referenceDate()). */
export async function purgeExpiredQuestionHistory(db: Db, cutoff: Date): Promise<RedactedRow[]> {
  const cutoffIso = cutoff.toISOString();
  return redactMatchingRows(
    db,
    `${AUDIT_SCOPE} and created_at < $1`,
    [cutoffIso],
    {
      // WP128: feedback attached to purged answers goes with them — scoped by
      // the SAME cutoff + AUDIT_SCOPE window the redaction uses (the feedback
      // row's own age is irrelevant; it inherits its answer's retention).
      sql: `delete from answer_feedback where audit_answer_id in
            (select id from audit_answers where ${AUDIT_SCOPE} and created_at < $1)`,
      params: [cutoffIso],
    },
    {
      // #120/#151: pending onboarding requests older than the cutoff, scoped by
      // the SAME age predicate the audit purge uses (PENDING_PURGE_WHERE, `$1` =
      // cutoff), via the SAME shared PENDING_REDACTION_SET as the self-service
      // leg — free text on all statuses, table identity on terminal rows only
      // (see deleteUserQuestionHistory for the in-flight-race rationale).
      sql: `update pending_table_requests set ${PENDING_REDACTION_SET}
            where ${PENDING_PURGE_WHERE}`,
      params: [cutoffIso, REDACTED_QUESTION_TEXT, REDACTED_TABLE_ID],
    },
  );
}

/** ⟨F2⟩ Dry-run preview for scripts/gdpr-purge.ts: how many rows a `--apply` run
 * WOULD redact, counted from the EXACT same scope fragments the purge itself
 * uses — `AUDIT_SCOPE` for audit rows, `PENDING_PURGE_WHERE` for pending rows —
 * so a read-only preview can never drift from what apply actually does. The
 * equivalence test pins `auditRows` === the redacted `RedactedRow[]` length and
 * `pendingRows` === the count of pending rows the purge turned into the
 * sentinel. Two COUNT queries only, never a write. */
export async function countPurgeableQuestionHistory(
  db: Db,
  cutoff: Date,
): Promise<{ auditRows: number; pendingRows: number }> {
  const cutoffIso = cutoff.toISOString();
  const { rows: audit } = await db.query(
    `select count(*)::int as n from audit_answers where ${AUDIT_SCOPE} and created_at < $1`,
    [cutoffIso],
  );
  const { rows: pending } = await db.query(
    `select count(*)::int as n from pending_table_requests where ${PENDING_PURGE_WHERE}`,
    [cutoffIso],
  );
  return {
    auditRows: Number(audit[0]?.n ?? 0),
    pendingRows: Number(pending[0]?.n ?? 0),
  };
}

/** Two-year retention window (#14, open-questions #14: "Decided … 2-year
 * retention"). A plain function of "now" so both the CLI and its tests can
 * inject the reference instant explicitly. */
export function twoYearsBefore(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  return cutoff;
}

// ---------------------------------------------------------------------------
// #133(b) — redaction integrity (verify-audit-rows.ts's redacted-row check)
// ---------------------------------------------------------------------------
//
// reconstructionReport (reconstruct.ts) verifies that a LIVE row's stored
// promoted columns and rendered text re-derive from its own stored envelope.
// A redacted row fails every one of those checks by design — redactMatchingRows
// above deliberately OVERWRITES the envelope with a sentinel shape that no
// longer carries the original answer/result/chart at all, so there is nothing
// left to "re-derive" (`response.answer` is `undefined` on a redacted answer
// row, which is exactly why the pre-#133 verify script had to skip these rows
// instead of running reconstructionReport on them).
//
// A redacted row still has a correctness question, just a DIFFERENT one: did
// the redaction itself write EXACTLY the sentinel shape this module defines —
// no more, no less? `redactionIntegrityReport` answers that, reading the
// EXACT shapes `redactedResponse`/`redactedPendingClarification` above write
// (single source of truth: this module owns both the writer and the checker,
// so they can never drift apart the way a duplicated shape definition could).

/** Compares one redacted sub-object (`response` or `pending_clarification`)
 * against its expected sentinel shape. Two distinct failure modes, both real
 * redaction bugs, reported distinctly:
 *  - a MISSING/WRONG expected key: the sentinel itself wasn't written
 *    correctly (e.g. `kind` still says something else, or `redacted` isn't
 *    `true`).
 *  - an EXTRA key that isn't part of the sentinel: content the redaction was
 *    supposed to strip is still sitting in the jsonb blob — the "leftover
 *    `answer`/`result`/`chart` key = failed redaction" failure mode #133
 *    calls out by name, so the offending key name(s) are reported explicitly
 *    rather than a generic "shape mismatch" string.
 *
 * Deliberately NOT a plain `JSON.stringify(actual) === JSON.stringify(expected)`
 * check: key ORDER must never matter here (a future Postgres/driver version
 * reordering jsonb keys on read must never fail this check on its own), which
 * is why comparison goes key-by-key through `stableStringify` (the same
 * canonicalizing serializer reconstruct.ts uses) instead of comparing raw
 * JSON text.
 */
function redactedShapeProblems(actual: unknown, expected: Record<string, unknown>, label: string): string[] {
  const problems: string[] = [];
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
    problems.push(`${label} is not a plain redacted-shape object (found: ${stableStringify(actual)})`);
    return problems;
  }
  const actualObj = actual as Record<string, unknown>;
  const expectedKeys = Object.keys(expected);
  const extraKeys = Object.keys(actualObj).filter((key) => !expectedKeys.includes(key));
  if (extraKeys.length > 0) {
    problems.push(
      `${label} carries unexpected key(s) not part of the redacted sentinel shape: ${extraKeys.join(', ')} — ` +
        'a leftover key means the original content was not fully stripped',
    );
  }
  for (const key of expectedKeys) {
    if (stableStringify(actualObj[key]) !== stableStringify(expected[key])) {
      problems.push(`${label}.${key} does not match the redacted sentinel value`);
    }
  }
  return problems;
}

/** #133(b) — does a GDPR-redacted row match the EXACT sentinel shape THIS
 * module writes? The redacted-row counterpart to `reconstructionReport`: same
 * `{ok, problems}` shape, same "run this against a live row and trust an
 * empty problems array" contract, same job (does the stored row match what a
 * correct producer would have written) — but checking `redactMatchingRows`'s
 * own output against itself, since a redacted row has no original content
 * left to independently re-derive.
 *
 * Checks (every one required, per the #133 design brief):
 *  - `question` / `finalText` === REDACTED_QUESTION_TEXT.
 *  - `response` deep-equals `redactedResponse(record.kind)` with NO extra
 *    keys (see `redactedShapeProblems`).
 *  - `intent` / `intentHash` / `conversationContext` are all `null` — the
 *    promoted query-plan columns the "wis de inhoud volledig" owner decision
 *    (session 23) requires cleared.
 *  - `resultIds` / `tableIds` / `tables` are all empty arrays.
 *  - `replyText` is `null` OR exactly `REDACTED_QUESTION_TEXT`, and
 *    `pendingClarification` is `null` OR deep-equals
 *    `redactedPendingClarification()` with no extra keys — AND the two
 *    nullnesses must PAIR (the `reply_round_complete` CHECK constraint,
 *    migration 004, requires `reply_text is null` to equal
 *    `pending_clarification is null`; a redaction that broke the pairing
 *    would never have made it past that constraint, but this re-checks it
 *    from the read side too, defense in depth).
 *
 * Never throws: called in a loop over live database rows
 * (`scripts/verify-audit-rows.ts`) where one malformed/corrupt row must be
 * reported as a problem, not abort the whole run.
 */
export function redactionIntegrityReport(record: AuditRecord): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  try {
    if (record.question !== REDACTED_QUESTION_TEXT) {
      problems.push(`question is not the redaction sentinel (found: ${stableStringify(record.question)})`);
    }
    if (record.finalText !== REDACTED_QUESTION_TEXT) {
      problems.push(`final_text is not the redaction sentinel (found: ${stableStringify(record.finalText)})`);
    }

    problems.push(...redactedShapeProblems(record.response, redactedResponse(record.kind), 'response'));

    if (record.intent !== null) problems.push('intent is not null');
    if (record.intentHash !== null) problems.push('intent_hash is not null');
    if (record.conversationContext !== null) problems.push('conversation_context is not null');
    if (record.resultIds.length !== 0) problems.push('result_ids is not an empty array');
    if (record.tableIds.length !== 0) problems.push('table_ids is not an empty array');
    if (record.tables.length !== 0) problems.push('tables is not an empty array');

    const replyIsNull = record.replyText === null;
    if (!replyIsNull && record.replyText !== REDACTED_QUESTION_TEXT) {
      problems.push(
        `reply_text is neither null nor the redaction sentinel (found: ${stableStringify(record.replyText)})`,
      );
    }

    const pendingIsNull = record.pendingClarification === null;
    if (!pendingIsNull) {
      problems.push(
        ...redactedShapeProblems(
          record.pendingClarification,
          redactedPendingClarification(),
          'pending_clarification',
        ),
      );
    }

    // reply_round_complete (migration 004's CHECK constraint), re-checked
    // from the read side: the two columns' nullability must match exactly.
    if (replyIsNull !== pendingIsNull) {
      problems.push(
        'reply_text and pending_clarification are not paired (would violate the reply_round_complete constraint)',
      );
    }
  } catch (error) {
    // A malformed/corrupt row is a PROBLEM to report, never a crash that
    // takes down a loop over live rows (scripts/verify-audit-rows.ts).
    problems.push(
      `redaction-integrity check crashed on a malformed record: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { ok: problems.length === 0, problems };
}
