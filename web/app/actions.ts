// The chat UI's only entry point into the backend (ADR 018 decision 3): a
// thin Server Action wrapper around the two audited functions. No business
// logic lives here — marshaling only, so a future Route Handler swap (for
// real stage-status streaming) stays confined to this one file.
'use server';

import { answerClarificationReplyAudited, answerQuestionAudited } from '../../src/answer/audit/index.ts';
import type { AuditedResponse } from '../../src/answer/audit/index.ts';
import { AnthropicLlmClient } from '../../src/answer/llm/client.ts';
import type { PendingClarification } from '../../src/answer/respond/types.ts';
import { getDb } from '../lib/db.ts';

// The one legitimate un-pinned clock in the codebase — every other call site
// (tests, hermetic CI, the benchmark runner) injects a fixed reference date.
function referenceDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function askQuestion(question: string): Promise<AuditedResponse> {
  return answerQuestionAudited(getDb(), question, {
    referenceDate: referenceDate(),
    intentClient: new AnthropicLlmClient(),
    answerClient: new AnthropicLlmClient(),
  });
}

export async function replyToClarification(
  pending: PendingClarification,
  reply: string,
): Promise<AuditedResponse> {
  return answerClarificationReplyAudited(getDb(), pending, reply, {
    referenceDate: referenceDate(),
    intentClient: new AnthropicLlmClient(),
    answerClient: new AnthropicLlmClient(),
  });
}
