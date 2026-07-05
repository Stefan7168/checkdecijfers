// Captures raw CBS OData v4 responses for the Phase 0 table set into
// tests/fixtures/cbs/<tableId>/ — verbatim wire data, so the fixture-backed
// tests exercise the same parsing code as live ingestion (ADR 003 seam).
// Small tables and registered slices are captured in full; the large CPI table
// through a capture-only slice (headline category T001112) so the fixture
// stays small but contains every benchmark cell B3/B4/B20 needs — a $top
// sample turned out to cut off after 2020MM12, silently missing them (WP5).
// Refresh: node scripts/capture-cbs-fixtures.ts [tableId ...]
//          (network required; not CI; no args = all Phase 0 tables)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CbsSlice } from '../src/cbs-adapter/types.ts';
import { sliceToFilter } from '../src/cbs-adapter/odata-v4.ts';
import { PHASE0_TABLES } from '../src/ingestion/registry-seed.ts';

const BASE = 'https://datasets.cbs.nl/odata/v1/CBS';
const OUT = fileURLToPath(new URL('../tests/fixtures/cbs', import.meta.url));
// Capture-only slices — narrow what the FIXTURE holds, without registering a
// slice for live ingestion (86141NED is ingested in full live; its fixture
// only carries the headline "alle bestedingen" series the benchmark uses).
const CAPTURE_SLICES: Record<string, CbsSlice> = {
  '86141NED': { dimensionEquals: { Bestedingscategorieen: 'T001112' } },
};
const MAX_PAGES = 20;

async function fetchJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

async function captureTable(id: string, slice: CbsSlice | undefined): Promise<void> {
  const dir = join(OUT, id);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {};
  const save = (name: string, data: unknown) => {
    writeFileSync(join(dir, name), JSON.stringify(data, null, 1) + '\n');
    files[name.replace('.json', '')] = name;
  };

  save('properties.json', await fetchJson(`${BASE}/${id}/Properties`));
  const dimensions = await fetchJson(`${BASE}/${id}/Dimensions`);
  save('dimensions.json', dimensions);
  save('measure-codes.json', await fetchJson(`${BASE}/${id}/MeasureCodes`));
  for (const dim of dimensions.value) {
    save(`codes-${dim.Identifier}.json`, await fetchJson(`${BASE}/${id}/${dim.Identifier}Codes`));
  }

  // Registered slice and capture-only slice both narrow the fetch; combining
  // them in one $filter keeps the semantics identical to live ingestion.
  const captureSlice = CAPTURE_SLICES[id];
  const registeredFilter = sliceToFilter(slice);
  const captureFilter = sliceToFilter(captureSlice);
  const filter = [registeredFilter, captureFilter].filter(Boolean).join(' and ') || null;
  const params = new URLSearchParams();
  if (filter) params.set('$filter', filter);
  let url: string | null = `${BASE}/${id}/Observations${params.size ? `?${params}` : ''}`;
  let rows = 0;
  const pageFiles: string[] = [];
  for (let page = 1; url && page <= MAX_PAGES; page++) {
    const data = await fetchJson(url);
    const name = `observations-page-${page}.json`;
    writeFileSync(join(dir, name), JSON.stringify(data, null, 1) + '\n');
    pageFiles.push(name);
    rows += data.value.length;
    url = data['@odata.nextLink'] ?? null;
  }
  if (url) throw new Error(`${id}: still a nextLink after ${MAX_PAGES} pages — capture would be silently incomplete; narrow the capture slice instead`);

  save('index.json', {
    tableId: id,
    capturedAt: new Date().toISOString(),
    source: `${BASE}/${id}`,
    sliceFilter: filter,
    captureOnlySlice: captureSlice ?? null,
    observationRows: rows,
    observationPages: pageFiles,
    files,
  });
  console.log(`${id}: ${rows} observation rows, ${pageFiles.length} page(s)${filter ? ' [sliced]' : ''}${captureSlice ? ' [capture-slice]' : ''}`);
}

// ---- catalog fixture (WP16 table finder) ----------------------------------
// A BOUNDED, topical sample of the real v4 Datasets catalog (not the full
// ~4,858 rows) so the recall/rerank tests run on genuine wire data but stay
// small. Written to tests/fixtures/cbs/_catalog.json. Reproduces the manual
// capture from session 24: a spread of topics + every Phase-0 registered id.
const CATALOG_SELECT = 'Identifier,Title,Description,Status,DatasetType,Language,Modified';
const CATALOG_FIXTURE_TOPICS = [
  'bijstand',
  'werkloos',
  'inflatie',
  'consumentenprijzen',
  'woningen',
  'koopwoningen',
  'bevolking',
  'faillissementen',
  'zonnestroom',
  'inkomen',
  'criminaliteit',
  'misdrijven',
];

async function captureCatalog(): Promise<void> {
  const byId = new Map<string, unknown>();
  const add = (rows: any[]) => {
    for (const row of rows) byId.set(row.Identifier, row);
  };
  for (const topic of CATALOG_FIXTURE_TOPICS) {
    const params = new URLSearchParams({
      $select: CATALOG_SELECT,
      $filter: `contains(Title,'${topic}')`,
      $top: '6',
    });
    add((await fetchJson(`${BASE}/Datasets?${params}`)).value);
  }
  // Every registered id explicitly, so recall/rerank tests can assert on them.
  const idFilter = PHASE0_TABLES.map((t) => `Identifier eq '${t.id}'`).join(' or ');
  const idParams = new URLSearchParams({ $select: CATALOG_SELECT, $filter: idFilter });
  add((await fetchJson(`${BASE}/Datasets?${idParams}`)).value);

  const rows = [...byId.values()].sort((a: any, b: any) =>
    a.Identifier < b.Identifier ? -1 : a.Identifier > b.Identifier ? 1 : 0,
  );
  const doc = {
    '@odata.context': `${BASE}/$metadata#Datasets(${CATALOG_SELECT})`,
    value: rows,
  };
  writeFileSync(join(OUT, '_catalog.json'), JSON.stringify(doc, null, 0) + '\n');
  console.log(`catalog fixture: ${rows.length} rows -> tests/fixtures/cbs/_catalog.json`);
}

if (process.argv.includes('--catalog')) {
  await captureCatalog();
  console.log('Catalog capture complete.');
  process.exit(0);
}

const requested = process.argv.slice(2);
const unknown = requested.filter((id) => !PHASE0_TABLES.some((t) => t.id === id));
if (unknown.length > 0) {
  console.error(`Unknown table id(s): ${unknown.join(', ')} — must be one of: ${PHASE0_TABLES.map((t) => t.id).join(', ')}`);
  process.exit(1);
}
const toCapture = requested.length > 0 ? PHASE0_TABLES.filter((t) => requested.includes(t.id)) : PHASE0_TABLES;
for (const table of toCapture) {
  await captureTable(table.id, table.slice);
}
console.log('Capture complete.');
