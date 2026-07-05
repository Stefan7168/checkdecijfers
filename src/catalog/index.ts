// CBS-catalog table discovery (WP16 sub-part 1). Public surface: the catalog
// mirror ingest, Stage-1 recall, Stage-2 rerank, and the findTable orchestrator.
export { ingestCatalog, type CatalogIngestResult } from './ingest.ts';
export { recallCandidates, RECALL_LIMIT, type RecallOptions } from './recall.ts';
export {
  ALIAS_HINTS,
  expandTopicTerms,
  type AliasHint,
} from './aliases.ts';
export {
  rerankShortlist,
  buildRerankRequest,
  TABLE_RERANK_MODEL,
  type RerankOptions,
} from './rerank.ts';
export {
  rerankJsonSchema,
  validateRerankOutput,
  RerankValidationError,
  RERANK_SCHEMA_VERSION,
} from './rerank-schema.ts';
export {
  buildRerankSystemPrompt,
  serializeShortlist,
  RERANK_PROMPT_VERSION,
} from './rerank-prompt.ts';
export { findTable, DISCLOSE_LIMIT, type FindTableOptions } from './find.ts';
export {
  DEFAULT_FIND_TABLE_CONFIG,
  type CatalogCandidate,
  type RerankResult,
  type RerankFn,
  type FindTableConfig,
  type FindTableOutcome,
} from './types.ts';
