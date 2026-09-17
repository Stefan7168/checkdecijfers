// A general, registry-driven alternate reading of a canonical measure: swaps
// `measure` and/or `dims` over the PRIMARY's own resolved coordinates and
// rebuilds through the SAME deterministic runQuery -> buildChartSpec pipeline
// (R6) — never a fabricated coordinate, never an LLM call.
//
// Unlike src/chart/curated.ts's original narrow `buildAlternateSpec` (kept
// there only historically; both now call this), this function MERGES the
// alternate's dims over the primary's OWN resolved dims
// (`primary.cells[0].dims`) rather than replacing them wholesale. Checked
// against the real registry (src/registry/defaults.ts): most alternates swap
// `measure` with no `dims` key at all, and several primaries carry non-empty
// dims of their own (e.g. a branch code) that a bare `dims: alt.dims` would
// silently drop, breaking the toggle for no honesty reason. Do not
// "simplify" this back to a literal replace.
//
// Eviction-race safety invariant, carried forward from curated.ts's old
// buildAlternateSpec comment (that function's only caller before this
// refactor): this builds an `explicit` target (tableId + measure + dims),
// and src/query/resolve.ts's explicit-target branch reports an eviction race
// on the referenced table as the honest-but-misleading `table_not_registered`
// refusal rather than the `table_evicted` a canonical target would get. That
// gap is unreachable ONLY when the referenced table is PINNED (never
// evictable, per migration 025_table_eviction_lifecycle.sql) — true for
// every call from curated.ts (always a hand-curated seed table; pinned,
// asserted by tests/chart/curated.test.ts), but NOT guaranteed for this
// function's broader caller set. `buildAlternateReading` is called with
// `primary.attribution.tableId` from whatever answered the PRIMARY query —
// once a general caller (Task 2, the answer pipeline) passes it a primary
// answer over an on-demand-onboarded (evictable, not pinned) table, that
// eviction race becomes reachable here for the first time.
//
// This still degrades SAFELY today without any further work: an eviction
// race on a non-pinned table produces `table_not_registered`, which is still
// a typed refusal — `runQuery`'s `!altOutcome.ok` branch below turns ANY
// refusal (this one included) into `{ ok: false }`, which every caller
// (curated.ts today, the answer pipeline in Task 2) already treats as
// "no toggle, primary chart unaffected" (principle c: refuse, never guess).
// So a race here degrades to a missing alternate reading, never a wrong one.
// If this function, or any future explicit-target caller, ever needs to
// distinguish "genuinely refused" from "raced an eviction" (e.g. to retry),
// resolve.ts's explicit-target branch needs revisiting first — see its own
// comment there.
import type { Db } from '../db/types.ts';
import type { StructuredIntent, ValidatedResult } from '../query/index.ts';
import { runQuery } from '../query/index.ts';
import { buildChartSpec } from './build.ts';
import type { ChartSpec } from './types.ts';

export interface AlternateReadingResult {
  label: string;
  spec: ChartSpec;
  /** #254(a), ADR 052 session 110 addendum: the alternate's own resolved
   * ValidatedResult (the same `altOutcome` this function already built the
   * spec from) — exposed so a caller can feed IT, not just the chart spec,
   * into buildPeriodChangeReading (which needs a ValidatedResult's cells,
   * not a rendered ChartSpec) to offer a period-change reading of THIS
   * alternate. Named `validated`, not `result`, to avoid a confusing
   * `outcome.result.result` at call sites (the outer discriminated union
   * already uses `result` for THIS whole object). Additive only: existing
   * callers (curated.ts) that read only `.label`/`.spec` are unaffected, and
   * respond.ts never spreads this object wholesale into the stored
   * AnswerResponse.chartAlternates entry — it destructures label/spec
   * explicitly, so this field never reaches the audit envelope. */
  validated: ValidatedResult;
}

export type AlternateReadingOutcome = { ok: true; result: AlternateReadingResult } | { ok: false; reason: string };

export interface AlternateReadingCoordinate {
  /** Present when the alternate differs by measure code. */
  measure?: string;
  /** Present when the alternate differs by dimension coordinate(s) — MERGED
   * over the primary's own resolved dims, never a full replace. */
  dims?: Record<string, string>;
  label: string;
}

/** `options.probe` (Session 110, ADR 041's #195 discipline): defaults to
 * `false` (the original, pre-existing behavior every chat/dock/curated
 * caller still gets — an alternate built for an actually-served answer is a
 * real, deliverable read and legitimately bumps `cbs_tables.last_queried_at`
 * like any other). `src/chart/embed-live.ts`'s `rerunLive` is the one
 * caller that passes `true`: a live embed re-render is never a
 * billed/served turn (the same discipline already applied to the PRIMARY
 * query there), so an alternate rebuilt alongside it must not bump the
 * eviction anchor either — an anonymous visitor merely loading (or
 * refreshing) a live embed must never be able to keep an otherwise-unused
 * table alive by that fact alone. */
