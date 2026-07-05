// Public surface of the WP6 intent-parsing step (ADR 001 module boundary:
// this lives in answer/, consuming the query module's frozen contract).
export { parseQuestion, buildIntentRequest } from './parse.ts';
export type { ParseQuestionOptions } from './parse.ts';
export {
  AnthropicIntentClient,
  RecordingIntentClient,
  ReplayIntentClient,
  INTENT_MODEL,
  requestHash,
  stableStringify,
} from './client.ts';
export type { IntentLlmClient, IntentLlmRequest, IntentLlmResponse, RecordedFixture } from './client.ts';
export { buildSystemPrompt, PROMPT_VERSION, AVAILABLE_GRAINS, REGIONAL_KEYS } from './prompt.ts';
export { rawParseSchema, rawParseJsonSchema, validateRawParse, CANONICAL_KEYS } from './schema.ts';
export { resolveCandidate, isResolutionFailure, STAND_START_OF_YEAR_KEYS, normalizeRegionName, parseReferenceDate, stepPeriodCode, daysInMonth, dateRangeToMonths } from './resolve.ts';
export type { CandidateResolution, DateRangeMonths } from './resolve.ts';
export { decide, mergeResolutions, differingAxes, buildUnmatchedClarification, resolveUnmatched, mergeExplicitPeriodEnumeration } from './policy.ts';
export type { OutcomeContext, ServabilityCheck, TableFinder, OnboardingRouting } from './policy.ts';
export * from './types.ts';
export {
  parseClarificationReply,
  buildClarifyRequest,
  buildClarifySystemPrompt,
  buildClarifyUserPayload,
  CLARIFY_PROMPT_VERSION,
  CLARIFY_MODE_SECTION,
  CLARIFY_CONTEXT_ADDENDUM,
} from './clarify.ts';
export type { ClarifyReplyOptions } from './clarify.ts';
export {
  parseFollowUpQuestion,
  buildFollowUpRequest,
  buildFollowUpSystemPrompt,
  buildFollowUpUserPayload,
  FOLLOWUP_PROMPT_VERSION,
  FOLLOWUP_MODE_SECTION,
} from './followup.ts';
export type { FollowUpOptions } from './followup.ts';
