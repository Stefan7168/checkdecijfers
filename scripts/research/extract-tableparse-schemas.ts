// Breadth step 4, Task 1 — fetches REAL CBS table schema + full dimension code
// lists for a fixed set of tables (chosen for shape variety — plan:
// docs/superpowers/plans/2026-09-28-breadth-step-4-table-parser.md, Task 1)
// and writes one committed fixture per table to
// tests/fixtures/tableparse/schemas/<tableId>.json, so Task 2's table-scoped
// parser tests can build input from them without a network call. Metadata
// only (title, dimensions, measures, code lists) — never touches Observations.
//
// Reuses the live adapter (src/cbs-adapter/odata-v4.ts) so the fixtures are
// exactly what production code would see: same shapes (CbsTableSchema,
// CbsCode), same retry/backoff behaviour as the app's own CBS fetches.
//
// Usage (network required, not CI):
//   node --import ./scripts/force-ipv4.mjs scripts/research/extract-tableparse-schemas.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ODataV4Source } from '../../src/cbs-adapter/odata-v4.ts';
import type { CbsCode } from '../../src/cbs-adapter/types.ts';

const OUT_DIR = fileURLToPath(new URL('../../tests/fixtures/tableparse/schemas/', import.meta.url));
const MAX_BYTES_HARD_STOP = 5 * 1024 * 1024; // 5 MB — STOP and report, never write
const MAX_BYTES_WARN = 1 * 1024 * 1024; // 1 MB — keep, but report the size

// Exact as-published table IDs, casing preserved (catalog quirk #1). Chosen
// for shape variety: yearly-only vs mixed JJ/KW/MM periods, a real
// GeoDimension (03759ned, 84521NED), region-CODED ordinary dimensions
// (85004NED's RegioS, 82291NED's CaribischNederland), long member lists that
// need the pre-filter (85669NED's Klimaatsectoren, 84521NED's Diagnose),
// no-grand-total dimensions and a Marges dimension (82291NED).
// Fix round 1 (controller ruling): `83052NED` and
// `86116NED` have no TimeDimension at all — kept on purpose as "must refuse"
// cases for Task 2's builder, not shape drift. `82291NED` and `80590ned`
// added as the ELIGIBLE counterparts: a genuine Marges case with a real
// TimeDimension + machine period status (unlike 83052NED's), and a
// no-grand-total `Leeftijd` dimension on a table with monthly periods.
const TABLE_IDS = [
  '03759ned',
  '85669NED',
  '84521NED',
  '85245NED',
  '83052NED',
  '85004NED',
  '82883NED',
  '86116NED',
  '82291NED',
  '80590ned',
];

async function main() {
  const source = new ODataV4Source();
  mkdirSync(OUT_DIR, { recursive: true });

  for (const tableId of TABLE_IDS) {
    console.log(`fetching ${tableId}...`);
    const schema = await source.fetchTableSchema(tableId);

    const codeLists: Record<string, CbsCode[]> = {};
    for (const dim of schema.dimensions) {
      codeLists[dim.name] = await source.fetchCodeList(tableId, dim.name);
    }

    const out = { fetchedAt: new Date().toISOString(), schema, codeLists };
    const json = JSON.stringify(out, null, 1) + '\n';
    const bytes = Buffer.byteLength(json, 'utf8');

    if (bytes > MAX_BYTES_HARD_STOP) {
      throw new Error(
        `${tableId} fixture would be ${(bytes / (1024 * 1024)).toFixed(2)} MB, over the 5 MB hard ` +
          `stop — STOPPING without writing. Report this and do not edit the data ` +
          `to fit.`,
      );
    }

    const path = `${OUT_DIR}${tableId}.json`;
    writeFileSync(path, json);

    const dimSummary = schema.dimensions
      .map((d) => `${d.name}[${d.kind}](${codeLists[d.name].length})`)
      .join(', ');
    const stringMeasures = schema.measures.filter((m) => m.dataType === 'String').length;
    console.log(
      `  ${tableId}: "${schema.title}" — ${schema.dimensions.length} dims [${dimSummary}], ` +
        `${schema.measures.length} measures (${stringMeasures} String-typed) -> ${path} ` +
        `(${bytes} bytes${bytes > MAX_BYTES_WARN ? ', OVER 1 MB' : ''})`,
    );
  }

  console.log(`\nWrote ${TABLE_IDS.length} table fixture(s) -> ${OUT_DIR}`);
}

await main();
