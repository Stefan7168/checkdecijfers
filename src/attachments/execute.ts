// "Eigen data" attachments tier — the H1 boundary's other half. A PURE
// function over dataset.cells: filter -> select -> aggregate -> derive ->
// sort -> limit -> cap points. Phase 2: the fixed aggregate/derived set
// (session 113) is computed HERE, never by the model — every produced value
// is either a parsed, stored cell, or a deterministic function of stored
// cells (sum/mean/min/max/count; difference/ratio/share_of_total/
// percent_change) with a traceable rowRef (U1). No LLM call, no db import:
// this file is deterministic and independently testable by construction.
//
// A design decision not spelled out in the original doc (an under-specified
// corner no reviewer's lens happened to cover): seriesBy and multiple y
// columns are not combined. When seriesBy is set, only y[0] is used as the
// value source for every series — mixing "one series per seriesBy value"
// with "one series per y column" would need its own cross-product design
// this feature doesn't need yet (WP202d territory if ever wanted). When
// seriesBy is null, multiple y columns each become their own series
// (comparing measures over the same x-axis), labeled by their own header —
// and, if instruction.aggregate is set, each is aggregated independently.
import type {
  AggregateFn,
  ChartInstruction,
  ColumnId,
  ColumnProfile,
  DatasetProfile,
  DerivedOp,
  MissingValueReason,
  UserDataset,
} from './types.ts';
import { columnById, columnIndex } from './columns.ts';
import { MAX_CHART_POINTS } from './limits.ts';
import { decimalsOf, parseNumber } from './ingest/numbers.ts';

export class TooManyPointsError extends Error {
  constructor(count: number) {
    super(`deze grafiek zou ${count} punten hebben, meer dan de ${MAX_CHART_POINTS} limiet — filter eerst`);
    this.name = 'TooManyPointsError';
  }
}

export class NoRowsError extends Error {
  constructor() {
    super('geen rijen voldoen aan dit filter');
    this.name = 'NoRowsError';
  }
}

export class AmbiguousFormatError extends Error {
  constructor(columnId: string) {
    super(
      `internal: column '${columnId}' has an unresolved ambiguous number format ` +
        `(should have been rejected by instruct/schema.ts before reaching execute.ts)`,
    );
    this.name = 'AmbiguousFormatError';
  }
}

/** One computed (aggregated/derived) plotted value, carrying its own
 * rowRef distinct from the plain per-cell `r{row}:c{col}` shape (U1) —
 * `agg:${fn}:${refs...}` or `der:${op}:${refA}|${refB|prev:..|total:..}`.
 * `reason` uses the same MissingValueReason vocabulary UserChartPoint does
 * (R11 analog: a gap is shown, never silently omitted). */
export interface ComputedValue {
  value: number | null;
  decimals: number;
  rowRef: string;
  reason?: MissingValueReason;
}

interface RawPoint {
  rowIndex: number;
  xRaw: string;
  xSortKey: number | string;
  yRaw: string;
  /** Groups points into a UserChartSeries — code-review finding, session
   * 84: this must be a value guaranteed distinct per real series (a column
   * id, or a seriesBy distinct value), NEVER a display header alone. Two y
   * columns sharing an identical header (a realistic malformed/duplicate
   * export) would otherwise silently merge into one series. */
  seriesKey: string;
  seriesLabel: string;
  /** Set by aggregatePoints/derivePoints (phase 2) once a point's value is
   * no longer one raw cell — chart.ts prefers this over re-parsing yRaw
   * whenever it is present. */
  computed?: ComputedValue;
}

/** Numeric value of one cell under its column's determined format — 'year'
 * columns have no separator ambiguity, so they parse as plain integers
 * regardless of the dataset's other numberFormat decisions. Code-review
 * finding, session 84: an unresolved 'ambiguous' format now THROWS rather
 * than silently falling through to nl-style parsing — a loud failure if
 * instruct/schema.ts's own ambiguous-format rejection is ever bypassed,
 * never a silently-guessed value (principle c). */
function resolvedFormat(column: ColumnProfile): 'nl' | 'en' {
  if (column.type === 'year') return 'en';
  const format = column.numberFormat ?? 'nl';
  if (format === 'ambiguous') throw new AmbiguousFormatError(column.id);
  return format;
}

