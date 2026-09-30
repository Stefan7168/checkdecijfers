// ADR 062 step 6 — the table-lane benchmark's CBS stand-in. Hermetic: it
// serves ONE committed snapshot per table and never touches the network.
//
//   - Schema + code lists: tests/fixtures/tableparse/schemas/<tableId>.json —
//     the SAME metadata capture (live adapter, measure groups included) the
//     table-parser recording builds its requests from, so the benchmark's
//     parse requests hash exactly like the recorded ones.
//   - Cells: tests/fixtures/tablelane-bench/cells/<tableId>.json — the rows
//     CBS returned for each slice the benchmark's expected parses need,
//     captured read-only by scripts/capture-tablelane-bench.ts through the live
//     adapter's own fetchObservations (the parsed CbsObservationRow shape).
//
// Loud by design: a fetch for a slice that is not inside one captured slice
// throws UncapturedSliceError. The job turns any fetch error into a refusal
// (cbs_unreachable), so the source ALSO records every such miss in
// `uncovered` — the runner reports it per task and the scorer fails the task.
// A miss is never served as "CBS has no data".
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  CbsCatalogEntry,
  CbsCode,
  CbsObservationRow,
  CbsSlice,
  CbsSource,
  CbsTableSchema,
} from '../../src/cbs-adapter/types.ts';

export const TABLEPARSE_SCHEMAS_DIR = fileURLToPath(new URL('../fixtures/tableparse/schemas', import.meta.url));
export const TABLELANE_BENCH_CELLS_DIR = fileURLToPath(new URL('../fixtures/tablelane-bench/cells', import.meta.url));

export interface SchemaFixture {
  fetchedAt: string;
  schema: CbsTableSchema;
  codeLists: Record<string, CbsCode[]>;
}

/** One captured slice: the exact CbsSlice the lane would send and every row
 * CBS returned for it (possibly fewer than the slice's cell count — a cell CBS
 * does not return is a missing cell, exactly as live). */
export interface CapturedSlice {
  slice: CbsSlice;
  rows: CbsObservationRow[];
}

export interface CellsFixture {
  tableId: string;
  capturedAt: string;
  /** CBS `Modified` of the table when the cells were captured — must equal
   * the schema fixture's, or the snapshot mixes two CBS versions. */
  cbsModified: string;
  source: string;
  slices: CapturedSlice[];
}

export function loadSchemaFixture(tableId: string): SchemaFixture {
  return JSON.parse(readFileSync(`${TABLEPARSE_SCHEMAS_DIR}/${tableId}.json`, 'utf8')) as SchemaFixture;
}

export function loadCellsFixture(tableId: string): CellsFixture | null {
  const path = `${TABLELANE_BENCH_CELLS_DIR}/${tableId}.json`;
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as CellsFixture;
}

export class UncapturedSliceError extends Error {
  override name = 'UncapturedSliceError';
}

/** Every requested code is inside the captured list (an absent or empty
 * restriction on the capture side means "all"). */
function within(requested: string[] | undefined, captured: string[] | undefined): boolean {
  if (captured === undefined || captured.length === 0) return true;
  if (requested === undefined || requested.length === 0) return false;
  return requested.every((code) => captured.includes(code));
}

/** The request asks for nothing outside the captured slice. Only the three
 * fields fetchSlice sends are supported; anything else is refused loudly. */
export function sliceWithin(req: CbsSlice, captured: CbsSlice): boolean {
  if (req.dimensionEquals || req.dimensionPrefixes || req.periodFloor) return false;
  if (!within(req.measures, captured.measures)) return false;
  if (req.periodIn?.dimension !== captured.periodIn?.dimension) return false;
  if (!within(req.periodIn?.codes, captured.periodIn?.codes)) return false;
  const capDims = captured.dimensionIn ?? {};
  for (const [dim, codes] of Object.entries(capDims)) {
    if (!within(req.dimensionIn?.[dim], codes)) return false;
  }
  return true;
}

/** fetchSlice's own matching semantics (FixtureSource.matchesSlice) for the
 * fields it sends: measures, dimensionIn, periodIn — empty lists add nothing. */
export function rowMatches(row: CbsObservationRow, slice: CbsSlice): boolean {
  if (slice.measures && slice.measures.length > 0 && !slice.measures.includes(row.measure)) return false;
  for (const [dim, codes] of Object.entries(slice.dimensionIn ?? {})) {
    if (codes.length > 0 && !codes.includes(row.coordinates[dim] ?? '')) return false;
  }
  const p = slice.periodIn;
  if (p && p.codes.length > 0 && !p.codes.includes(row.coordinates[p.dimension] ?? '')) return false;
  return true;
}

export class TableLaneBenchSource implements CbsSource {
  /** Every fetch the snapshot could not serve, in order (table + slice). */
  readonly uncovered: { tableId: string; slice: CbsSlice | undefined }[] = [];
  private readonly schemas = new Map<string, SchemaFixture>();
  private readonly cells = new Map<string, CellsFixture | null>();

  private schemaOf(tableId: string): SchemaFixture {
    let fixture = this.schemas.get(tableId);
    if (fixture === undefined) {
      if (!existsSync(`${TABLEPARSE_SCHEMAS_DIR}/${tableId}.json`)) {
        throw new Error(`TableLaneBenchSource: no schema fixture for table '${tableId}'`);
      }
      fixture = loadSchemaFixture(tableId);
      this.schemas.set(tableId, fixture);
    }
    return fixture;
  }

  async fetchTableSchema(tableId: string): Promise<CbsTableSchema> {
    return structuredClone(this.schemaOf(tableId).schema);
  }

  async fetchCodeList(tableId: string, dimension: string): Promise<CbsCode[]> {
    const list = this.schemaOf(tableId).codeLists[dimension];
    if (list === undefined) throw new Error(`TableLaneBenchSource: no code list '${dimension}' for '${tableId}'`);
    return structuredClone(list);
  }

  async *fetchObservations(tableId: string, slice?: CbsSlice): AsyncIterable<CbsObservationRow[]> {
    if (!this.cells.has(tableId)) this.cells.set(tableId, loadCellsFixture(tableId));
    const fixture = this.cells.get(tableId) ?? null;
    const captured = slice === undefined ? undefined : fixture?.slices.find((c) => sliceWithin(slice, c.slice));
    if (slice === undefined || captured === undefined) {
      this.uncovered.push({ tableId, slice });
      throw new UncapturedSliceError(
        `benchmark snapshot has no captured slice covering this request on '${tableId}': ${JSON.stringify(slice)}`,
      );
    }
    yield structuredClone(captured.rows.filter((row) => rowMatches(row, slice)));
  }

  async fetchObservationCount(): Promise<number | null> {
    return null;
  }

  async fetchCatalog(): Promise<CbsCatalogEntry[]> {
    return [];
  }
}
