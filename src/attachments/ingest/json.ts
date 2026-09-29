// "Eigen data" import — a JSON table: an array of records (objects), or an
// array of arrays with a header row first, optionally wrapped in a single-key
// object ({"data": [...]}, the shape most APIs and exports use). Anything else
// is refused, never guessed at. Nested values become their compact JSON text
// (so nothing is silently dropped) and are then length-capped like any cell.
import { MAX_COLUMNS, MAX_ROWS } from '../limits.ts';
import { CsvTooLargeError, enforceTableCaps } from './csv.ts';
import { UnreadableFileError } from './xlsx.ts';

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function unwrap(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const values = Object.values(parsed as Record<string, unknown>);
    const arrays = values.filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as unknown[];
  }
  return null;
}

export function parseJsonTable(text: string): string[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new UnreadableFileError('geen geldige JSON');
  }
  const records = unwrap(parsed);
  if (!records || records.length === 0) throw new UnreadableFileError('geen tabel in de JSON');
  if (records.length - 1 > MAX_ROWS) throw new CsvTooLargeError(`het bestand heeft meer dan ${MAX_ROWS} rijen`);

  let rows: string[][];
  if (records.every((r) => Array.isArray(r))) {
    rows = (records as unknown[][]).map((r) => r.map(asText));
  } else if (records.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const r of records as Record<string, unknown>[]) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
          if (keys.length > MAX_COLUMNS) throw new CsvTooLargeError(`het bestand heeft meer dan ${MAX_COLUMNS} kolommen`);
        }
      }
    }
    rows = [keys, ...(records as Record<string, unknown>[]).map((r) => keys.map((k) => asText(r[k])))];
  } else {
    throw new UnreadableFileError('de JSON is geen tabel');
  }
  if (rows.length < 2) throw new UnreadableFileError('geen tabel in de JSON');
  const width = Math.max(...rows.map((r) => r.length));
  rows = rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r));
  enforceTableCaps(rows);
  return rows;
}
