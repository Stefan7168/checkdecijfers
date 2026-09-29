// "Eigen data" import — one door for every way a table gets in. Each route
// turns untrusted bytes/text into the same thing (`cells`: rows of raw cell
// text, header first) and hands it to the SAME profiling, quota, storage and
// chart pipeline as a CSV upload — so a new format can add no new trust rules.
import { CsvTooLargeError, parseCsv } from './csv.ts';
import { parseJsonTable } from './json.ts';
import { parseOds } from './ods.ts';
import { parseXlsx, UnreadableFileError, type ParsedSheet } from './xlsx.ts';
import type { SourceKind } from '../types.ts';

export { CsvTooLargeError, UnreadableFileError };

export type UploadKind = Extract<SourceKind, 'file_csv' | 'file_tsv' | 'file_xlsx' | 'file_ods' | 'file_json'>;

/** File name → import route; null = not a supported file type. Legacy binary
 * `.xls` is deliberately absent (its format is a different, riskier parser;
 * the refusal text tells people to re-save as .xlsx). */
export function sniffUploadKind(fileName: string): UploadKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'file_csv';
  if (lower.endsWith('.tsv') || lower.endsWith('.tab')) return 'file_tsv';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'file_xlsx';
  if (lower.endsWith('.ods')) return 'file_ods';
  if (lower.endsWith('.json')) return 'file_json';
  return null;
}

export function isLegacyExcel(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.xls');
}

export interface ParsedImport {
  cells: string[][];
  /** Set for workbooks: the tab that was read and every readable tab's name. */
  sheetName: string | null;
  sheetNames: string[];
}

function pickSheet(sheets: ParsedSheet[], wanted: string | null | undefined): ParsedImport {
  if (sheets.length === 0) throw new UnreadableFileError('geen blad met een tabel gevonden');
  const chosen = (wanted ? sheets.find((s) => s.name === wanted) : undefined) ?? sheets[0]!;
  return { cells: chosen.cells, sheetName: chosen.name, sheetNames: sheets.map((s) => s.name) };
}

export function parseUpload(kind: UploadKind, bytes: Uint8Array, wantedSheet?: string | null): ParsedImport {
  switch (kind) {
    case 'file_xlsx':
      return pickSheet(parseXlsx(bytes).sheets, wantedSheet);
    case 'file_ods':
      return pickSheet(parseOds(bytes).sheets, wantedSheet);
    case 'file_json':
      return { cells: parseJsonTable(new TextDecoder('utf-8').decode(bytes)), sheetName: null, sheetNames: [] };
    case 'file_csv':
    case 'file_tsv':
      return { cells: parseCsv(new TextDecoder('utf-8').decode(bytes)).cells, sheetName: null, sheetNames: [] };
  }
}

/** A table pasted from Excel/Sheets arrives tab-separated; parseCsv's own
 * dialect sniffing covers it and plain comma/semicolon text alike. */
export function parsePastedTable(text: string): string[][] {
  return parseCsv(text).cells;
}
