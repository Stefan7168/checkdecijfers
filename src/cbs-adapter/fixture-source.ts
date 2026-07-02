// Replay of captured raw CBS OData v4 responses through the same parse-v4
// functions the live adapter uses (ADR 003: tests exercise real parsing
// code, not a second hand-written shape). Fixtures are captured by
// scripts/capture-cbs-fixtures.ts into tests/fixtures/cbs/<tableId>/,
// manifest shape: tests/fixtures/cbs/82235NED/index.json.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CbsCode, CbsObservationRow, CbsSlice, CbsSource, CbsTableSchema } from './types.ts';
import { parseCodes, parseDimensions, parseMeasures, parseObservationsPage } from './parse-v4.ts';
export { sliceToFilter } from './odata-v4.ts';

interface FixtureIndex {
  tableId: string;
  observationPages: string[];
  files: Record<string, string>;
}

export interface FixtureDocs {
  properties: unknown;
  dimensions: unknown;
  measureCodes: unknown;
  codes: Record<string, unknown>;
  observationPages: unknown[];
}

/** Reads index.json in `dir` and loads every raw document it references. */
export function loadFixtureDocs(dir: string): FixtureDocs {
  const indexPath = join(dir, 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as FixtureIndex;

  const readJson = (fileName: string): unknown => JSON.parse(readFileSync(join(dir, fileName), 'utf8'));

  const propertiesFile = index.files['properties'];
  const dimensionsFile = index.files['dimensions'];
  const measureCodesFile = index.files['measure-codes'];
  if (!propertiesFile || !dimensionsFile || !measureCodesFile) {
    throw new Error(
      `Fixture manifest at '${indexPath}' is missing one of properties/dimensions/measure-codes`,
    );
  }

  const codes: Record<string, unknown> = {};
  for (const [key, fileName] of Object.entries(index.files)) {
    if (!key.startsWith('codes-')) continue;
    const dimension = key.slice('codes-'.length);
    codes[dimension] = readJson(fileName);
  }

  const observationPages = (index.observationPages ?? []).map((fileName) => readJson(fileName));

  return {
    properties: readJson(propertiesFile),
    dimensions: readJson(dimensionsFile),
    measureCodes: readJson(measureCodesFile),
    codes,
    observationPages,
  };
}

/** Discovers every table directory under `dir` (one level, each holding an index.json) and loads it. */
export function loadFixtureDocsTree(dir: string): Record<string, FixtureDocs> {
  const result: Record<string, FixtureDocs> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    result[entry.name] = loadFixtureDocs(join(dir, entry.name));
  }
  return result;
}

function matchesEquals(coordinates: Record<string, string>, dimensionEquals?: Record<string, string>): boolean {
  if (!dimensionEquals) return true;
  return Object.entries(dimensionEquals).every(([dim, code]) => coordinates[dim] === code);
}

function matchesPrefixes(
  coordinates: Record<string, string>,
  dimensionPrefixes?: Record<string, string[]>,
): boolean {
  if (!dimensionPrefixes) return true;
  return Object.entries(dimensionPrefixes).every(([dim, prefixes]) => {
    const value = coordinates[dim];
    return value !== undefined && prefixes.some((prefix) => value.startsWith(prefix));
  });
}

function matchesPeriodFloor(coordinates: Record<string, string>, periodFloor?: string): boolean {
  if (!periodFloor) return true;
  const period = coordinates['Perioden'];
  // Lexicographic >=, matching sliceToFilter's `Perioden ge 'code'` semantics
  // (CBS period codes sort correctly as strings: YYYY + grain + index).
  return period !== undefined && period >= periodFloor;
}

/** Applies a CbsSlice client-side, with the same matching semantics as sliceToFilter. */
function matchesSlice(row: CbsObservationRow, slice?: CbsSlice): boolean {
  if (!slice) return true;
  return (
    matchesEquals(row.coordinates, slice.dimensionEquals) &&
    matchesPrefixes(row.coordinates, slice.dimensionPrefixes) &&
    matchesPeriodFloor(row.coordinates, slice.periodFloor)
  );
}

function isFixtureDocs(value: FixtureDocs | Record<string, FixtureDocs>): value is FixtureDocs {
  return 'properties' in value && 'dimensions' in value && 'measureCodes' in value;
}

/**
 * CbsSource replaying pre-captured fixture docs through parse-v4, filtering
 * observations client-side to the requested slice.
 * Accepts either one table's FixtureDocs (matched against any tableId the
 * caller passes — the single-table case tests use) or a
 * Record<tableId, FixtureDocs> for multi-table sources; an unknown tableId
 * against the multi-table form throws a descriptive error.
 */
export class FixtureSource implements CbsSource {
  private readonly single: FixtureDocs | null;
  private readonly tables: Record<string, FixtureDocs>;

  constructor(docs: FixtureDocs | Record<string, FixtureDocs>) {
    if (isFixtureDocs(docs)) {
      this.single = docs;
      this.tables = {};
    } else {
      this.single = null;
      this.tables = docs;
    }
  }

  private docsFor(tableId: string): FixtureDocs {
    if (this.single) return this.single;
    const docs = this.tables[tableId];
    if (!docs) {
      throw new Error(
        `FixtureSource has no fixture docs registered for table '${tableId}' (known: ${Object.keys(this.tables).join(', ') || '<none>'})`,
      );
    }
    return docs;
  }

  async fetchTableSchema(tableId: string): Promise<CbsTableSchema> {
    const docs = this.docsFor(tableId);
    const props = docs.properties as { Title?: unknown };
    if (typeof props.Title !== 'string') {
      throw new Error(`Fixture Properties for table '${tableId}' is missing Title`);
    }
    return {
      tableId,
      title: props.Title,
      dimensions: parseDimensions(docs.dimensions),
      measures: parseMeasures(docs.measureCodes),
    };
  }

  async fetchCodeList(tableId: string, dimension: string): Promise<CbsCode[]> {
    const docs = this.docsFor(tableId);
    const raw = docs.codes[dimension];
    if (raw === undefined) {
      throw new Error(
        `FixtureSource has no captured code list for table '${tableId}' dimension '${dimension}' (known: ${Object.keys(docs.codes).join(', ') || '<none>'})`,
      );
    }
    return parseCodes(raw);
  }

  async *fetchObservations(tableId: string, slice?: CbsSlice): AsyncIterable<CbsObservationRow[]> {
    const docs = this.docsFor(tableId);
    const dimensionNames = parseDimensions(docs.dimensions).map((d) => d.name);
    for (const page of docs.observationPages) {
      const { rows } = parseObservationsPage(page, dimensionNames);
      yield rows.filter((row) => matchesSlice(row, slice));
    }
  }
}
