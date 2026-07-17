// Parallel, dimension-partitioned observation capture — the committed
// escape hatch for CBS's slow unfiltered Observations stream (measured
// session 50 on 85880NED: ~6KB/s single-connection with mid-body
// terminations → a full-table fetch dies after 3×45-min attempts, while
// PARALLEL filtered connections each get their own bandwidth: 99,676 rows
// in ~6 minutes over 5 chunks). Every stored page is a verbatim wire
// response; the per-code filters over ONE required dimension partition the
// table exactly, so the union of pages == the unfiltered table.
// FixtureSource iterates the manifest's page list and ignores
// @odata.nextLink (src/cbs-adapter/fixture-source.ts), so chunk pages are
// first-class fixture pages.
//
// The output dir must already hold the table's METADATA files
// (properties/dimensions/measure-codes/codes-*.json) — copy them from a
// normal capture or fetch them first; this script only fetches observations
// and writes observations-page-N.json + index.json.
//
// Pairs with scripts/sync-from-capture.ts for a same-day live sync
// (docs/RUNBOOK.md, curated-table procedure step 5).
//
// Usage: node --import ./scripts/force-ipv4.mjs scripts/capture-observations-chunked.ts <tableId> <partitionDimension> <outDir>
//   e.g. ... capture-observations-chunked.ts 85880NED SoortMutaties /tmp/85880NED-full
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://datasets.cbs.nl/odata/v1/CBS';
const MAX_PAGES_PER_CHUNK = 20;

const [tableId, partitionDimension, outDir] = process.argv.slice(2);
if (!tableId || !partitionDimension || !outDir) {
  console.error('usage: capture-observations-chunked.ts <tableId> <partitionDimension> <outDir>');
  process.exit(1);
}

const codesDoc = JSON.parse(readFileSync(join(outDir, `codes-${partitionDimension}.json`), 'utf8')) as {
  value: { Identifier: string }[];
};
const codes = codesDoc.value.map((c) => c.Identifier);
if (codes.length === 0 || codes.length > 40) {
  // A partition over too many codes means too many connections — pick a
  // smaller dimension (politeness to CBS; 5-10 concurrent is the sweet spot).
  console.error(`partition dimension '${partitionDimension}' has ${codes.length} codes — pick one with 1-40`);
  process.exit(1);
}

async function fetchJson(url: string): Promise<Record<string, unknown> & { value: unknown[] }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) return (await res.json()) as Record<string, unknown> & { value: unknown[] };
      lastErr = new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      lastErr = err;
    }
    console.log(`retry ${attempt} for ${url}: ${String(lastErr)}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw lastErr;
}

async function captureChunk(code: string): Promise<(Record<string, unknown> & { value: unknown[] })[]> {
  const pages: (Record<string, unknown> & { value: unknown[] })[] = [];
  let url: string | null =
    `${BASE}/${tableId}/Observations?$filter=${encodeURIComponent(`${partitionDimension} eq '${code}'`)}`;
  for (let p = 1; url && p <= MAX_PAGES_PER_CHUNK; p++) {
    const started = Date.now();
    const data = await fetchJson(url);
    console.log(`${code} page ${p}: ${data.value.length} rows in ${Math.round((Date.now() - started) / 1000)}s`);
    pages.push(data);
    url = (data['@odata.nextLink'] as string | undefined) ?? null;
  }
  if (url) throw new Error(`${code}: still a nextLink after ${MAX_PAGES_PER_CHUNK} pages`);
  return pages;
}

const perCode = await Promise.all(codes.map(captureChunk));

let pageNo = 0;
let rows = 0;
const pageFiles: string[] = [];
for (const pages of perCode) {
  for (const data of pages) {
    pageNo += 1;
    const name = `observations-page-${pageNo}.json`;
    // Byte-format identical to scripts/capture-cbs-fixtures.ts's writes.
    writeFileSync(join(outDir, name), JSON.stringify(data, null, 1) + '\n');
    pageFiles.push(name);
    rows += data.value.length;
  }
}

const files: Record<string, string> = {
  properties: 'properties.json',
  dimensions: 'dimensions.json',
  'measure-codes': 'measure-codes.json',
};
const dims = JSON.parse(readFileSync(join(outDir, 'dimensions.json'), 'utf8')) as {
  value: { Identifier: string }[];
};
for (const dim of dims.value) {
  files[`codes-${dim.Identifier}`] = `codes-${dim.Identifier}.json`;
}

writeFileSync(
  join(outDir, 'index.json'),
  JSON.stringify(
    {
      tableId,
      capturedAt: new Date().toISOString(),
      source: `${BASE}/${tableId}`,
      sliceFilter: null,
      captureOnlySlice: null,
      observationRows: rows,
      observationPages: pageFiles,
      files,
    },
    null,
    1,
  ) + '\n',
);
console.log(`DONE: ${rows} rows over ${pageFiles.length} page file(s) in ${outDir}`);
