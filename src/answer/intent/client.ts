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
// Haiku parses; SONNET WRITES. Owner question 2026-07-26 ("the model people's
// questions use is Haiku, change it to Sonnet 5") — the premise is half right,
// so the answer lives next to the constant it is about: the user-facing answer
// TEXT is already composed by claude-sonnet-5 (PHRASING_MODEL, compose/prompt.ts).
// This model only turns a question into REGISTRY VOCABULARY — it never sees a
// cell value and never writes prose (ADR 012). Owner decision on hearing that:
// leave it. Escalating THIS one is open question #172, not a config edit — it
// needs thinking:'disabled' instead of temperature:0, a re-calibration of the
// 0.8 confidence floor (Sonnet's distribution overlaps must-confident with
// should-disclose), and a #164 re-record of ~93 fixtures.
export const INTENT_MODEL = 'claude-haiku-4-5';
