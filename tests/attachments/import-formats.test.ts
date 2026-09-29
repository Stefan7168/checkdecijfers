import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import {
  CsvTooLargeError,
  isLegacyExcel,
  parsePastedTable,
  parseUpload,
  sniffUploadKind,
  UnreadableFileError,
} from '../../src/attachments/ingest/formats.ts';
import { exportUrlFor, fetchGoogleSheet, GSheetFetchError, parseGoogleSheetUrl } from '../../src/attachments/ingest/gsheet.ts';
import { parseJsonTable } from '../../src/attachments/ingest/json.ts';

const dir = resolve(__dirname, '..', 'fixtures', 'attachments', 'sheets');
const file = (name: string) => new Uint8Array(readFileSync(resolve(dir, name)));

describe('file type sniffing', () => {
  it('routes every supported extension and refuses the rest', () => {
    expect(sniffUploadKind('a.XLSX')).toBe('file_xlsx');
    expect(sniffUploadKind('a.ods')).toBe('file_ods');
    expect(sniffUploadKind('a.json')).toBe('file_json');
    expect(sniffUploadKind('a.tsv')).toBe('file_tsv');
    expect(sniffUploadKind('a.pdf')).toBeNull();
    expect(isLegacyExcel('old.xls')).toBe(true);
    expect(sniffUploadKind('old.xls')).toBeNull();
  });
});

describe('Excel (.xlsx)', () => {
  const wb = parseUpload('file_xlsx', file('koffie_verkoop_2023_2024.xlsx'));
  it('reads the visible table tab, skips the note-only and hidden tabs', () => {
    expect(wb.sheetName).toBe('Sales');
    expect(wb.sheetNames).toEqual(['Sales']);
    expect(wb.cells[0]).toEqual(['Month', 'Region', 'Product', 'Revenue', 'Units', 'Cost']);
    expect(wb.cells).toHaveLength(1 + 24 * 3 * 2);
  });
  it('turns date-formatted serials into ISO dates and profiles the columns', () => {
    expect(wb.cells[1]![0]).toBe('2023-01-01');
    const types = Object.fromEntries(buildDatasetProfile(wb.cells).columns.map((c) => [c.header, c.type]));
    expect(types).toMatchObject({ Month: 'date', Region: 'text', Revenue: 'number', Units: 'number' });
  });
  it('refuses a non-zip file as unreadable', () => {
    expect(() => parseUpload('file_xlsx', strToU8('hello'))).toThrow(UnreadableFileError);
  });
  it('refuses a zip bomb before inflating it', () => {
    const big = zipSync({ 'xl/worksheets/sheet1.xml': new Uint8Array(70 * 1024 * 1024) });
    expect(big.length).toBeLessThan(4 * 1024 * 1024);
    expect(() => parseUpload('file_xlsx', big)).toThrow(CsvTooLargeError);
  });
  it('refuses a stray far-away cell instead of allocating a million rows', () => {
    const bytes = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>h</t></is></c><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>'),
    });
    expect(() => parseUpload('file_xlsx', bytes)).toThrow(CsvTooLargeError);
  });
  it('decodes entities and rich-text runs in shared strings, and cleans float tails', () => {
    const bytes = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><r><t>R&amp;</t></r><r><t>D</t></r></si><si><t>Waarde</t></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>0.30000000000000004</v></c></row></sheetData></worksheet>',
      ),
    });
    expect(parseUpload('file_xlsx', bytes).cells).toEqual([
      ['R&D', 'Waarde'],
      ['R&D', '0.3'],
    ]);
  });
});

describe('OpenDocument (.ods)', () => {
  const wb = parseUpload('file_ods', file('huishoudbudget_2024.ods'));
  it('reads the table and ignores the huge repeated blank padding row', () => {
    expect(wb.sheetName).toBe('Budget');
    expect(wb.cells).toHaveLength(1 + 12 * 6);
    expect(wb.cells[0]).toEqual(['Maand', 'Categorie', 'Bedrag', 'Begroot']);
    expect(wb.cells[1]![0]).toBe('2024-01-01');
  });
  it('rejects a non-zip file', () => {
    expect(() => parseUpload('file_ods', strToU8('nope'))).toThrow(UnreadableFileError);
  });
});

