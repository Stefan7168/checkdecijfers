// "Eigen data" attachments tier — deterministic numeric-format detection and
// parsing (D5, the parsing-level application of principle (c): ambiguity is
// asked, never guessed). No LLM involvement anywhere in this file; every
// decision here is either definite (proven by the cell text itself) or
// explicitly 'ambiguous', which blocks charting until the user answers the
// profile card's two-chip disambiguation (ingest/profile.ts).
//
// 'nl' = dot is the thousands separator, comma is decimal (StatLine's own
// convention). 'en' = comma is the thousands separator, dot is decimal.
import type { NumberFormat } from '../types.ts';

type CellSignal = 'nl' | 'en' | 'ambiguous-single' | 'no-signal';

/** Digits-only body after stripping an optional leading sign, or null if the
 * text isn't number-shaped at all (contains anything other than digits,
 * '.', ',', an optional leading '-'). */
function numericBody(raw: string): string | null {
  const trimmed = raw.trim();
  const body = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
  if (body.length === 0 || !/^[\d.,]+$/.test(body) || !/\d/.test(body)) return null;
  return body;
}

/**
 * What one cell's own text proves about the column's separator convention.
 *
 * - Both '.' and ',' present: the LAST one occurring is the decimal
 *   separator (D5's original rule) — definite, no ambiguity possible.
 * - 2+ of the SAME separator, none of the other: a real number has at most
 *   one decimal point, so 2+ occurrences can only be thousands-grouping —
 *   definite (fixed in review: the original draft left multi-group cells
 *   like "1.234.567" to an unwritten implementation detail).
 * - Exactly one separator, with exactly 3 digits after it: this is the
 *   single genuinely ambiguous shape — "9.800"/"9,800" could be either
 *   convention's thousands-grouped integer or the other's decimal fraction.
 * - Exactly one separator, with a digit count OTHER than 3: thousands
 *   grouping is ALWAYS exactly 3 digits, so a different count proves this
 *   separator is decimal, not grouping — definite.
 * - No separator at all (a plain integer), or not number-shaped: no signal
 *   either way.
 */
function classifyCell(raw: string): CellSignal {
  const body = numericBody(raw);
  if (body === null) return 'no-signal';

  const dotCount = (body.match(/\./g) ?? []).length;
  const commaCount = (body.match(/,/g) ?? []).length;

  if (dotCount > 0 && commaCount > 0) {
    return body.lastIndexOf(',') > body.lastIndexOf('.') ? 'nl' : 'en';
  }
  if (dotCount >= 2) return 'nl';
  if (commaCount >= 2) return 'en';
  if (dotCount === 1) {
    const digitsAfter = body.length - body.lastIndexOf('.') - 1;
    return digitsAfter === 3 ? 'ambiguous-single' : 'en';
  }
  if (commaCount === 1) {
    const digitsAfter = body.length - body.lastIndexOf(',') - 1;
    return digitsAfter === 3 ? 'ambiguous-single' : 'nl';
  }
  return 'no-signal';
}

/**
 * Deterministically decides one column's NumberFormat from its own cell
 * text — never from a guess. A DEFINITE signal from any cell (multi-group,
 * mixed-separator, or a non-3-digit single separator) resolves the whole
 * column, including any single-separator-3-digit cells that looked
 * ambiguous alone (column-wide consistency: this dataset is a single file,
 * not a mix of locales). Contradictory definite signals (a real
 * data-quality problem — e.g. one cell CSV-glued from a different locale)
 * fall back to 'ambiguous' rather than picking one side.
 */
export function detectNumberFormat(cellValues: readonly string[]): NumberFormat {
  let definite: 'nl' | 'en' | null = null;
  let sawAmbiguousSingle = false;

  for (const raw of cellValues) {
    const signal = classifyCell(raw);
    if (signal === 'no-signal') continue;
    if (signal === 'ambiguous-single') {
      sawAmbiguousSingle = true;
      continue;
    }
    if (definite === null) {
      definite = signal;
    } else if (definite !== signal) {
      return 'ambiguous';
    }
  }

  if (definite !== null) return definite;
  if (sawAmbiguousSingle) return 'ambiguous';
  // No separators anywhere (every cell a plain integer, or empty/blank) —
  // both conventions agree on plain integers, so the format is moot; 'nl'
  // is the deterministic default for this column's future parseNumber calls.
  return 'nl';
}

export class AmbiguousNumberFormatError extends Error {
  constructor() {
    super(
      "internal: parseNumber called with format 'ambiguous' — an ambiguous column must be rejected " +
        'by instruct/schema.ts before any value on it is ever parsed (never guess, principle c)',
    );
    this.name = 'AmbiguousNumberFormatError';
  }
}

/**
 * Parses one raw cell under an already-DECIDED format. Code-review finding,
 * session 84: 'ambiguous' now THROWS rather than silently falling through
 * to nl-style parsing — every real caller must have already resolved the
 * format (via the user's profile-card disambiguation) or rejected the
 * column entirely (instruct/schema.ts); a loud failure here is the
 * defense-in-depth backstop if that resolution is ever bypassed. Returns
 * null for empty text or anything that doesn't parse to a finite number
 * (e.g. "n.v.t.") — the caller (execute.ts) turns a null here into a
 * UserChartPoint with a reason, never a silently-dropped point (U11).
 */
export function parseNumber(raw: string, format: NumberFormat): number | null {
  if (format === 'ambiguous') throw new AmbiguousNumberFormatError();
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const normalized =
    format === 'en' ? trimmed.replaceAll(',', '') : trimmed.replaceAll('.', '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Digits after the decimal separator in the RAW text (never the parsed
 * value) — so display via the shared formatValueNl never rounds beyond
 * what the source file actually contained. */
export function decimalsOf(raw: string, format: NumberFormat): number {
  const trimmed = raw.trim();
  const decimalChar = format === 'en' ? '.' : ',';
  const index = trimmed.lastIndexOf(decimalChar);
  if (index === -1) return 0;
  const after = trimmed.slice(index + 1);
  return /^\d+$/.test(after) ? after.length : 0;
}
