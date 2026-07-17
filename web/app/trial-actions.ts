// The #53 anonymous-trial Server Action (ADR 036) — deliberately its OWN
// action, never a bypass of askQuestion's auth gate (actions.ts:283 stays
// exactly as strict as it is). Differences from the paid path, all
// owner-decided (session 51) or ADR-036 design:
//
//   - Identity: the D1 visitor cookie (set here on first use) — no account.
//   - Money: the trial POT (src/billing/trial-pot.ts, questions not credits)
//     + every LLM client below runs on the SEPARATE capped trial API key via
//     the existing AnthropicLlmClient(sdk) constructor seam — zero prompt-
//     byte changes, zero main-budget exposure.
//   - Scope: core answer loop only. No web-search, no WP16 onboarding
//     finder, no threads, no clarification REPLY round (v1: a clarification
//     response renders with a "maak een gratis account" nudge — an
//     unmetered anonymous reply endpoint would be a free-LLM abuse surface,
//     ADR 036 D5).
//   - Pot semantics: every SERVED response (answer, clarification, refusal)
//     consumes the trial question — "2 proefvragen" = 2 served responses.
//     Refund ONLY when the pipeline throws before anything was shown (the
//     gate.ts compensation mirror). Refunding refusals would let deliberately
//     unanswerable questions burn the trial key for free, uncounted.
//   - R8: the audit row is written exactly like a paid turn (inside
//     answerQuestionAudited), with userId null + sourceTag 'anonymous_trial'
//     (migration 020); the trial_questions row links to it post-hoc.
'use server';

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

import { answerQuestionAudited } from '../backend/answer/audit/index.ts';
import type { SemanticCheckOptions } from '../backend/answer/compose/index.ts';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import {
  attachTrialAudit,
  refundTrialQuestion,
  takeTrialQuestion,
} from '../backend/billing/index.ts';
import { getDb } from '../lib/db.ts';
import {
  hashedRequestIp,
  readTrialVisitorId,
  TRIAL_COOKIE,
  TRIAL_COOKIE_MAX_AGE_S,
  trialConfigured,
} from '../lib/trial.ts';

// Mirrors actions.ts's guardLength/referenceDate exactly; duplicated (small,
// two lines each) rather than exported from the paid action file — importing
// from a 'use server' module would register ITS actions under this module
// too, and these guards are infra, not shared business logic.
const MAX_INPUT_LENGTH = 2000;

function referenceDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function trialClient(): AnthropicLlmClient {
  // The outer belt (ADR 036 D3): every trial LLM call authenticates with the
  // separate hard-capped key — the SDK instance is the ONLY thing that
  // differs from the paid path's clients.
  return new AnthropicLlmClient(new Anthropic({ apiKey: process.env.ANTHROPIC_TRIAL_API_KEY }));
}

// The #144 semantic checker rides along on trial turns when it is live —
// same dormancy flag as the paid path (actions.ts semanticCheckOptions), but
// its checker client ALSO runs on the trial key: ALL trial spend stays
// inside the trial belt, including defense-in-depth calls.
function trialSemanticCheckOptions(): { semanticCheck: SemanticCheckOptions } | Record<string, never> {
  if (process.env.SEMANTIC_CHECK_ENABLED !== '1') return {};
  return {
    semanticCheck: {
      client: trialClient(),
      mode: process.env.SEMANTIC_CHECK_FAILMODE === 'closed' ? 'fail_closed' : 'fail_open',
    },
  };
}

export type TrialAskOutcome =
  | { kind: 'ok'; response: ComposedResponse; questionsLeft: number }
  /** dormant / pot empty / ip backstop: the UI degrades to the login prompt. */
  | { kind: 'closed'; reason: 'dormant' | 'pot_empty' | 'ip_limit' }
  /** This visitor's own 2-question budget is spent. */
  | { kind: 'used_up' }
  | { kind: 'duplicate_request' };

export async function askTrialQuestion(question: string, requestId: string): Promise<TrialAskOutcome> {
  if (question.length > MAX_INPUT_LENGTH) {
    throw new Error(`input rejected: ${question.length} chars exceeds ${MAX_INPUT_LENGTH}`);
  }
  if (!trialConfigured()) return { kind: 'closed', reason: 'dormant' };
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 100) {
    throw new Error('input rejected: malformed requestId');
  }

  const db = getDb();
  // First use mints the visitor id and sets the functional cookie (D1);
  // returning visitors present theirs (garbage values already coerced to
  // null by readTrialVisitorId — never trusted into SQL).
  let visitorId = await readTrialVisitorId();
  if (visitorId === null) {
    visitorId = randomUUID();
    const jar = await cookies();
    jar.set(TRIAL_COOKIE, visitorId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: TRIAL_COOKIE_MAX_AGE_S,
      path: '/',
    });
  }
  const ipHash = await hashedRequestIp();

  // Check-BEFORE-serve (owner decision): the atomic take precedes any LLM
  // work; a rejected take has cost nothing and drained nothing.
  const take = await takeTrialQuestion(db, visitorId, ipHash, requestId);
  if (take.kind === 'pot_empty') return { kind: 'closed', reason: 'pot_empty' };
  if (take.kind === 'ip_limit') return { kind: 'closed', reason: 'ip_limit' };
  if (take.kind === 'visitor_limit') return { kind: 'used_up' };
  if (take.kind === 'duplicate_request') return { kind: 'duplicate_request' };

  try {
    const audited = await answerQuestionAudited(db, question, {
      referenceDate: referenceDate(),
      userId: null,
      sourceTag: 'anonymous_trial',
      requestId,
      conversationContext: null,
      intentClient: trialClient(),
      answerClient: trialClient(),
      ...trialSemanticCheckOptions(),
      // Deliberately absent: extraCanonicalMeasures / sourceSelection /
      // webClient / webBilling / tableFinder — the trial serves the Phase-0
      // core loop only (ADR 036 D5); every absent option keeps that path
      // byte-identical to the calibrated pipeline.
    });
    // Post-hoc link from the pot bookkeeping to the audit row — genuinely
    // fail-soft (adversarial-review finding, session 52: inside the outer
    // try, a throwing UPDATE would discard an already-served answer AND
    // wrongly refund a served question): its failure only costs the link,
    // never the answer. questionsLeft comes from the take itself (computed
    // in-transaction), so no post-serve read can fail here either.
    if (audited.auditId !== null) {
      try {
        await attachTrialAudit(db, take.trialQuestionId, audited.auditId);
      } catch (err) {
        console.warn('[trial] audit link failed (answer served, link missing):', err);
      }
    }
    return { kind: 'ok', response: audited.response, questionsLeft: take.questionsLeft };
  } catch (error) {
    // Nothing was shown: give the pot (and the visitor's budget) the
    // question back — the gate.ts compensation mirror, idempotent.
    await refundTrialQuestion(db, take.trialQuestionId);
    console.error('askTrialQuestion failed:', error);
    throw error;
  }
}