describe('JSON', () => {
  it('reads an array of records inside a wrapper and unions the keys', () => {
    const cells = parseUpload('file_json', file('sensoren_maart_april.json')).cells;
    expect(cells[0]).toEqual(['date', 'sensor', 'temperature_c', 'humidity_pct']);
    expect(cells).toHaveLength(1 + 60 * 3);
    // A missing value is an empty cell, never a guessed number.
    expect(cells.some((r) => r[3] === '')).toBe(true);
  });
  it('accepts array-of-arrays, refuses non-tables', () => {
    expect(parseJsonTable('[["a","b"],[1,2]]')).toEqual([['a', 'b'], ['1', '2']]);
    expect(() => parseJsonTable('{"a":1}')).toThrow(UnreadableFileError);
    expect(() => parseJsonTable('not json')).toThrow(UnreadableFileError);
    expect(() => parseJsonTable('[1,2,3]')).toThrow(UnreadableFileError);
  });
});

describe('pasted table', () => {
  it('reads tab-separated text as pasted from Excel', () => {
    const cells = parsePastedTable(readFileSync(resolve(dir, 'geplakt_uit_excel.txt'), 'utf8'));
    expect(cells[0]).toEqual(['Team', 'Sprint', 'Punten']);
    expect(cells).toHaveLength(7);
  });
});

describe('Google Sheets link', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
  it('accepts Sheets links and reads the tab id', () => {
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toEqual({ id: ID, gid: null });
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=2044`)).toEqual({ id: ID, gid: '2044' });
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=7&usp=sharing`)?.gid).toBe('7');
  });
  it('rejects everything that is not a docs.google.com https sheet', () => {
    for (const bad of [
      `http://docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://evil.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com.evil.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com/document/d/${ID}/edit`,
      'https://docs.google.com/spreadsheets/d/short/edit',
      'http://169.254.169.254/latest/meta-data',
      'not a url',
    ]) {
      expect(parseGoogleSheetUrl(bad), bad).toBeNull();
    }
  });
  it('rebuilds the export URL from the id, never from the pasted string', () => {
    expect(exportUrlFor({ id: ID, gid: null })).toEqual({ url: `https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`, format: 'xlsx' });
    expect(exportUrlFor({ id: ID, gid: '9' }).format).toBe('csv');
  });
  it('follows Google redirects, and calls a sign-in redirect "not shared"', async () => {
    const ok: typeof fetch = async (input) => {
      const url = String(input);
      if (url.startsWith('https://docs.google.com/')) return new Response(null, { status: 307, headers: { location: 'https://doc-0k.googleusercontent.com/x' } });
      return new Response('a,b\n1,2\n', { status: 200, headers: { 'content-type': 'text/csv' } });
    };
    const got = await fetchGoogleSheet({ id: ID, gid: '0' }, ok);
    expect(new TextDecoder().decode(got.bytes)).toBe('a,b\n1,2\n');

    const priv: typeof fetch = async () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin' } });
    await expect(fetchGoogleSheet({ id: ID, gid: null }, priv)).rejects.toMatchObject({ reason: 'not_shared' });

    const html: typeof fetch = async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(fetchGoogleSheet({ id: ID, gid: null }, html)).rejects.toBeInstanceOf(GSheetFetchError);
  });
  it('never follows a redirect to a non-Google host', async () => {
    let calls = 0;
    const evil: typeof fetch = async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } });
    };
    await expect(fetchGoogleSheet({ id: ID, gid: null }, evil)).rejects.toMatchObject({ reason: 'not_shared' });
    expect(calls).toBe(1);
  });
});
