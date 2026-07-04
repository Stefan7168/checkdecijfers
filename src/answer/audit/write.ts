// Building and inserting one audit_answers row per ComposedResponse (R8,
// migration 004, ADR 016). The envelope is stored verbatim as the
// authoritative snapshot; every other column is wrap-site context (ADR 015)
// or a promoted copy whose consistency the reconstruction check re-verifies.
import { createHash } from 'node:crypto';
import type { Db } from '../../db/types.ts';
import type { StructuredIntent } from '../../query/index.ts';
import { stableStringify } from '../llm/client.ts';
import { PROMPT_VERSION } from '../intent/prompt.ts';
import { CLARIFY_PROMPT_VERSION } from '../intent/clarify.ts';
import { FOLLOWUP_PROMPT_VERSION } from '../intent/followup.ts';
import { COMPOSE_PROMPT_VERSION } from '../compose/prompt.ts';
import type { ComposedResponse, PendingClarification } from '../respond/types.ts';
import type { ConversationContext } from '../context/types.ts';
import type { AuditRecord, AuditSourceTag, LlmCallRecord, PromptVersions, TableRef } from './types.ts';
import { AUDIT_SCHEMA_VERSION } from './types.ts';

/** The prompt-version constants in force (ADR 015 wrap-site obligation) —
 * recorded on every row, whether or not the matching call ran; llmCalls says
 * what actually ran. `followup` since WP15 (ADR 021). */
export function currentPromptVersions(): PromptVersions {
  return {
    intent: PROMPT_VERSION,
    clarify: CLARIFY_PROMPT_VERSION,
    compose: COMPOSE_PROMPT_VERSION,
    followup: FOLLOWUP_PROMPT_VERSION,
  };
}

/** Canonical hash of a resolved intent — the repeat-question measurement
 * source for the docs/06 caching/spend triggers. Same canonicalization as the
 * LLM fixture hash (stableStringify: key-order independent). */
export function intentHash(intent: StructuredIntent): string {
  return createHash('sha256').update(stableStringify(intent)).digest('hex').slice(0, 32);
}

/** The resolved intent a response rests on, when one exists: answers echo it
 * in the validated result; refusals may carry it via the query refusal or an
 * intent-shaped parse; clarifications by definition have none. */
export function resolvedIntent(response: ComposedResponse): StructuredIntent | null {
  if (response.kind === 'answer') return response.result.intent;
  if (response.kind === 'refusal') {
    if (response.queryRefusal) return response.queryRefusal.intent;
    if (response.parse?.kind === 'intent') return response.parse.intent;
  }
  return null;
}

/** Everything the wrap site knows that the envelope deliberately does not
 * carry (ADR 015 "Notes for WP10"). */
export interface AuditContext {
  referenceDate: string;
  userId: string | null;
  /** WP13, open-questions #44: defaults to 'user' (the real chat's own path)
   * when the wrap site doesn't say otherwise -- runner scripts pass
   * 'benchmark'/'validation' explicitly. */
  sourceTag?: AuditSourceTag;
  /** The billing gate's idempotency key for this turn (src/billing/gate.ts),
   * when one exists -- the dashboard question-history join key. */
  requestId?: string | null;
  /** Reply-round context; both null on first-turn rows. */
  replyText: string | null;
  pendingClarification: PendingClarification | null;
  /** WP15 (ADR 021): the validated context OFFERED to this turn's parse;
   * null on standalone and reply turns. */
  conversationContext: ConversationContext | null;
  llmCalls: LlmCallRecord[];
  latencyMs: number;
}

/** The unsaved row (AuditRecord minus the database-assigned fields). */
export type AuditRow = Omit<AuditRecord, 'id' | 'createdAt'>;

export function buildAuditRow(response: ComposedResponse, context: AuditContext): AuditRow {
  const intent = resolvedIntent(response);
  const isAnswer = response.kind === 'answer';
  const tables: TableRef[] = isAnswer
    ? [
        {
          tableId: response.result.attribution.tableId,
          tableVersion: response.result.attribution.tableVersion,
          syncedAt: response.result.attribution.syncedAt,
        },
      ]
    : [];
  const totals = context.llmCalls.reduce(
    (sum, call) => ({
      inputTokens: sum.inputTokens + call.inputTokens,
      outputTokens: sum.outputTokens + call.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    userId: context.userId,
    sourceTag: context.sourceTag ?? 'user',
    requestId: context.requestId ?? null,
    kind: response.kind,
    question: response.question,
    referenceDate: context.referenceDate,
    replyText: context.replyText,
    pendingClarification: context.pendingClarification,
    conversationContext: context.conversationContext,
    response,
    finalText: response.text,
    intent,
    intentHash: intent === null ? null : intentHash(intent),
    refusalReason: response.kind === 'refusal' ? response.reason : null,
    resultIds: isAnswer ? response.result.cells.map((cell) => cell.resultId) : [],
    tableIds: tables.map((t) => t.tableId),
    tables,
    answerSource: isAnswer ? response.answer.source : null,
    chartEmitted: isAnswer && response.chart !== null,
    promptVersions: currentPromptVersions(),
    llmCalls: context.llmCalls,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    latencyMs: context.latencyMs,
  };
}

/** Inserts the row and returns its id. Array columns travel as jsonb text and
 * are expanded server-side, so the same statement behaves identically on pg
 * (Supabase) and PGlite (CI) — ADR 002's plain-Postgres rule. */
export async function insertAuditRecord(db: Db, row: AuditRow): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers (
       schema_version, user_id, source_tag, kind, question, reference_date,
       reply_text, pending_clarification, conversation_context, response, final_text,
       intent, intent_hash, refusal_reason,
       result_ids, table_ids, tables, answer_source, chart_emitted,
       prompt_versions, llm_calls, input_tokens, output_tokens, latency_ms,
       request_id
     ) values (
       $1, $2, $3, $4, $5, $6,
       $7, $8::jsonb, $24::jsonb, $9::jsonb, $10,
       $11::jsonb, $12, $13,
       array(select jsonb_array_elements_text($14::jsonb)),
       array(select jsonb_array_elements_text($15::jsonb)),
       $16::jsonb, $17, $18,
       $19::jsonb, $20::jsonb, $21, $22, $23,
       $25
     ) returning id`,
    [
      row.schemaVersion,
      row.userId,
      row.sourceTag,
      row.kind,
      row.question,
      row.referenceDate,
      row.replyText,
      row.pendingClarification === null ? null : JSON.stringify(row.pendingClarification),
      JSON.stringify(row.response),
      row.finalText,
      row.intent === null ? null : JSON.stringify(row.intent),
      row.intentHash,
      row.refusalReason,
      JSON.stringify(row.resultIds),
      JSON.stringify(row.tableIds),
      JSON.stringify(row.tables),
      row.answerSource,
      row.chartEmitted,
      JSON.stringify(row.promptVersions),
      JSON.stringify(row.llmCalls),
      row.inputTokens,
      row.outputTokens,
      row.latencyMs,
      row.conversationContext === null ? null : JSON.stringify(row.conversationContext),
      row.requestId,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined || id === null) {
    throw new Error('audit insert returned no id');
  }
  return Number(id);
}
