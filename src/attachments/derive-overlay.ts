// "Eigen data" attachments tier — the own-data analog of
// src/chart/copilot/map.ts's `addDerivedOverlay` (ADR 056 phases 4/6): a
// reader names a series (by label) and either two point labels (a
// difference arrow) or nothing else (an average line over the whole
// series), and this file computes that value SERVER-SIDE from the dataset's
// own stored cells — the caller only ever supplies labels, never a number
// (H1). CBS's version re-reads an ALREADY-AUDITED answer's own cells by
// resultId; own-data has no audit trail to re-read, but also none of
// principle (b)'s live-fetch restriction to work around, so re-running
// executeInstruction(dataset, instruction) over the already-ingested (bulk-
// stored, D5) dataset.cells cheaply and purely reconstructs "the already-
// built chart" — the exact points chart.ts's buildUserChartSpec would
// itself produce.
//
// A NEW file rather than added to execute.ts (the task's other option):
// chart.ts's own buildPoint already resolves a computed-or-raw point's
// value/decimals/ref WITHOUT importing execute.ts's private valueAndDecimals
// (it duplicates the four-line resolution inline) — this file follows that
// same, already-established precedent instead of growing execute.ts's own
// surface for one more caller.
//
// Deterministic, no LLM, no db import — same purity contract as execute.ts's
// own top-of-file comment. Every value returned is either one already-parsed
// stored cell or a fixed arithmetic function (mean/difference) of stored
// cells, carrying a rowRef in execute.ts's own `agg:`/`der:` convention
// (R1's traceability handle, applied one layer up over an already-computed
// chart rather than raw rows).
import { columnById, columnIndex } from './columns.ts';
import { executeInstruction, type ComputedValue, type RawPoint } from './execute.ts';
import { decimalsOf, parseNumber } from './ingest/numbers.ts';
import { aggregateLabel, derivedLabel } from './labels.ts';
import type { ChartInstruction, ColumnProfile, DatasetProfile, UserDataset } from './types.ts';

/** What to compute, named the same way the reader/picker names it on the
 * already-drawn chart: a series by its DISPLAYED label (chart.ts's
 * aggregate/derived-decorated label when one applies, the raw column
 * header/seriesBy value otherwise — never an internal column id), and, for
 * `difference`, two point labels (the x-axis values to diff between,
 * mirroring how CBS's own addDerivedOverlay names two period labels).
 * `mean` takes no point labels: it averages EVERY point of the named
 * series, the "average line over a series" case — mirroring how CBS's
 * mapping passes ALL of a series' resultIds, never a subset. */
export type OverlaySelection =
  | { calcKind: 'mean'; seriesLabel: string }
  | { calcKind: 'difference'; seriesLabel: string; pointLabels: [string, string] };

/** One reachable "this selection does not resolve to a value" refusal — the
 * named series/point doesn't exist on this chart, or every candidate value
 * is missing. English (not execute.ts's own Dutch NoRowsError/
 * TooManyPointsError): this class's messages flow straight into
 * dataset-derivation-actions.ts's `reason` string, the same English
 * developer/UI-facing style chart-derivation-actions.ts's own refusal
 * reasons already use for the identical kind of request — never rendered
 * as chat-answer prose the way execute.ts's own errors are. */
export class OverlaySelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverlaySelectionError';
  }
}

interface SeriesGroup {
  label: string;
  yColumn: ColumnProfile;
  points: RawPoint[];
}

function operandHeader(profile: DatasetProfile, instruction: ChartInstruction, columnId: string): string {
  const header = columnById(profile, columnId).header;
  return instruction.aggregate !== null ? aggregateLabel(instruction.aggregate.fn, header) : header;
}

/**
 * Groups executeInstruction's output back into the series chart.ts would
 * draw, computing each group's DISPLAYED label exactly the way
 * buildUserChartSpec does (chart.ts) — duplicated rather than reusing
 * buildUserChartSpec's own UserChartSpec output because that shape has no
 * raw `decimals` field (it only ever exposes a formatted display string),
 * and reusing executeInstruction's RawPoints is what keeps a raw cell's
 * decimals available. Skipping this label step and matching on the raw
 * column header/seriesBy value instead would silently break the feature on
 * any chart with `aggregate`/`derived` set, whose reader-visible label is
 * "Sum of Omzet"/"Omzet − Kosten", never the bare header.
 */
