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
//          node scripts/capture-eurostat-fixtures.ts --siblings   (the three E2a sibling slices)
//          (network required; not CI; no args = every code below)
//          node scripts/capture-eurostat-fixtures.ts --catalog
//          node scripts/capture-eurostat-fixtures.ts --structure [code ...]  (SDMX structure messages; no codes = all six)
//          node scripts/capture-eurostat-fixtures.ts --decimals-probe <code ...>  (the first decimals read, #357 (a))
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// `--siblings` (session of 2026-09-30): captures the REAL response for each E2a
// sibling registration's exact slice (the URL `buildRequestUrl` builds — one
// source of truth with `npm run eurostat:siblings`) into
// tests/fixtures/eurostat-siblings/<code>.json (NOT under eurostat/: the fixture-source loader treats every subfolder there as a table), so a hermetic test can prove the
// adapter parses what the real API returns for the reviewed slice. Added after
// the first real registration threw: monthly time codes are 'YYYY-MM', not the
// 'YYYY-Mnn' the synthetic fixtures assumed, and prc_hicp_manr was frozen at 2025-12.
if (process.argv.includes('--siblings')) {
  const { buildRequestUrl } = await import('../src/eurostat-adapter/statistics-api.ts');
  const { EUROSTAT_SIBLING_REGISTRATIONS } = await import('../src/sources/eurostat-siblings.ts');
  const dir = join(OUT, '..', 'eurostat-siblings');
  mkdirSync(dir, { recursive: true });
  for (const reg of EUROSTAT_SIBLING_REGISTRATIONS) {
    const code = reg.tableId.slice(reg.tableId.indexOf(':') + 1);
    const url = buildRequestUrl(code, reg.slice);
    const dataset = await fetchJson(url);
    writeFileSync(join(dir, `${code}.json`), JSON.stringify(dataset) + '\n');
    writeFileSync(
      join(dir, `${code}.index.json`),
      JSON.stringify({ synthetic: false, tableId: reg.tableId, capturedAt: new Date().toISOString(), source: url }, null, 1) + '\n',
    );
    console.log(`${reg.tableId}: captured -> tests/fixtures/eurostat-siblings/${code}.json`);
  }
  console.log('Sibling capture complete.');
  process.exit(0);
}

// `--decimals-probe <code...>` (#357 (a), 2026-10-01): captures Eurostat's REAL answer to the first decimals read
// (`decimalsProbeSlice`, read 1: every unit, the latest two periods, bounded) for a dataset whose structure is already
// captured under tests/fixtures/eurostat-structure/, built from that committed structure so the URL is exactly the
// one a hermetic test's adapter will request. Into tests/fixtures/eurostat-decimals/<code>.json (+ .index.json).
if (process.argv.includes('--decimals-probe')) {
  const { buildRequestUrl } = await import('../src/eurostat-adapter/statistics-api.ts');
  const { decimalsProbePeriods, decimalsProbeSlice, fitEurostatStructure, readEurostatStructure } = await import('../src/eurostat-adapter/sdmx-structure.ts');
  const structureDir = join(OUT, '..', 'eurostat-structure');
  const dir = join(OUT, '..', 'eurostat-decimals');
  mkdirSync(dir, { recursive: true });
  const codes = process.argv.slice(process.argv.indexOf('--decimals-probe') + 1).filter((a) => !a.startsWith('--'));
  for (const code of codes) {
    const structure = readEurostatStructure(
      code,
      readFileSync(join(structureDir, `${code}.dataflow.xml`), 'utf8'),
      readFileSync(join(structureDir, `${code}.constraint.xml`), 'utf8'),
    );
    const fit = fitEurostatStructure(`eurostat:${code}`, structure);
    if (!fit.ok) throw new Error(`${code}: ${fit.summary}`);
    const probe = decimalsProbeSlice(`eurostat:${code}`, structure, fit, fit.unitCodes, decimalsProbePeriods(1));
    if (probe === null) throw new Error(`${code}: no bounded decimals read exists`);
    const url = buildRequestUrl(code, probe.slice);
    writeFileSync(join(dir, `${code}.json`), JSON.stringify(await fetchJson(url)) + '\n');
    writeFileSync(
      join(dir, `${code}.index.json`),
      JSON.stringify({ synthetic: false, tableId: `eurostat:${code}`, capturedAt: new Date().toISOString(), source: url, cells: probe.cells }, null, 1) + '\n',
    );
    console.log(`${code}: captured -> tests/fixtures/eurostat-decimals/${code}.json (at most ${probe.cells} cells)`);
  }
  process.exit(0);
}

// `--structure` (#357 study step 1, 2026-09-30): captures the two SDMX structure messages (dataflow with its
// partial code lists, and the content constraint — no observations) for the four registered datasets into
// tests/fixtures/eurostat-structure/<code>.{dataflow,constraint}.xml, verbatim, from the URLs the adapter
// itself builds (`structureUrls`). Sequential, one request at a time.
// With codes after the flag (`--structure mar_mg_aa_cwhd`), only those are (re)captured and merged into the
// existing index (#357 (d): the geography examples below); without, every code in STRUCTURE_CODES.
if (process.argv.includes('--structure')) {
  const { structureUrls } = await import('../src/eurostat-adapter/statistics-api.ts');
  const dir = join(OUT, '..', 'eurostat-structure');
  mkdirSync(dir, { recursive: true });
  // The four registered datasets, plus two geography examples (#357 (d), captured 2026-10-01): mar_mg_aa_cwhd keeps
  // its places in `rep_mar`, a list Eurostat does not mark as geography; migr_asyappctza's `citizen` list is
  // marked (derived from GEO, codes with LEVEL).
  const STRUCTURE_CODES = ['tipsbd30', 'une_rt_q', 'prc_hicp_minr', 'namq_10_gdp', 'mar_mg_aa_cwhd', 'migr_asyappctza'];
  const named = process.argv.slice(process.argv.indexOf('--structure') + 1).filter((a) => !a.startsWith('--'));
  const indexPath = join(dir, 'index.json');
  const index: { synthetic: false; capturedAt: string; datasets: Record<string, unknown>; capturedAtByDataset?: Record<string, string> } =
    named.length > 0 && existsSync(indexPath)
      ? JSON.parse(readFileSync(indexPath, 'utf8'))
      : { synthetic: false, capturedAt: new Date().toISOString(), datasets: {} };
  for (const code of named.length > 0 ? named : STRUCTURE_CODES) {
    const urls = structureUrls(code);
    writeFileSync(join(dir, `${code}.dataflow.xml`), await fetchText(urls.dataflow));
    writeFileSync(join(dir, `${code}.constraint.xml`), await fetchText(urls.constraint));
    index.datasets[code] = urls;
    if (named.length > 0) (index.capturedAtByDataset ??= {})[code] = new Date().toISOString();
    console.log(`${code}: captured -> tests/fixtures/eurostat-structure/${code}.{dataflow,constraint}.xml`);
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
  console.log('Structure capture complete.');
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
