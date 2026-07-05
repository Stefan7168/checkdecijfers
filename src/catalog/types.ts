// Shared types for CBS-catalog table discovery (WP16 sub-part 1 — the table
// finder). The finder maps a user TOPIC we don't have loaded to the CBS table
// id(s) that could answer it, in two stages: deterministic Postgres full-text
// recall (Stage 1) → narrow LLM rerank over the shortlist (Stage 2), with
// conservative confidence routing to either the fetch+verify gate (sub-part 2)
// or multi-candidate disclosure (#21/#39). No data cells are ever read here —
// only catalog metadata.

/** One candidate surfaced by Stage-1 recall: a cbs_catalog row + its FTS rank. */
export interface CatalogCandidate {
  /** As-published CBS id — verbatim, feeds the ingestion pipeline directly. */
  tableId: string;
  title: string;
  summary: string;
  /** 'Regulier' | 'Gediscontinueerd' | 'Vervallen' | … — disclosure signal. */
  status: string | null;
  datasetType: string | null;
  /** ts_rank score from the recall query (higher = stronger keyword match). */
  rank: number;
}

/** Stage-2 rerank output AFTER schema validation + the hard allowlist check.
 *  Every id here is guaranteed to be one of the shortlist ids that were sent. */
export interface RerankResult {
  /** The picked table id — allowlist-guaranteed to be in the shortlist. */
  tableId: string;
  /** Model confidence 0..1 in the pick (range-checked in code, not the schema). */
  confidence: number;
  /** The model's one-line Dutch reason, for logging + disclosure copy. */
  reading: string;
  /** Runner-up ids the model judged plausible — also allowlist-checked. Used to
   *  populate multi-candidate disclosure; empty when the pick is unambiguous. */
  alternativeIds: string[];
}

/** Ranks a recall shortlist against the topic (Stage 2). Injected into the
 *  orchestrator so its routing is unit-testable without the live LLM harness;
 *  in production it is a closure over rerankShortlist(client, …). */
export type RerankFn = (topic: string, shortlist: CatalogCandidate[]) => Promise<RerankResult>;

/** Confidence routing knobs. DEFAULT_FIND_TABLE_CONFIG is deliberately
 *  conservative (favour disclosure over auto-proceed) and NOT yet calibrated —
 *  calibration against a labelled topic→table set is the supervised follow-up
 *  step (mirrors ADR 012's R7 calibration procedure for intent parsing). */
export interface FindTableConfig {
  /** At or above this confidence a single pick auto-proceeds to the fetch+verify
   *  gate; below it the finder discloses candidates instead of picking. */
  highConfidence: number;
}

export const DEFAULT_FIND_TABLE_CONFIG: FindTableConfig = {
  // Conservative placeholder — favour disclosure. To be calibrated live.
  highConfidence: 0.8,
};

/**
 * The routing decision the finder returns. Sub-part 2 consumes it:
 *   confident → fetch → verify → store → answer (costs credits, #24).
 *   disclose  → show candidate titles, "welke bedoel je?" BEFORE any ingest.
 *   none      → recall found nothing; honest "we don't have this / can't find it".
 */
export type FindTableOutcome =
  | {
      kind: 'confident';
      pick: CatalogCandidate;
      confidence: number;
      reading: string;
      /** Full shortlist, for the audit trail / logging. */
      candidates: CatalogCandidate[];
    }
  | {
      kind: 'disclose';
      /** The pick plus its plausible alternatives, in display order. */
      candidates: CatalogCandidate[];
      /** low_confidence: the model wasn't sure. rerank_error: the model's output
       *  was malformed or off-allowlist, so we never trusted a pick. Both route
       *  to the same honest multi-candidate disclosure (principle c). */
      reason: 'low_confidence' | 'rerank_error';
    }
  | { kind: 'none'; reason: 'no_recall' };
