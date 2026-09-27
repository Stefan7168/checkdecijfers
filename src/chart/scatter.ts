// Two-measure scatter (spec docs/superpowers/specs/2026-09-27-two-measure-scatter-design.md, D8):
// a chart spec of its own, NOT a new ChartForm. The one-measure ChartSpec and
// its form switcher stay untouched, so ADR 039's "scatter never offered" still
// holds for one-measure charts — a scatter needs two measures.
//
// Built deterministically from the two stored region-set results (R6): every
// plotted number is a projection of one ResultCell per axis (R1, via the two
// result ids), every display string comes from the shared answer formatter
// (R3/R10), and the default scale and the labelled extremes are pure
// functions of the plotted values — so every surface opens the same view and
// audit reconstruction rebuilds the spec byte-identically (R8).
import { z } from 'zod';
import { buildAttributionLine, formatValueNl } from '../answer/compose/format.ts';
import { pairRegions } from '../query/index.ts';
import type { PairSide, RegionScope, ResultCell, ValidatedResult } from '../query/index.ts';
import { PROVISIONAL_NOTE } from './build.ts';
import { lowerFirst } from './scatter-text.ts';

export const SCATTER_SPEC_VERSION = 1 as const;
/** Highest + lowest on each axis, de-duplicated. */
export const SCATTER_MAX_LABELS = 4;
/** An axis opens on a log scale when max/min reaches this (all values > 0). */
export const LOG_SCALE_MIN_SPREAD = 100;

export type AxisScale = 'linear' | 'log';

export interface ScatterAxis {
  measureTitle: string;
  unit: string;
  decimals: number;
  periodLabel: string;
  tableId: string;
  defaultScale: AxisScale;
  /** The exact R4 attribution sentence of this axis's table. */
  attributionLine: string;
  /** The leg's canonical measure key (`result.intent.target.key` for a
   * canonical target), else null — lets an English renderer name the
   * measure from the hand-written English labels
   * (src/answer/respond/english-measure-labels.ts) instead of leaving a
   * Dutch CBS title in English text (#296 part 2 Task 6 fix round 1). */
  canonicalKey: string | null;
  /** The leg's `result.attribution.syncedAt` (our measured last sync) — the
   * source badge's date, same as a one-measure chart's. */
  syncedAt: string;
}

/** One axis's state for a left-out region (#296 part 2): mirrors
 * `PairSide.state` (`src/query/pair.ts`) but drops the raw `ResultCell` in
 * favour of just the one fact a Dutch text builder needs — the CBS marker on
 * a withheld cell. Present-and-null rather than optional, so every consumer
 * pattern-matches on `state` instead of guessing from field presence. */
export interface ScatterSideStatus {
  state: 'value' | 'withheld' | 'not_applicable' | 'missing';
  /** The CBS marker (e.g. 'Secret') when `state` is 'withheld'; null otherwise. */
  valueAttribute: string | null;
}

/** A region `pairRegions` could not plot on both axes, disclosed so nothing
 * is silently dropped (principle c, R11) — the spec's own copy of
 * `LeftOutRegion` (`src/query/pair.ts`), self-sufficient so a renderer never
 * needs the original `ValidatedResult`s back. */
export interface ScatterLeftOut {
  regionCode: string;
  /** Full CBS region label, or the region code when neither leg ever named it. */
  label: string;
  y: ScatterSideStatus;
  x: ScatterSideStatus;
}

export interface ScatterPoint {
  regionCode: string;
  label: string;
  x: number;
  y: number;
  xFormatted: string;
  yFormatted: string;
  /** R1 traceability handles — one CBS cell per axis. */
  xResultId: string;
  yResultId: string;
  provisional: boolean;
}

