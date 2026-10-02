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
//
// Session 153 (#357 step 5) — the Eurostat set, READ-ONLY from Eurostat's
// public API through the table-lane job's own source (StatisticsApiSource,
// structure mode, decimals observed). Same steps, `--eurostat` first:
//
//   ... capture-tablelane-bench.ts --eurostat --schemas <code> [<code> ...]
//   ... capture-tablelane-bench.ts --eurostat                (cells)
//   ... capture-tablelane-bench.ts --eurostat --write-key     (the frozen key,
//       read INDEPENDENTLY: a plain fetch of Eurostat's JSON-stat URL with
//       every dimension pinned — not our adapter — one cell per task)
//   ... capture-tablelane-bench.ts --eurostat --verify-key
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ODataV4Source } from '../src/cbs-adapter/odata-v4.ts';
import { StatisticsApiSource } from '../src/eurostat-adapter/statistics-api.ts';
import type { CbsCode, CbsObservationRow, CbsSlice } from '../src/cbs-adapter/types.ts';
import {
  EUROSTAT_BENCH_SCHEMAS_DIR,
  TABLELANE_BENCH_CELLS_DIR,
  TABLEPARSE_SCHEMAS_DIR,
  cellsFixturePath,
  loadSchemaFixture,
  rowMatches,
  schemaFixturePath,
  sliceWithin,
  type CapturedSlice,
  type CellsFixture,
} from '../tests/helpers/tablelane-bench-source.ts';
import {
  answerableTasks,
  cannedPlans,
  loadTableLaneKey,
  loadTableLaneTasks,
  type KeyCell,
  type TableLaneKeyFile,
  type TableLaneSet,
} from './tablelane-bench-lib.ts';

const EUROSTAT_PREFIX = 'eurostat:';
const EUROSTAT_DATA_URL = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';

function sourceFor(set: TableLaneSet): ODataV4Source | StatisticsApiSource {
  return set === 'eurostat' ? new StatisticsApiSource(fetch, { structureLayout: { decimals: 'observed' } }) : new ODataV4Source();
}

async function captureEurostatSchemas(codes: string[]): Promise<void> {
  const source = new StatisticsApiSource(fetch, { structureLayout: { decimals: 'observed' } });
  mkdirSync(EUROSTAT_BENCH_SCHEMAS_DIR, { recursive: true });
  for (const code of codes) {
    const tableId = `${EUROSTAT_PREFIX}${code}`;
    const path = schemaFixturePath(tableId);
    if (existsSync(path)) throw new Error(`${path} exists — never overwritten (the benchmark's request bytes hash it)`);
    const schema = await source.fetchTableSchema(tableId);
    const codeLists: Record<string, CbsCode[]> = {};
    for (const dim of schema.dimensions) codeLists[dim.name] = await source.fetchCodeList(tableId, dim.name);
    writeFileSync(path, `${JSON.stringify({ fetchedAt: new Date().toISOString(), schema, codeLists }, null, 1)}\n`);
    console.log(`${tableId}: "${schema.title}" — ${schema.measures.length} units, ${schema.dimensions.length} dims -> ${path}`);
  }
}

/** Internal period code → Eurostat's TIME_PERIOD ('2024JJ00' → '2024',
 * '2024KW02' → '2024-Q2', '2025MM03' → '2025-03'). */
export function eurostatTimeCode(period: string): string {
  const m = /^(\d{4})(JJ|KW|MM)(\d{2})$/.exec(period);
  if (m === null) throw new Error(`not an internal period code: ${period}`);
  if (m[2] === 'JJ') return m[1]!;
  if (m[2] === 'KW') return `${m[1]}-Q${Number(m[3])}`;
  return `${m[1]}-${m[3]}`;
}

/** One planned cell read straight from Eurostat's JSON-stat endpoint — a plain
 * fetch, NOT our adapter: every dimension pinned, so the answer is the single
 * value at index 0 (absent = no value) and its flag (absent = 'Published', the
 * status our adapter stores for an unflagged value). */
