// Stage-2 rerank caller (WP16 sub-part 1): wraps the shared LLM harness to turn
// a topic + recall shortlist into a validated, allowlist-checked pick. The
// model does a schema-constrained multiple-choice over a supplied list — the
// same narrow role as intent parsing, and an easier shape (closed choice vs.
// open extraction). So it runs on the small/fast tier, NOT Fable.
import type { LlmClient, LlmRequest } from '../answer/llm/client.ts';
import { buildRerankSystemPrompt, serializeShortlist } from './rerank-prompt.ts';
import { rerankJsonSchema, validateRerankOutput } from './rerank-schema.ts';
import type { CatalogCandidate, RerankResult } from './types.ts';

/**
 * Small/fast tier, same as INTENT_MODEL (ADR 004 "model per task" + the
 * delegation cost-tier rule). The principle-(c) risk of a wrong table is
 * contained STRUCTURALLY — the hard allowlist (never invent an id), a
 * conservative confidence threshold, multi-candidate disclosure, and the
 * downstream verification gate — not by model size. Escalation ladder
 * Haiku → Sonnet → Fable is a one-line change here, triggered ONLY by a
 * MEASURED accuracy miss within a good shortlist (a quality miss, not a safety
 * breach); Fable is not justified for v1 (ADR 025).
 */
export const TABLE_RERANK_MODEL = 'claude-haiku-4-5';

export interface RerankOptions {
  client: LlmClient;
  model?: string;
  maxTokens?: number;
}

export function buildRerankRequest(
  topic: string,
  shortlist: CatalogCandidate[],
  options: Pick<RerankOptions, 'model' | 'maxTokens'> = {},
): LlmRequest {
  return {
    model: options.model ?? TABLE_RERANK_MODEL,
    // Headroom over the small JSON output (id + confidence + a short Dutch
    // reading + ≤3 alt ids). A max_tokens stop throws in the harness → the
    // orchestrator routes it to disclosure (fail-safe, never a fabrication),
    // but 512 was a tighter margin than any sibling caller; 1024 avoids
    // degrading a confident pick to disclosure on a verbose reading.
    maxTokens: options.maxTokens ?? 1024,
    temperature: 0,
    system: buildRerankSystemPrompt(),
    question: serializeShortlist(topic, shortlist),
    jsonSchema: rerankJsonSchema(),
  };
}

/**
 * Stage 2: pick the best table from a (non-empty) shortlist. Throws
 * RerankValidationError on malformed or off-allowlist output — the orchestrator
 * catches it and falls back to disclosure, so a rerank failure is never a wrong
 * table (principle c).
 */
export async function rerankShortlist(
  topic: string,
  shortlist: CatalogCandidate[],
  options: RerankOptions,
): Promise<RerankResult> {
  const request = buildRerankRequest(topic, shortlist, options);
  const response = await options.client.complete(request);
  return validateRerankOutput(
    response.outputText,
    shortlist.map((c) => c.tableId),
  );
}
