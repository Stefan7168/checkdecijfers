// Public surface of the WP9 respond module (ADR 001 module boundary): the
// full pipeline orchestrator (answer/clarification/refusal), the refusal
// builders, and the staleness check — everything downstream (a future UI
// layer, WP10 audit) consumes ComposedResponse and these entry points.
export {
  respondToQuestion,
  respondToClarificationReply,
  respondToIntent,
  CLICK_TAKE_MODEL,
} from './respond.ts';
export type { RespondOptions } from './respond.ts';
export {
  buildParseRefusal,
  buildQueryRefusal,
  buildStillAmbiguousRefusal,
  buildNoSourcesRefusal,
  buildWebOnlyRefusal,
  toRefusalResponse,
  toClarificationResponse,
  toInternalRefusal,
} from './refusals.ts';
export type { BuiltRefusal, QueryRefusalOutcome } from './refusals.ts';
export { META_TEMPLATES, matchMetaTemplate, normalizeMetaQuestion } from './meta.ts';
export type { MetaTemplate, MetaTemplateKey, MetaBodyContext } from './meta.ts';
export { maxAgeDaysForCadence, checkStaleness } from './staleness.ts';
export type { StalenessCheck } from './staleness.ts';
export { periodCodeToNl } from './period-nl.ts';
export { buildAnswerChips, buildRefusalSuggestions, buildSuggestions, MAX_SUGGESTIONS } from './suggestions.ts';
export type { AnswerChips } from './suggestions.ts';
// WP26 mechanism A (ADR 024): the client-held click-option trust boundary.
export { validateClickOptions, withValidatedClickOptions } from './validate-pending.ts';
export * from './types.ts';