function numericCellValue(raw: string, column: ColumnProfile): number | null {
  return parseNumber(raw, resolvedFormat(column));
}

function rowPassesFilters(
  row: readonly string[],
  instruction: ChartInstruction,
  profile: DatasetProfile,
): boolean {
  for (const filter of instruction.filters) {
    const column = columnById(profile, filter.column);
    const raw = (row[columnIndex(filter.column)] ?? '').trim();
    if (filter.op === 'in') {
      if (!filter.values.includes(raw)) return false;
    } else {
      const value = numericCellValue(raw, column);
      if (value === null || value < filter.from || value > filter.to) return false;
    }
  }
  return true;
}

function xSortKey(raw: string, column: ColumnProfile): number | string {
  if (column.type === 'year' || column.type === 'number') {
    return numericCellValue(raw, column) ?? Number.POSITIVE_INFINITY;
  }
  // 'date' (ISO, lexicographically ordered) and 'text' both sort correctly
  // as plain strings for this purpose.
  return raw;
}

/** One matched (filtered) source row, carrying its 1-based index into
 * dataset.cells (row 0 is the header row). */
interface MatchedRow {
  row: readonly string[];
  rowIndex: number;
}

/**
 * Selects ONE y column's rows into RawPoints, unaggregated, unsorted — the
 * per-column half of what executeInstruction used to do inline for both
 * its seriesBy and multi-y branches. Called once per y column (or once for
 * `derived.b`), independently of instruction.y, so the aggregate/derived
 * pipeline can select `a` and `b` through the exact same code path.
 */
function selectPoints(
  matching: readonly MatchedRow[],
  profile: DatasetProfile,
  instruction: ChartInstruction,
  yId: ColumnId,
): RawPoint[] {
  const xColumn = columnById(profile, instruction.x);
  const xColumnIndex = columnIndex(instruction.x);
  const yColumnIndex = columnIndex(yId);

  if (instruction.seriesBy !== null) {
    const seriesColumnIndex = columnIndex(instruction.seriesBy);
    return matching.map(({ row, rowIndex }) => ({
      rowIndex,
      xRaw: row[xColumnIndex] ?? '',
      xSortKey: xSortKey(row[xColumnIndex] ?? '', xColumn),
      yRaw: row[yColumnIndex] ?? '',
      // The seriesBy column's raw value IS the natural grouping key here —
      // no header-collision risk (distinct values within one column are
      // already unique by construction).
      seriesKey: (row[seriesColumnIndex] ?? '').trim(),
      seriesLabel: (row[seriesColumnIndex] ?? '').trim(),
    }));
  }

  const yColumn = columnById(profile, yId);
  return matching.map(({ row, rowIndex }) => ({
    rowIndex,
    xRaw: row[xColumnIndex] ?? '',
    xSortKey: xSortKey(row[xColumnIndex] ?? '', xColumn),
    yRaw: row[yColumnIndex] ?? '',
    // Code-review finding, session 84: key by the COLUMN ID (always
    // unique), not the header text (two y columns can share a header in a
    // malformed/duplicate-export file) — the header stays the DISPLAY
    // label only.
    seriesKey: yId,
    seriesLabel: yColumn.header,
  }));
}

/**
 * Groups `points` (one y column's unaggregated RawPoints) by
 * `(seriesKey, xRaw.trim())` and reduces each group through `fn`. Group
 * order is first-appearance order (the order `points` already carries —
 * file order pre-sort). `rowRef = agg:${fn}:${refs.join('+')}` lists every
 * member row's cell ref, INCLUDING ones with no numeric value (a null/
 * empty cell is still traceable, never silently dropped from the ref —
 * U1/U11) — only the numeric ones feed the actual computation.
 */
