// CSV/TSV ingest parser (D5/U11 fixtures) — a from-scratch RFC 4180 parser,
// since no import-side parser or delimiter-sniffer exists anywhere else in
// this codebase (web/lib/csv.ts is export-only). Untrusted input: every cap
// must be a hard refusal, never silent truncation.
import { describe, expect, it } from 'vitest';
import { CsvTooLargeError, parseCsv } from '../../src/attachments/ingest/csv.ts';
import { MAX_CELL_CHARS, MAX_COLUMNS, MAX_HEADER_CHARS, MAX_ROWS } from '../../src/attachments/limits.ts';

describe('parseCsv — dialect sniffing', () => {
  it('sniffs a semicolon-delimited file (StatLine convention)', () => {
    const { cells, delimiter } = parseCsv('Jaar;Omzet\n2020;100\n2021;150\n');
    expect(delimiter).toBe(';');
    expect(cells).toEqual([
      ['Jaar', 'Omzet'],
      ['2020', '100'],
      ['2021', '150'],
    ]);
  });

  it('sniffs a comma-delimited file', () => {
    const { delimiter } = parseCsv('Jaar,Omzet\n2020,100\n2021,150\n');
    expect(delimiter).toBe(',');
  });

  it('sniffs a tab-delimited file', () => {
    const { delimiter } = parseCsv('Jaar\tOmzet\n2020\t100\n2021\t150\n');
    expect(delimiter).toBe('\t');
  });

  it('falls back to ; for a single-column file (dialect is moot)', () => {
    const { delimiter, cells } = parseCsv('Jaar\n2020\n2021\n');
    expect(delimiter).toBe(';');
    expect(cells).toEqual([['Jaar'], ['2020'], ['2021']]);
  });
});

describe('parseCsv — RFC 4180 quoting', () => {
  it('handles a quoted field containing the delimiter', () => {
    const { cells } = parseCsv('Naam;Waarde\n"Amsterdam; hoofdstad";100\n');
    expect(cells[1]).toEqual(['Amsterdam; hoofdstad', '100']);
  });

  it('handles an escaped quote inside a quoted field ("" -> ")', () => {
    const { cells } = parseCsv('Naam;Waarde\n"Zeg ""hallo""";100\n');
    expect(cells[1]).toEqual(['Zeg "hallo"', '100']);
  });

  it('handles a quoted field containing a literal newline', () => {
    const { cells } = parseCsv('Naam;Waarde\n"regel een\nregel twee";100\n');
    expect(cells[1]).toEqual(['regel een\nregel twee', '100']);
  });

  it('handles CRLF line endings', () => {
    const { cells } = parseCsv('Jaar;Omzet\r\n2020;100\r\n2021;150\r\n');
    expect(cells).toEqual([
      ['Jaar', 'Omzet'],
      ['2020', '100'],
      ['2021', '150'],
    ]);
  });

  it('strips a leading UTF-8 BOM', () => {
    const { cells } = parseCsv('﻿Jaar;Omzet\n2020;100\n');
    expect(cells[0]).toEqual(['Jaar', 'Omzet']);
  });

  it('skips blank lines', () => {
    const { cells } = parseCsv('Jaar;Omzet\n2020;100\n\n2021;150\n');
    expect(cells).toEqual([
      ['Jaar', 'Omzet'],
      ['2020', '100'],
      ['2021', '150'],
    ]);
  });

  it('handles a file with no trailing newline', () => {
    const { cells } = parseCsv('Jaar;Omzet\n2020;100');
    expect(cells).toEqual([
      ['Jaar', 'Omzet'],
      ['2020', '100'],
    ]);
  });
});

describe('parseCsv — caps are a hard refusal, never silent truncation', () => {
  it('throws CsvTooLargeError over the row cap', () => {
    const rows = Array.from({ length: MAX_ROWS + 2 }, (_, i) => `${i}`).join('\n');
    expect(() => parseCsv(`Jaar\n${rows}`)).toThrow(CsvTooLargeError);
  });

  it('does NOT throw at exactly the row cap (off-by-one guard)', () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) => `${i}`).join('\n');
    expect(() => parseCsv(`Jaar\n${rows}`)).not.toThrow();
  });

  it('throws CsvTooLargeError over the column cap', () => {
    const header = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `c${i}`).join(';');
    expect(() => parseCsv(`${header}\n`)).toThrow(CsvTooLargeError);
  });

  it('throws CsvTooLargeError over the header-length cap', () => {
    const longHeader = 'x'.repeat(MAX_HEADER_CHARS + 1);
    expect(() => parseCsv(`${longHeader};Omzet\n1;2\n`)).toThrow(CsvTooLargeError);
  });

  it('throws CsvTooLargeError over the cell-length cap', () => {
    const longCell = 'x'.repeat(MAX_CELL_CHARS + 1);
    expect(() => parseCsv(`Jaar;Omzet\n2020;${longCell}\n`)).toThrow(CsvTooLargeError);
  });

  it('throws CsvTooLargeError on a completely empty file', () => {
    expect(() => parseCsv('')).toThrow(CsvTooLargeError);
  });
});
