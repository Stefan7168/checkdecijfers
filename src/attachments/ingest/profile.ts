// "Eigen data" attachments tier — builds the closed vocabulary (D6, the R2
// analog) from parsed cells. This is the ONLY place a DatasetProfile is
// produced; instruct/schema.ts trusts every id/range/distinct-list it
// contains because this function built it directly from the dataset's own
// stored cells.
import type { ColumnProfile, ColumnType, DatasetProfile, NumberFormat } from '../types.ts';
import { MAX_DISTINCT_VALUES } from '../limits.ts';
import { detectNumberFormat, parseNumber } from './numbers.ts';

/** Missing-value markers that don't disqualify a column from being
 * classified 'number'/'year'/'date' — the U11 "n.v.t." fixture plus the
 * common blank/dash conventions. Anything else that fails a type's shape
 * check means the column falls through to 'text'. */
const MISSING_MARKERS = new Set(['', 'n.v.t.', 'nvt', '-', '.']);

function isMissing(cell: string): boolean {
  return MISSING_MARKERS.has(cell.trim().toLowerCase());
}

const YEAR_RE = /^\d{4}$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;
const NUMBER_SHAPE_RE = /^-?[\d.,]+$/;

function isYear(cell: string): boolean {
  if (!YEAR_RE.test(cell)) return false;
  const year = Number.parseInt(cell, 10);
  return year >= 1900 && year <= 2100;
}

function isDate(cell: string): boolean {
  return DATE_RE.test(cell);
}

function isNumberShaped(cell: string): boolean {
  return NUMBER_SHAPE_RE.test(cell) && /\d/.test(cell);
}

/** All non-empty, non-missing-marker values match `test` — the column
 * classifies as that type only when EVERY real value fits (principle c:
 * never guess a type past what the data actually shows). */
function everyRealValueMatches(values: readonly string[], test: (cell: string) => boolean): boolean {
  let sawReal = false;
  for (const raw of values) {
    const cell = raw.trim();
    if (isMissing(cell)) continue;
    sawReal = true;
    if (!test(cell)) return false;
  }
  return sawReal;
}

function classifyType(values: readonly string[]): ColumnType {
  if (everyRealValueMatches(values, isYear)) return 'year';
  if (everyRealValueMatches(values, isDate)) return 'date';
  if (everyRealValueMatches(values, isNumberShaped)) return 'number';
  return 'text';
}

function distinctValues(values: readonly string[]): { distinct: string[]; truncated: boolean } {
  const seen = new Set<string>();
  for (const raw of values) {
    const cell = raw.trim();
    if (isMissing(cell)) continue;
    seen.add(cell);
  }
  const sorted = [...seen].sort((a, b) => a.localeCompare(b, 'nl'));
  return {
    distinct: sorted.slice(0, MAX_DISTINCT_VALUES),
    truncated: sorted.length > MAX_DISTINCT_VALUES,
  };
}

/**
 * Code-review finding, session 84: an 'ambiguous' format now returns NO
 * range at all (was: a crude, format-blind `parseFloat(cell.replace(',',
 * '.'))` fallback that manufactured a plausible-looking min/max). D5 is
 * explicit that an ambiguous column blocks charting until the user
 * disambiguates — giving it a real-looking range let instruct/schema.ts's
 * 'between' filter check (which only tests for undefined min/max) validate
 * successfully on a column that was never actually resolved. Leaving the
 * range genuinely absent means that check does its job with no separate
 * ambiguity check needed there.
 */
function numericRange(values: readonly string[], format: NumberFormat): { min?: number; max?: number } {
  if (format === 'ambiguous') return {};
  let min: number | undefined;
  let max: number | undefined;
  for (const raw of values) {
    const cell = raw.trim();
    if (isMissing(cell)) continue;
    const parsed = parseNumber(cell, format);
    if (parsed === null || !Number.isFinite(parsed)) continue;
    min = min === undefined ? parsed : Math.min(min, parsed);
    max = max === undefined ? parsed : Math.max(max, parsed);
  }
  return { min, max };
}

/** Builds one column's profile from its header + the full data-row column.
 * `distinct` is given to 'text'/'year'/'date' columns (fixed in review: the
 * original design only gave text columns a distinct list, leaving an `in`
 * filter on a low-cardinality year/date column nothing to validate
 * against) — a high-cardinality 'number' column carries no distinct list
 * at all, which is exactly what makes `in` illegal on it (instruct/schema.ts). */
function buildColumnProfile(id: string, header: string, values: readonly string[]): ColumnProfile {
  const nulls = values.filter((cell) => isMissing(cell)).length;
  const type = classifyType(values);
  const sample = values.filter((cell) => !isMissing(cell.trim())).slice(0, 3);

  const profile: ColumnProfile = { id, header, type, nulls };
  if (sample.length > 0) profile.sample = sample;

  if (type === 'text' || type === 'year' || type === 'date') {
    const { distinct, truncated } = distinctValues(values);
    profile.distinct = distinct;
    profile.distinctTruncated = truncated;
  }
  if (type === 'year') {
    // A 4-digit year has no thousands/decimal separator either way — plain
    // integer parsing, no format guess needed.
    const { min, max } = numericRange(values, 'en');
    if (min !== undefined) profile.min = min;
    if (max !== undefined) profile.max = max;
  }
  if (type === 'number') {
    const format = detectNumberFormat(values);
    profile.numberFormat = format;
    const { min, max } = numericRange(values, format);
    if (min !== undefined) profile.min = min;
    if (max !== undefined) profile.max = max;
  }
  return profile;
}

/**
 * Builds the closed vocabulary from parsed cells (header row + data rows).
 * `rowCount` counts DATA rows only, matching csv.ts's row cap (D3/D6).
 */
export function buildDatasetProfile(cells: readonly string[][]): DatasetProfile {
  const header = cells[0] ?? [];
  const dataRows = cells.slice(1);
  const columns = header.map((columnHeader, index) => {
    const values = dataRows.map((row) => row[index] ?? '');
    return buildColumnProfile(`c${index}`, columnHeader, values);
  });
  return { columns, rowCount: dataRows.length };
}
