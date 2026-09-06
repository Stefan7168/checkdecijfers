// Numeric-format detection + parsing (D5/U11) — the parsing-level
// application of principle (c): ambiguity is asked, never guessed. Every
// case here is either a real, reproducible Dutch-data shape or an
// adversarial-review fixture (the multi-group separator gap).
import { describe, expect, it } from 'vitest';
import {
  AmbiguousNumberFormatError,
  decimalsOf,
  detectNumberFormat,
  parseNumber,
} from '../../src/attachments/ingest/numbers.ts';

describe('detectNumberFormat', () => {
  it('decides nl (dot=thousands, comma=decimal) from a mixed-separator cell', () => {
    expect(detectNumberFormat(['1.234,56'])).toBe('nl');
  });

  it('decides en (comma=thousands, dot=decimal) from a mixed-separator cell', () => {
    expect(detectNumberFormat(['1,234.56'])).toBe('en');
  });

  it('decides nl from a comma-decimal cell with a non-3-digit fraction', () => {
    expect(detectNumberFormat(['3,3'])).toBe('nl');
    expect(detectNumberFormat(['120,5'])).toBe('nl');
  });

  it('decides en from a dot-decimal cell with a non-3-digit fraction', () => {
    expect(detectNumberFormat(['3.3'])).toBe('en');
  });

  it('is ambiguous for a single dot with exactly 3 trailing digits (StatLine-style example)', () => {
    expect(detectNumberFormat(['9.800'])).toBe('ambiguous');
  });

  it('is ambiguous for a single comma with exactly 3 trailing digits (the symmetric case)', () => {
    expect(detectNumberFormat(['9,800'])).toBe('ambiguous');
  });

  it('fixed in review — a multi-group dot cell (no comma) is unambiguously nl', () => {
    // A real number has at most one decimal point; 2+ dots can only be
    // thousands-grouping. The original design draft left this to an
    // unwritten implementation detail (adversarial review, H1-boundary lens).
    expect(detectNumberFormat(['1.234.567'])).toBe('nl');
  });

  it('fixed in review — a multi-group comma cell (no dot) is unambiguously en', () => {
    expect(detectNumberFormat(['1,234,567'])).toBe('en');
  });

  it('column-wide consistency: one unambiguous cell resolves an otherwise-ambiguous sibling cell', () => {
    // "9.800" alone is ambiguous; "12.5" in the SAME column proves the dot
    // is decimal here (thousands-grouping is always exactly 3 digits), so
    // the column as a whole resolves to 'en', not 'ambiguous'.
    expect(detectNumberFormat(['9.800', '12.5'])).toBe('en');
    // Symmetric: a multi-group cell resolves a single-group sibling.
    expect(detectNumberFormat(['9.800', '1.234.567'])).toBe('nl');
  });

  it('contradictory definite signals fall back to ambiguous, never pick a side', () => {
    expect(detectNumberFormat(['3,3', '3.3'])).toBe('ambiguous');
  });

  it('plain integers with no separator anywhere default to nl (the format is moot either way)', () => {
    expect(detectNumberFormat(['2015', '2020', '42'])).toBe('nl');
  });

  it('ignores blank and non-numeric cells (n.v.t.) when deciding the format', () => {
    expect(detectNumberFormat(['3,3', '', 'n.v.t.', '4,4'])).toBe('nl');
  });
});

describe('parseNumber', () => {
  it('parses an nl thousands+decimal value', () => {
    expect(parseNumber('1.234,56', 'nl')).toBeCloseTo(1234.56);
  });

  it('parses an en thousands+decimal value', () => {
    expect(parseNumber('1,234.56', 'en')).toBeCloseTo(1234.56);
  });

  it('parses a multi-group nl integer', () => {
    expect(parseNumber('1.234.567', 'nl')).toBe(1234567);
  });

  it('parses a multi-group en integer', () => {
    expect(parseNumber('1,234,567', 'en')).toBe(1234567);
  });

  it('preserves a negative sign', () => {
    expect(parseNumber('-24', 'nl')).toBe(-24);
    expect(parseNumber('-1.234,5', 'nl')).toBeCloseTo(-1234.5);
  });

  it('returns null for an empty cell', () => {
    expect(parseNumber('', 'nl')).toBeNull();
    expect(parseNumber('   ', 'nl')).toBeNull();
  });

  it('returns null for text that is not a number ("n.v.t.")', () => {
    expect(parseNumber('n.v.t.', 'nl')).toBeNull();
  });

  it('fixed in review — throws rather than silently guessing when called with an unresolved ambiguous format', () => {
    // Before this fix, 'ambiguous' silently fell through to nl-style
    // parsing (the format==='en' ternary's else branch) — a guessed value
    // for a column the design says must block charting until the user
    // disambiguates. Every real caller must resolve the format first.
    expect(() => parseNumber('9.800', 'ambiguous')).toThrow(AmbiguousNumberFormatError);
  });
});

describe('decimalsOf', () => {
  it('counts digits after the nl decimal comma', () => {
    expect(decimalsOf('120,5', 'nl')).toBe(1);
    expect(decimalsOf('3,33', 'nl')).toBe(2);
  });

  it('counts digits after the en decimal dot', () => {
    expect(decimalsOf('120.5', 'en')).toBe(1);
  });

  it('is 0 for an integer with no decimal part', () => {
    expect(decimalsOf('2024', 'nl')).toBe(0);
    expect(decimalsOf('1.234.567', 'nl')).toBe(0);
  });
});