function aggregatePoints(points: readonly RawPoint[], fn: AggregateFn, yColumn: ColumnProfile): RawPoint[] {
  interface Group {
    seriesKey: string;
    seriesLabel: string;
    xRaw: string;
    xSortKey: number | string;
    members: RawPoint[];
  }
  const groups = new Map<string, Group>();
  const order: string[] = [];
  for (const point of points) {
    const groupKey = `${point.seriesKey} ${point.xRaw.trim()}`;
    let group = groups.get(groupKey);
    if (group === undefined) {
      group = { seriesKey: point.seriesKey, seriesLabel: point.seriesLabel, xRaw: point.xRaw, xSortKey: point.xSortKey, members: [] };
      groups.set(groupKey, group);
      order.push(groupKey);
    }
    group.members.push(point);
  }

  const yColumnIndex = columnIndex(yColumn.id);
  return order.map((key) => {
    const group = groups.get(key)!;
    const refs = group.members.map((m) => `r${m.rowIndex}:c${yColumnIndex}`);
    const rowRef = `agg:${fn}:${refs.join('+')}`;
    const numericMembers = group.members
      .map((m) => ({ value: numericCellValue(m.yRaw, yColumn), raw: m.yRaw }))
      .filter((m): m is { value: number; raw: string } => m.value !== null);
    const values = numericMembers.map((m) => m.value);
    const decimals =
      numericMembers.length === 0 ? 0 : Math.max(...numericMembers.map((m) => decimalsOf(m.raw, resolvedFormat(yColumn))));

    let value: number | null;
    let resultDecimals = decimals;
    if (fn === 'count') {
      value = group.members.length;
      resultDecimals = 0;
    } else if (fn === 'mean') {
      value = values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
      resultDecimals = 2;
    } else if (fn === 'sum') {
      value = values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
    } else if (fn === 'min') {
      value = values.length === 0 ? null : Math.min(...values);
    } else {
      value = values.length === 0 ? null : Math.max(...values);
    }

    return {
      rowIndex: group.members[0]!.rowIndex,
      xRaw: group.xRaw,
      xSortKey: group.xSortKey,
      // No longer one traceable cell — chart.ts's sourceText rule reads
      // this as '' whenever the point's rowRef starts with 'agg:'.
      yRaw: '',
      seriesKey: group.seriesKey,
      seriesLabel: group.seriesLabel,
      computed: { value, decimals: resultDecimals, rowRef },
    };
  });
}

/** A point's plotted value/decimals/traceability ref, whichever stage
 * produced it — already computed (aggregate ran) or still one raw cell. */
function valueAndDecimals(point: RawPoint, column: ColumnProfile): { value: number | null; decimals: number; ref: string } {
  if (point.computed) {
    return { value: point.computed.value, decimals: point.computed.decimals, ref: point.computed.rowRef };
  }
  const value = numericCellValue(point.yRaw, column);
  const decimals = value === null ? 0 : decimalsOf(point.yRaw, resolvedFormat(column));
  return { value, decimals, ref: `r${point.rowIndex}:c${columnIndex(column.id)}` };
}

function joinKey(point: RawPoint, seriesBy: ColumnId | null): string {
  return seriesBy !== null ? `${point.seriesKey} ${point.xRaw.trim()}` : point.xRaw.trim();
}

/**
 * Computes `derived.op` over `aPoints` (already selected, and aggregated if
 * instruction.aggregate was set) and, for difference/ratio, a matching
 * `bPoints` (selected/aggregated exactly like `a`, joined by
 * (seriesKey, xKey) — the effective series identity, not the raw column
 * id: when seriesBy is null there is only ever one implicit series, so the
 * join key collapses to xKey alone). Processes each series in x order
 * (sorted by xSortKey) so percent_change's "previous point" is always the
 * chronologically-previous one, regardless of the instruction's own
 * display `sort` (applied afterwards, by sortPoints).
 */
