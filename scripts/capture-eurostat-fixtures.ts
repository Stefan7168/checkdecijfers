// RUN session 107 (2026-09-16) — Constraint 0 resolved (owner confirmed "no
// real Eurostat API spend" meant money, not any live call; the API is
// free/public/read-only). This is the actual run that checked the adapter's
// URL/shape assumptions against the real API and found + fixed two real
// defects: (1) the Catalogue "table of contents" endpoint returns
// tab-separated TEXT, not JSON — an `Accept: application/json` header gets a
// 406, not the documented shape src/eurostat-adapter/jsonstat.ts's
// `parseJsonStatCatalog` originally assumed; (2) the three demo codes this
// session's ORIGINAL hand-built specimens modelled (`demo_pjan`,
// `namq_10_gdp`, `nrg_bal_c`) are real, but their true cell counts (742,730 /
// 8,191,372 / 21,300,267 per the live catalog) all exceed
// `SYNC_CELL_THRESHOLD` (500,000) — too large to usefully commit as a
// synchronous-happy-path fixture. Replaced with two small, real, in-range
// datasets found via the live catalog capture (below) for the happy-path
// captures; the three original codes' existing HAND-BUILT specimens stay in
// tests/fixtures/eurostat/ unchanged, still used by unrelated unit tests as
// arbitrary example table ids.
//
// Captures raw Eurostat Statistics API (JSON-stat 2.0) + Catalogue API
// responses into tests/fixtures/eurostat/<code>/ — modelled directly on
// scripts/capture-cbs-fixtures.ts's pattern (verbatim wire data, so the
// fixture-backed tests exercise the same parsing code as live ingestion,
// ADR 003 seam applied to source two).
//
// Refresh: node scripts/capture-eurostat-fixtures.ts [code ...]
//          (network required; not CI; no args = every code below)
//          node scripts/capture-eurostat-fixtures.ts --catalog
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATISTICS_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
const CATALOGUE_URL = 'https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt?lang=EN';
const OUT = fileURLToPath(new URL('../tests/fixtures/eurostat', import.meta.url));

// Two small, real, well-under-SYNC_CELL_THRESHOLD datasets (515/525 cells
// per the live catalog, confirmed 2026-09-16) — chosen from the real
// Catalogue capture specifically to stay a comparable size to CBS's own
// committed fixtures (tens of KB to a few MB, not the 8-21M-cell datasets
// the original three demo codes turned out to be). Capturing a
// different/wider set is fine too; this list is a starting point, not a
// ceiling.
const CODES = ['tipsbd30', 'migr_asyapp1mp'];

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

/** The Catalogue endpoint returns tab-separated TEXT, not JSON — no `Accept`
 * header at all (an `application/json` Accept on this one endpoint gets a
 * 406, verified live). */
async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.text();
    if (attempt >= 3) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

async function captureTable(code: string): Promise<void> {
  const dir = join(OUT, code);
  mkdirSync(dir, { recursive: true });
  const url = `${STATISTICS_BASE}/${code}?format=JSON&lang=EN`;
  const dataset = await fetchJson(url);
  writeFileSync(join(dir, 'dataset.json'), JSON.stringify(dataset, null, 1) + '\n');
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify(
      {
        synthetic: false,
        dataset: 'dataset.json',
        capturedAt: new Date().toISOString(),
        source: url,
      },
      null,
      1,
    ) + '\n',
  );
  console.log(`${code}: captured -> tests/fixtures/eurostat/${code}/dataset.json`);
}

async function captureCatalog(): Promise<void> {
  const raw = await fetchText(CATALOGUE_URL);
  const doc = { synthetic: false, capturedAt: new Date().toISOString(), source: CATALOGUE_URL, raw };
  writeFileSync(join(OUT, '_catalog.json'), JSON.stringify(doc, null, 1) + '\n');
  console.log('catalog captured -> tests/fixtures/eurostat/_catalog.json');
}

if (process.argv.includes('--catalog')) {
  await captureCatalog();
  console.log('Catalog capture complete.');
  process.exit(0);
}

const requested = process.argv.slice(2);
const unknown = requested.filter((code) => !CODES.includes(code));
if (unknown.length > 0) {
  console.error(`Unknown dataset code(s): ${unknown.join(', ')} — must be one of: ${CODES.join(', ')}`);
  process.exit(1);
}
const toCapture = requested.length > 0 ? requested : CODES;
for (const code of toCapture) {
  await captureTable(code);
}
console.log('Capture complete.');