export interface ScatterSpec {
  schemaVersion: typeof SCATTER_SPEC_VERSION;
  kind: 'scatter';
  title: string;
  /** Vertical axis: the asked-about measure. */
  y: ScatterAxis;
  /** Horizontal axis: the added measure. */
  x: ScatterAxis;
  /** In the y leg's cell order. */
  points: ScatterPoint[];
  /** The region class the y leg was resolved against (#296 part 2) — the same
   * scope the region-set coverage disclosure reads from, carried on the spec
   * itself so a Dutch text builder is self-sufficient and never needs the
   * original `ValidatedResult`s back. */
  scope: RegionScope;
  /** Every region `pairRegions` left out of `points`, in `pairRegions` order —
   * disclosed with each side's state so no dropped region is silent
   * (principle c, R11). */
  leftOut: ScatterLeftOut[];
  /** `pairRegions(...).notApplicable.length` — regions not a member of the
   * class this period per CBS, on at least one leg. */
  notApplicableCount: number;
  /** Region codes to label on the chart (≤ SCATTER_MAX_LABELS); [] unless both
   * legs and the pairing are complete (spec D7: an incomplete side means the
   * true extreme might be a withheld region). */
  labelled: string[];
  provisionalNote: string | null;
  license: 'CC BY 4.0';
}

const axisSchema = z.strictObject({
  measureTitle: z.string(),
  unit: z.string(),
  decimals: z.number().int(),
  periodLabel: z.string(),
  tableId: z.string(),
  defaultScale: z.enum(['linear', 'log']),
  attributionLine: z.string(),
  canonicalKey: z.string().nullable(),
  syncedAt: z.string(),
});

/** #253's four RegionScope variants (`src/query/types.ts`), mirrored here so
 * the spec's own `scope` field validates as strictly as the rest of it. */
const regionScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all_provincies') }),
  z.strictObject({ kind: z.literal('all_landsdelen') }),
  z.strictObject({ kind: z.literal('all_gemeenten') }),
  z.strictObject({ kind: z.literal('gemeenten_in_provincie'), parent: z.string() }),
]);

const scatterSideStatusSchema = z.strictObject({
  state: z.enum(['value', 'withheld', 'not_applicable', 'missing']),
  valueAttribute: z.string().nullable(),
});

const scatterLeftOutSchema = z.strictObject({
  regionCode: z.string(),
  label: z.string(),
  y: scatterSideStatusSchema,
  x: scatterSideStatusSchema,
});

export const scatterSpecSchema = z.strictObject({
  schemaVersion: z.literal(SCATTER_SPEC_VERSION),
  kind: z.literal('scatter'),
  title: z.string(),
  y: axisSchema,
  x: axisSchema,
  points: z.array(
    z.strictObject({
      regionCode: z.string(),
      label: z.string(),
      x: z.number(),
      y: z.number(),
      xFormatted: z.string(),
      yFormatted: z.string(),
      xResultId: z.string(),
      yResultId: z.string(),
      provisional: z.boolean(),
    }),
  ),
  scope: regionScopeSchema,
  leftOut: z.array(scatterLeftOutSchema),
  notApplicableCount: z.number().int().nonnegative(),
  labelled: z.array(z.string()).max(SCATTER_MAX_LABELS),
  provisionalNote: z.string().nullable(),
  license: z.literal('CC BY 4.0'),
}).superRefine((spec, ctx) => {
  // Every labelled code must name an actual plotted point — a labelled
  // region that isn't one of this spec's own points would be a dangling
  // reference the chart layer couldn't resolve.
  const regionCodes = new Set(spec.points.map((p) => p.regionCode));
  spec.labelled.forEach((code, i) => {
    if (!regionCodes.has(code)) {
      ctx.addIssue({
        code: 'custom',
        path: ['labelled', i],
        message: `labelled region code "${code}" is not the regionCode of any point`,
      });
    }
  });
});

export function defaultScale(values: number[]): AxisScale {
  if (values.length === 0 || values.some((v) => v <= 0)) return 'linear';
  return Math.max(...values) / Math.min(...values) >= LOG_SCALE_MIN_SPREAD ? 'log' : 'linear';
}