function groupSeries(dataset: UserDataset, instruction: ChartInstruction, points: readonly RawPoint[]): SeriesGroup[] {
  const profile = dataset.profile;
  const singleY = instruction.seriesBy !== null ? columnById(profile, instruction.y[0]!) : null;
  const derivedLabelText =
    instruction.derived !== null
      ? derivedLabel(
          instruction.derived.op,
          operandHeader(profile, instruction, instruction.y[0]!),
          instruction.derived.b === null ? null : operandHeader(profile, instruction, instruction.derived.b),
        )
      : null;

  const bySeriesKey = new Map<string, RawPoint[]>();
  const order: string[] = [];
  for (const point of points) {
    let bucket = bySeriesKey.get(point.seriesKey);
    if (bucket === undefined) {
      bucket = [];
      bySeriesKey.set(point.seriesKey, bucket);
      order.push(point.seriesKey);
    }
    bucket.push(point);
  }

  return order.map((key) => {
    const groupPoints = bySeriesKey.get(key)!;
    const first = groupPoints[0]!;
    const yColumn = singleY ?? columnById(profile, first.seriesKey);
    const label =
      derivedLabelText ?? (instruction.aggregate !== null ? aggregateLabel(instruction.aggregate.fn, yColumn.header) : first.seriesLabel);
    return { label, yColumn, points: groupPoints };
  });
}

interface ResolvedPoint {
  value: number | null;
  decimals: number;
  ref: string;
}

/** Mirrors chart.ts's buildPoint: a point executeInstruction already
 * computed (aggregate/derived ran) carries its own value/decimals/rowRef;
 * a still-raw point is parsed fresh under its column's resolved format —
 * the same inline format rule buildPoint itself uses (year columns are
 * always 'en', ambiguous never reaches this point because a chart cannot
 * have been built from one, per instruct/schema.ts's own upstream check). */
function resolvePoint(point: RawPoint, yColumn: ColumnProfile): ResolvedPoint {
  if (point.computed) {
    return { value: point.computed.value, decimals: point.computed.decimals, ref: point.computed.rowRef };
  }
  const format = yColumn.type === 'year' ? 'en' : (yColumn.numberFormat ?? 'nl');
  const value = parseNumber(point.yRaw, format);
  return {
    value,
    decimals: value === null ? 0 : decimalsOf(point.yRaw, format),
    ref: `r${point.rowIndex}:c${columnIndex(yColumn.id)}`,
  };
}

/** Mirrors execute.ts's own private compareSortKey (kept file-private
 * there by design) so which point the reader/picker named FIRST never
 * flips a difference's sign — the same click-order-independence
 * chart-derivation-actions.ts enforces for CBS's resultIds by sorting on
 * periodCode before calling deriveDifference. */
function compareX(a: RawPoint, b: RawPoint): number {
  if (typeof a.xSortKey === 'number' && typeof b.xSortKey === 'number') return a.xSortKey - b.xSortKey;
  return String(a.xSortKey).localeCompare(String(b.xSortKey), 'nl');
}

/**
 * The pure computation behind the own-data `addDerivedOverlay` doorway.
 * `instruction` is the ALREADY-VALIDATED instruction that built the chart
 * the reader is looking at (dataset-derivation-actions.ts revalidates a
 * client-held instruction through the existing instruct/schema.ts allowlist
 * before calling this, the same "never trust a client-echoed shape" rule
 * render.ts already applies to a panel/canvas edit).
 *
 * Guaranteed on any normal return: `value` is a real number and `reason` is
 * absent — every path that would otherwise produce a null value throws
 * OverlaySelectionError instead (a single on-demand request has nothing
 * useful to draw from a null overlay, unlike a many-point chart series,
 * where a gap is shown rather than omitted, U11).
 */
