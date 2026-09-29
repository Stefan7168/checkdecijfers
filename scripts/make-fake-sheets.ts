// Generates realistic FAKE spreadsheets for trying the "Eigen data" import end
// to end (Excel, OpenDocument, JSON, CSV, TSV, pasted text). Seeded, so the
// files are byte-identical on every run. Output: tests/fixtures/attachments/sheets/
//   node scripts/make-fake-sheets.ts
// The workbook writers below emit the same part layout Excel / LibreOffice do
// (shared strings, a styles part with a date format, several tabs, a hidden tab)
// — they exist only to make test files; the READER is src/attachments/ingest/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';

const OUT = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'attachments', 'sheets');
mkdirSync(OUT, { recursive: true });

// mulberry32 — a tiny seeded generator.
let seed = 146;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const round = (n: number, d = 2) => Number(n.toFixed(d));

type Cell = string | number | { date: string };
type Sheet = { name: string; rows: Cell[][]; hidden?: boolean };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colLetter = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const serial = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000) + 25569;

function writeXlsx(file: string, sheets: Sheet[]): void {
  const strings: string[] = [];
  const sIndex = (s: string) => {
    let i = strings.indexOf(s);
    if (i === -1) {
      strings.push(s);
      i = strings.length - 1;
    }
    return i;
  };
  const sheetXml = sheets.map((sh) => {
    const rows = sh.rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${colLetter(c)}${r + 1}`;
            if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
            if (typeof cell === 'string') return `<c r="${ref}" t="s"><v>${sIndex(cell)}</v></c>`;
            return `<c r="${ref}" s="1"><v>${serial(cell.date)}</v></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const parts: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    ),
  };
  sheetXml.forEach((xml, i) => (parts[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml)));
  parts['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
  );
  writeFileSync(resolve(OUT, file), zipSync(parts));
}

