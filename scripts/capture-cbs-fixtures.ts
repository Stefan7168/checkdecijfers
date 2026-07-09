// Captures raw CBS OData v4 responses for the Phase 0 table set into
// tests/fixtures/cbs/<tableId>/ — verbatim wire data, so the fixture-backed
// tests exercise the same parsing code as live ingestion (ADR 003 seam).
// Small tables and registered slices are captured in full; the large CPI table
// through a capture-only slice (headline category T001112) so the fixture
// stays small but contains every benchmark cell B3/B4/B20 needs — a $top
// sample turned out to cut off after 2020MM12, silently missing them (WP5).
// Refresh: node scripts/capture-cbs-fixtures.ts [tableId ...]
//          (network required; not CI; no args = all Phase 0 tables)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Fixture-only tables (WP27 stage A): captured for the finder/fit tests but
// NOT Phase-0-registered. 37789ksz (the bijstand-stock kerncijfers table,
// owner decision 2026-07-08) gets full observations — Stage C's e2e delivery
// test ingests it. 85615NED (the flow table of the live #111 mis-pick) gets
// schema docs + the real $count only: the fit gate must reject it for the
// stock question, so its observations are never read — and at full size they
// would bloat the fixture for nothing.
const FIXTURE_ONLY_TABLES: { id: string; observations: boolean }[] = [
  { id: '37789ksz', observations: true },
  { id: '85615NED', observations: false },
];

async function fetchJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

async function captureTable(
  id: string,
  slice: CbsSlice | undefined,
  options: { skipObservations?: boolean } = {},
): Promise<void> {
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

  // Schema-only capture (WP27 fixture-only tables): the manifest still records
  // the REAL live $count — fetchObservationCount replays honestly — but no
  // observation pages are stored (this table's cells are never read in tests).
  if (options.skipObservations) {
    const countRes = await fetch(`${BASE}/${id}/Observations/$count`, {
      headers: { Accept: 'text/plain' },
    });
    if (!countRes.ok) throw new Error(`${countRes.status} for ${id}/Observations/$count`);
    const count = Number((await countRes.text()).trim());
    save('index.json', {
      tableId: id,
      capturedAt: new Date().toISOString(),
      source: `${BASE}/${id}`,
      sliceFilter: null,
      captureOnlySlice: null,
      observationRows: count,
      observationPages: [],
      files,
    });
    console.log(`${id}: schema-only capture (live count ${count}, 0 pages stored)`);
    return;
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

// Surgical catalog add (WP27 stage A): fetch the named ids' live catalog rows
// and MERGE them into the existing _catalog.json — every already-present row
// keeps its VALUES semantically identical (a full --catalog re-capture would
// churn Modified timestamps and topic-sample membership, shifting recall for
// unrelated labelled cases). Honesty note (PR-#17 review): the merge
// round-trips the whole file through JSON.parse/stringify, so the FILE
// FORMATTING normalizes to this script's own compact one-line form — the
// first --catalog-add run (session 31) therefore rewrote the legacy
// pretty-printed file wholesale; verify row preservation semantically (parse
// + compare per Identifier), never by eyeballing the git diff.
// Usage: --catalog-add <id> [<id> ...]
async function catalogAdd(ids: string[]): Promise<void> {
  const path = join(OUT, '_catalog.json');
  const existing = JSON.parse(readFileSync(path, 'utf8')) as { '@odata.context': string; value: any[] };
  const byId = new Map<string, unknown>(existing.value.map((row) => [row.Identifier, row]));
  const idFilter = ids.map((id) => `Identifier eq '${id}'`).join(' or ');
  const params = new URLSearchParams({ $select: CATALOG_SELECT, $filter: idFilter });
  const fetched = (await fetchJson(`${BASE}/Datasets?${params}`)).value as any[];
  const missing = ids.filter((id) => !fetched.some((row) => row.Identifier === id));
  if (missing.length > 0) throw new Error(`--catalog-add: not found in the live catalog: ${missing.join(', ')}`);
  for (const row of fetched) byId.set(row.Identifier, row);
  const rows = [...byId.values()].sort((a: any, b: any) =>
    a.Identifier < b.Identifier ? -1 : a.Identifier > b.Identifier ? 1 : 0,
  );
  writeFileSync(path, JSON.stringify({ ...existing, value: rows }, null, 0) + '\n');
  console.log(`catalog fixture: +${fetched.length} row(s) merged, ${rows.length} total -> tests/fixtures/cbs/_catalog.json`);
}

if (process.argv.includes('--catalog')) {
  await captureCatalog();
  console.log('Catalog capture complete.');
  process.exit(0);
}

const addIdx = process.argv.indexOf('--catalog-add');
if (addIdx !== -1) {
  const ids = process.argv.slice(addIdx + 1);
  if (ids.length === 0) {
    console.error('--catalog-add needs at least one table id');
    process.exit(1);
  }
  await catalogAdd(ids);
  process.exit(0);
}

const requested = process.argv.slice(2);
const capturable = [
  ...PHASE0_TABLES.map((t) => ({ id: t.id, slice: t.slice, skipObservations: false })),
  ...FIXTURE_ONLY_TABLES.map((t) => ({ id: t.id, slice: undefined, skipObservations: !t.observations })),
];
const unknown = requested.filter((id) => !capturable.some((t) => t.id === id));
if (unknown.length > 0) {
  console.error(`Unknown table id(s): ${unknown.join(', ')} — must be one of: ${capturable.map((t) => t.id).join(', ')}`);
  process.exit(1);
}
// No args = the Phase-0 set (the historical default); fixture-only tables are
// captured by naming them explicitly.
const toCapture = requested.length > 0 ? capturable.filter((t) => requested.includes(t.id)) : capturable.filter((t) => PHASE0_TABLES.some((p) => p.id === t.id));
for (const table of toCapture) {
  await captureTable(table.id, table.slice, { skipObservations: table.skipObservations });
}
console.log('Capture complete.');
