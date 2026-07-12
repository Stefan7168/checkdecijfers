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
  FEEDBACK_TEXT_MAX_LENGTH,
  upsertAnswerFeedback,
} from '../backend/answer/audit/index.ts';
import { buildConversationContext, validateConversationContext } from '../backend/answer/context/index.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import type { PendingClarification } from '../backend/answer/respond/types.ts';
import {
  chargeAndRun,
  compensate,
  getActionClassPrice,
  getBalance,
  reserveWebSearchDebit,
} from '../backend/billing/index.ts';
import type { GatedResponse, LedgerEntry } from '../backend/billing/index.ts';
// WP129+130 (#130, ADR 032): the Anthropic web-search client is constructed
// HERE (server-only) and injected into the audited pipeline — the barrel is
// the intended construction seam (its own comment says so). SourceSelection is
// the validated structural payload; SOURCES gives the known registry keys the
// untrusted client payload is filtered against.
import { AnthropicWebSearchClient } from '../backend/websearch/index.ts';
import type { SourceSelection } from '../backend/websearch/index.ts';
import { SOURCES } from '../backend/sources/registry.ts';
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

// WP129+130 (#129, ADR 032): the source-tags selection is UNTRUSTED client
// input (a Server Action argument — attacker-controlled, like every other one
// here). It is coerced to a SourceSelection BEFORE the billing gate and NEVER
// throws: any malformed shape degrades to `undefined` (the legacy no-selection
// behavior, byte-identical to a pre-WP submit). `sources` is filtered to KNOWN
// registry keys (Object.keys(SOURCES)) — an unknown key is dropped, never
// trusted; `web` is coerced to a strict boolean. When WEBSEARCH_ENABLED !== '1'
// the whole selection is FORCED to undefined (the server belt behind the
// dormant UI): a crafted payload cannot reach the web path while the feature is
// dormant, so `selection?.web === true` anywhere below already implies the flag
// is on.
function validateSelection(raw: unknown): SourceSelection | undefined {
  if (process.env.WEBSEARCH_ENABLED !== '1') return undefined;
  if (raw === null || typeof raw !== 'object') return undefined;
  const obj = raw as { sources?: unknown; web?: unknown };
  if (!Array.isArray(obj.sources)) return undefined;
  const known = new Set(Object.keys(SOURCES));
  const sources = obj.sources.filter((s): s is string => typeof s === 'string' && known.has(s));
  return { sources, web: obj.web === true };
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
  rawSelection?: unknown,
): Promise<AskOutcome> {
  guardLength(question);
  const userId = await currentUserId();
  if (userId === null) {
    return { gated: { kind: 'unauthenticated' }, context: null };
  }
  const conversationContext = await validateConversationContext(getDb(), rawContext ?? null);
  // WP129+130 (#129, ADR 032): validate the untrusted selection payload BEFORE
  // the gate (never throws; forced undefined while the flag is off).
  const selection = validateSelection(rawSelection);
  // ⟨W4⟩ Upfront affordability (UX only, race-tolerated): a web-opted turn
  // transiently needs simple + web_addon = 30 in BOTH modes — the untouched
  // gate holds the base 20 before the pipeline, and the web reserve of 10
  // happens INSIDE it, before the refund posts, so 30 must be AVAILABLE even
  // though web-only NETS 10. (`selection?.web === true` implies the flag is on
  // — validateSelection forces undefined otherwise.) The race with the gate is
  // tolerated by the reserve closure's honest skip (insufficient_balance
  // section, no charge).
  const webAddonPrice = selection?.web === true ? await getActionClassPrice(getDb(), 'web_addon') : 0;
  if (selection?.web === true) {
    const simplePrice = await getActionClassPrice(getDb(), 'simple');
    const required = simplePrice + webAddonPrice;
    const balance = await getBalance(getDb(), userId);
    if (balance < required) {
      return { gated: { kind: 'insufficient_credits', balance, required }, context: null };
    }
  }
  // #112: loaded BEFORE the billing gate — the load is read-only and must
  // never run (or fail) inside the charged section.
  const extraVocabulary = await onboardedVocabulary();
  // WP129+130 (#130, ADR 032): the taken web debit lives in this holder so the
  // settlement (and the catch) below can keep-or-refund it. The reserve()
  // closure sets it INSIDE the pipeline (debit-before-spend).
  const webDebitHolder: { entry: LedgerEntry | null } = { entry: null };
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
        // WP129+130 (#129, ADR 032): the validated selection rides the audited
        // options as a STRUCTURAL input (never prompt text) — respond* uses it
        // for the web-only / no-sources pre-parse belt, and attach uses it to
        // decide whether a web attempt is owed. Absent ⇒ byte-identical.
        ...(selection !== undefined ? { sourceSelection: selection } : {}),
        // WP129+130 (#130, ADR 032): the web client + reserve() closure are
        // constructed ONLY when WEBSEARCH_ENABLED='1' AND the Internet chip is
        // selected — the ONBOARDING_ENABLED dormancy pattern: until the RUNBOOK
        // go-live sets the flag + applies migration 018, no path constructs the
        // Anthropic web client or touches the websearch_cost ledger row, so
        // production behaves byte-identically pre-WP129+130. The closure debits
        // INSIDE the pipeline (debit-before-spend) and stashes the taken entry
        // in webDebitHolder for the settlement below.
        ...(process.env.WEBSEARCH_ENABLED === '1' && selection?.web === true
          ? {
              webClient: new AnthropicWebSearchClient(),
              webBilling: {
                reserve: async (): Promise<boolean> => {
                  const reserved = await reserveWebSearchDebit(getDb(), userId, requestId, webAddonPrice);
                  if (reserved.kind === 'debited') {
                    webDebitHolder.entry = reserved.entry;
                    return true;
                  }
                  // insufficient (a race the upfront check tolerates) or
                  // duplicate (unreachable — the base gate short-circuits a
                  // duplicate requestId before run() executes): honest skip.
                  return false;
                },
              },
            }
          : {}),
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
    // ⟨W3⟩ Web add-on settlement on the FINAL gated object (post-onboarding) —
    // keep the +10 iff a cited web section shipped on an audited 'ok' turn,
    // else refund the taken debit (a no-op when none was taken).
    const settled = await settleWebAddon(finalGated, webDebitHolder.entry, webAddonPrice, userId);
    return { gated: settled, context: await outcomeContext(settled) };
  } catch (error) {
    // WP129+130 (ADR 032): a web debit taken before the pipeline threw is
    // compensated here (the base question debit is already compensated inside
    // chargeAndRun before this rethrow reaches us — ADR 020). Then rethrow.
    if (webDebitHolder.entry !== null) {
      await compensate(getDb(), userId, webDebitHolder.entry.id, webAddonPrice, null);
    }
    // Vercel function logs are the owner's only visibility into production
    // infra failures (WP12 review); the client still receives Next's generic
    // masked error, never these details.
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
    // WP27 stage B: the candidate chain rides the envelope into the trigger —
    // the last in-memory link before pending_table_requests.candidate_ids.
    candidateIds: response.onboarding.candidateIds,
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
      // route's claim logic makes a redundant kick harmless (its summary then
      // reports "processed": null — the route returns OnboardingJobSummary,
      // not a "claimed" count; comment fixed in the session-30 review).
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

// ⟨W3⟩/⟨W1⟩ (WP129+130, ADR 032): the web add-on settlement. Runs AFTER the
// pipeline (and, for askQuestion, AFTER maybeTriggerOnboarding) on the FINAL
// gated object. The +10 add-on is KEPT iff a web section with >= 1 cited
// finding was actually DELIVERED on an AUDITED 'ok' turn:
//   finalGated.kind === 'ok'
//   && finalGated.response.webSection?.status === 'ok'
//   && finalGated.auditId !== null   (the ⟨W1⟩ belt — a refusal shipped
//                                     UNRECORDED by persistOrFailClosed's
//                                     fail-closed branch has auditId null and
//                                     its webSection stripped; paid, unverified
//                                     web content must never be kept unrecorded)
// then netCost gains the add-on price. EVERY other shape with a TAKEN web debit
// ⇒ compensate() the debit — the money invariant: netCost mirrors the
// compensation actually applied, never drifting from the append-only ledger.
// (With the ⟨W3⟩ skip-list an onboarding turn can no longer carry a web debit,
// but the rule is stated generally so it stays correct if that ever changes.)
// A null holder (no web debit taken) ⇒ nothing to settle.
async function settleWebAddon(
  finalGated: GatedResponse,
  webDebit: LedgerEntry | null,
  price: number,
  userId: string,
): Promise<GatedResponse> {
  if (webDebit === null) return finalGated;
  const keep =
    finalGated.kind === 'ok' &&
    finalGated.response.webSection?.status === 'ok' &&
    finalGated.auditId !== null;
  if (keep) {
    return { ...finalGated, netCost: finalGated.netCost + price };
  }
  const auditId = finalGated.kind === 'ok' ? finalGated.auditId : null;
  await compensate(getDb(), userId, webDebit.id, price, auditId);
  return finalGated;
}

export async function replyToClarification(
  pending: PendingClarification,
  reply: string,
  requestId: string,
  rawSelection?: unknown,
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
  // WP129+130 (#129, ADR 032): same untrusted-selection validation + ⟨W4⟩
  // upfront affordability (30 in both web modes) as askQuestion. A reply turn
  // that resolves to an ANSWER or a data-shaped refusal owes the web attempt
  // and charges the +10 (a clarification outcome here means still-ambiguous →
  // refusal, so the round is over — attach's own kind-check handles the skip).
  const selection = validateSelection(rawSelection);
  const webAddonPrice = selection?.web === true ? await getActionClassPrice(getDb(), 'web_addon') : 0;
  if (selection?.web === true) {
    const simplePrice = await getActionClassPrice(getDb(), 'simple');
    const required = simplePrice + webAddonPrice;
    const balance = await getBalance(getDb(), userId);
    if (balance < required) {
      return { gated: { kind: 'insufficient_credits', balance, required }, context: null };
    }
  }
  // #112: same pre-gate load as askQuestion (read-only, fail-soft).
  const extraVocabulary = await onboardedVocabulary();
  const webDebitHolder: { entry: LedgerEntry | null } = { entry: null };
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
        // WP129+130 (#129/#130, ADR 032): the validated selection + web wiring,
        // identical to askQuestion (the reply turn carries the same chips and
        // charges the +10 if it answers/refuses with data). Absent ⇒ byte-
        // identical to today.
        ...(selection !== undefined ? { sourceSelection: selection } : {}),
        ...(process.env.WEBSEARCH_ENABLED === '1' && selection?.web === true
          ? {
              webClient: new AnthropicWebSearchClient(),
              webBilling: {
                reserve: async (): Promise<boolean> => {
                  const reserved = await reserveWebSearchDebit(getDb(), userId, requestId, webAddonPrice);
                  if (reserved.kind === 'debited') {
                    webDebitHolder.entry = reserved.entry;
                    return true;
                  }
                  return false;
                },
              },
            }
          : {}),
      }),
    );
    // ⟨W3⟩ Settlement — no maybeTriggerOnboarding on the reply path (no finder),
    // so the gated object IS final; keep-or-refund the add-on the same way.
    const settled = await settleWebAddon(gated, webDebitHolder.entry, webAddonPrice, userId);
    return { gated: settled, context: await outcomeContext(settled) };
  } catch (error) {
    // WP129+130 (ADR 032): compensate a taken web debit before rethrowing (the
    // base debit is already compensated inside chargeAndRun — ADR 020).
    if (webDebitHolder.entry !== null) {
      await compensate(getDb(), userId, webDebitHolder.entry.id, webAddonPrice, null);
    }
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

// WP128 (#128): 👍/👎 on an answer + optional free text on 👎. FAIL-SOFT
// EVERYWHERE — deliberately UNLIKE deleteMyQuestionHistory above (which
// throws on unauth): feedback must never break or block anything, so the
// ENTIRE body sits in one try/catch and every path (unauthenticated,
// malformed/attacker-controlled input, db error incl. the missing table in
// the pre-migration-017 deploy window, ownership miss) returns { ok: false }.
// Free feature: no billing gate, no charged entry point — this function
// calls no billing function. The ownership + kind + source_tag guard lives
// in the insert statement itself (src/answer/audit/feedback.ts): feedback
// can only attach to the CALLING user's own user-tagged answer rows.
export async function submitAnswerFeedback(
  auditId: number,
  verdict: 'up' | 'down',
  feedbackText?: string,
): Promise<{ ok: boolean }> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    // Server Action arguments are attacker-controlled — validate as unknown.
    if (verdict !== 'up' && verdict !== 'down') return { ok: false };
    if (typeof auditId !== 'number' || !Number.isSafeInteger(auditId) || auditId <= 0) {
      return { ok: false };
    }
    if (
      feedbackText !== undefined &&
      (typeof feedbackText !== 'string' || feedbackText.length > FEEDBACK_TEXT_MAX_LENGTH)
    ) {
      return { ok: false };
    }
    const ok = await upsertAnswerFeedback(getDb(), {
      auditAnswerId: auditId,
      userId,
      verdict,
      feedbackText: feedbackText ?? null,
    });
    return { ok };
  } catch (err) {
    console.error('answer feedback write failed', err);
    return { ok: false };
  }
}
