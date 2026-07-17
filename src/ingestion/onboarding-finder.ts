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
import { alreadyIngested } from './onboarding.ts';
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
    ((query, shortlist) => {
      if (!deps.rerankClient) {
        throw new Error('buildOnboardingFinder: rerankClient is required when no rerank fn is provided');
      }
      return rerankShortlist(query, shortlist, { client: deps.rerankClient });
    });
  return async (term: string, question: string): Promise<OnboardingRouting | null> => {
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
      // Recall runs on the TERM; the rerank prompt additionally sees the full
      // QUESTION (WP27 stage A — the stock-vs-flow signal, ADR 027 D3a).
      const outcome = await findTable(deps.db, { topic: term, question }, { rerank });
      if (outcome.kind !== 'confident') return null;

      // #166 pre-charge guard: a confident pick on a table we ALREADY hold
      // (registered active + synced — the job's own alreadyIngested predicate,
      // shared so the two notions can't drift) must never route to onboarding:
      // there is nothing to fetch, so a 100-credit "we halen het voor je op"
      // charge would bill the user for data already in the database (the
      // coverage sprint makes this reachable: a synonym miss onto a curated
      // table like 83693NED). Returning null falls back to the plain B15
      // clarification, which names the loaded topics — the user re-asks with
      // a listed term and pays the normal question price only.
      if (await alreadyIngested(deps.db, outcome.pick.tableId)) return null;

      // #166 guard, second leg (session-50 review finding): the fit gate
      // downstream resolves over the WHOLE candidate chain, not just the pick
      // (runFitGate iterates candidateIds and takes the first structural fit)
      // — so an already-held ALTERNATE would let a charged job skip the fetch
      // and deliver from data we already hold: the exact charge #166 exists to
      // kill, one link later. Screen the alternates with the same predicate,
      // BEFORE the cap, so up to 3 genuinely onboardable candidates survive.
      const onboardableAlternates: string[] = [];
      for (const id of outcome.alternativeIds) {
        if (!(await alreadyIngested(deps.db, id))) onboardableAlternates.push(id);
      }

      // Confident pick → does this user already have an active fetch for this
      // exact table? If so, the acknowledgment says "already being fetched"
      // and NO new debit happens (alreadyPending → the action never triggers).
      const active = await findActiveRequest(deps.db, deps.userId, outcome.pick.tableId);
      return {
        tableId: outcome.pick.tableId,
        topicTerm: term,
        confidence: outcome.confidence,
        alreadyPending: active !== null,
        // WP27 stage B (ADR 027 D2a): THE constructing link of the candidate
        // chain — pick first, then the rerank's allowlist-sanitized
        // alternativeIds (never contain the pick, order preserved; since #166
        // filtered to not-yet-ingested tables), cap 3. Every link downstream
        // only CARRIES this list; skip this line and candidate_ids stays []
        // in production even though everything typechecks (PR-#17 review,
        // session 31).
        candidateIds: [outcome.pick.tableId, ...onboardableAlternates].slice(0, 3),
      };
    } catch {
      return null;
    }
  };
}