export function deriveChartOverlay(dataset: UserDataset, instruction: ChartInstruction, selection: OverlaySelection): ComputedValue {
  const points = executeInstruction(dataset, instruction);
  const group = groupSeries(dataset, instruction, points).find((g) => g.label === selection.seriesLabel);
  if (group === undefined) {
    throw new OverlaySelectionError(`unknown series '${selection.seriesLabel}' on this chart`);
  }

  if (selection.calcKind === 'mean') {
    if (group.points.length < 2) {
      throw new OverlaySelectionError(`series '${selection.seriesLabel}' has too few points for an average`);
    }
    const resolved = group.points.map((p) => resolvePoint(p, group.yColumn));
    // Skips missing values rather than treating them as 0 or refusing the
    // whole average — matching execute.ts's OWN aggregatePoints 'mean'
    // branch exactly (a fixed convention this file must not reinvent).
    const numeric = resolved.filter((r): r is ResolvedPoint & { value: number } => r.value !== null);
    if (numeric.length === 0) {
      throw new OverlaySelectionError(`no value available to compute an average for series '${selection.seriesLabel}'`);
    }
    const mean = numeric.reduce((sum, r) => sum + r.value, 0) / numeric.length;
    // agg:mean:refs — the exact shape aggregatePoints (execute.ts) uses for
    // a fixed-set aggregate, listing EVERY member's ref (not just the
    // numeric ones) so a missing point stays traceable rather than
    // silently dropped from the ref (U1/U11). resultDecimals is hardcoded
    // to 2 there too, for the same reason: a mean is rarely exact at the
    // source cells' own precision.
    const rowRef = `agg:mean:${resolved.map((r) => r.ref).join('+')}`;
    return { value: mean, decimals: 2, rowRef };
  }

  const [labelA, labelB] = selection.pointLabels;
  // xRaw is trimmed to match — the same normalization aggregatePoints'
  // groupKey and derivePoints' joinKey already apply before comparing x
  // values (execute.ts), and chart.ts's own xLabel is `raw.xRaw.trim()`,
  // so a label the reader saw ON the chart always compares trimmed too.
  const pointA = group.points.find((p) => p.xRaw.trim() === labelA);
  const pointB = group.points.find((p) => p.xRaw.trim() === labelB);
  if (pointA === undefined || pointB === undefined) {
    throw new OverlaySelectionError(`unknown point '${pointA === undefined ? labelA : labelB}' in series '${selection.seriesLabel}'`);
  }
  if (pointA === pointB) {
    throw new OverlaySelectionError('cannot compute a difference between one point and itself');
  }
  const [earlier, later] = compareX(pointA, pointB) <= 0 ? [pointA, pointB] : [pointB, pointA];
  const earlierResolved = resolvePoint(earlier, group.yColumn);
  const laterResolved = resolvePoint(later, group.yColumn);
  if (earlierResolved.value === null || laterResolved.value === null) {
    // Unlike mean, a difference cannot partially resolve — both operands
    // are required, so either one missing refuses the whole request
    // (mirrors derivePoints' own difference precondition in execute.ts:
    // av.value === null || bv.value === null refuses the point there too,
    // just returned as a null-with-reason point instead of a throw, since
    // that call site produces many points, not one on-demand value).
    throw new OverlaySelectionError(`cannot compute a difference — one of the two points in series '${selection.seriesLabel}' has no value`);
  }
  // der:difference:earlier|later — execute.ts's OWN der:${op}:${refA}|${refB}
  // shape, applied here between two POINTS of one series (a period-like
  // pair) rather than execute.ts's own difference op's two COLUMNS on one
  // row; the refs themselves (r{row}:c{col}, or an already-agg:/der:
  // rowRef when a point was itself computed) disambiguate which cells were
  // used, so no new op name or rowRef shape is needed.
  const rowRef = `der:difference:${earlierResolved.ref}|${laterResolved.ref}`;
  return {
    value: laterResolved.value - earlierResolved.value,
    decimals: Math.max(earlierResolved.decimals, laterResolved.decimals),
    rowRef,
  };
}