function derivePoints(
  aPoints: readonly RawPoint[],
  bPoints: readonly RawPoint[] | null,
  op: DerivedOp,
  aColumn: ColumnProfile,
  bColumn: ColumnProfile | null,
  seriesBy: ColumnId | null,
): RawPoint[] {
  const seriesOrder: string[] = [];
  const bySeries = new Map<string, RawPoint[]>();
  for (const point of aPoints) {
    let bucket = bySeries.get(point.seriesKey);
    if (bucket === undefined) {
      bucket = [];
      bySeries.set(point.seriesKey, bucket);
      seriesOrder.push(point.seriesKey);
    }
    bucket.push(point);
  }

  const bByKey = bPoints === null ? null : new Map(bPoints.map((p) => [joinKey(p, seriesBy), p] as const));

  const result: RawPoint[] = [];
  for (const seriesKey of seriesOrder) {
    const seriesPoints = [...bySeries.get(seriesKey)!].sort((a, b) => compareSortKey(a.xSortKey, b.xSortKey));
    const aVals = seriesPoints.map((p) => valueAndDecimals(p, aColumn));

    if (op === 'share_of_total') {
      const nonNull = aVals.filter((v) => v.value !== null);
      const total = nonNull.reduce((sum, v) => sum + v.value!, 0);
      const n = nonNull.length;
      seriesPoints.forEach((p, i) => {
        const av = aVals[i]!;
        const value = av.value === null || total === 0 ? null : (av.value / total) * 100;
        const reason: MissingValueReason | undefined = av.value === null ? 'geen getal' : undefined;
        result.push({
          ...p,
          computed: { value, decimals: 1, rowRef: `der:share_of_total:${av.ref}|total:${n}`, ...(reason ? { reason } : {}) },
        });
      });
      continue;
    }

    if (op === 'percent_change') {
      seriesPoints.forEach((p, i) => {
        const av = aVals[i]!;
        if (i === 0) {
          result.push({
            ...p,
            computed: { value: null, decimals: 1, rowRef: `der:percent_change:${av.ref}`, reason: 'geen vorige waarde' },
          });
          return;
        }
        const prev = aVals[i - 1]!;
        let value: number | null;
        let reason: MissingValueReason | undefined;
        if (av.value === null || prev.value === null || prev.value === 0) {
          value = null;
          reason = 'geen getal';
        } else {
          value = ((av.value - prev.value) / Math.abs(prev.value)) * 100;
        }
        result.push({
          ...p,
          computed: {
            value,
            decimals: 1,
            rowRef: `der:percent_change:${av.ref}|prev:${prev.ref}`,
            ...(reason ? { reason } : {}),
          },
        });
      });
      continue;
    }

    // difference / ratio — both need b.
    seriesPoints.forEach((p, i) => {
      const av = aVals[i]!;
      const bPoint = bByKey?.get(joinKey(p, seriesBy)) ?? null;
      const bv = bPoint !== null && bColumn !== null ? valueAndDecimals(bPoint, bColumn) : null;

      let value: number | null;
      let decimals: number;
      let reason: MissingValueReason | undefined;
      if (av.value === null || bv === null || bv.value === null) {
        value = null;
        decimals = op === 'ratio' ? 2 : av.decimals;
        reason = 'geen getal';
      } else if (op === 'difference') {
        value = av.value - bv.value;
        decimals = Math.max(av.decimals, bv.decimals);
      } else if (bv.value === 0) {
        value = null;
        decimals = 2;
        reason = 'geen getal';
      } else {
        value = av.value / bv.value;
        decimals = 2;
      }

      // 'none' sentinel: no b row/group joined at all (as opposed to a
      // joined b whose own value is null) — still a real, distinguishable
      // rowRef suffix, never silently merged with the joined-but-null case.
      const refB = bv?.ref ?? 'none';
      result.push({
        ...p,
        computed: { value, decimals, rowRef: `der:${op}:${av.ref}|${refB}`, ...(reason ? { reason } : {}) },
      });
    });
  }
  return result;
}

/** The plotted value a 'value' sort orders by — already computed
 * (aggregate/derived ran) or still one raw cell, resolving the y column
 * the same way chart.ts's singleY does (seriesKey IS the y column id
 * unless seriesBy grouped by something else entirely). */
function valueOf(point: RawPoint, profile: DatasetProfile, instruction: ChartInstruction): number | null {
  if (point.computed) return point.computed.value;
  const yColumn = instruction.seriesBy !== null ? columnById(profile, instruction.y[0]!) : columnById(profile, point.seriesKey);
  return numericCellValue(point.yRaw, yColumn);
}

/**
 * Order: a line chart ALWAYS orders by x ascending, regardless of `sort`
 * (D7) — a trend line in file order would be meaningless. A bar chart
 * honors an explicit `sort`; with none given, file order (or, post-
 * aggregate/derive, group-first-appearance order) is preserved (never
 * guess an ordering the user didn't ask for). `by: 'value'` orders by the
 * plotted (possibly computed) value, nulls always last regardless of
 * direction (U11 — a missing value is never implied to be "least").
 */
