// #317 (docs/open-questions.md): checkTable() in src/sources/conformance.ts
// called adapter.fetchTableSchema(id) and adapter.fetchCodeList(id, dim.name)
// WITHOUT the manifest's registered slice, while fetchObservations already
// received spec.slice — an inconsistency with src/ingestion/pipeline.ts,
// which threads the registered slice into all three calls
// (registerTables → fetchTableSchema(table.id, table.slice) and
// fetchAllCodeLists → fetchCodeList(tableId, dim.name, slice)). This test
// pins the SAME argument shape for the conformance harness: a recording fake
// adapter proves the slice actually reaches both calls.
import { describe, expect, it } from 'vitest';
import type {
  CbsCatalogEntry,
  CbsCode,
  CbsObservationRow,
  CbsSlice,
  CbsTableSchema,
} from '../../src/cbs-adapter/types.ts';
import type { SourceAdapter } from '../../src/sources/adapters.ts';
import { runSourceConformance, type SourceConformanceManifest } from '../../src/sources/conformance.ts';
import { fakeSourceInfo } from '../helpers/fake-source-info.ts';

/** Records the exact arguments each call was made with, so the test can
 * assert on the argument SHAPE rather than on any behavioral side effect
 * (the fake ignores the slice for its returned data — same as the existing
 * conformance-failures.test.ts FakeSource — because this test's only concern
 * is whether the slice is PASSED, not how a real adapter would narrow with it). */
class RecordingSource implements SourceAdapter {
  readonly fetchTableSchemaCalls: Array<{ tableId: string; slice: CbsSlice | undefined }> = [];
  readonly fetchCodeListCalls: Array<{ tableId: string; dimension: string; slice: CbsSlice | undefined }> = [];

  private readonly schema: CbsTableSchema;
  private readonly codes: Record<string, CbsCode[]>;
  private readonly rows: CbsObservationRow[];
  private readonly catalog: CbsCatalogEntry[];

  constructor(schema: CbsTableSchema, codes: Record<string, CbsCode[]>, rows: CbsObservationRow[], catalog: CbsCatalogEntry[]) {
    this.schema = schema;
    this.codes = codes;
    this.rows = rows;
    this.catalog = catalog;
  }

  async fetchTableSchema(tableId: string, slice?: CbsSlice): Promise<CbsTableSchema> {
    this.fetchTableSchemaCalls.push({ tableId, slice });
    return this.schema;
  }

  async fetchCodeList(tableId: string, dimension: string, slice?: CbsSlice): Promise<CbsCode[]> {
    this.fetchCodeListCalls.push({ tableId, dimension, slice });
    return this.codes[dimension] ?? [];
  }

  async *fetchObservations(_tableId: string, _slice?: CbsSlice): AsyncIterable<CbsObservationRow[]> {
    yield this.rows;
  }

  async fetchObservationCount(): Promise<number | null> {
    return this.rows.length;
  }

  async fetchCatalog(): Promise<CbsCatalogEntry[]> {
    return this.catalog;
  }
}

const code = (c: string, status: string | null): CbsCode => ({
  code: c,
  title: c,
  dimensionGroup: null,
  status,
  index: null,
});

const row = (period: string, value: number | null, valueAttribute: string): CbsObservationRow => ({
  measure: 'M1',
  coordinates: { Perioden: period, RegioS: 'NL01' },
  value,
  valueAttribute,
  stringValue: null,
});

function schema(): CbsTableSchema {
  return {
    tableId: 'fake:t1',
    title: 'Fake tabel',
    dimensions: [
      { name: 'Perioden', kind: 'TimeDimension' },
      { name: 'RegioS', kind: 'GeoDimension' },
    ],
    measures: [{ code: 'M1', title: 'Aantal', unit: 'aantal', decimals: 0, description: '' }],
  };
}

function catalog(): CbsCatalogEntry[] {
  return [
    {
      tableId: 'fake:t1',
      title: 'Fake tabel',
      summary: '',
      status: 'Actueel',
      datasetType: 'Numeric',
      language: 'nl',
      modified: null,
    },
  ];
}

const SLICE: CbsSlice = { periodFloor: '2000JJ00' };

const MANIFEST: SourceConformanceManifest = {
  sourceKey: 'fake',
  tables: [{ tableId: 'fake:t1', slice: SLICE }],
  declaredPeriodStatuses: ['Definitief', 'Voorlopig'],
  declaredValueAttributes: ['None', 'Missing'],
  declaredCatalogStatuses: ['Actueel'],
  declaredDatasetTypes: ['Numeric'],
};

describe('#317 — conformance threads the registered slice into fetchTableSchema/fetchCodeList', () => {
  it('passes the manifest slice to fetchTableSchema, exactly like pipeline.ts\'s registerTables', async () => {
    const source = new RecordingSource(
      schema(),
      {
        Perioden: [code('2023JJ00', 'Definitief')],
        RegioS: [code('NL01', null)],
      },
      [row('2023JJ00', 5, 'None')],
      catalog(),
    );
    await runSourceConformance(source, MANIFEST, fakeSourceInfo());

    expect(source.fetchTableSchemaCalls).toEqual([{ tableId: 'fake:t1', slice: SLICE }]);
  });

  it('passes the manifest slice to every fetchCodeList call, exactly like pipeline.ts\'s fetchAllCodeLists', async () => {
    const source = new RecordingSource(
      schema(),
      {
        Perioden: [code('2023JJ00', 'Definitief')],
        RegioS: [code('NL01', null)],
      },
      [row('2023JJ00', 5, 'None')],
      catalog(),
    );
    await runSourceConformance(source, MANIFEST, fakeSourceInfo());

    expect(source.fetchCodeListCalls).toEqual([
      { tableId: 'fake:t1', dimension: 'Perioden', slice: SLICE },
      { tableId: 'fake:t1', dimension: 'RegioS', slice: SLICE },
    ]);
  });

  it('a table with no manifest slice still calls both with slice === undefined (unchanged behavior)', async () => {
    const source = new RecordingSource(
      schema(),
      {
        Perioden: [code('2023JJ00', 'Definitief')],
        RegioS: [code('NL01', null)],
      },
      [row('2023JJ00', 5, 'None')],
      catalog(),
    );
    const noSliceManifest: SourceConformanceManifest = { ...MANIFEST, tables: [{ tableId: 'fake:t1' }] };
    await runSourceConformance(source, noSliceManifest, fakeSourceInfo());

    expect(source.fetchTableSchemaCalls).toEqual([{ tableId: 'fake:t1', slice: undefined }]);
    expect(source.fetchCodeListCalls).toEqual([
      { tableId: 'fake:t1', dimension: 'Perioden', slice: undefined },
      { tableId: 'fake:t1', dimension: 'RegioS', slice: undefined },
    ]);
  });
});
