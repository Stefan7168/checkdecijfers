// The WP10 wrap layer (ADR 015 "Notes for WP10", ADR 016): the audited entry
// points the outside world (chat UI, benchmark runner) calls. Each wraps its
// WP9 counterpart and writes ONE audit_answers row per produced response —
// BEFORE returning it, so nothing can be shown unrecorded (R8; ADR 004's
// no-streaming rule exists for exactly this ordering).
//
// Fail-closed policy on an audit-write failure (ADR 016):
//  - answer or clarification: the response is WITHHELD and replaced by the
//    'internal' refusal — an unrecorded answer violates R8, and unrecorded
//    pending state would open a clarification round the audit trail never saw.
//    The replacement refusal is itself audited (best effort).
//  - refusal: returned as-is with the failure appended to its internalNote —
//    refusals carry no data values (ADR 015 decision 1), so principle (c) is
//    not at risk, and masking one honest refusal with another helps nobody.
import type { Db } from '../../db/types.ts';
import { toInternalRefusal } from '../respond/refusals.ts';
import {
  respondToClarificationReply,
  respondToQuestion,
  type RespondOptions,
} from '../respond/respond.ts';
import type { ComposedResponse, PendingClarification, RefusalResponse } from '../respond/types.ts';
import type { ConversationContext } from '../context/types.ts';
// WP129+130 (ADR 032): the web-attach seam runs between respond and
// persistOrFailClosed so the stored row carries the section (stored-before-
// shown, R8). Imported DIRECTLY (attach.ts type-imports client.ts) — no
// Anthropic SDK enters this graph; actions.ts constructs the real client.
import { attachWebAugmentation, type WebBilling } from '../../websearch/attach.ts';
import type { WebSearchClient } from '../../websearch/client.ts';
import type { AuditSourceTag } from './types.ts';
import { LlmCallTracker } from './track.ts';
import { buildAuditRow, insertAuditRecord, type AuditContext } from './write.ts';

export interface AuditedRespondOptions extends RespondOptions {
  /** Identity seam (ADR 006); omitted/null = anonymous. */
  userId?: string | null;
  /** WP13, open-questions #44: omitted = 'user' (the real chat's own path).
   * The benchmark/validation runner scripts pass 'benchmark'/'validation'
   * explicitly. */
  sourceTag?: AuditSourceTag;
  /** The billing gate's idempotency key for this turn (src/billing/gate.ts) —
   * the dashboard question-history join key back to credit_transactions.
   * Omitted on runner scripts that don't go through the gate. */
  requestId?: string | null;
  // conversationContext (WP15, ADR 021) is inherited from RespondOptions and
  // recorded on the audit row below — an input capture, like replyText.
  // sourceSelection (WP129+130, ADR 032) is likewise inherited from
  // RespondOptions and flows through respond*, then to attachWebAugmentation.
  /** WP129+130 (#130, ADR 032): the web-search client + the reserve() closure,
   * wired ONLY by web/app/actions.ts when the flag is on AND the Internet chip
   * is selected. Absent everywhere else (benchmark, tests, CLI) → attach
   * records `not_configured` if a turn OWES a web attempt, otherwise a null
   * section (⟨W6⟩). Kept as an injected pair so this module never imports
   * billing/db and the benchmark constructs zero web machinery. */
  webClient?: WebSearchClient;
  webBilling?: WebBilling;
}