export async function buildAlternateReading(
  db: Db,
  primary: ValidatedResult,
  primaryIntent: StructuredIntent,
  alt: AlternateReadingCoordinate,
  options: { probe?: boolean } = {},
): Promise<AlternateReadingOutcome> {
  const primaryCell = primary.cells[0];
  if (!primaryCell) return { ok: false, reason: 'primary result has no cells to derive a coordinate from' };

  const altIntent: StructuredIntent = {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: primary.attribution.tableId,
      measure: alt.measure ?? primaryCell.measure,
      dims: { ...primaryCell.dims, ...(alt.dims ?? {}) },
    },
    // #254 review finding (post-Task-1): must carry the PRIMARY's own
    // regions onto the alternate. resolve.ts defaults an absent `regions` to
    // `[]` (src/query/resolve.ts:270) — without this, a multi-region
    // comparison primary (e.g. "compare Amsterdam and Rotterdam") would
    // silently build its alternate over an unrelated, regionless national
    // reading instead of the same region comparison. Same optional
    // pass-through pattern as `period` above.
    regions: primaryIntent.regions,
    period: primaryIntent.period,
    // Inherited from the primary, never hardcoded to 'series': a hardcoded
    // 'series' would refuse every alternate built over a comparison-shaped
    // primary (bar chart, multiple regions at one period) once Task 2 wires
    // this in generally — a comparison primary's own intent carries
    // `derivation: 'none'`, and resolve.ts's arity check (src/query/
    // resolve.ts) requires a multi-period selection (periodCodes.length >= 2)
    // for `'series'`, which a single-period comparison intent never has. Do
    // not "simplify" this back to a literal `'series'`.
    derivation: primaryIntent.derivation,
  };

  const altOutcome = await runQuery(db, altIntent, { probe: options.probe === true });
  if (!altOutcome.ok) {
    return { ok: false, reason: `alternate reading refused (${altOutcome.refusal.kind}): ${altOutcome.refusal.message}` };
  }

  // #254 review finding (post-Task-5): the whole toggle feature assumes every
  // alternate is built over the IDENTICAL period window as the primary — that
  // assumption is what lets the UI safely keep the zoom-window bounds and the
  // Vanaf/Tot period-select options derived from the PRIMARY spec even while
  // an alternate reading is on screen, so the reader never sees the
  // selectable date range shift under them when they switch reading. `period`
  // is passed through unchanged onto altIntent above, but that only means
  // both intents ASK for the same window — nothing before this point verifies
  // the alternate's own RESOLVED cells actually landed on that same set of
  // period codes. A registry alternate can swap `measure` entirely (not just
  // `dims`), and a measure with a gappier published history on the same table
  // could in principle resolve to a different set of periods than the primary
  // even when both ask for the identical window. Today `runQuery`'s own
  // completeness gate (src/query/run.ts: every requested period code or a
  // full refusal, never a partial result) makes that unreachable via the
  // ordinary "ask the same period, get a shorter alternate" path — a request
  // spanning a genuine gap on the alternate measure (a real one exists: table
  // 85429NED's M001608 YoY measure has NO rows at all for 2015/2021, unlike
  // its sibling D001607 value measure) just refuses the whole alternate
  // outright via the branch above, which every caller already treats as
  // "no toggle, primary chart unaffected". This check exists as the enforced
  // backstop for every OTHER way a mismatch could reach here — a future
  // caller passing a `primaryIntent` that doesn't actually describe how
  // `primary` was built, a future relaxation of runQuery's all-or-nothing
  // completeness rule, or an on-demand-fetch race between the primary and
  // alternate queries — so the "identical period window" assumption is an
  // enforced invariant, not an unchecked hope. If it ever fires, the
  // primary's own `attribution.coveredPeriods` (built from the PRIMARY query)
  // would otherwise describe a range the alternate's own plotted data does
  // not fully cover — an honesty-relevant mismatch (principle c: refuse
  // rather than show something misleading), even though no single number
  // would itself be wrong or fabricated. Comparing the SET, not the array:
  // cell order is "period ascending, then intent region order" (run.ts), an
  // ordering fact this check has no business depending on. Do not "simplify"
  // this away — it is exactly this function's own documented philosophy ("a
  // race here degrades to a missing alternate reading, never a wrong one")
  // applied to the one failure mode nothing else here was checking.
  const primaryPeriods = new Set(primary.cells.map((c) => c.periodCode));
  const altPeriods = new Set(altOutcome.cells.map((c) => c.periodCode));
  const periodsMatch = primaryPeriods.size === altPeriods.size && [...primaryPeriods].every((p) => altPeriods.has(p));
  if (!periodsMatch) {
    return {
      ok: false,
      reason:
        `alternate reading resolved a different set of periods than the primary ` +
        `(primary: ${[...primaryPeriods].sort().join(', ')}; alternate: ${[...altPeriods].sort().join(', ')}) — ` +
        `refusing rather than risk a coverage claim the alternate's own data doesn't back`,
    };
  }

  try {
    const spec = buildChartSpec(altOutcome);
    if (spec === null) return { ok: false, reason: `alternate reading shape '${altOutcome.shape}' yields no chart` };
    return { ok: true, result: { label: alt.label, spec, validated: altOutcome } };
  } catch (err) {
    return { ok: false, reason: `alternate reading chart build failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
