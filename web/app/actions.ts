// The chat UI's only entry point into the backend (ADR 018 decision 3, WP13
// ADR 020): a thin Server Action wrapper around the two audited functions,
// now gated by the billing module (src/billing/, WP13) — never the answer
// pipeline itself. No business logic lives here beyond that gating —
// marshaling plus two infra guards (input-length bound, error logging), so a
// future Route Handler swap (for real stage-status streaming) stays confined
// to this one file.
'use server';

import { after } from 'next/server';

import {
  answerClarificationReplyAudited,
  answerQuestionAudited,
  deleteUserQuestionHistory,
} from '../backend/answer/audit/index.ts';
import { buildConversationContext, validateConversationContext } from '../backend/answer/context/index.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import type { PendingClarification } from '../backend/answer/respond/types.ts';
import { chargeAndRun } from '../backend/billing/index.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import { buildOnboardingFinder } from '../backend/ingestion/onboarding-finder.ts';
import {
  onboardingPrice,
  triggerOnboarding,
} from '../backend/ingestion/onboarding-trigger.ts';
import { loadOnboardedVocabulary } from '../backend/ingestion/onboarding-vocab.ts';
import type { OnboardedMeasure } from '../backend/answer/intent/prompt.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { kickOnboardingJob } from '../lib/onboarding-kick.ts';

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

// #112 (the go-live money bug): a fresh chat turn must KNOW what has already
// been onboarded, or re-asking an answered topic re-triggers the full
// 100-credit onboarding instead of answering at the normal question price.
// Rides the SAME master switch as the finder and the history read (the
// session-27 incident rule: while dormant, no code path may touch
// onboarding-owned state) and fails SOFT: a load failure degrades this turn
// to the Phase-0 vocabulary — worst case is exactly yesterday's behavior
// (the finder path), never a blocked or unanswered turn.
async function onboardedVocabulary(): Promise<OnboardedMeasure[]> {
  if (process.env.ONBOARDING_ENABLED !== '1') return [];
  try {
    return await loadOnboardedVocabulary(getDb());
  } catch (error) {
    console.error('onboarded-vocabulary load failed (turn continues with Phase-0 vocabulary):', error);
    return [];
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
  // #112: loaded BEFORE the billing gate — the load is read-only and must
  // never run (or fail) inside the charged section.
  const extraVocabulary = await onboardedVocabulary();
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
        // #112: the already-onboarded vocabulary, so a repeat question on an
        // onboarded topic parses onto its 'onboarded:' key and answers
        // directly (normal price) — the finder below only sees topics the
        // parse could NOT match. [] while the switch is off or nothing is
        // onboarded → prompt bytes identical to the calibrated Phase-0 one.
        extraCanonicalMeasures: extraVocabulary,
        // WP16 sub-part 2 (ADR 026): the table finder is injected ONLY here —
        // an unloaded topic the finder confidently maps to a CBS table becomes
        // an 'onboarding_pending' acknowledgment instead of the B15
        // clarification. Absent everywhere else (benchmark, tests, the reply
        // action below), so the unmatched exit stays byte-identical there.
        // Gated on ONBOARDING_ENABLED='1' so "dormant until the supervised
        // live step" is mechanical, not aspirational: until the RUNBOOK step
        // applies migrations 012+013 and sets the env vars, production
        // behaves byte-identically pre-WP16 — no finder, no per-question
        // rerank spend, no path that can touch the not-yet-migrated tables.
        ...(process.env.ONBOARDING_ENABLED === '1'
          ? {
              tableFinder: buildOnboardingFinder({
                db: getDb(),
                userId,
                rerankClient: new AnthropicLlmClient(),
              }),
            }
          : {}),
      }),
    );
    // WP16 sub-part 2 (ADR 026, design §2): if the pipeline acknowledged an
    // onboarding fetch, the gate already fully refunded the 20-credit question
    // debit (net 0). Now do the MONEY for the fetch — the 100-credit debit +
    // queue row — atomically, OUTSIDE the answer module. This step never
    // fabricates: it only reads a refusal the pipeline already produced and
    // audited, and its own failure degrades to leaving the acknowledgment
    // shown with the fetch not started.
    const finalGated = await maybeTriggerOnboarding(gated, {
      userId,
      requestId,
      question,
    });
    return { gated: finalGated, context: await outcomeContext(finalGated) };
  } catch (error) {
    // Vercel function logs are the owner's only visibility into production
    // infra failures (WP12 review); the client still receives Next's generic
    // masked error, never these details. chargeAndRun has already
    // compensated the debit before this rethrow reaches here (ADR 020).
    console.error('askQuestion failed:', error);
    throw error;
  }
}

