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
export { resolveCandidate, isResolutionFailure, STAND_START_OF_YEAR_KEYS, normalizeRegionName, parseReferenceDate } from './resolve.ts';
export type { CandidateResolution } from './resolve.ts';
export { decide, mergeResolutions, differingAxes, buildUnmatchedClarification } from './policy.ts';
export type { OutcomeContext } from './policy.ts';
export * from './types.ts';
