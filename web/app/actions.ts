// The chat UI's only entry point into the backend (ADR 018 decision 3): a
// thin Server Action wrapper around the two audited functions. No business
// logic lives here — marshaling plus two infra guards (input-length bound,
// error logging), so a future Route Handler swap (for real stage-status
// streaming) stays confined to this one file.
'use server';

import { answerClarificationReplyAudited, answerQuestionAudited } from '../backend/answer/audit/index.ts';
import type { AuditedResponse } from '../backend/answer/audit/index.ts';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import type { PendingClarification } from '../backend/answer/respond/types.ts';
import { getDb } from '../lib/db.ts';

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

export async function askQuestion(question: string): Promise<AuditedResponse> {
  guardLength(question);
  try {
    return await answerQuestionAudited(getDb(), question, {
      referenceDate: referenceDate(),
      intentClient: new AnthropicLlmClient(),
      answerClient: new AnthropicLlmClient(),
    });
  } catch (error) {
    // Vercel function logs are the owner's only visibility into production
    // infra failures (WP12 review); the client still receives Next's generic
    // masked error, never these details.
    console.error('askQuestion failed:', error);
    throw error;
  }
}

export async function replyToClarification(
  pending: PendingClarification,
  reply: string,
): Promise<AuditedResponse> {
  guardLength(reply);
  try {
    return await answerClarificationReplyAudited(getDb(), pending, reply, {
      referenceDate: referenceDate(),
      intentClient: new AnthropicLlmClient(),
      answerClient: new AnthropicLlmClient(),
    });
  } catch (error) {
    console.error('replyToClarification failed:', error);
    throw error;
  }
}
