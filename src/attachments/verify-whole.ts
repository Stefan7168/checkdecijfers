// "Eigen data" attachments tier — own-data's "verified whole" check (plan
// 2026-09-22, Task 4; the own-data analog of src/query/whole-verification.ts,
// which CBS's phase 5b — web/app/chart-whole-verification-actions.ts — checks
// a region roster against its CBS-published parent total with). Own-data has
// no registry and no independently-published total to fetch: instead, the
// READER points at one cell of their OWN uploaded file and says "this is my
// total" (the `wholeRowRef`), and this file checks whether the currently-
// displayed parts (`partRowRefs`, already resolved to rowRefs by the caller —
// a click on a pie slice/stack segment, never a re-typed label) genuinely sum
// to it — the EXACT SAME tolerance/arithmetic CBS's own tier trusts
// (verifyPartsSumToWhole, reused UNCHANGED).
//
// Resolution mirrors deriveChartOverlay (derive-overlay.ts) exactly: the
// reader's OWN currently-displayed chart instruction is re-executed over the
// dataset's already-ingested cells (never trusted as a cached value), via the
// SAME allResolvedPoints map that file already builds — imported rather than
// re-derived, so the rowRef -> real-value resolution rule (raw vs. computed
// points, per-column number format) lives in exactly one place.
//
// A rowRef that does not resolve to a real point on THIS chart (a stale
// designation over a dataset that changed, or a garbled partRowRef) is
// treated as "no value" — the SAME missing/null case verifyPartsSumToWhole
// already refuses with (`missing_whole` for the whole, `withheld_member` for
// a part) — never a thrown error and never own-data-specific arithmetic: the
// entire point of reusing verifyPartsSumToWhole is that its refusal shapes
// are already trusted, so this file adds no new ones.
//
// Deterministic, no LLM, no db import — same purity contract as execute.ts
// and derive-overlay.ts's own top-of-file comments.
import { allResolvedPoints, type ResolvedPoint } from './derive-overlay.ts';
import type { ChartInstruction, UserDataset } from './types.ts';
import { verifyPartsSumToWhole, type PartCell, type VerifyOutcome } from '../query/whole-verification.ts';

/** A resolved point (or an unresolved rowRef) as the cell the pure check
 * reads. Own-data has no CBS-style withheld/estimated attribute concept —
 * only "has a value" or "is null" — so `valueAttribute` is always null (the
 * PartCell type explicitly allows this; nothing in verifyPartsSumToWhole
 * reads the field, it exists only for a future consumer). */
function toPartCell(point: ResolvedPoint | undefined): PartCell {
  // #314 (session 124; the #312 M3 finding): a point computed over FEWER
  // cells than its group has (an aggregate that skipped an empty/non-
  // numeric cell, or anything derived from one) is not a value this check
  // may add up as if it were complete — it is treated exactly like a
  // missing one, so verifyPartsSumToWhole's own trusted refusals apply
  // (`withheld_member` for a part, `missing_whole` for the whole) and the
  // note reads "can't be checked", never a "Checked" built on a partial sum.
  if (point?.incomplete) return { value: null, decimals: point.decimals, valueAttribute: null };
  return { value: point?.value ?? null, decimals: point?.decimals ?? 0, valueAttribute: null };
}

/**
 * Does the reader-designated whole (`wholeRowRef`) genuinely equal the sum of
 * the given parts (`partRowRefs`), within verifyPartsSumToWhole's own
 * tolerance? Both are resolved against the SAME already-validated
 * `instruction` re-executed over `dataset` — the caller (the server action)
 * owns validating that instruction; this function trusts it as given, same
 * division of responsibility as deriveChartOverlay/dataset-derivation-
 * actions.ts.
 *
 * `partRowRefs` is exactly the set the caller wants summed — this function
 * does not filter, dedupe, or exclude `wholeRowRef` from it; a caller that
 * wants "every OTHER currently-displayed part" must build that list itself
 * (the UI never lets a reader designate a point that isn't currently
 * displayed, and never includes the designated point in its own parts list —
 * see user-chart.tsx's wholePartRowRefsFor).
 */
export function verifyDatasetWhole(
  dataset: UserDataset,
  instruction: ChartInstruction,
  wholeRowRef: string,
  partRowRefs: readonly string[],
): VerifyOutcome {
  const byRef = allResolvedPoints(dataset, instruction);
  const whole = toPartCell(byRef.get(wholeRowRef));
  const parts = partRowRefs.map((ref) => toPartCell(byRef.get(ref)));
  return verifyPartsSumToWhole(parts, whole);
}