function writeOds(file: string, sheets: Sheet[]): void {
  const body = sheets
    .map((sh) => {
      const rows = sh.rows
        .map((row) => {
          const cells = row
            .map((cell) => {
              if (typeof cell === 'number') return `<table:table-cell office:value-type="float" office:value="${cell}"><text:p>${cell}</text:p></table:table-cell>`;
              if (typeof cell === 'string') return `<table:table-cell office:value-type="string"><text:p>${esc(cell)}</text:p></table:table-cell>`;
              return `<table:table-cell office:value-type="date" office:date-value="${cell.date}"><text:p>${cell.date}</text:p></table:table-cell>`;
            })
            .join('');
          return `<table:table-row>${cells}</table:table-row>`;
        })
        .join('');
      // LibreOffice pads every sheet with one huge repeated blank row.
      return `<table:table table:name="${esc(sh.name)}">${rows}<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table>`;
    })
    .join('');
  const content = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet>${body}</office:spreadsheet></office:body></office:document-content>`;
  writeFileSync(resolve(OUT, file), zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'), 'content.xml': strToU8(content) }));
}

const months = (from: string, n: number): string[] => {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  for (let i = 0; i < n; i += 1) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

// 1. Excel: a coffee-chain sales workbook — 24 months × 3 regions × 2 products,
//    a "Notes" tab (skipped: no table) and a hidden scratch tab (never imported).
const regions = ['Noord', 'Midden', 'Zuid'];
const products = ['Espresso', 'Filterkoffie'];
const sales: Cell[][] = [['Month', 'Region', 'Product', 'Revenue', 'Units', 'Cost']];
months('2023-01', 24).forEach((month, i) => {
  regions.forEach((region, ri) =>
    products.forEach((product, pi) => {
      const season = 1 + 0.18 * Math.sin((i / 12) * 2 * Math.PI) + i * 0.012;
      const base = [1.0, 1.35, 0.85][ri]! * [1.2, 0.8][pi]! * 42000;
      const revenue = round(base * season * between(0.94, 1.06));
      sales.push([{ date: month }, region, product, revenue, Math.round(revenue / between(3.1, 3.6)), round(revenue * between(0.55, 0.68))]);
    }),
  );
});
writeXlsx('koffie_verkoop_2023_2024.xlsx', [
  { name: 'Sales', rows: sales },
  { name: 'Notes', rows: [['Prepared by finance, figures are fake']] },
  { name: 'Scratch', rows: [['x', 'y'], [1, 2]], hidden: true },
]);

// 2. OpenDocument: a household budget, categories × months.
const cats = ['Huur', 'Boodschappen', 'Energie', 'Vervoer', 'Uitgaan', 'Sparen'];
const budget: Cell[][] = [['Maand', 'Categorie', 'Bedrag', 'Begroot']];
months('2024-01', 12).forEach((month, i) =>
  cats.forEach((cat, ci) => {
    const planned = [1150, 520, 180, 140, 160, 300][ci]!;
    const actual = round(planned * between(0.85, 1.25) * (cat === 'Energie' ? 1 + 0.3 * Math.cos((i / 12) * 2 * Math.PI) : 1));
    budget.push([{ date: month }, cat, actual, planned]);
  }),
);
writeOds('huishoudbudget_2024.ods', [{ name: 'Budget', rows: budget }]);

// 3. JSON: an IoT sensor export, an array of records with a missing value now and then.
const sensors = ['woonkamer', 'slaapkamer', 'kelder'];
const readings: Record<string, unknown>[] = [];
for (let d = 0; d < 60; d += 1) {
  const day = new Date(Date.UTC(2024, 2, 1 + d)).toISOString().slice(0, 10);
  sensors.forEach((sensor, si) => {
    const temp = round(17 + si * -2.5 + 4 * Math.sin((d / 30) * Math.PI) + between(-0.8, 0.8), 1);
    const rec: Record<string, unknown> = { date: day, sensor, temperature_c: temp };
    if (rand() > 0.06) rec.humidity_pct = Math.round(between(38, 72));
    readings.push(rec);
  });
}
writeFileSync(resolve(OUT, 'sensoren_maart_april.json'), JSON.stringify({ exported: '2024-05-01', data: readings }, null, 1));

// 4. CSV: an employee-survey export, semicolons + decimal comma (Dutch Excel).
const depts = ['Klantenservice', 'Techniek', 'Verkoop', 'HR', 'Logistiek'];
let survey = 'Afdeling;Kwartaal;Tevredenheid;Respondenten;Aanbeveling (NPS)\n';
depts.forEach((dept, di) =>
  ['2023-Q1', '2023-Q2', '2023-Q3', '2023-Q4', '2024-Q1', '2024-Q2'].forEach((q, qi) => {
    const score = round(6.4 + di * 0.25 + qi * 0.09 + between(-0.3, 0.3), 1);
    survey += `${dept};${q};${String(score).replace('.', ',')};${Math.round(between(18, 140))};${Math.round(between(-10, 45))}\n`;
  }),
);
writeFileSync(resolve(OUT, 'medewerkersonderzoek.csv'), survey);

// 5. CSV: deliberately messy Dutch finance export — thousands dots, euro signs,
//    "n.v.t.", a missing cell, negative numbers.
let messy = 'Gemeente;Jaar;Begroting;Werkelijk;Opmerking\n';
['Utrecht', 'Almere', 'Zwolle', 'Breda'].forEach((g, gi) =>
  [2021, 2022, 2023].forEach((y) => {
    const b = Math.round(between(80, 260) * 1_000_000 + gi * 4_000_000);
    const w = Math.round(b * between(0.93, 1.08));
    const fmt = (n: number) => `€ ${n.toLocaleString('nl-NL')}`;
    messy += `${g};${y};${fmt(b)};${gi === 1 && y === 2022 ? 'n.v.t.' : fmt(w)};${w > b ? 'overschrijding' : ''}\n`;
  }),
);
writeFileSync(resolve(OUT, 'gemeente_begroting_rommelig.csv'), messy);

// 6. TSV: energy use by province and year.
let tsv = 'Province\tYear\tElectricity_GWh\tGas_million_m3\tSolar_share_pct\n';
['Groningen', 'Friesland', 'Drenthe', 'Overijssel', 'Gelderland', 'Utrecht', 'Noord-Holland', 'Zuid-Holland', 'Zeeland', 'Noord-Brabant', 'Limburg', 'Flevoland'].forEach((p, pi) =>
  [2019, 2020, 2021, 2022, 2023].forEach((y, yi) =>
    (tsv += `${p}\t${y}\t${Math.round(between(2200, 9800) + pi * 130)}\t${Math.round(between(300, 1700))}\t${round(4 + yi * 2.1 + between(0, 3), 1)}\n`),
  ),
);
writeFileSync(resolve(OUT, 'energie_per_provincie.tsv'), tsv);

// 7. Text as pasted from Excel: tab-separated, no file.
writeFileSync(
  resolve(OUT, 'geplakt_uit_excel.txt'),
  'Team\tSprint\tPunten\nAlpha\t1\t34\nAlpha\t2\t41\nAlpha\t3\t38\nBeta\t1\t29\nBeta\t2\t33\nBeta\t3\t47\n',
);
console.log(`wrote fake sheets to ${OUT}`);
