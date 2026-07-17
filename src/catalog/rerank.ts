// Stage-2 rerank caller (WP16 sub-part 1): wraps the shared LLM harness to turn
// a topic + recall shortlist into a validated, allowlist-checked pick. The
// model does a schema-constrained multiple-choice over a supplied list — the
// same narrow role as intent parsing, and an easier shape (closed choice vs.
// open extraction). So it runs on the small/fast tier, NOT Fable.
import type { LlmClient, LlmRequest } from '../answer/llm/client.ts';
import { buildRerankSystemPrompt, serializeShortlist } from './rerank-prompt.ts';
import { rerankJsonSchema, validateRerankOutput } from './rerank-schema.ts';
import type { CatalogCandidate, FindTableQuery, RerankResult } from './types.ts';

/**
 * The principle-(c) risk of a wrong table is contained STRUCTURALLY — the
 * hard allowlist (never invent an id), a conservative confidence threshold,
 * multi-candidate disclosure, and the downstream verification gate — not by
 * model size. Escalation ladder Haiku → Sonnet → Fable is a one-line change
 * here, triggered ONLY by a MEASURED accuracy miss within a good shortlist
 * (a quality miss, not a safety breach); Fable is not justified (ADR 025).
 *
 * ▶ ESCALATION ATTEMPTED AND REVERTED (session 54, 2026-07-18 — the ladder's
 * trigger fired, the step was measured, the measurement said no-for-now):
 * Haiku stably (4/4 records, byte-identical prompt to the s31/s50 era)
 * dropped the only v1-DELIVERABLE table 37789ksz from the bijstand-stock
 * candidate chain — a real quality regression within a good shortlist
 * (upstream model drift, NOT caused by the coverage batch; tracked as
 * open-questions #172). The Sonnet step was then measured properly: after
 * fixing the params (Sonnet 5 rejects temperature 0 — see buildRerankRequest)
 * its chains are RICHER (37789ksz back in the bijstand alternatives) but its
 * confidence distribution is MUDDY against the Haiku-calibrated 0.8 floor:
 * correct must-confident picks land at 0.60-0.88 (huizenprijzen 0.60)
 * OVERLAPPING should-disclose picks (zonnepanelen runner-up 0.62,
 * bijstand-stock 0.60) — no clean threshold exists, so adopting Sonnet
 * requires model+threshold CO-calibration (its own supervised work package,
 * #172), not a one-line swap. Reverted to the proven Haiku config verbatim.
 */
export const TABLE_RERANK_MODEL = 'claude-haiku-4-5';

export interface RerankOptions {
  client: LlmClient;
  model?: string;
  maxTokens?: number;
}

export function buildRerankRequest(
  query: FindTableQuery,
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
    // Haiku parses deterministically at temperature 0 (the proven config).
    // ⚠ For a future Sonnet escalation (#172): Sonnet 5 REJECTS temperature 0
    // and runs adaptive thinking unless disabled — swap this line for
    // `thinking: 'disabled'` like the compose caller (src/answer/compose/
    // prompt.ts). The un-adapted param was the silent killer of the first
    // s54 escalation attempt: every rerank call API-errored and the fail-safe
    // disclosed 9/11 before anyone saw a model answer.
    temperature: 0,
    system: buildRerankSystemPrompt(),
    question: serializeShortlist(query, shortlist),
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
  query: FindTableQuery,
  shortlist: CatalogCandidate[],
  options: RerankOptions,
): Promise<RerankResult> {
  const request = buildRerankRequest(query, shortlist, options);
  const response = await options.client.complete(request);
  return validateRerankOutput(
    response.outputText,
    shortlist.map((c) => c.tableId),
  );
}