async function readEurostatCell(code: string, unit: string, coords: Record<string, string>, period: string) {
  const params = new URLSearchParams({ format: 'JSON', lang: 'EN', unit });
  for (const [dim, c] of Object.entries(coords)) params.append(dim, c);
  params.append('time', eurostatTimeCode(period));
  const url = `${EUROSTAT_DATA_URL}/${code}?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const body = (await res.json()) as { value?: Record<string, number>; status?: Record<string, string>; size?: number[] };
  const cells = (body.size ?? []).reduce((a, b) => a * b, 1);
  if (cells !== 1) throw new Error(`${url}: expected exactly one cell with every dimension pinned, got ${cells}`);
  return { url, value: body.value?.['0'] ?? null, status: body.status?.['0'] ?? 'Published' };
}

/** The Eurostat key: per answer task (and ask task's reply round), the planned
 * slice must be ONE cell; that cell is read independently from Eurostat and
 * must equal the committed snapshot's row. */
async function writeEurostatKey(): Promise<void> {
  const tasks = loadTableLaneTasks('eurostat');
  const plans = await cannedPlans(tasks);
  const out: TableLaneKeyFile = {
    schemaVersion: 1,
    source:
      'Frozen ground truth for the Eurostat table-lane benchmark (benchmark/tablelane-eurostat-tasks.json): one cell per answer task ' +
      "and per ask task's post-click answer, read independently from Eurostat's public JSON-stat API (verifyUrl, every dimension " +
      'pinned, plain fetch — not our adapter) by scripts/capture-tablelane-bench.ts --eurostat --write-key, and checked equal to the ' +
      'committed snapshot (tests/fixtures/tablelane-bench/cells/eurostat__*.json). Dataset versions are pinned by the schema ' +
      "fixtures' 'modified' (Eurostat UPDATE_DATA). Never hand-edited to green.",
    frozenAt: new Date().toISOString().slice(0, 10),
    tasks: {},
  };
  for (const task of answerableTasks(tasks)) {
    const plan = plans.find((p) => p.taskId === task.id && p.round === (task.type === 'ask' ? 'reply' : 'first'))!;
    if (plan.slice === null) throw new Error(`${task.id}: the canned plan fetches nothing (${plan.kind} ${plan.refusalReason ?? ''})`);
    const schema = loadSchemaFixture(task.table).schema;
    const geoDim = schema.dimensions.find((d) => d.kind === 'GeoDimension')?.name ?? null;
    const measures = plan.slice.measures ?? [];
    const periods = plan.slice.periodIn?.codes ?? [];
    if (measures.length !== 1 || periods.length !== 1) throw new Error(`${task.id}: the planned slice is not one cell`);
    const coords: Record<string, string> = {};
    for (const [dim, codes] of Object.entries(plan.slice.dimensionIn ?? {})) {
      if (codes.length !== 1) throw new Error(`${task.id}: dimension ${dim} is not pinned to one member`);
      coords[dim] = codes[0]!;
    }
    const [code, unit] = measures[0]!.split('|') as [string, string];
    const read = await readEurostatCell(code, unit, coords, periods[0]!);
    const snapshot = loadCellsFixtureStrict(task.table).slices.flatMap((s) => s.rows).filter((r) => rowMatches(r, plan.slice!));
    if (snapshot.length !== 1 || snapshot[0]!.value !== read.value) {
      throw new Error(`${task.id}: Eurostat says ${read.value}, the snapshot has ${JSON.stringify(snapshot.map((r) => r.value))} — not frozen`);
    }
    const dims = Object.fromEntries(Object.entries(coords).filter(([d]) => d !== geoDim));
    const cell: KeyCell = {
      measure: measures[0]!,
      period: periods[0]!,
      region: geoDim === null ? null : (coords[geoDim] ?? null),
      dims,
      value: read.value,
      status: read.status,
    };
    out.tasks[task.id] = { table: task.table, cells: [cell], verifyUrl: read.url };
    console.log(`${task.id}: ${read.value} (${read.status}) ${read.url}`);
  }
  writeFileSync(fileURLToPath(new URL('../benchmark/tablelane-eurostat-answer-key.json', import.meta.url)), `${JSON.stringify(out, null, 2)}\n`);
}

function loadCellsFixtureStrict(tableId: string): CellsFixture {
  const path = cellsFixturePath(tableId);
  if (!existsSync(path)) throw new Error(`${tableId}: no cell snapshot — capture cells first`);
  return JSON.parse(readFileSync(path, 'utf8')) as CellsFixture;
}

async function verifyEurostatKey(): Promise<void> {
  const key = loadTableLaneKey('eurostat');
  let bad = 0;
  for (const [taskId, entry] of Object.entries(key.tasks)) {
    const res = await fetch(entry.verifyUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${taskId}: ${res.status} for ${entry.verifyUrl}`);
    const body = (await res.json()) as { value?: Record<string, number> };
    const got = body.value?.['0'] ?? null;
    const want = entry.cells[0]!.value;
    if (got !== want) bad += 1;
    console.log(`${taskId}: ${got === want ? 'MATCH' : 'MISMATCH'} Eurostat ${got} key ${want}`);
  }
  console.log(bad === 0 ? 'every key entry matches Eurostat' : `${bad} key entr(y/ies) differ from Eurostat`);
  if (bad > 0) process.exitCode = 1;
}

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

async function captureCells(set: TableLaneSet = 'cbs'): Promise<void> {
  const source = sourceFor(set);
  const tasks = loadTableLaneTasks(set);
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
      const pages =
        source instanceof ODataV4Source
          ? source.fetchObservations(tableId, slice, live.dimensions.map((d) => d.name))
          : source.fetchObservations(tableId, slice);
      for await (const page of pages) rows.push(...page);
      captured.push({ slice, rows });
      console.log(`${tableId}: ${rows.length} row(s) for ${JSON.stringify(slice)}`);
    }
    const out: CellsFixture = {
      tableId,
      capturedAt: new Date().toISOString(),
      cbsModified: live.modified,
      source:
        set === 'eurostat'
          ? `${EUROSTAT_DATA_URL}/${tableId.slice(EUROSTAT_PREFIX.length)}`
          : `https://datasets.cbs.nl/odata/v1/CBS/${tableId}/Observations`,
      slices: captured,
    };
    writeFileSync(cellsFixturePath(tableId), `${JSON.stringify(out, null, 1)}\n`);
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

const argv = process.argv.slice(2);
const eurostat = argv[0] === '--eurostat';
const args = eurostat ? argv.slice(1) : argv;
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain && eurostat) {
  if (args[0] === '--schemas') {
    if (args.length < 2) throw new Error('--schemas needs at least one Eurostat dataset code');
    await captureEurostatSchemas(args.slice(1));
  } else if (args[0] === '--write-key') {
    await writeEurostatKey();
  } else if (args[0] === '--verify-key') {
    await verifyEurostatKey();
  } else if (args.length === 0) {
    await captureCells('eurostat');
  } else {
    throw new Error(`unknown arguments: ${argv.join(' ')}`);
  }
} else if (isMain) {
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
