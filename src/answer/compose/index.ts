// Public surface of the WP7 answer-composition step (ADR 001 module boundary:
// consumes the query module's ValidatedResult, produces the ComposedAnswer
// the UI renders and WP10 audits).
export { composeAnswer } from './compose.ts';
export type { ComposeOptions } from './compose.ts';
export {
  buildPhrasingPayload,
  buildPhrasingRequest,
  buildComposeSystemPrompt,
  COMPOSE_PROMPT_VERSION,
  PHRASING_MODEL,
} from './prompt.ts';
export type { PhrasingPayload, PhrasingRequestOptions } from './prompt.ts';
export { applyUnitExpansions } from './expand.ts';
export { renderTemplateBody, displayValueUnit, nullReasonText } from './template.ts';
export { validateAnswerBody, scanBody, splitSentences, baseRegionLabel } from './validate.ts';
export type { ClassifiedToken, TokenKind } from './validate.ts';
export { formatValueNl, parseNlNumber, findNumericTokens, maskPhrases, unitMaskPhrases } from './format.ts';
export {
  buildSemanticCheckPayload,
  buildSemanticCheckRequest,
  buildSemanticCheckSystemPrompt,
  findSuspectTokens,
  runSemanticCheck,
  semanticCheckJsonSchema,
  validateSemanticCheckOutput,
  SEMANTIC_CHECK_MODEL,
  SEMANTIC_CHECK_PROMPT_VERSION,
  SemanticCheckValidationError,
} from './semantic-check.ts';
export type { SemanticCheckOptions, SemanticCheckOutcome, SemanticCheckPayload } from './semantic-check.ts';
export * from './types.ts';
