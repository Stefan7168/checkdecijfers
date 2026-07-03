// WP10 audit records (R8) — types (docs/05 audit-trail design, ADR 016).
//
// One AuditRecord per produced ComposedResponse — answer, clarification or
// refusal — written BEFORE the response is shown (the audited entry points in
// respond-audited.ts return only after the insert commits). The record is a
// complete, renderable snapshot: the envelope already carries the parse
// outcome, the validated result (result IDs, values, derivations), the
// composed answer and the chart spec; everything else here is either the
// wrap-site context ADR 015 assigned to WP10 (reply text, pending
// clarification, prompt versions) or a promoted copy for querying.
import type { ComposedResponse, PendingClarification, RefusalReason } from '../respond/types.ts';
import type { AnswerSource } from '../compose/types.ts';

export const AUDIT_SCHEMA_VERSION = 1 as const;

/** One LLM call made while producing the response — the "model IDs used" half
 * of docs/05's requirement (the prompt-version half is PromptVersions). */
export interface LlmCallRecord {
  /** Which pipeline role made the call (ADR 004's two confined roles, plus
   * the clarify-mode variant of intent parsing). */
  role: 'intent' | 'clarify' | 'compose';
  /** The model that answered, as reported by the API response. */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** The three exported prompt-version constants in force when this record was
 * written (ADR 015 wrap-site obligation): intent PROMPT_VERSION,
 * CLARIFY_PROMPT_VERSION, COMPOSE_PROMPT_VERSION. */
export interface PromptVersions {
  intent: number;
  clarify: number;
  compose: number;
}

/** {tableId, tableVersion, syncedAt} per docs/05 "table IDs + versions +
 * sync dates". */
export interface TableRef {
  tableId: string;
  tableVersion: number;
  syncedAt: string;
}

export interface AuditRecord {
  id: number;
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  createdAt: string;
  /** Identity seam (ADR 006): null = anonymous / benchmark runs. */
  userId: string | null;

  kind: ComposedResponse['kind'];
  question: string;
  /** The injected YYYY-MM-DD reference date the parse ran against. */
  referenceDate: string;

  /** Reply-round context (ADR 015): the user's free-text reply and the
   * PendingClarification it answered. Both null on first-turn rows. */
  replyText: string | null;
  pendingClarification: PendingClarification | null;

  /** The authoritative snapshot: the full envelope, verbatim. */
  response: ComposedResponse;
  /** = response.text (promoted; reconstruction asserts equality). */
  finalText: string;

  /** The resolved intent when one exists (promoted from the envelope): the
   * deterministic query plan (ADR 016). */
  intent: unknown | null;
  /** sha256/32-hex over the canonicalized intent (docs/06 caching seam). */
  intentHash: string | null;
  refusalReason: RefusalReason | null;
  resultIds: string[];
  tableIds: string[];
  tables: TableRef[];
  answerSource: AnswerSource | null;
  chartEmitted: boolean;

  promptVersions: PromptVersions;
  llmCalls: LlmCallRecord[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}
