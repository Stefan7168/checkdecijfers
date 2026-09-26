// ADR 058 (English answers, Task 8): the web-layer gate for the English
// rendering — dormant until ENGLISH_ANSWERS_ENABLED='1' AND the reader is on
// English, the SAME ONBOARDING_ENABLED/WEBSEARCH_ENABLED dormancy pattern
// web/app/actions.ts already uses for every other flagged feature (see
// semanticCheckOptions/clickOptionsEnabled there). Kept OUT of actions.ts
// itself: that file is 'use server', and every one of its exports must be an
// async Server Action — a plain synchronous export (needed here so tests can
// call it directly without an await) would break the build.
//
// Absent flag or a Dutch reader ⇒ `{}`, spread into the audited options bag —
// `answerQuestionAudited`/`answerClarificationReplyAudited` then run the
// EXACT byte-identical Dutch path they always have (Task 7's A1 discipline).
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import type { LlmClient } from '../backend/answer/llm/client.ts';
import type { Lang } from './i18n/messages.ts';

export function englishAnswerOptions(lang: Lang): { lang?: 'en'; translateClient?: LlmClient } {
  if (process.env.ENGLISH_ANSWERS_ENABLED === '1' && lang === 'en') {
    return { lang: 'en', translateClient: new AnthropicLlmClient() };
  }
  return {};
}