export interface AuditedResponse {
  response: ComposedResponse;
  /** The audit_answers row id. Null ONLY when the audit write itself failed —
   * `response` is then the fail-closed replacement (or the annotated
   * refusal), never an unrecorded answer. */
  auditId: number | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function appendInternalNote(refusal: RefusalResponse, note: string): RefusalResponse {
  return {
    ...refusal,
    internalNote: refusal.internalNote === null ? note : `${refusal.internalNote}\n${note}`,
  };
}

interface WrapContext {
  question: string;
  referenceDate: string;
  userId: string | null;
  sourceTag: AuditSourceTag | undefined;
  requestId: string | null | undefined;
  replyText: string | null;
  pendingClarification: PendingClarification | null;
  conversationContext: ConversationContext | null;
  tracker: LlmCallTracker;
  startedAt: number;
}

function auditContext(wrap: WrapContext): AuditContext {
  return {
    referenceDate: wrap.referenceDate,
    userId: wrap.userId,
    sourceTag: wrap.sourceTag,
    requestId: wrap.requestId,
    replyText: wrap.replyText,
    pendingClarification: wrap.pendingClarification,
    conversationContext: wrap.conversationContext,
    llmCalls: wrap.tracker.calls,
    latencyMs: Math.max(0, Math.round(performance.now() - wrap.startedAt)),
  };
}

async function persistOrFailClosed(
  db: Db,
  response: ComposedResponse,
  wrap: WrapContext,
): Promise<AuditedResponse> {
  try {
    const auditId = await insertAuditRecord(db, buildAuditRow(response, auditContext(wrap)));
    return { response, auditId };
  } catch (error) {
    const note = `audit write failed: ${errorMessage(error)}`;
    if (response.kind === 'refusal') {
      // ⟨W1⟩ (WP129+130, ADR 032): this branch ships the refusal UNRECORDED
      // (auditId null, no retry — its ADR-016 rationale "refusals carry no data
      // values" predates this WP). A refusal can now carry a billed, unverified
      // web section; shown-and-kept without a stored row would break R8 and
      // leave paid web content unaudited. Strip the section to null (the
      // settlement step then refunds the add-on automatically). sourceSelection
      // may stay — it carries no fetched content.
      const annotated = appendInternalNote(response, note);
      const stripped =
        (annotated.webSection ?? null) !== null ? { ...annotated, webSection: null } : annotated;
      return { response: stripped, auditId: null };
    }
    const refusal = toInternalRefusal(wrap.question, note);
    try {
      const auditId = await insertAuditRecord(db, buildAuditRow(refusal, auditContext(wrap)));
      return { response: refusal, auditId };
    } catch (secondError) {
      return {
        response: appendInternalNote(refusal, `audit write failed again: ${errorMessage(secondError)}`),
        auditId: null,
      };
    }
  }
}

export async function answerQuestionAudited(
  db: Db,
  question: string,
  options: AuditedRespondOptions,
): Promise<AuditedResponse> {
  const tracker = new LlmCallTracker();
  const conversationContext = options.conversationContext ?? null;
  const wrap: WrapContext = {
    question,
    referenceDate: options.referenceDate,
    userId: options.userId ?? null,
    sourceTag: options.sourceTag,
    requestId: options.requestId,
    replyText: null,
    pendingClarification: null,
    conversationContext,
    tracker,
    startedAt: performance.now(),
  };
  const response = await respondToQuestion(db, question, {
    ...options,
    // 'followup' when a context is offered (the parse runs in follow-up mode,
    // WP15/ADR 021) — llm_calls stays honest about which prompt actually ran.
    intentClient: tracker.wrap(conversationContext === null ? 'intent' : 'followup', options.intentClient),
    answerClient: tracker.wrap('compose', options.answerClient),
    // #144 (ADR 034): the checker's calls are tracked like every other role —
    // token counts land in llm_calls; the verdict itself rides the envelope.
    ...(options.semanticCheck
      ? {
          semanticCheck: {
            ...options.semanticCheck,
            client: tracker.wrap('semantic_check', options.semanticCheck.client),
          },
        }
      : {}),
  });
  // WP129+130 (ADR 032): attach the web section BEFORE persisting, so the
  // stored row carries it verbatim (R8) and latencyMs honestly includes web
  // time. Both keys are always set (A1). No selection/client/billing (the
  // benchmark, tests, CLI) ⇒ both keys null, zero web machinery.
  const augmented = await attachWebAugmentation(response, {
    selection: options.sourceSelection,
    client: options.webClient,
    billing: options.webBilling,
  });
  return persistOrFailClosed(db, augmented, wrap);
}

export async function answerClarificationReplyAudited(
  db: Db,
  pending: PendingClarification,
  reply: string,
  options: AuditedRespondOptions,
): Promise<AuditedResponse> {
  const tracker = new LlmCallTracker();
  const wrap: WrapContext = {
    question: pending.question,
    // THIS turn's clock (staleness runs against it). The original parse's
    // clock travels inside the stored pending_clarification, so both are
    // reconstructable from the row.
    referenceDate: options.referenceDate,
    userId: options.userId ?? null,
    sourceTag: options.sourceTag,
    requestId: options.requestId,
    replyText: reply,
    pendingClarification: pending,
    // A reply merges with the pending intent — never also with a context
    // (one merge candidate per parse, ADR 021 decision 1).
    conversationContext: null,
    tracker,
    startedAt: performance.now(),
  };
  const response = await respondToClarificationReply(db, pending, reply, {
    ...options,
    conversationContext: null,
    intentClient: tracker.wrap('clarify', options.intentClient),
    answerClient: tracker.wrap('compose', options.answerClient),
    // #144 (ADR 034): same tracking on the reply turn.
    ...(options.semanticCheck
      ? {
          semanticCheck: {
            ...options.semanticCheck,
            client: tracker.wrap('semantic_check', options.semanticCheck.client),
          },
        }
      : {}),
  });
  // WP129+130 (ADR 032): same attach seam on the reply turn. A 'clarification'
  // outcome here means the round is OVER (still-ambiguous → refusal), so a web
  // attempt may legitimately be owed; attach's own kind-check handles the
  // clarification-skip case.
  const augmented = await attachWebAugmentation(response, {
    selection: options.sourceSelection,
    client: options.webClient,
    billing: options.webBilling,
  });
  return persistOrFailClosed(db, augmented, wrap);
}
