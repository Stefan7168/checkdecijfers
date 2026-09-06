// "Eigen data" attachments tier — the H1 boundary's other half. A PURE
// function over dataset.cells: filter -> group by seriesBy -> order -> limit
// -> cap points. No arithmetic in v1 (D7) — every produced value is a
// parsed, stored cell, nothing summed/averaged/derived. No LLM call, no db
// import: this file is deterministic and independently testable by
// construction.
//
// A design decision not spelled out in the original doc (an under-specified
// corner no reviewer's lens happened to cover): seriesBy and multiple y
// columns are not combined. When seriesBy is set, only y[0] is used as the
// value source for every series — mixing "one series per seriesBy value"
// with "one series per y column" would need its own cross-product design
// this feature doesn't need yet (WP202d territory if ever wanted). When
// seriesBy is null, multiple y columns each become their own series
// (comparing measures over the same x-axis), labeled by their own header.
import type { ChartInstruction, ColumnProfile, DatasetProfile, UserDataset } from './types.ts';
import { columnById, columnIndex } from './columns.ts';
import { MAX_CHART_POINTS } from './limits.ts';
import { parseNumber } from './ingest/numbers.ts';

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
}

/** Numeric value of one cell under its column's determined format — 'year'
 * columns have no separator ambiguity, so they parse as plain integers
 * regardless of the dataset's other numberFormat decisions. Code-review
 * finding, session 84: an unresolved 'ambiguous' format now THROWS rather
 * than silently falling through to nl-style parsing — a loud failure if
 * instruct/schema.ts's own ambiguous-format rejection is ever bypassed,
 * never a silently-guessed value (principle c). */
function numericCellValue(raw: string, column: ColumnProfile): number | null {
  if (column.type === 'year') return parseNumber(raw, 'en');
  const format = column.numberFormat ?? 'nl';
  if (format === 'ambiguous') throw new AmbiguousFormatError(column.id);
  return parseNumber(raw, format);
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

/**
 * Selects, groups, orders and limits rows per the validated instruction.
 * Returns one RawPoint per (row, series) — chart.ts turns these into the
 * final UserChartPoint/UserChartSeries shapes, applying the shared Dutch
 * formatter. Throws TooManyPointsError/NoRowsError rather than silently
 * truncating or rendering an unexplained empty chart (D7's "never silent
 * omission" rule, extended in review to the zero-row case).
 */
export function executeInstruction(dataset: UserDataset, instruction: ChartInstruction): RawPoint[] {
  const profile = dataset.profile;
  const xColumn = columnById(profile, instruction.x);
  const yId = instruction.seriesBy !== null ? instruction.y[0]! : undefined;

  const dataRows = dataset.cells.slice(1);
  const matching = dataRows
    .map((row, offset) => ({ row, rowIndex: offset + 1 }))
    .filter(({ row }) => rowPassesFilters(row, instruction, profile));

  if (matching.length === 0) {
    throw new NoRowsError();
  }

  let points: RawPoint[];
  if (instruction.seriesBy !== null) {
    const seriesColumnIndex = columnIndex(instruction.seriesBy);
    const xColumnIndex = columnIndex(instruction.x);
    const yColumnIndex = columnIndex(yId!);
    points = matching.map(({ row, rowIndex }) => ({
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
  } else {
    const xColumnIndex = columnIndex(instruction.x);
    points = matching.flatMap(({ row, rowIndex }) =>
      instruction.y.map((yColumnId) => {
        const yColumn = columnById(profile, yColumnId);
        return {
          rowIndex,
          xRaw: row[xColumnIndex] ?? '',
          xSortKey: xSortKey(row[xColumnIndex] ?? '', xColumn),
          yRaw: row[columnIndex(yColumnId)] ?? '',
          // Code-review finding, session 84: key by the COLUMN ID (always
          // unique), not the header text (two y columns can share a
          // header in a malformed/duplicate-export file) — the header
          // stays the DISPLAY label only.
          seriesKey: yColumnId,
          seriesLabel: yColumn.header,
        };
      }),
    );
  }

  // Order: a line chart ALWAYS orders by x ascending, regardless of `sort`
  // (D7) — a trend line in file order would be meaningless. A bar chart
  // honors an explicit `sort`; with none given, file order is preserved
  // (never guess an ordering the user didn't ask for).
  if (instruction.kind === 'line') {
    points = [...points].sort((a, b) => compareSortKey(a.xSortKey, b.xSortKey));
  } else if (instruction.sort !== null) {
    const { by, direction } = instruction.sort;
    if (by === 'x') {
      points = [...points].sort((a, b) => compareSortKey(a.xSortKey, b.xSortKey));
    } else {
      const sortColumn = columnById(profile, by);
      const sortColumnIndex = columnIndex(by);
      const keyed = points.map((point) => ({
        point,
        key: xSortKey(dataset.cells[point.rowIndex]?.[sortColumnIndex] ?? '', sortColumn),
      }));
      keyed.sort((a, b) => compareSortKey(a.key, b.key));
      points = keyed.map((k) => k.point);
    }
    if (direction === 'desc') points.reverse();
  }

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
