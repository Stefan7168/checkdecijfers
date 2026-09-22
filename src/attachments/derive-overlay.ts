// "Eigen data" attachments tier — the own-data analog of
// src/chart/copilot/map.ts's `addDerivedOverlay` (ADR 056 phases 4/6): the
// reader (via the panel picker or chat) names either two points (a
// difference arrow) or a whole series (an average line), and this file
// computes that value SERVER-SIDE from the dataset's own stored cells — the
// caller only ever supplies rowRefs, never a number (H1). CBS's version
// re-reads an ALREADY-AUDITED answer's own cells by resultId; own-data has
// no audit trail to re-read, but also none of principle (b)'s live-fetch
// restriction to work around, so re-running executeInstruction(dataset,
// instruction) over the already-ingested (bulk-stored, D5) dataset.cells
// cheaply and purely reconstructs "the already-built chart" — the exact
// points chart.ts's buildUserChartSpec would itself produce.
//
// Identified by ROWREF, not label — mirrors web/lib/chart-commands.ts's
// shared `DerivedOverlayRequest.resultIds: string[]` exactly (the SAME
// field CBS's own requestChartDerivation takes), the shape the reader's
// selection is ALREADY resolved into before it ever reaches a command: the
// chat mapper (src/attachments/copilot/map.ts) resolves the model's typed
// labels to rowRefs at mapping time, and the on-screen picker (chart.tsx's
// CBS precedent) resolves a click the same way — a server action should
// never see a label a second time. `mean`'s resultIds are every point of
// the chosen series (mirrors CBS's own addDerivedOverlay passing ALL of a
// series' resultIds for mean, never a subset); `difference`'s are exactly 2.
//
// A NEW file rather than added to execute.ts: chart.ts's own buildPoint
// already resolves a computed-or-raw point's value/decimals/ref WITHOUT
// importing execute.ts's private valueAndDecimals (it duplicates the
// four-line resolution inline) — this file follows that same,
// already-established precedent instead of growing execute.ts's own
// surface for one more caller.
//
// Deterministic, no LLM, no db import — same purity contract as execute.ts's
// own top-of-file comment. Every value returned is either one already-parsed
// stored cell or a fixed arithmetic function (mean/difference) of stored
// cells, carrying a rowRef in execute.ts's own `agg:`/`der:` convention
// (R1's traceability handle, applied one layer up over an already-computed
// chart rather than raw rows).
import { columnById, columnIndex } from './columns.ts';
import { executeInstruction, type RawPoint } from './execute.ts';
import { decimalsOf, parseNumber } from './ingest/numbers.ts';
import type { ChartInstruction, ColumnProfile, UserDataset } from './types.ts';

/** deriveChartOverlay's own return shape — narrower than execute.ts's
 * `ComputedValue` (whose `value: number | null` and optional `reason`
 * describe a point WITHIN a many-point series, where a gap is shown rather
 * than omitted, U11). A single on-demand overlay request has nothing useful
 * to draw from a null value, so every path that would otherwise produce one
 * throws `OverlaySelectionError` instead — `value` here is a real number by
 * construction, not merely by convention, so a caller never needs its own
 * defensive null check for something this function already guarantees. */
export interface ResolvedOverlay {
  value: number;
  decimals: number;
  rowRef: string;
}

/** What to compute: `difference` between exactly two points (`resultIds`
 * length 2 — a mismatched length is a caller bug, refused rather than
 * silently truncated/padded); `mean` over every point of one series
 * (`resultIds` the WHOLE series' own refs — same "all of it, never a
 * subset" convention CBS's own addDerivedOverlay mapping uses). Both name
 * points the same way a stored command already does: by rowRef, resolved
 * ONCE upstream (the chat mapper, or the panel picker's click handler) —
 * never re-resolved from a label here. */
export type OverlaySelection = { calcKind: 'difference' | 'mean'; resultIds: string[] };

/** One reachable "this selection does not resolve to a value" refusal — a
 * named rowRef doesn't exist on this chart (a stale command over an edited
 * dataset, D5's one allowed post-ready mutation reshaping rows/columns), or
 * every candidate value is missing. English (not execute.ts's own Dutch
 * NoRowsError/TooManyPointsError): this class's messages flow straight into
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

/** Exported for verify-whole.ts (Task 4, plan 2026-09-22): the own-data
 * "verified whole" check needs the SAME rowRef -> real-value resolution this
 * file already built for the difference/mean overlay — re-deriving it a
 * second time would risk the two copies silently drifting (e.g. if the
 * format rule in resolvePoint below ever changes). Kept in this file rather
 * than execute.ts (this file's own header comment already explains why: it
 * mirrors chart.ts's buildPoint precedent of a small local resolution
 * rather than growing execute.ts's surface for one more caller). */
export interface ResolvedPoint {
  value: number | null;
  decimals: number;
  ref: string;
  xSortKey: RawPoint['xSortKey'];
  /** Carried from execute.ts's ComputedValue.incomplete (#314). */
  incomplete?: true;
}

/** Mirrors chart.ts's buildPoint: a point executeInstruction already
 * computed (aggregate/derived ran) carries its own value/decimals/rowRef;
 * a still-raw point is parsed fresh under its column's resolved format —
 * the same inline format rule buildPoint itself uses (year columns are
 * always 'en', ambiguous never reaches this point because a chart cannot
 * have been built from one, per instruct/schema.ts's own upstream check). */
