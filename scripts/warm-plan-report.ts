// ADR 065 step 2: what would filling each active CBS table's declared scope through bounded slice
// requests look like? READ-ONLY: SELECT statements only — no write, no CBS call, no AI.
//
//   npm run ingest:warm-plan                       one line per table + totals
//   npm run ingest:warm-plan -- --json             the same as JSON
//   npm run ingest:warm-plan -- --max-cells 500 --max-filter-chars 4000
//
// A table whose scope cannot be planned completely prints the reason and the report goes on.
import { connectFromEnv } from '../src/db/client.ts';
import { SLICE_MAX_CELLS } from '../src/ingestion/slice-cache.ts';
import { DEFAULT_MAX_FILTER_CHARS, loadWarmScope, planWarmSlices, type WarmPlanOptions } from '../src/ingestion/warm-plan.ts';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

function numberFlag(name: string): number | undefined {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = Number(args[at + 1]);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`${name} needs a whole number of at least 1`);
    process.exit(1);
  }
  return value;
}

const options: WarmPlanOptions = {
  maxCells: numberFlag('--max-cells'),
  maxFilterChars: numberFlag('--max-filter-chars'),
};

interface TableLine {
  tableId: string;
  ok: boolean;
  error?: string;
  scopeCells?: number;
  requests?: number;
  largestRequestCells?: number;
  longestFilterChars?: number;
}

const { db, pool } = connectFromEnv();

try {
  const tables = await db.query(
    `select id from cbs_tables where status = 'active' and id not like 'eurostat:%' order by id`,
  );
  const lines: TableLine[] = [];
  for (const row of tables.rows) {
    const tableId = row.id as string;
    try {
      const plan = planWarmSlices(await loadWarmScope(db, tableId), options);
      const cells = (req: (typeof plan.requests)[number]): number =>
        req.measures.length *
        req.periods.length *
        Object.values(req.members).reduce((n, codes) => n * codes.length, 1);
      lines.push({
        tableId,
        ok: true,
        scopeCells: plan.totalCells,
        requests: plan.requests.length,
        largestRequestCells: Math.max(...plan.requests.map(cells)),
        longestFilterChars: plan.longestFilterChars,
      });
    } catch (err) {
      lines.push({ tableId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const planned = lines.filter((l) => l.ok);
  const totals = {
    tables: lines.length,
    planned: planned.length,
    refused: lines.length - planned.length,
    scopeCells: planned.reduce((n, l) => n + l.scopeCells!, 0),
    requests: planned.reduce((n, l) => n + l.requests!, 0),
  };

  if (asJson) {
    console.log(
      JSON.stringify({ maxCells: options.maxCells ?? SLICE_MAX_CELLS, maxFilterChars: options.maxFilterChars ?? DEFAULT_MAX_FILTER_CHARS, lines, totals }, null, 2),
    );
  } else {
    console.log(
      `Warm plan (read-only) — caps: ${options.maxCells ?? SLICE_MAX_CELLS} cells, ${options.maxFilterChars ?? DEFAULT_MAX_FILTER_CHARS} filter characters per request\n`,
    );
    const idWidth = Math.max(10, ...lines.map((l) => l.tableId.length));
    for (const l of lines) {
      if (!l.ok) {
        console.log(`  ${l.tableId.padEnd(idWidth)}  NOT PLANNED  ${l.error}`);
        continue;
      }
      console.log(
        `  ${l.tableId.padEnd(idWidth)}  scope ${String(l.scopeCells).padStart(9)} cells  ` +
          `${String(l.requests).padStart(6)} request(s)  largest ${String(l.largestRequestCells).padStart(5)} cells  ` +
          `longest filter ${String(l.longestFilterChars).padStart(5)}`,
      );
    }
    console.log(
      `\n${totals.planned} of ${totals.tables} table(s) planned (${totals.refused} refused): ` +
        `${totals.scopeCells} cells in ${totals.requests} request(s).`,
    );
  }
} finally {
  await pool.end();
}
