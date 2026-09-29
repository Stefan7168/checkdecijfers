// "Eigen data" import — OpenDocument spreadsheet (.ods, LibreOffice / Google
// Sheets "download as ODS") reader. Same rules as xlsx.ts: untrusted input,
// hard caps, values as saved, only content.xml is opened.
import { unzipSync } from 'fflate';
import { MAX_COLUMNS, MAX_ROWS } from '../limits.ts';
import { CsvTooLargeError, enforceTableCaps } from './csv.ts';
import { decodeEntities, scanElements } from './xml-scan.ts';
import { UnreadableFileError, type ParsedSheet, type ParsedWorkbook } from './xlsx.ts';

const MAX_CONTENT_BYTES = 60 * 1024 * 1024;

/** Visible text of a cell: the <text:p> paragraphs joined by a space, tags
 * (spans, links, line breaks) removed, entities decoded. */
function cellText(inner: string): string {
  const paragraphs: string[] = [];
  for (const p of scanElements(inner, 'text:p')) {
    paragraphs.push(decodeEntities(p.inner.replace(/<[^>]*>/g, '')));
  }
  return paragraphs.join(' ');
}

function repeatCount(raw: string | undefined): number {
  const n = Number(raw ?? 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function cleanNumber(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : raw;
}

function readTable(inner: string): string[][] {
  const rows: string[][] = [];
  let width = 0;
  for (const row of scanElements(inner, 'table:table-row')) {
    const cells: string[] = [];
    // A merged cell's covered neighbours are empty but still OCCUPY a column:
    // read them as blank cells so the cells after them keep their position.
    const rowXml = row.inner
      .replaceAll('<table:covered-table-cell', '<table:table-cell')
      .replaceAll('</table:covered-table-cell>', '</table:table-cell>');
    const cellSources = [...scanElements(rowXml, 'table:table-cell')];
    for (const cell of cellSources) {
      const type = cell.attrs['office:value-type'];
      let text = '';
      if (type === 'float' || type === 'percentage' || type === 'currency') {
        text = cleanNumber(cell.attrs['office:value'] ?? '');
      } else if (type === 'date') {
        text = (cell.attrs['office:date-value'] ?? '').slice(0, 10);
      } else if (type === 'boolean') {
        text = cell.attrs['office:boolean-value'] === 'true' ? 'TRUE' : 'FALSE';
      } else {
        text = cellText(cell.inner);
      }
      const repeat = repeatCount(cell.attrs['table:number-columns-repeated']);
      if (text === '') {
        // Repeated blanks are how ODS pads a row to 1024 columns: never expand.
        for (let i = 0; i < Math.min(repeat, MAX_COLUMNS + 1); i += 1) cells.push('');
        continue;
      }
      if (cells.length + repeat > MAX_COLUMNS + 1) throw new CsvTooLargeError(`het blad heeft meer dan ${MAX_COLUMNS} kolommen`);
      for (let i = 0; i < repeat; i += 1) cells.push(text);
    }
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    const rowRepeat = repeatCount(row.attrs['table:number-rows-repeated']);
    if (cells.length === 0) continue; // blank row (incl. the huge trailing pad)
    if (cells.length > MAX_COLUMNS) throw new CsvTooLargeError(`het blad heeft meer dan ${MAX_COLUMNS} kolommen`);
    if (rows.length + rowRepeat > MAX_ROWS + 1) throw new CsvTooLargeError(`het blad heeft meer dan ${MAX_ROWS} rijen`);
    if (cells.length > width) width = cells.length;
    for (let i = 0; i < rowRepeat; i += 1) rows.push(cells.slice());
  }
  return rows.map((r) => {
    const padded = r.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });
}

export function parseOds(bytes: Uint8Array): ParsedWorkbook {
  let content: Uint8Array | undefined;
  try {
    content = unzipSync(bytes, {
      filter: (file) => {
        if (file.name !== 'content.xml') return false;
        if (file.originalSize > MAX_CONTENT_BYTES) throw new CsvTooLargeError('het bestand is te groot na uitpakken');
        return true;
      },
    })['content.xml'];
  } catch (error) {
    if (error instanceof CsvTooLargeError) throw error;
    throw new UnreadableFileError('geen leesbaar OpenDocument-bestand');
  }
  if (!content) throw new UnreadableFileError('geen leesbaar OpenDocument-bestand');
  const xml = new TextDecoder('utf-8').decode(content);

  const sheets: ParsedSheet[] = [];
  for (const table of scanElements(xml, 'table:table')) {
    const rows = readTable(table.inner);
    if (rows.length < 2) continue;
    const header = rows[0]!.map((h, i) => (h.trim() === '' ? `Column ${i + 1}` : h));
    const cells = [header, ...rows.slice(1)];
    enforceTableCaps(cells);
    sheets.push({ name: table.attrs['table:name'] ?? `Sheet ${sheets.length + 1}`, cells });
  }
  return { sheets };
}
