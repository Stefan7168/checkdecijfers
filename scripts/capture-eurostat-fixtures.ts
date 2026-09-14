// OWNER-RUN STEP — this session did NOT execute this script (Constraint 0,
// docs/session-briefs/2026-09-14-wp30c-e1-executor-brief.md: no live HTTP
// call to the real Eurostat API happens this session, even though the API
// is free/public and read-only). Run it, then re-run `npx vitest run
// tests/sources` and the internal explorer's smoke check before treating
// E1 as proven against real Eurostat data — the hand-built specimens this
// session committed under tests/fixtures/eurostat/ prove the CODE PATH
// only, not that real Eurostat responses match the shapes this adapter
// assumes.
//
// Captures raw Eurostat Statistics API (JSON-stat 2.0) + Catalogue API
// responses into tests/fixtures/eurostat/<code>/ — modelled directly on
// scripts/capture-cbs-fixtures.ts's pattern (verbatim wire data, so the
// fixture-backed tests exercise the same parsing code as live ingestion,
// ADR 003 seam applied to source two).
//
// UNVERIFIED URL SHAPES (Constraint 0): the Statistics API and Catalogue
// API URLs below are this session's best-effort construction from
// Eurostat's publicly documented conventions — see
// src/eurostat-adapter/statistics-api.ts's own header comment. The FIRST
// run of this script is exactly what checks (and, if wrong, corrects) them
// against the real API — read its output carefully, don't assume success.
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

// The three codes this session's hand-built specimens cover (Task 3) — a
// real capture of the SAME codes is the most direct way to check whether
// the synthetic shapes this adapter assumes actually match the live API.
// Capturing a different/wider set is fine too; this list is a starting
// point, not a ceiling.
const CODES = ['demo_pjan', 'namq_10_gdp', 'nrg_bal_c'];

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();
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
  const raw = await fetchJson(CATALOGUE_URL);
  const doc = { synthetic: false, capturedAt: new Date().toISOString(), source: CATALOGUE_URL, ...(raw as object) };
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
