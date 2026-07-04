// The chat UI's only entry point into the backend (ADR 018 decision 3, WP13
// ADR 020): a thin Server Action wrapper around the two audited functions,
// now gated by the billing module (src/billing/, WP13) — never the answer
// pipeline itself. No business logic lives here beyond that gating —
// marshaling plus two infra guards (input-length bound, error logging), so a
// future Route Handler swap (for real stage-status streaming) stays confined
// to this one file.
'use server';

import { answerClarificationReplyAudited, answerQuestionAudited } from '../backend/answer/audit/index.ts';
import { buildConversationContext, validateConversationContext } from '../backend/answer/context/index.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import type { PendingClarification } from '../backend/answer/respond/types.ts';
import { chargeAndRun } from '../backend/billing/index.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';

// Auth check happens HERE, inside the Server Action — not only in proxy.ts.
// Next's own data-security guidance is explicit that a Proxy matcher is an
// optimistic check, never the authorization boundary: a matcher change or a
// Server Function moved to a different route can silently stop being
// covered by Proxy without anyone noticing, so every Server Function must
// verify itself (web/lib/current-user.ts).

// The one legitimate un-pinned clock in the codebase — every other call site
// (tests, hermetic CI, the benchmark runner) injects a fixed reference date.
// Computed in the product's own timezone (WP12 review): a plain UTC date is
// still yesterday for up to two hours after midnight in the Netherlands,
// which would skew relative-period resolution ("vorige maand").
function referenceDate(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Infra guard, not a pipeline rule: bounds single-request token spend on the
// public endpoint (the client input caps at 500 chars; this is the belt
// behind it). Throwing here produces no response at all — nothing is shown,
// so nothing needs auditing (R8 governs produced responses). Rate limiting
// proper stays Phase 1–2 (docs/03 non-goals, ADR 005).
const MAX_INPUT_LENGTH = 2000;

function guardLength(text: string): void {
  if (text.length > MAX_INPUT_LENGTH) {
    throw new Error(`input rejected: ${text.length} chars exceeds ${MAX_INPUT_LENGTH}`);
  }
}

// WP15 (ADR 021): what the chat gets back on every submit — the billing
// envelope unchanged, plus the structured context the CLIENT should hold and
// send back on the next question. `context` is null whenever the response
// leaves no honest referent (clarifications, parse-level refusals, a gated
// non-'ok' outcome) — the caller (chat.tsx) must then keep whatever context
// it already held, never overwrite it with null (ADR 021 decision 1: a
// smalltalk/refusal detour must not erase the referent).
export interface AskOutcome {
  gated: GatedResponse;
  context: ConversationContext | null;
}

/** gated.kind === 'ok' -> the context handed to the NEXT turn, built from
 * this turn's own response; every other kind -> null (nothing was produced
 * to derive a referent from). Deterministic, server-side only — the client
 * never constructs a ConversationContext itself.
 *
 * Fail-open on the build itself: by the time this runs the answer is already
 * produced, audited AND debited — a context-derivation hiccup may cost the
 * NEXT turn its referent, never the user this turn's paid answer. */
async function outcomeContext(gated: GatedResponse): Promise<ConversationContext | null> {
  if (gated.kind !== 'ok') return null;
  try {
    return await buildConversationContext(getDb(), gated.response);
  } catch (error) {
    console.error('conversation-context build failed (answer still returned):', error);
    return null;
  }
}

// requestId: a client-generated UUID (crypto.randomUUID(), one per submit —
// chat.tsx) threaded all the way into the billing gate's idempotency key
// (credit_transactions_one_debit_per_request). Without it, a Server Action
// re-invoked by a browser retry or a double submit would debit the same
// logical question twice.
//
// rawContext: the client-held ConversationContext from a PRIOR turn, sent
// back verbatim (untrusted — see web/backend/answer/context/validate.ts).
// Validated BEFORE the billing gate even runs: a garbage context must
// degrade to a standalone parse, never affect gating or throw.
export async function askQuestion(
  question: string,
  requestId: string,
  rawContext?: unknown,
): Promise<AskOutcome> {
  guardLength(question);
  const userId = await currentUserId();
  if (userId === null) {
    return { gated: { kind: 'unauthenticated' }, context: null };
  }
  const conversationContext = await validateConversationContext(getDb(), rawContext ?? null);
  try {
    const gated = await chargeAndRun(getDb(), userId, requestId, () =>
      answerQuestionAudited(getDb(), question, {
        referenceDate: referenceDate(),
        userId,
        sourceTag: 'user',
        requestId,
        conversationContext,
        intentClient: new AnthropicLlmClient(),
        answerClient: new AnthropicLlmClient(),
      }),
    );
    return { gated, context: await outcomeContext(gated) };
  } catch (error) {
    // Vercel function logs are the owner's only visibility into production
    // infra failures (WP12 review); the client still receives Next's generic
    // masked error, never these details. chargeAndRun has already
    // compensated the debit before this rethrow reaches here (ADR 020).
    console.error('askQuestion failed:', error);
    throw error;
  }
}

export async function replyToClarification(
  pending: PendingClarification,
  reply: string,
  requestId: string,
): Promise<AskOutcome> {
  guardLength(reply);
  const userId = await currentUserId();
  if (userId === null) {
    return { gated: { kind: 'unauthenticated' }, context: null };
  }
  // WP15: a pending from a follow-up clarification embeds the conversational
  // referent — client-held, so it gets the SAME registry validation as a
  // fresh question's context before it can reach the clarify prompt. A
  // forged/garbled one drops to a contextless reply merge (fail closed).
  const { conversationContext: rawEmbedded, ...pendingRest } = pending;
  const embeddedContext = await validateConversationContext(getDb(), rawEmbedded ?? null);
  const safePending: PendingClarification = {
    ...pendingRest,
    ...(embeddedContext ? { conversationContext: embeddedContext } : {}),
  };
  try {
    const gated = await chargeAndRun(getDb(), userId, requestId, () =>
      answerClarificationReplyAudited(getDb(), safePending, reply, {
        referenceDate: referenceDate(),
        userId,
        sourceTag: 'user',
        requestId,
        intentClient: new AnthropicLlmClient(),
        answerClient: new AnthropicLlmClient(),
      }),
    );
    return { gated, context: await outcomeContext(gated) };
  } catch (error) {
    console.error('replyToClarification failed:', error);
    throw error;
  }
}
