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

export async function buildAlternateReading(
  db: Db,
  primary: ValidatedResult,
  primaryIntent: StructuredIntent,
  alt: AlternateReadingCoordinate,
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

  const altOutcome = await runQuery(db, altIntent);
  if (!altOutcome.ok) {
    return { ok: false, reason: `alternate reading refused (${altOutcome.refusal.kind}): ${altOutcome.refusal.message}` };
  }
  try {
    const spec = buildChartSpec(altOutcome);
    if (spec === null) return { ok: false, reason: `alternate reading shape '${altOutcome.shape}' yields no chart` };
    return { ok: true, result: { label: alt.label, spec } };
  } catch (err) {
    return { ok: false, reason: `alternate reading chart build failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