function axisOf(result: ValidatedResult, cells: ResultCell[]): ScatterAxis {
  const first = cells[0] ?? result.cells[0];
  if (first === undefined) {
    throw new Error(`buildScatterSpec: ${result.attribution.tableId} has no cells — a scatter needs at least one paired region`);
  }
  return {
    measureTitle: first.measureTitle,
    unit: first.unit,
    decimals: first.decimals,
    periodLabel: first.periodLabel,
    tableId: result.attribution.tableId,
    defaultScale: defaultScale(cells.map((c) => c.value as number)),
    attributionLine: buildAttributionLine(result),
    // Optional chaining on purpose: a hand-built test leg may carry no
    // intent target at all; a real leg always does (runQuery's own intent).
    canonicalKey: result.intent?.target?.kind === 'canonical' ? result.intent.target.key : null,
    syncedAt: result.attribution.syncedAt,
  };
}

/** Precondition: `y`/`x` must carry at least one paired region between them —
 * runPairQuery (src/query/pair.ts) guarantees this itself (it refuses
 * `no_data` below SCATTER_MIN_PAIRS pairs before a ScatterSpec is ever
 * built), so this is never reachable from the real query pipeline; it is
 * enforced here only so a caller that bypasses runPairQuery gets an explicit
 * error instead of a TypeError on an undefined cell. */
export function buildScatterSpec(y: ValidatedResult, x: ValidatedResult): ScatterSpec {
  const pairing = pairRegions(y, x);
  const yAxis = axisOf(y, pairing.pairs.map((p) => p.y));
  const xAxis = axisOf(x, pairing.pairs.map((p) => p.x));

  // A scatter is only ever built from two region-set legs (#253) — runPairQuery
  // guarantees this on the real query path, so this is only reachable from a
  // caller that bypasses it, same as axisOf's "no cells" guard above.
  if (y.regionSet === undefined) {
    throw new Error('buildScatterSpec: the y leg has no regionSet — a scatter is only built from region-set legs');
  }
  const scope: RegionScope = y.regionSet.scope;

  const points: ScatterPoint[] = pairing.pairs.map((p) => ({
    regionCode: p.regionCode,
    // Full CBS region label (like src/chart/build.ts:112's cell.regionLabel),
    // NOT baseRegionLabel: stripping the CBS qualifier would collide
    // "Bergen (L.)" and "Bergen (NH.)" onto the same "Bergen" point label.
    label: p.regionLabel,
    x: p.x.value as number,
    y: p.y.value as number,
    xFormatted: formatValueNl(p.x.value as number, p.x.decimals),
    yFormatted: formatValueNl(p.y.value as number, p.y.decimals),
    xResultId: p.x.resultId,
    yResultId: p.y.resultId,
    provisional: p.x.provisional || p.y.provisional,
  }));

  const sideStatus = (side: PairSide): ScatterSideStatus => ({
    state: side.state,
    valueAttribute: side.cell?.value === null ? side.cell.valueAttribute : null,
  });
  const leftOut: ScatterLeftOut[] = pairing.leftOut.map((r) => ({
    regionCode: r.regionCode,
    label: r.regionLabel ?? r.regionCode,
    y: sideStatus(r.y),
    x: sideStatus(r.x),
  }));

  const complete = pairing.complete && (y.regionSet?.complete ?? false) && (x.regionSet?.complete ?? false);
  const labelled: string[] = [];
  if (complete && points.length > 0) {
    const extreme = (key: 'x' | 'y', pick: 'max' | 'min'): string =>
      points.reduce((best, p) => ((pick === 'max' ? p[key] > best[key] : p[key] < best[key]) ? p : best)).regionCode;
    for (const code of [extreme('y', 'max'), extreme('y', 'min'), extreme('x', 'max'), extreme('x', 'min')]) {
      if (!labelled.includes(code) && labelled.length < SCATTER_MAX_LABELS) labelled.push(code);
    }
  }

  return {
    schemaVersion: SCATTER_SPEC_VERSION,
    kind: 'scatter',
    title: `${yAxis.measureTitle} tegenover ${lowerFirst(xAxis.measureTitle)}, ${yAxis.periodLabel}`,
    y: yAxis,
    x: xAxis,
    points,
    scope,
    leftOut,
    notApplicableCount: pairing.notApplicable.length,
    labelled,
    provisionalNote: points.some((p) => p.provisional) ? PROVISIONAL_NOTE : null,
    license: 'CC BY 4.0',
  };
}
