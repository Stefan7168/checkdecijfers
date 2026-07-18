// #172 step 0 — the structural shortlist-walk fix (ADR 027 amendment A4):
// the DELIVERABILITY WALK the onboarding fit gate consumes. Pick first, then
// the model's alternates (prioritization hints, allowlist-sanitized, kept
// VERBATIM — they carry the rerank's judgment incl. its "TENZIJ historisch"
// rule), then every REMAINING current shortlist entry in shortlist order
// (recall.ts's rank-merged return order). Chain membership stops being a
// single-model judgment: a future model dropping a deliverable alternate no
// longer kills delivery (the s54-measured Haiku drift class) — the ADR-027
// fit gate walks the whole list and stays the sole deliverability judge (its
// A3 pre-checks reject non-fitting shapes deterministically, so extension
// entries rarely cost an LLM call; the walk runs in the ASYNC onboarding job,
// never the request path).
//
// MEASURED basis (step-0 verification, 2026-07-18, recorded in
// docs/session-briefs/2026-07-19-172-escalation-protocol.md): 37789ksz sits
// at position 22/24 of the live shortlist (rank 0.0760) — every smaller cap
// (the protocol's own cap-6 sketch included) provably misses it, so the
// extension covers the FULL remaining shortlist. It is filtered to CURRENT
// catalog rows per the row's OWN source registry entry (the recall-quota/A6
// notion; unknown source → not walked — the buildIsCurrentPredicate
// else-false direction, NOT the A1 display fallback). Discontinued tables
// are deliberately not auto-walked: the extension bypasses the rerank's
// historical judgment, and auto-onboarding a discontinued table could serve
// a stale series for a current question (principle c).
import { SOURCES, sourceKeyForTableId } from '../sources/registry.ts';
import type { FindTableOutcome } from './types.ts';

/** Ordered, de-duplicated table ids for the fit-gate walk: model chain first,
 * then the current remainder of the Stage-1 shortlist. Pure — the #166
 * already-held screen and persistence stay the onboarding layer's job. */
export function candidateWalk(
  outcome: Extract<FindTableOutcome, { kind: 'confident' }>,
): string[] {
  const walk = [outcome.pick.tableId, ...outcome.alternativeIds];
  const seen = new Set(walk);
  for (const candidate of outcome.candidates) {
    if (seen.has(candidate.tableId)) continue;
    const info = SOURCES[sourceKeyForTableId(candidate.tableId)];
    if (info === undefined) continue;
    if (!info.currentCatalogStatuses.includes(candidate.status ?? '')) continue;
    seen.add(candidate.tableId);
    walk.push(candidate.tableId);
  }
  return walk;
}
