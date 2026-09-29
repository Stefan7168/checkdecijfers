// "Eigen data" import — Excel .xlsx reader (untrusted input). An .xlsx is a zip
// of XML parts; we read only what a table needs: the sheet list, the shared
// strings, the date styles, and one sheet's cells. Formulas are read as the
// value Excel last SAVED (`<v>`), never evaluated; macros, images, charts and
// external links are never opened (the zip filter admits only the five parts
// below). Every limit is a hard refusal, never truncation (the tier's rule).
import { unzipSync } from 'fflate';
import { MAX_COLUMNS, MAX_ROWS } from '../limits.ts';
import { CsvTooLargeError, enforceTableCaps } from './csv.ts';
import { decodeEntities, scanElements, textOf } from './xml-scan.ts';

/** The file is not a readable workbook (corrupt, encrypted, not a zip). */
export class UnreadableFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableFileError';
  }
}

/** Zip-bomb guard: no single part may inflate past this, and the sum of the
 * parts we admit may not either (the compressed upload is already capped at
 * MAX_FILE_BYTES by the caller). */
const MAX_PART_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_INFLATED_BYTES = 60 * 1024 * 1024;

const WANTED = /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/;

export interface ParsedSheet {
  name: string;
  cells: string[][];
}

export interface ParsedWorkbook {
  /** Non-empty sheets only, in workbook order. */
  sheets: ParsedSheet[];
}

/** 0-based column index from an A1 reference's letters ("AB12" → 27). */
function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}
function rowNumber(ref: string): number {
  const m = /(\d+)$/.exec(ref);
  return m ? Number(m[1]) : NaN;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormatCode(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(stripped) && !/^general$/i.test(stripped.trim());
}

/** Per cell-style-index: does the style show its number as a date. */
function readDateStyles(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return [];
  const custom = new Map<number, boolean>();
  for (const f of scanElements(stylesXml, 'numFmt')) {
    const id = Number(f.attrs['numFmtId']);
    if (Number.isInteger(id)) custom.set(id, isDateFormatCode(f.attrs['formatCode'] ?? ''));
  }
  const xfsBlock = [...scanElements(stylesXml, 'cellXfs')][0];
  if (!xfsBlock) return [];
  const styles: boolean[] = [];
  for (const xf of scanElements(xfsBlock.inner, 'xf')) {
    const id = Number(xf.attrs['numFmtId'] ?? 0);
    styles.push(custom.get(id) ?? BUILTIN_DATE_FORMATS.has(id));
  }
  return styles;
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const si of scanElements(xml, 'si')) {
    // Concatenate every <t> run; phonetic-guide runs (<rPh>) are dropped first.
    out.push(textOf(stripElements(si.inner, 'rPh'), 't'));
  }
  return out;
}

function stripElements(xml: string, tag: string): string {
  if (xml.indexOf(`<${tag}`) === -1) return xml;
  let out = '';
  let pos = 0;
  const open = `<${tag}`;
  const close = `</${tag}>`;
  while (pos < xml.length) {
    const start = xml.indexOf(open, pos);
    if (start === -1) {
      out += xml.slice(pos);
      break;
    }
    out += xml.slice(pos, start);
    const end = xml.indexOf(close, start);
    if (end === -1) break;
    pos = end + close.length;
  }
  return out;
}

/** Excel serial day number → ISO date (the shape profile.ts recognises). */
function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** A stored number as clean text: no binary-float tails (0.1+0.2), no
 * exponent noise for ordinary magnitudes. Exact for the 15 digits Excel keeps. */
function cleanNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const fixed = Number(n.toPrecision(15));
  return String(fixed);
}

