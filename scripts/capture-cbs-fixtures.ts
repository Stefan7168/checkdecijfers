// Captures raw CBS OData v4 responses for the Phase 0 table set into
// tests/fixtures/cbs/<tableId>/ — verbatim wire data, so the fixture-backed
// tests exercise the same parsing code as live ingestion (ADR 003 seam).
// Small tables and registered slices are captured in full; the large CPI table
// as a 1,000-row sample (tests need realistic pages, not the whole table).
// Refresh: node scripts/capture-cbs-fixtures.ts   (network required; not CI)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CbsSlice } from '../src/cbs-adapter/types.ts';
import { sliceToFilter } from '../src/cbs-adapter/odata-v4.ts';
import { PHASE0_TABLES } from '../src/ingestion/registry-seed.ts';

const BASE = 'https://datasets.cbs.nl/odata/v1/CBS';
const OUT = fileURLToPath(new URL('../tests/fixtures/cbs', import.meta.url));
// CPI is 611k observations; fixtures only need a realistic sample of pages.
const SAMPLE_ONLY: Record<string, number> = { '86141NED': 1000 };
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

  const filter = sliceToFilter(slice);
  const sampleTop = SAMPLE_ONLY[id];
  const params = new URLSearchParams();
  if (filter) params.set('$filter', filter);
  if (sampleTop) params.set('$top', String(sampleTop));
  let url: string | null = `${BASE}/${id}/Observations${params.size ? `?${params}` : ''}`;
  let rows = 0;
  const pageFiles: string[] = [];
  for (let page = 1; url && page <= MAX_PAGES; page++) {
    const data = await fetchJson(url);
    const name = `observations-page-${page}.json`;
    writeFileSync(join(dir, name), JSON.stringify(data, null, 1) + '\n');
    pageFiles.push(name);
    rows += data.value.length;
    url = sampleTop ? null : (data['@odata.nextLink'] ?? null);
  }

  save('index.json', {
    tableId: id,
    capturedAt: new Date().toISOString(),
    source: `${BASE}/${id}`,
    sliceFilter: filter,
    sampleOnly: Boolean(sampleTop),
    observationRows: rows,
    observationPages: pageFiles,
    files,
  });
  console.log(`${id}: ${rows} observation rows, ${pageFiles.length} page(s)${filter ? ' [sliced]' : ''}${sampleTop ? ' [sample]' : ''}`);
}

for (const table of PHASE0_TABLES) {
  await captureTable(table.id, table.slice);
}
console.log('Capture complete.');
