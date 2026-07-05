// WP9 clarification-reply parsing: the second half of the ONE clarification
// round (docs/05 failure table; docs/02 S3). A free-text reply ("Utrecht",
// "de gemeente", "het landelijke cijfer, voor 2024") is parsed MERGED with
// the pending partial intent — never as a fresh question.
//
// Confinement is identical to WP6 (ADR 004/012): the LLM sees the original
// question, the clarification we asked, the offered options and the reply —
// never data — and emits the same schema-validated RawParse vocabulary.
// Deterministic code (resolve/policy) still owns name→code resolution and the
// R7 thresholds. Whether a still-unresolved outcome becomes a
// refusal-with-guidance (the final-round rule: never a second question) is
// the respond layer's decision, NOT this module's — this module reports
// honestly what the merged parse is.
//
// HASH-STABILITY: this module APPENDS a mode section to the WP6 system prompt
// builder's output. It must never modify prompt.ts's bytes — the recorded
// intent fixtures (54 as of WP14) hash the base prompt verbatim (ADR 012).
import type { Db } from '../../db/types.ts';
import { echoServability } from '../../query/index.ts';
import type { ConversationContext } from '../context/types.ts';
import type { PendingClarification } from '../respond/types.ts';
import { INTENT_MODEL, type IntentLlmClient, type IntentLlmRequest } from './client.ts';
import { MAX_CANDIDATES, REFUSAL_KIND_BY_QUESTION_KIND } from './parse.ts';
import { buildSystemPrompt } from './prompt.ts';
import { rawParseJsonSchema, validateRawParse } from './schema.ts';
import { resolveCandidate } from './resolve.ts';
import { resolveUnmatched, decide, type OutcomeContext, type TableFinder } from './policy.ts';
import { DEFAULT_PARSER_CONFIG, type ParseOutcome, type ParserConfig } from './types.ts';

/** Bump when the clarify-mode section or reply payload shape changes
 * meaningfully — recorded in every clarify fixture and the audit record.
 * v2 (2026-07-04, WP15 review finding): a clarification that arose from a
 * FOLLOW-UP question carries its conversational referent, delivered to the
 * reply merge via CLARIFY_CONTEXT_ADDENDUM + a previous_intent payload field
 * — BOTH added only when a context is present, so contextless reply requests
 * stay byte-identical to v1 (the 7 committed clarify fixtures replay
 * unchanged; proven by the replay suite). */
export const CLARIFY_PROMPT_VERSION = 2;

export interface ClarifyReplyOptions {
  client: IntentLlmClient;
  config?: ParserConfig;
  model?: string;
  maxTokens?: number;
  /** WP16 sub-part 2 (ADR 026): OPTIONAL table-finder for the unmatched exit,
   * kept uniform with the other two call sites. NOT wired in production today
   * (web/app/actions.ts injects it only into askQuestion, not
   * replyToClarification — a reply-turn onboarding trigger is a separate
   * decision), so a reply that still names an unmatched topic keeps its
   * byte-identical B15 behavior. Threaded here so the seam stays consistent
   * and a future decision can enable it without touching this module. */
  tableFinder?: TableFinder;
}

/** The clarify-mode instruction, appended verbatim to the WP6 system prompt
 * so the vocabulary/region/period/derivation rules stay a single source of
 * truth. Keep this text stable: its bytes are part of every clarify fixture
 * hash. */
export const CLARIFY_MODE_SECTION = `

# Clarification-reply mode

This request is the SECOND turn of a clarification round. The user asked a question, we could not resolve every axis, and we asked ONE clarifying question. You now receive a JSON object instead of a bare question:

{"original_question": ..., "clarification_question": ..., "options": [...], "reply": ...}

Rules for this mode:

- Parse the MERGED request: the original question combined with the reply. The reply answers our clarification — it is not a fresh question.
- Keep every axis from the original question that the reply does not change (its topic, its period, its regions, its derivation). The reply typically fills in only what was asked.
- A reply that picks an offered option (verbatim, by prefix, or by reference such as "de eerste") means that option's reading.
- A short reply is an answer, not a question: "Utrecht" answers a region question; "de gemeente" disambiguates a region kind; "2024" answers a period question.
- If the merged request STILL leaves an axis unresolved (the reply ignored part of the question, or names a topic that matches no key), report that honestly exactly as in normal mode: unmatched terms in unmatchedMeasureTerm, missing periods as {"kind":"none"}, unknown region kinds as 'onbekend'. NEVER invent the missing axis. Downstream code decides what happens after this round — you never re-ask.
- Only when the reply clearly ABANDONS the original question and asks something new and unrelated, parse the reply on its own (any kind, including forecast_request/causal_question/out_of_scope/compound/smalltalk_or_other).
- Confidence keeps its normal meaning, applied to the merged reading.

The output schema is unchanged.`;

