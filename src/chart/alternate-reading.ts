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
