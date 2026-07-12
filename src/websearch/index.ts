// Public surface of the WP129+130 web-search augmentation module (ADR 001
// module boundary, ADR 032). web/app/actions.ts constructs the client from
// here. NB src/answer/respond/types.ts and src/answer/audit/reconstruct.ts
// import the PURE LEAF (./types.ts) and ./attach.ts DIRECTLY, never this
// barrel — so the Anthropic SDK (client.ts) never enters the response-envelope
// / client-bundle module graph (the src/billing/index.ts Turbopack lesson).
export type { WebFinding, WebSection, SourceSelection } from './types.ts';
export { WEBSEARCH_SKIP_REASONS } from './types.ts';
export {
  AnthropicWebSearchClient,
  WEBSEARCH_MODEL,
  WEBSEARCH_MAX_USES,
  WEBSEARCH_TIMEOUT_MS,
  WEBSEARCH_MAX_TOKENS,
} from './client.ts';
export type { WebSearchClient } from './client.ts';
export { WEBSEARCH_PROMPT, WEBSEARCH_PROMPT_VERSION } from './prompt.ts';
export { attachWebAugmentation } from './attach.ts';
export type { WebBilling, AttachWebAugmentationOptions } from './attach.ts';
