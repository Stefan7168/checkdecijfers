// ADR 062 step 6 — captures the table-lane benchmark's CBS snapshot,
// READ-ONLY from CBS's public OData API (datasets.cbs.nl). No database, no
// LLM, no API key. Network required; never run in CI.
//
//   node --import ./scripts/force-ipv4.mjs scripts/capture-tablelane-bench.ts --schemas <id> [<id> ...]
//     Writes tests/fixtures/tableparse/schemas/<id>.json for a table that has
//     NO schema fixture yet (the same shape and the same live-adapter path as
//     scripts/research/extract-tableparse-schemas.ts: schema incl. measure
//     groups + every dimension's code list). Refuses to overwrite an existing
//     file — the labelled calibration set's request bytes hash those files.
//
//   npm run tablelane:bench:capture -- --verify-key
//     Re-reads every answer-key entry's raw OData URL (plain fetch, not our
//     adapter) and compares periods + values with the frozen key.
//
//   node --import ./scripts/force-ipv4.mjs scripts/capture-tablelane-bench.ts
//     For every benchmark task that needs cells (benchmark/tablelane-tasks.json:
//     `answer` tasks, and `ask` tasks' reply round), runs the REAL planner
//     (planTableLane) over the schema fixture with the task's expected parse
//     as a canned model output, takes the slice it plans, and fetches exactly
//     that slice through the live adapter's fetchObservations — the same call
//     fetchSlice makes. Writes tests/fixtures/tablelane-bench/cells/<id>.json.
//     Refuses when CBS's live `Modified` differs from the schema fixture's
//     (the snapshot would mix two CBS versions) — then re-capture the schema
//     in a separate, reviewed change first.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ODataV4Source } from '../src/cbs-adapter/odata-v4.ts';
import type { CbsCode, CbsObservationRow, CbsSlice } from '../src/cbs-adapter/types.ts';
import {
  TABLELANE_BENCH_CELLS_DIR,
  TABLEPARSE_SCHEMAS_DIR,
  loadSchemaFixture,
  sliceWithin,
  type CapturedSlice,
  type CellsFixture,
} from '../tests/helpers/tablelane-bench-source.ts';
import { cannedPlans, loadTableLaneKey, loadTableLaneTasks } from './tablelane-bench-lib.ts';

async function captureSchemas(ids: string[]): Promise<void> {
  const source = new ODataV4Source();
  mkdirSync(TABLEPARSE_SCHEMAS_DIR, { recursive: true });
  for (const tableId of ids) {
    const path = `${TABLEPARSE_SCHEMAS_DIR}/${tableId}.json`;
    if (existsSync(path)) throw new Error(`${path} exists — never overwritten (labelled-set request bytes hash it)`);
    const schema = await source.fetchTableSchema(tableId);
    if (schema.measureGroupsUnavailable === true) {
      throw new Error(`${tableId}: CBS measure groups could not be read — not captured (the parser would refuse it)`);
    }
    const codeLists: Record<string, CbsCode[]> = {};
    for (const dim of schema.dimensions) codeLists[dim.name] = await source.fetchCodeList(tableId, dim.name);
    const json = `${JSON.stringify({ fetchedAt: new Date().toISOString(), schema, codeLists }, null, 1)}\n`;
    writeFileSync(path, json);
    console.log(`${tableId}: "${schema.title}" — ${schema.measures.length} measures, ${schema.dimensions.length} dims -> ${path}`);
  }
}

async function captureCells(): Promise<void> {
  const source = new ODataV4Source();
  const tasks = loadTableLaneTasks();
  const plans = await cannedPlans(tasks);
  const byTable = new Map<string, CbsSlice[]>();
  for (const p of plans) {
    if (p.slice === null) continue;
    const list = byTable.get(p.tableId) ?? [];
    if (!list.some((s) => sliceWithin(p.slice!, s) && sliceWithin(s, p.slice!))) list.push(p.slice);
    byTable.set(p.tableId, list);
  }
  mkdirSync(TABLELANE_BENCH_CELLS_DIR, { recursive: true });
  for (const [tableId, slices] of byTable) {
    const fixture = loadSchemaFixture(tableId);
    const live = await source.fetchTableSchema(tableId);
    if (live.modified === null) throw new Error(`${tableId}: CBS reports no Modified date — not captured`);
    if (live.modified !== fixture.schema.modified) {
      throw new Error(
        `${tableId}: CBS Modified is now ${live.modified}, the schema fixture has ${fixture.schema.modified} — ` +
          'the snapshot would mix two CBS versions; not captured',
      );
    }
    const captured: CapturedSlice[] = [];
    for (const slice of slices) {
      const rows: CbsObservationRow[] = [];
      for await (const page of source.fetchObservations(tableId, slice, live.dimensions.map((d) => d.name))) rows.push(...page);
      captured.push({ slice, rows });
      console.log(`${tableId}: ${rows.length} row(s) for ${JSON.stringify(slice)}`);
    }
    const out: CellsFixture = {
      tableId,
      capturedAt: new Date().toISOString(),
      cbsModified: live.modified,
      source: `https://datasets.cbs.nl/odata/v1/CBS/${tableId}/Observations`,
      slices: captured,
    };
    writeFileSync(`${TABLELANE_BENCH_CELLS_DIR}/${tableId}.json`, `${JSON.stringify(out, null, 1)}\n`);
  }
}

/** The independent check of the frozen key: each entry's raw OData URL
 * (plain fetch, not our adapter) must return exactly the key's periods and
 * values. Read-only; prints one line per entry; non-zero exit on a mismatch. */
async function verifyKey(): Promise<void> {
  const key = loadTableLaneKey();
  let bad = 0;
  for (const [taskId, entry] of Object.entries(key.tasks)) {
    const res = await fetch(entry.verifyUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${taskId}: ${res.status} for ${entry.verifyUrl}`);
    const rows = ((await res.json()) as { value: { Perioden: string; Value: number | null }[] }).value;
    const got = rows.map((r) => `${r.Perioden}=${r.Value}`).sort();
    const want = entry.cells.map((c) => `${c.period}=${c.value}`).sort();
    const match = JSON.stringify(got) === JSON.stringify(want);
    if (!match) bad += 1;
    console.log(`${taskId}: ${match ? 'MATCH' : 'MISMATCH'} CBS [${got.join(', ')}] key [${want.join(', ')}]`);
  }
  console.log(bad === 0 ? 'every key entry matches CBS' : `${bad} key entr(y/ies) differ from CBS`);
  if (bad > 0) process.exitCode = 1;
}

const args = process.argv.slice(2);
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (args[0] === '--verify-key') {
    await verifyKey();
  } else if (args[0] === '--schemas') {
    const ids = args.slice(1);
    if (ids.length === 0) throw new Error('--schemas needs at least one table id');
    await captureSchemas(ids);
  } else if (args.length === 0) {
    await captureCells();
  } else {
    throw new Error(`unknown arguments: ${args.join(' ')}`);
  }
}