function readSheet(xml: string, sharedStrings: string[], dateStyles: boolean[]): string[][] {
  const grid = new Map<number, Map<number, string>>();
  let maxRow = -1;
  let maxCol = -1;
  for (const c of scanElements(xml, 'c')) {
    const ref = c.attrs['r'];
    if (!ref) continue;
    const col = columnIndex(ref);
    const row = rowNumber(ref) - 1;
    if (!(col >= 0) || !(row >= 0)) continue;
    const type = c.attrs['t'];
    let text: string | null = null;
    if (type === 'inlineStr') {
      text = textOf(c.inner, 't');
    } else {
      const v = [...scanElements(c.inner, 'v')][0];
      if (v) {
        const raw = decodeEntities(v.inner);
        if (type === 's') text = sharedStrings[Number(raw)] ?? '';
        else if (type === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'e') text = '';
        else if (type === 'str') text = raw;
        else if (dateStyles[Number(c.attrs['s'] ?? 0)] === true) {
          text = serialToIso(Number(raw)) ?? cleanNumber(raw);
        } else text = cleanNumber(raw);
      }
    }
    if (text === null || text === '') continue;
    // Bounds BEFORE storing: a stray cell at XFD1048576 must not become a
    // million-row allocation, and a too-big sheet is refused, not clipped.
    if (row > MAX_ROWS) throw new CsvTooLargeError(`het blad heeft meer dan ${MAX_ROWS} rijen`);
    if (col >= MAX_COLUMNS) throw new CsvTooLargeError(`het blad heeft meer dan ${MAX_COLUMNS} kolommen`);
    let r = grid.get(row);
    if (!r) grid.set(row, (r = new Map()));
    r.set(col, text);
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  if (maxRow < 0) return [];
  const rows: string[][] = [];
  const rowKeys = [...grid.keys()].sort((a, b) => a - b);
  // Leading blank rows are dropped (a title gap above the table), interior
  // blank rows kept as empty rows exactly like a CSV with blank lines would be
  // filtered by parseCsv — here we drop them too, for the same reason.
  for (const key of rowKeys) {
    const r = grid.get(key)!;
    const out: string[] = [];
    for (let col = 0; col <= maxCol; col += 1) out.push(r.get(col) ?? '');
    rows.push(out);
  }
  return rows;
}

/** Blank header cells get a stable placeholder so every column is addressable. */
function nameBlankHeaders(cells: string[][]): string[][] {
  const header = cells[0]!.map((h, i) => (h.trim() === '' ? `Column ${i + 1}` : h));
  return [header, ...cells.slice(1)];
}

export function parseXlsx(bytes: Uint8Array): ParsedWorkbook {
  let total = 0;
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(bytes, {
      filter: (file) => {
        if (!WANTED.test(file.name)) return false;
        if (file.originalSize > MAX_PART_BYTES) {
          throw new CsvTooLargeError('een onderdeel van het bestand is te groot na uitpakken');
        }
        total += file.originalSize;
        if (total > MAX_TOTAL_INFLATED_BYTES) {
          throw new CsvTooLargeError('het bestand is te groot na uitpakken');
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof CsvTooLargeError) throw error;
    throw new UnreadableFileError('geen leesbaar Excel-bestand');
  }
  const decoder = new TextDecoder('utf-8');
  const text = (name: string): string | undefined => (parts[name] ? decoder.decode(parts[name]) : undefined);

  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new UnreadableFileError('geen leesbaar Excel-bestand');

  const rels = new Map<string, string>();
  for (const rel of scanElements(text('xl/_rels/workbook.xml.rels') ?? '', 'Relationship')) {
    const id = rel.attrs['Id'];
    const target = rel.attrs['Target'];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }

  const sharedStrings = readSharedStrings(text('xl/sharedStrings.xml'));
  const dateStyles = readDateStyles(text('xl/styles.xml'));

  const sheets: ParsedSheet[] = [];
  let index = 0;
  for (const s of scanElements(workbook, 'sheet')) {
    index += 1;
    // Hidden sheets are the author's scratch space; never imported silently.
    if (s.attrs['state'] === 'hidden' || s.attrs['state'] === 'veryHidden') continue;
    const name = s.attrs['name'] ?? `Sheet ${index}`;
    const target = rels.get(s.attrs['r:id'] ?? '') ?? `xl/worksheets/sheet${index}.xml`;
    const xml = text(target);
    if (xml === undefined) continue;
    const rows = readSheet(xml, sharedStrings, dateStyles);
    if (rows.length < 2) continue; // needs a header and at least one data row
    const cells = nameBlankHeaders(rows);
    enforceTableCaps(cells);
    sheets.push({ name, cells });
  }
  return { sheets };
}
