// "Eigen data" attachments tier — a from-scratch RFC 4180 parser for
// CSV/TSV upload (WP202a). No existing parser to reuse: web/lib/csv.ts is
// the EXPORT side only (a fixed ';' serializer for CBS answers) — there is
// no delimiter-sniffing or import-side parsing anywhere else in this
// codebase (a doc-freshness correction: the design doc originally claimed
// otherwise). Untrusted input throughout — every cap here is a hard refusal
// (a thrown error, never silent truncation), matching this tier's
// "never silent omission" rule for chart-side caps (D7).
import { MAX_CELL_CHARS, MAX_COLUMNS, MAX_HEADER_CHARS, MAX_ROWS } from '../limits.ts';

export class CsvTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvTooLargeError';
  }
}

const CANDIDATE_DELIMITERS = [';', ',', '\t'] as const;
type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

/** Strips a leading UTF-8 BOM if present (Excel's own encoding sniff mark —
 * the same fact web/lib/csv.ts's header records for the export side). */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * A minimal RFC 4180 state machine: handles quoted fields (which may
 * contain the delimiter, CR/LF, and an escaped quote via doubling `""`),
 * bare CRLF/LF line endings, and a trailing newline. Returns rows of raw
 * field strings — no trimming, no type coercion; that is profile.ts's job.
 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Both CRLF and a bare CR count as one row break; a following LF is
      // consumed so it never starts an empty extra row.
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // A trailing field/row with no final newline still counts.
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}

/**
 * Sniffs the dialect by consistency, not raw frequency: for each candidate
 * delimiter, count its occurrences (outside quotes — approximated here by
 * running the real parser and checking the resulting field count per row,
 * which is robust to a delimiter character appearing inside a quoted
 * field) across the first few non-empty lines, and pick the delimiter whose
 * field count is the same, and greater than 1, across all of them. Falls
 * back to ';' (StatLine's own convention) when nothing is consistent —
 * e.g. a genuinely single-column file, where the dialect is moot.
 */
function sniffDelimiter(text: string): Delimiter {
  const sampleLines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0).slice(0, 5);
  if (sampleLines.length === 0) return ';';

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = sampleLines.map((line) => parseDelimited(line, delimiter)[0]?.length ?? 1);
    const first = counts[0]!;
    if (first > 1 && counts.every((count) => count === first)) {
      return delimiter;
    }
  }
  return ';';
}

export interface ParsedCsv {
  /** Verbatim raw cell text, header row included at index 0 — the exact
   * `cells` shape user_datasets.cells stores (D3). */
  cells: string[][];
  delimiter: Delimiter;
}

/**
 * Parses untrusted CSV/TSV bytes. Every cap is a hard refusal (thrown),
 * never silent truncation — the caller (respond.ts) turns this into an
 * honest "dit bestand is te groot" refusal, never a partially-charted file
 * the user doesn't know is incomplete.
 */
export function parseCsv(text: string): ParsedCsv {
  const stripped = stripBom(text);
  const delimiter = sniffDelimiter(stripped);
  const rawRows = parseDelimited(stripped, delimiter).filter(
    (row) => !(row.length === 1 && row[0] === ''),
  );

  if (rawRows.length === 0) {
    throw new CsvTooLargeError('het bestand bevat geen rijen');
  }
  // rowCount excludes the header row (D3/D6: DatasetProfile.rowCount is a
  // DATA row count) — the cap applies to data rows, not the header.
  if (rawRows.length - 1 > MAX_ROWS) {
    throw new CsvTooLargeError(`het bestand heeft meer dan ${MAX_ROWS} rijen`);
  }

  const columnCount = rawRows[0]!.length;
  if (columnCount > MAX_COLUMNS) {
    throw new CsvTooLargeError(`het bestand heeft meer dan ${MAX_COLUMNS} kolommen`);
  }

  rawRows[0]!.forEach((header, index) => {
    if (header.length > MAX_HEADER_CHARS) {
      throw new CsvTooLargeError(
        `kolomkop ${index + 1} is langer dan ${MAX_HEADER_CHARS} tekens`,
      );
    }
  });
  for (let r = 1; r < rawRows.length; r += 1) {
    for (const cell of rawRows[r]!) {
      if (cell.length > MAX_CELL_CHARS) {
        throw new CsvTooLargeError(`een cel is langer dan ${MAX_CELL_CHARS} tekens (rij ${r + 1})`);
      }
    }
  }

  return { cells: rawRows, delimiter };
}
