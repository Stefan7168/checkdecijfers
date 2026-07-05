// The table finder (WP16 sub-part 1): topic → routing decision. Composes
// Stage-1 recall (deterministic FTS) and Stage-2 rerank (injected — so this
// routing is unit-testable without the LLM harness), then applies conservative
// confidence routing:
//   recall empty        → none      (we can't even find a candidate)
//   confident pick       → confident (→ sub-part 2 fetch+verify gate)
//   low conf / rerank err → disclose (→ #21/#39 multi-candidate, BEFORE any ingest)
// It never fetches, ingests, or reads a data cell — it only decides.
import type { Db } from '../db/types.ts';
import { recallCandidates, type RecallOptions } from './recall.ts';
import {
  DEFAULT_FIND_TABLE_CONFIG,
  type CatalogCandidate,
  type FindTableConfig,
  type FindTableOutcome,
  type RerankFn,
} from './types.ts';

/** How many candidates a disclosure shows the user (a handful, not the whole
 *  shortlist). The pick leads, then its plausible alternatives. */
export const DISCLOSE_LIMIT = 4;

export interface FindTableOptions {
  /** Stage 2. In production a closure over rerankShortlist(…, {client}); in
   *  tests a stub, so routing is exercised without recorded LLM fixtures. */
  rerank: RerankFn;
  config?: FindTableConfig;
  recall?: RecallOptions;
}

export async function findTable(
  db: Db,
  topic: string,
  options: FindTableOptions,
): Promise<FindTableOutcome> {
  const shortlist = await recallCandidates(db, topic, options.recall ?? {});
  if (shortlist.length === 0) {
    return { kind: 'none', reason: 'no_recall' };
  }

  const config = options.config ?? DEFAULT_FIND_TABLE_CONFIG;
  const byId = new Map(shortlist.map((c) => [c.tableId, c]));

  let result;
  try {
    result = await options.rerank(topic, shortlist);
  } catch {
    // Malformed / off-allowlist / model error → never a pick; disclose honestly.
    return { kind: 'disclose', candidates: shortlist.slice(0, DISCLOSE_LIMIT), reason: 'rerank_error' };
  }

  const pick = byId.get(result.tableId);
  if (!pick) {
    // validateRerankOutput guarantees the id is in the shortlist; this guards a
    // stub rerank that ignores the allowlist. Treat as a rerank failure.
    return { kind: 'disclose', candidates: shortlist.slice(0, DISCLOSE_LIMIT), reason: 'rerank_error' };
  }

  if (result.confidence >= config.highConfidence) {
    return {
      kind: 'confident',
      pick,
      confidence: result.confidence,
      reading: result.reading,
      candidates: shortlist,
    };
  }

  // Low confidence → disclose: the pick, then its allowlist-sanitized alternatives.
  const alternatives = result.alternativeIds
    .map((id) => byId.get(id))
    .filter((c): c is CatalogCandidate => c !== undefined);
  return {
    kind: 'disclose',
    candidates: [pick, ...alternatives].slice(0, DISCLOSE_LIMIT),
    reason: 'low_confidence',
  };
}
