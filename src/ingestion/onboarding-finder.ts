// Builds the TableFinder the answer pipeline consumes (WP16 sub-part 2, ADR
// 026, design §2). The answer/policy layer stays db- and catalog-free — it
// takes an injected `(term) => Promise<OnboardingRouting | null>` callback
// (the ServabilityCheck precedent). This factory IS that callback's
// production implementation: it runs the sub-part-1 finder (findTable: FTS
// recall → Haiku rerank → confidence routing) and, on a confident pick, adds
// the per-user already-pending check that the policy layer has no userId to do.
//
// Only a CONFIDENT finder pick becomes a routing; disclose / none / any throw
// return null so the caller falls back to the byte-identical B15 clarification
// (design's confident-floor is the single safety gate — a below-floor pick
// discloses, never onboards; §8 risk 1).
import type { LlmClient } from '../answer/llm/client.ts';
import type { OnboardingRouting, TableFinder } from '../answer/intent/policy.ts';
import { findTable } from '../catalog/find.ts';
import { rerankShortlist } from '../catalog/rerank.ts';
import type { RerankFn } from '../catalog/types.ts';
import type { Db } from '../db/types.ts';
import { findActiveRequest } from './onboarding-store.ts';

export interface OnboardingFinderDeps {
  db: Db;
  /** The user asking — needed for the per-(user, table) already-pending check.
   * The policy layer never has this; the web action does, and constructs this
   * finder with it. */
  userId: string;
  /** Shared small/fast-tier LLM client for the Stage-2 rerank (same client the
   * chat already builds for intent parsing; the rerank pins its own model).
   * Ignored when `rerank` is supplied directly (tests inject a stub, exactly
   * like FindTableOptions.rerank — so routing is provable without the LLM
   * harness). Required in production (the default rerank closes over it). */
  rerankClient?: LlmClient;
  /** Stage-2 rerank fn override (tests). Defaults to the production closure
   * over rerankShortlist(rerankClient). */
  rerank?: RerankFn;
}

/** Produces the TableFinder the answer pipeline injects. Absent injection →
 * the pipeline never onboards (byte-identical B15); this factory is only ever
 * called by web/app/actions.ts's askQuestion. */
export function buildOnboardingFinder(deps: OnboardingFinderDeps): TableFinder {
  const rerank: RerankFn =
    deps.rerank ??
    ((topic, shortlist) => {
      if (!deps.rerankClient) {
        throw new Error('buildOnboardingFinder: rerankClient is required when no rerank fn is provided');
      }
      return rerankShortlist(topic, shortlist, { client: deps.rerankClient });
    });
  return async (term: string): Promise<OnboardingRouting | null> => {
    // findTable never throws for a normal miss (it routes recall-empty → none
    // and rerank errors → disclose), but wrap defensively: ANY failure here —
    // including the already-pending lookup — must degrade to the plain B15
    // clarification, never block the answer turn or fabricate an onboarding
    // trigger (principle c). Swallowing an already-pending lookup failure is
    // money-safe: duplicate protection is structural (the one-active-per-
    // (user,table) unique index + the per-request debit dedup), so a missed
    // check degrades to the no-second-charge duplicate path, never a double
    // debit. (Session-27 review: the first version caught only findTable,
    // contradicting this comment's own "ANY failure" contract.)
    try {
      const outcome = await findTable(deps.db, term, { rerank });
      if (outcome.kind !== 'confident') return null;

      // Confident pick → does this user already have an active fetch for this
      // exact table? If so, the acknowledgment says "already being fetched"
      // and NO new debit happens (alreadyPending → the action never triggers).
      const active = await findActiveRequest(deps.db, deps.userId, outcome.pick.tableId);
      return {
        tableId: outcome.pick.tableId,
        topicTerm: term,
        confidence: outcome.confidence,
        alreadyPending: active !== null,
      };
    } catch {
      return null;
    }
  };
}