/** Appended AFTER the clarify-mode section, and ONLY when the pending
 * clarification carries a conversational referent (WP15, ADR 021 — the
 * follow-up→clarify→reply chain; review finding 2026-07-04: without this the
 * reply merge saw only the bare elliptical follow-up text and lost the
 * referent). Contextless requests never include these bytes, so the v1
 * clarify fixtures stay valid. Keep this text stable: its bytes are part of
 * every context-carrying clarify fixture hash. */
export const CLARIFY_CONTEXT_ADDENDUM = `

# Conversational referent (field "previous_intent")

The original question in this round was itself a FOLLOW-UP: the payload carries an extra field previous_intent — what the turn BEFORE it resolved to, in your vocabulary (a topicKey from the vocabulary above, registry place names, a concrete period). The original question's ellipsis ("en ...?", "dit", "daar") points at it.

- Merge ALL THREE sources: previous_intent supplies every axis neither the original question nor the reply changes; the original question supplies what it changed; the reply answers our clarification question.
- The same verbatim-copy rules as always: NEVER drop or silently replace an inherited region (not even on an "alleen landelijk" topic), NEVER widen an inherited period. Report still-unresolved axes honestly; downstream code decides what happens.`;

export function buildClarifySystemPrompt(context?: ConversationContext | null): string {
  return buildSystemPrompt() + CLARIFY_MODE_SECTION + (context ? CLARIFY_CONTEXT_ADDENDUM : '');
}

/** The user-turn payload. Serialized deterministically (stable key order as
 * written) — these bytes are part of the fixture hash. The previous_intent
 * key exists ONLY when the pending carries a referent: contextless payloads
 * keep the exact v1 four-key shape. */
export function buildClarifyUserPayload(pending: PendingClarification, reply: string): string {
  const context = pending.conversationContext ?? null;
  return JSON.stringify({
    original_question: pending.question,
    clarification_question: pending.questionNl,
    options: pending.options,
    reply,
    ...(context
      ? {
          previous_intent: {
            topicKey: context.topicKey,
            regions: context.regions,
            period: context.period,
            derivation: context.derivation,
          },
        }
      : {}),
  });
}

export function buildClarifyRequest(
  pending: PendingClarification,
  reply: string,
  options: Pick<ClarifyReplyOptions, 'model' | 'maxTokens'> = {},
): IntentLlmRequest {
  return {
    model: options.model ?? INTENT_MODEL,
    maxTokens: options.maxTokens ?? 2048,
    temperature: 0,
    system: buildClarifySystemPrompt(pending.conversationContext),
    question: buildClarifyUserPayload(pending, reply),
    jsonSchema: rawParseJsonSchema(),
  };
}

/** Parse the user's reply merged with the pending clarification. Returns an
 * honest ParseOutcome: 'intent' when the merge resolves, 'clarification' when
 * axes remain unresolved (the respond layer converts that to a
 * refusal-with-guidance — final round), 'refusal' when the merged/abandoning
 * reply classifies as one. The `question` echoed in the outcome is the
 * ORIGINAL question (the reply is recorded in the audit record separately). */
export async function parseClarificationReply(
  db: Db,
  pending: PendingClarification,
  reply: string,
  options: ClarifyReplyOptions,
): Promise<ParseOutcome> {
  const request = buildClarifyRequest(pending, reply, options);
  const response = await options.client.complete(request);
  const raw = validateRawParse(response.outputText);

  const context: OutcomeContext = {
    question: pending.question,
    raw,
    model: response.model,
    usage: response.usage,
  };

  if (raw.kind !== 'data_query') {
    return {
      kind: 'refusal',
      ...context,
      refusalKind: REFUSAL_KIND_BY_QUESTION_KIND[raw.kind],
      note: raw.note,
    };
  }

  if (raw.candidates.length === 0) return resolveUnmatched(context, options.tableFinder);

  const resolutions = await Promise.all(
    raw.candidates
      .slice(0, MAX_CANDIDATES)
      .map((candidate) => resolveCandidate(db, candidate, pending.referenceDate)),
  );
  // The #56 servability check applies on reply turns too — decide() is the
  // shared seam, so an unservable echo can never be offered from either path.
  return decide(
    context,
    resolutions,
    options.config ?? DEFAULT_PARSER_CONFIG,
    (intent) => echoServability(db, intent),
    options.tableFinder,
  );
}