function resolvePoint(point: RawPoint, yColumn: ColumnProfile): ResolvedPoint {
  if (point.computed) {
    return {
      value: point.computed.value,
      decimals: point.computed.decimals,
      ref: point.computed.rowRef,
      xSortKey: point.xSortKey,
      ...(point.computed.incomplete ? { incomplete: true as const } : {}),
    };
  }
  const format = yColumn.type === 'year' ? 'en' : (yColumn.numberFormat ?? 'nl');
  const value = parseNumber(point.yRaw, format);
  return {
    value,
    decimals: value === null ? 0 : decimalsOf(point.yRaw, format),
    ref: `r${point.rowIndex}:c${columnIndex(yColumn.id)}`,
    xSortKey: point.xSortKey,
  };
}

/** Every point executeInstruction would draw, resolved and indexed by its
 * OWN rowRef — the lookup a `resultIds` selection is checked against.
 * yColumn is resolved per point (not per pre-grouped series, since nothing
 * here needs a series' DISPLAYED label any more, only which column format
 * to parse a raw point's value under): `instruction.seriesBy` set means one
 * shared y column for every series (chart.ts's own `singleY` rule);
 * unset means each point's own seriesKey names its column directly. */
export function allResolvedPoints(dataset: UserDataset, instruction: ChartInstruction): Map<string, ResolvedPoint> {
  const profile = dataset.profile;
  const singleY = instruction.seriesBy !== null ? columnById(profile, instruction.y[0]!) : null;
  const byRef = new Map<string, ResolvedPoint>();
  for (const point of executeInstruction(dataset, instruction)) {
    const yColumn = singleY ?? columnById(profile, point.seriesKey);
    const resolved = resolvePoint(point, yColumn);
    byRef.set(resolved.ref, resolved);
  }
  return byRef;
}

/** Mirrors execute.ts's own private compareSortKey (kept file-private
 * there by design) so which point the reader/picker named FIRST never
 * flips a difference's sign — the same click-order-independence
 * chart-derivation-actions.ts enforces for CBS's resultIds by sorting on
 * periodCode before calling deriveDifference. */
function compareX(a: ResolvedPoint, b: ResolvedPoint): number {
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
export function deriveChartOverlay(dataset: UserDataset, instruction: ChartInstruction, selection: OverlaySelection): ResolvedOverlay {
  const byRef = allResolvedPoints(dataset, instruction);

  if (selection.calcKind === 'mean') {
    if (selection.resultIds.length < 2) {
      throw new OverlaySelectionError('too few points for an average');
    }
    const resolved = selection.resultIds.map((ref) => {
      const point = byRef.get(ref);
      if (point === undefined) throw new OverlaySelectionError(`unknown point '${ref}' on this chart`);
      return point;
    });
    // Skips missing values rather than treating them as 0 or refusing the
    // whole average — matching execute.ts's OWN aggregatePoints 'mean'
    // branch exactly (a fixed convention this file must not reinvent).
    const numeric = resolved.filter((r): r is ResolvedPoint & { value: number } => r.value !== null);
    if (numeric.length === 0) {
      throw new OverlaySelectionError('no value available to compute an average');
    }
    const mean = numeric.reduce((sum, r) => sum + r.value, 0) / numeric.length;
    // agg:mean:refs — the exact shape aggregatePoints (execute.ts) uses for
    // a fixed-set aggregate, listing EVERY member's ref (not just the
    // numeric ones) so a missing point stays traceable rather than
    // silently dropped from the ref (U1/U11). decimals is hardcoded to 2
    // there too, for the same reason: a mean is rarely exact at the source
    // cells' own precision.
    const rowRef = `agg:mean:${resolved.map((r) => r.ref).join('+')}`;
    return { value: mean, decimals: 2, rowRef };
  }

  if (selection.resultIds.length !== 2) {
    throw new OverlaySelectionError('a difference needs exactly two points');
  }
  const [refA, refB] = selection.resultIds as [string, string];
  if (refA === refB) {
    throw new OverlaySelectionError('cannot compute a difference between one point and itself');
  }
  const pointA = byRef.get(refA);
  const pointB = byRef.get(refB);
  if (pointA === undefined || pointB === undefined) {
    throw new OverlaySelectionError(`unknown point '${pointA === undefined ? refA : refB}' on this chart`);
  }
  const [earlier, later] = compareX(pointA, pointB) <= 0 ? [pointA, pointB] : [pointB, pointA];
  if (earlier.value === null || later.value === null) {
    // Unlike mean, a difference cannot partially resolve — both operands
    // are required, so either one missing refuses the whole request
    // (mirrors derivePoints' own difference precondition in execute.ts:
    // av.value === null || bv.value === null refuses the point there too,
    // just returned as a null-with-reason point instead of a throw, since
    // that call site produces many points, not one on-demand value).
    throw new OverlaySelectionError('cannot compute a difference — one of the two points has no value');
  }
  // der:difference:earlier|later — execute.ts's OWN der:${op}:${refA}|${refB}
  // shape, applied here between two POINTS of one series (a period-like
  // pair) rather than execute.ts's own difference op's two COLUMNS on one
  // row; the refs themselves (r{row}:c{col}, or an already-agg:/der:
  // rowRef when a point was itself computed) disambiguate which cells were
  // used, so no new op name or rowRef shape is needed.
  const rowRef = `der:difference:${earlier.ref}|${later.ref}`;
  return {
    value: later.value - earlier.value,
    decimals: Math.max(earlier.decimals, later.decimals),
    rowRef,
  };
}