function sortPoints(
  points: readonly RawPoint[],
  instruction: ChartInstruction,
  dataset: UserDataset,
  profile: DatasetProfile,
): RawPoint[] {
  if (instruction.kind === 'line') {
    return [...points].sort((a, b) => compareSortKey(a.xSortKey, b.xSortKey));
  }
  if (instruction.sort === null) return [...points];

  const { by, direction } = instruction.sort;

  if (by === 'value') {
    const withValue = points.map((p) => ({ p, v: valueOf(p, profile, instruction) }));
    const nonNull = withValue.filter((x) => x.v !== null);
    const nulls = withValue.filter((x) => x.v === null);
    nonNull.sort((a, b) => (a.v as number) - (b.v as number));
    if (direction === 'desc') nonNull.reverse();
    return [...nonNull, ...nulls].map((x) => x.p);
  }

  let sorted: RawPoint[];
  if (by === 'x') {
    sorted = [...points].sort((a, b) => compareSortKey(a.xSortKey, b.xSortKey));
  } else {
    const sortColumn = columnById(profile, by);
    const sortColumnIndex = columnIndex(by);
    const keyed = points.map((point) => ({
      point,
      key: xSortKey(dataset.cells[point.rowIndex]?.[sortColumnIndex] ?? '', sortColumn),
    }));
    keyed.sort((a, b) => compareSortKey(a.key, b.key));
    sorted = keyed.map((k) => k.point);
  }
  if (direction === 'desc') sorted.reverse();
  return sorted;
}

/**
 * Selects, aggregates/derives, orders and limits rows per the validated
 * instruction. Returns one RawPoint per (row-or-group, series) —
 * chart.ts turns these into the final UserChartSpec shapes, applying the
 * shared Dutch formatter. Throws TooManyPointsError/NoRowsError rather
 * than silently truncating or rendering an unexplained empty chart (D7's
 * "never silent omission" rule, extended in review to the zero-row case).
 * `instruction.aggregate ?? null` / `instruction.derived ?? null` are read
 * defensively (both fields, via ChartInstruction's own required-but-
 * nullable typing) so a stored v1 row — upgraded by upgradeInstruction —
 * still reconstructs byte-identically: aggregate/derived null is a no-op
 * at every stage below.
 */
export function executeInstruction(dataset: UserDataset, instruction: ChartInstruction): RawPoint[] {
  const profile = dataset.profile;

  const dataRows = dataset.cells.slice(1);
  const matching = dataRows
    .map((row, offset) => ({ row, rowIndex: offset + 1 }))
    .filter(({ row }) => rowPassesFilters(row, instruction, profile));

  if (matching.length === 0) {
    throw new NoRowsError();
  }

  // derived requires exactly one y column (instruct/schema.ts); seriesBy
  // has always restricted to y[0] alone.
  const yIds = instruction.seriesBy !== null || instruction.derived !== null ? [instruction.y[0]!] : instruction.y;
  const aggregate = instruction.aggregate ?? null;

  let points: RawPoint[] = yIds.flatMap((yId) => {
    let seriesPoints = selectPoints(matching, profile, instruction, yId);
    if (aggregate !== null) {
      seriesPoints = aggregatePoints(seriesPoints, aggregate.fn, columnById(profile, yId));
    }
    return seriesPoints;
  });

  const derived = instruction.derived ?? null;
  if (derived !== null) {
    const aColumn = columnById(profile, instruction.y[0]!);
    const bId = derived.b;
    let bPoints: RawPoint[] | null = null;
    let bColumn: ColumnProfile | null = null;
    if (bId !== null) {
      bColumn = columnById(profile, bId);
      bPoints = selectPoints(matching, profile, instruction, bId);
      if (aggregate !== null) {
        bPoints = aggregatePoints(bPoints, aggregate.fn, bColumn);
      }
    }
    points = derivePoints(points, bPoints, derived.op, aColumn, bColumn, instruction.seriesBy);
  }

  points = sortPoints(points, instruction, dataset, profile);

  if (instruction.limit !== null) {
    points = points.slice(0, instruction.limit);
  }

  if (points.length > MAX_CHART_POINTS) {
    throw new TooManyPointsError(points.length);
  }

  return points;
}

function compareSortKey(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'nl');
}

export type { RawPoint };