// WP16 sub-part 2 (ADR 026, design §2): the money orchestration for an
// on-demand fetch. Runs AFTER chargeAndRun so the question debit is already
// refunded (the acknowledgment is a refusal → gate refund → net 0), then
// charges the 100-credit onboarding cost and queues the fetch in ONE
// transaction (triggerOnboarding). Only fires on an 'ok' gated result whose
// response is the 'onboarding_pending' refusal carrying the structured
// onboarding envelope — every other gated shape (insufficient/duplicate/
// unauthenticated, or any non-onboarding response) passes through untouched.
async function maybeTriggerOnboarding(
  gated: GatedResponse,
  ctx: { userId: string; requestId: string; question: string },
): Promise<GatedResponse> {
  if (gated.kind !== 'ok') return gated;
  const response = gated.response;
  if (
    response.kind !== 'refusal' ||
    response.reason !== 'onboarding_pending' ||
    response.onboarding === null
  ) {
    // 'onboarding_already_pending' also lands here and passes through: the
    // pipeline already knew a fetch is in flight, so there is NO new debit —
    // the turn nets 0 (gate refunded the question debit), the acknowledgment
    // shows as-is. Asking twice must not cost twice (design §2/§5).
    return gated;
  }

  const result = await triggerOnboarding(getDb(), {
    userId: ctx.userId,
    requestId: ctx.requestId,
    questionText: ctx.question,
    tableId: response.onboarding.tableId,
    topicTerm: response.onboarding.topicTerm,
    finderConfidence: response.onboarding.confidence,
    ackAuditAnswerId: gated.auditId,
  });

  switch (result.kind) {
    case 'started':
      // #113 kick-on-trigger: the row just committed — fire the cron route so
      // the delivery re-run starts within minutes (the "kwestie van minuten"
      // promise), not at the daily 06:00 UTC backstop sweep. after() runs the
      // kick POST-RESPONSE, so it is strictly post-commit AND can never delay
      // or alter this returned GatedResponse; kickOnboardingJob is fail-soft
      // (it cannot throw), so a failed kick just degrades to the backstop.
      after(() => kickOnboardingJob());
      // Show the acknowledgment; the caption must read the 100-credit fetch
      // cost, not the refunded question turn's 0 (design §2/§5).
      return { ...gated, netCost: await onboardingPrice(getDb()) };
    case 'duplicate':
      // #113 kick-on-trigger: an active row already exists — a re-ask is the
      // natural user retry channel if an earlier kick failed, and the cron
      // route's claim logic makes a redundant kick a harmless {"claimed":0}.
      // Same post-response, fail-soft guarantees as 'started'.
      after(() => kickOnboardingJob());
      // A concurrent/retried trigger already debited (or an active job already
      // exists under another request): no second charge. Show the
      // acknowledgment again; the turn nets 0.
      return { ...gated, netCost: 0 };
    case 'insufficient':
      // Not enough credits for the fetch. Show the EXISTING insufficient-
      // credits UI with required: 100. The audited acknowledgment exists but
      // is not rendered (documented decision, design §2): nothing fabricated,
      // the fetch never started, and the ledger already nets 0 for the turn
      // (gate refunded the question debit; no onboarding debit happened).
      return { kind: 'insufficient_credits', balance: result.balance, required: result.required };
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
  // #112: same pre-gate load as askQuestion (read-only, fail-soft).
  const extraVocabulary = await onboardedVocabulary();
  try {
    const gated = await chargeAndRun(getDb(), userId, requestId, () =>
      answerClarificationReplyAudited(getDb(), safePending, reply, {
        referenceDate: referenceDate(),
        userId,
        sourceTag: 'user',
        requestId,
        intentClient: new AnthropicLlmClient(),
        answerClient: new AnthropicLlmClient(),
        // #112: the reply merge must accept the same onboarded keys the first
        // turn could have parsed into the pending's candidates — without this
        // the round dead-ends in an internal refusal (paid dead-end). Still
        // NO tableFinder here: a reply-turn onboarding trigger stays an
        // unmade decision.
        extraCanonicalMeasures: extraVocabulary,
      }),
    );
    return { gated, context: await outcomeContext(gated) };
  } catch (error) {
    console.error('replyToClarification failed:', error);
    throw error;
  }
}

// #14 (GDPR): self-service "Verwijder mijn vraaggeschiedenis" (WP14,
// docs/08-build-plan.md). THE CRITICAL SECURITY PIN: the user id scoping this
// delete comes ONLY from currentUserId()'s server-side, getClaims()-verified
// session — never from a client-supplied argument — so this action can only
// ever redact the CALLING user's own rows, by construction (there is no
// parameter here a caller could substitute another user's id into).
//
// Redacts rather than physically deletes (src/answer/audit/retention.ts):
// the ledger (credit_transactions) is NEVER touched, by construction (this
// function calls nothing in src/billing/); the owner-decided UX is a
// "verwijderde vraag" placeholder row that keeps its credit amount visible
// (web/components/question-history.tsx renders the redacted sentinel).
export async function deleteMyQuestionHistory(): Promise<{ deletedCount: number }> {
  const userId = await currentUserId();
  if (userId === null) {
    throw new Error('not authenticated');
  }
  const redacted = await deleteUserQuestionHistory(getDb(), userId);
  return { deletedCount: redacted.length };
}
