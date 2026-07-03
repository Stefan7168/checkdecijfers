// The intent parser's LLM seam (ADR 012). Since WP7 the implementation lives
// in the SHARED harness (src/answer/llm/client.ts — one seam, two fixture
// sets); this file keeps the WP6 names so the intent module and its committed
// fixtures are untouched. The intent request shape serializes byte-identically
// to pre-WP7, so every recorded fixture hash still resolves.
export {
  AnthropicLlmClient as AnthropicIntentClient,
  ReplayLlmClient as ReplayIntentClient,
  RecordingLlmClient as RecordingIntentClient,
  requestHash,
  stableStringify,
} from '../llm/client.ts';
export type {
  LlmClient as IntentLlmClient,
  LlmRequest as IntentLlmRequest,
  LlmResponse as IntentLlmResponse,
  RecordedFixture,
} from '../llm/client.ts';

/** Small/fast tier for intent parsing per ADR 004 ("model per task"); the
 * concrete ID is an implementation-time choice, revisited via ADR 004's
 * triggers (benchmark accuracy, deprecation). */
export const INTENT_MODEL = 'claude-haiku-4-5';
