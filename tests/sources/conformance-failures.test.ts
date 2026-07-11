// WP30b: the harness must be able to FAIL — the reconstructionReport
// tamper-test discipline. A harness that cannot reject a bad adapter is a
// rubber stamp, and D6 makes it the done-definition for adding a source. A
// hand-rolled fake adapter (canonical shapes directly, NO parse code — the
// contract accepts any implementation) is seeded with one corruption per test
// and the RIGHT family must report it in plain language.
import { describe, expect, it } from 'vitest';
import type {
  CbsCatalogEntry,
  CbsCode,
  CbsObservationRow,
  CbsSlice,
  CbsTableSchema,
} from '../../src/cbs-adapter/types.ts';
import type { SourceAdapter } from '../../src/sources/adapters.ts';
import {
  runSourceConformance,
  validateManifestShape,
  type ConformanceFamily,
  type ConformanceReport,
  type SourceConformanceManifest,
} from '../../src/sources/conformance.ts';
import { SOURCES, type SourceInfo } from '../../src/sources/registry.ts';
import { fakeSourceInfo } from '../helpers/fake-source-info.ts';

interface FakeTable {
  schema: CbsTableSchema;
  codes: Record<string, CbsCode[]>;
  rows: CbsObservationRow[];
}

class FakeSource implements SourceAdapter {
  private readonly tables: Record<string, FakeTable>;
  private readonly catalog: CbsCatalogEntry[] | 'throw';

  constructor(tables: Record<string, FakeTable>, catalog: CbsCatalogEntry[] | 'throw') {
    this.tables = tables;
    this.catalog = catalog;
  }

  private get(tableId: string): FakeTable {
    const t = this.tables[tableId];
    if (!t) throw new Error(`fake source has no table '${tableId}'`);
    return t;
  }

  async fetchTableSchema(tableId: string): Promise<CbsTableSchema> {
    return this.get(tableId).schema;
  }

  async fetchCodeList(tableId: string, dimension: string): Promise<CbsCode[]> {
    return this.get(tableId).codes[dimension] ?? [];
  }

  async *fetchObservations(tableId: string, slice?: CbsSlice): AsyncIterable<CbsObservationRow[]> {
    let rows = this.get(tableId).rows;
    if (slice?.periodFloor !== undefined) {
      const floor = slice.periodFloor;
      rows = rows.filter((r) => (r.coordinates['Perioden'] ?? '') >= floor);
    }
    yield rows;
  }

  async fetchObservationCount(tableId: string): Promise<number | null> {
    return this.get(tableId).rows.length;
  }

  async fetchCatalog(): Promise<CbsCatalogEntry[]> {
    if (this.catalog === 'throw') throw new Error('no catalog captured');
    return this.catalog;
  }
}

// --- Baseline: a coherent, PASSING non-cbs source (also proves the prefix
// rules work for a real '<key>:<native-id>' source) ------------------------

const code = (c: string, status: string | null): CbsCode => ({
  code: c,
  title: c,
  dimensionGroup: null,
  status,
  index: null,
});

const row = (
  period: string,
  value: number | null,
  valueAttribute: string,
  measure = 'M1',
  region = 'NL01',
): CbsObservationRow => ({
  measure,
  coordinates: { Perioden: period, RegioS: region },
  value,
  valueAttribute,
  stringValue: null,
});

function baseTable(): FakeTable {
  return {
    schema: {
      tableId: 'fake:t1',
      title: 'Fake tabel',
      dimensions: [
        { name: 'Perioden', kind: 'TimeDimension' },
        { name: 'RegioS', kind: 'GeoDimension' },
      ],
      measures: [{ code: 'M1', title: 'Aantal', unit: 'aantal', decimals: 0, description: '' }],
    },
    codes: {
      Perioden: [code('2023JJ00', 'Definitief'), code('2024JJ00', 'Voorlopig')],
      RegioS: [code('NL01', null)],
    },
    rows: [row('2023JJ00', 5, 'None'), row('2024JJ00', null, 'Missing')],
  };
}

function baseCatalog(): CbsCatalogEntry[] {
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

function baseManifest(): SourceConformanceManifest {
  return {
    sourceKey: 'fake',
    tables: [{ tableId: 'fake:t1' }],
    declaredPeriodStatuses: ['Definitief', 'Voorlopig'],
    declaredValueAttributes: ['None', 'Missing'],
    declaredCatalogStatuses: ['Actueel', 'Oud'],
    declaredDatasetTypes: ['Numeric'],
  };
}

interface Scenario {
  table?: FakeTable;
  catalog?: CbsCatalogEntry[] | 'throw';
  manifest?: SourceConformanceManifest;
  info?: SourceInfo;
}

async function run(s: Scenario = {}): Promise<ConformanceReport> {
  const table = s.table ?? baseTable();
  const manifest = s.manifest ?? baseManifest();
  const tables: Record<string, FakeTable> = {};
  for (const t of manifest.tables) tables[t.tableId] = table;
  return runSourceConformance(new FakeSource(tables, s.catalog ?? baseCatalog()), manifest, s.info ?? fakeSourceInfo());
}

function families(report: ConformanceReport): Set<ConformanceFamily> {
  return new Set(report.failures.map((f) => f.family));
}

describe('conformance harness — positive control', () => {
  it('the coherent baseline fake source PASSES (prefix rules and all)', async () => {
    const report = await run();
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('F0 — registry-entry coherence failures', () => {
  it('a status declared both definitive and provisional-displayed', async () => {
    const report = await run({ info: fakeSourceInfo({ definitiveStatuses: ['Voorlopig'] }) });
    expect(families(report)).toContain('F0_registry');
  });

  it('empty displayName / empty attributionLabel / missing license', async () => {
    expect(families(await run({ info: fakeSourceInfo({ displayName: '  ' }) }))).toContain('F0_registry');
    expect(families(await run({ info: fakeSourceInfo({ attributionLabel: '' }) }))).toContain('F0_registry');
    expect(
      families(await run({ info: fakeSourceInfo({ license: '' as unknown as SourceInfo['license'] }) })),
    ).toContain('F0_registry');
  });

  it('provisionalDisplay keyed on an undeclared period status', async () => {
    const report = await run({
      info: fakeSourceInfo({ provisionalDisplay: { Herzien: ' (herzien cijfer)' } }),
    });
    expect(families(report)).toContain('F0_registry');
  });

  it('empty definitiveStatuses, and definitiveStatuses outside the declared vocabulary', async () => {
    expect(families(await run({ info: fakeSourceInfo({ definitiveStatuses: [] }) }))).toContain('F0_registry');
    expect(families(await run({ info: fakeSourceInfo({ definitiveStatuses: ['Vastgesteld'] }) }))).toContain(
      'F0_registry',
    );
  });

  it('nullReasonLabels keyed on an undeclared value attribute', async () => {
    const report = await run({
      info: fakeSourceInfo({ nullReasonLabels: { Missing: 'door FAKE niet geleverd', Geheim: 'geheim' } }),
    });
    expect(families(report)).toContain('F0_registry');
  });

  it('empty currentCatalogStatuses', async () => {
    const report = await run({ info: fakeSourceInfo({ currentCatalogStatuses: [] }) });
    expect(families(report)).toContain('F0_registry');
  });

  it('currentCatalogStatuses outside the declared catalog vocabulary', async () => {
    const report = await run({ info: fakeSourceInfo({ currentCatalogStatuses: ['NietGedeclareerd'] }) });
    expect(families(report)).toContain('F0_registry');
  });

  it('deepLink that does not embed the table id, or is not https', async () => {
    const noId = await run({ info: fakeSourceInfo({ deepLink: () => 'https://fake.example/static' }) });
    expect(families(noId)).toContain('F0_registry');
    const http = await run({ info: fakeSourceInfo({ deepLink: (id) => `http://fake.example/${id}` }) });
    expect(families(http)).toContain('F0_registry');
  });

  it('registry key ≠ manifest sourceKey', async () => {
    const report = await run({ info: fakeSourceInfo({ key: 'anders' }) });
    expect(families(report)).toContain('F0_registry');
  });
});

describe('F1 — replay + D4 id discipline failures', () => {
  it('missing catalog (fetchCatalog throws) and empty catalog both fail', async () => {
    expect(families(await run({ catalog: 'throw' }))).toContain('F1_replay');
    expect(families(await run({ catalog: [] }))).toContain('F1_replay');
  });

  it('a catalog entry with a bare (unprefixed) id under a non-cbs source', async () => {
    const entries = baseCatalog();
    entries.push({ ...entries[0]!, tableId: '47022NED' });
    const report = await run({ catalog: entries });
    expect(families(report)).toContain('F1_replay');
  });

  it('a manifest table with a bare id under a non-cbs source', async () => {
    const table = baseTable();
    table.schema = { ...table.schema, tableId: 't1' };
    const manifest = baseManifest();
    manifest.tables = [{ tableId: 't1' }];
    const report = await run({ table, manifest });
    expect(families(report)).toContain('F1_replay');
  });

  it("a 'cbs:'-prefixed id under cbs (CBS ids must stay bare — D4)", async () => {
    const table = baseTable();
    table.schema = { ...table.schema, tableId: 'cbs:sneaky' };
    const manifest: SourceConformanceManifest = {
      sourceKey: 'cbs',
      tables: [{ tableId: 'cbs:sneaky' }],
      declaredPeriodStatuses: ['Definitief', 'Voorlopig', 'NaderVoorlopig'],
      declaredValueAttributes: ['None', 'Missing', 'Impossible', 'Confidential', 'NotAvailable'],
      declaredCatalogStatuses: ['Regulier', 'Actueel'],
      declaredDatasetTypes: ['Numeric'],
    };
    const catalog: CbsCatalogEntry[] = [{ ...baseCatalog()[0]!, tableId: '82235NED', status: 'Regulier' }];
    const report = await run({ table, manifest, catalog, info: SOURCES['cbs']! });
    const f1 = report.failures.filter((f) => f.family === 'F1_replay');
    expect(f1.some((f) => f.tableId === 'cbs:sneaky')).toBe(true);
  });

  it('empty schema title and zero measures both fail', async () => {
    const noTitle = baseTable();
    noTitle.schema = { ...noTitle.schema, title: '   ' };
    expect(families(await run({ table: noTitle }))).toContain('F1_replay');

    const noMeasures = baseTable();
    noMeasures.schema = { ...noMeasures.schema, measures: [] };
    expect(families(await run({ table: noMeasures }))).toContain('F1_replay');
  });

  it('an empty code list for a dimension', async () => {
    const table = baseTable();
    table.codes['RegioS'] = [];
    expect(families(await run({ table }))).toContain('F1_replay');
  });

  it('a throwing fetchObservationCount is reported, not crashed on', async () => {
    class CountThrows extends FakeSource {
      override async fetchObservationCount(): Promise<number | null> {
        throw new Error('count endpoint exploded');
      }
    }
    const report = await runSourceConformance(
      new CountThrows({ 'fake:t1': baseTable() }, baseCatalog()),
      baseManifest(),
      fakeSourceInfo(),
    );
    expect(families(report)).toContain('F1_replay');
    expect(report.failures.some((f) => f.summary.includes('count endpoint exploded'))).toBe(true);
  });

  it('zero and two TimeDimensions both fail (the A7 exactly-one contract)', async () => {
    const zero = baseTable();
    zero.schema = {
      ...zero.schema,
      dimensions: [{ name: 'RegioS', kind: 'GeoDimension' }],
    };
    expect(families(await run({ table: zero }))).toContain('F1_replay');

    const two = baseTable();
    two.schema = {
      ...two.schema,
      dimensions: [
        { name: 'Perioden', kind: 'TimeDimension' },
        { name: 'PeriodenB', kind: 'TimeDimension' },
      ],
    };
    expect(families(await run({ table: two }))).toContain('F1_replay');
  });
});

describe('F2 — period grammar + declared statuses', () => {
  it('a period code outside the canonical grammar', async () => {
    const table = baseTable();
    table.codes['Perioden'] = [...table.codes['Perioden']!, code('2024XX01', 'Definitief')];
    expect(families(await run({ table }))).toContain('F2_periods');
  });

  it('an undeclared period status', async () => {
    const table = baseTable();
    table.codes['Perioden'] = [...table.codes['Perioden']!, code('2022JJ00', 'Herzien')];
    expect(families(await run({ table }))).toContain('F2_periods');
  });

  it('an observed period coordinate outside the grammar', async () => {
    const table = baseTable();
    table.rows = [...table.rows, row('2024KW05', 7, 'None')];
    expect(families(await run({ table }))).toContain('F2_periods');
  });
});

describe('F3 — value-attribute completeness (R11)', () => {
  it('a null cell whose attribute has no owner-approved null-reason label', async () => {
    const table = baseTable();
    table.rows = [row('2023JJ00', 5, 'None'), row('2024JJ00', null, 'Mystery')];
    expect(families(await run({ table }))).toContain('F3_statuses');
  });

  it('declared-but-unlabeled: the attribute is declared yet nullReasonLabels lacks it', async () => {
    const table = baseTable();
    table.rows = [row('2023JJ00', 5, 'None'), row('2024JJ00', null, 'Vertrouwelijk')];
    const manifest = baseManifest();
    manifest.declaredValueAttributes = ['None', 'Missing', 'Vertrouwelijk'];
    expect(families(await run({ table, manifest }))).toContain('F3_statuses');
  });

  it('an undeclared value attribute on a NON-null cell is still a completeness failure', async () => {
    const table = baseTable();
    table.rows = [row('2023JJ00', 5, 'Bijzonder'), row('2024JJ00', null, 'Missing')];
    expect(families(await run({ table }))).toContain('F3_statuses');
  });
});

describe('F5 — the five validators still bite through the harness', () => {
  it('duplicate cells (same measure + coordinates twice)', async () => {
    const table = baseTable();
    table.rows = [...table.rows, row('2023JJ00', 5, 'None')];
    expect(families(await run({ table }))).toContain('F5_validators');
  });

  it('a reason-less null (value null, attribute None)', async () => {
    const table = baseTable();
    table.rows = [row('2023JJ00', 5, 'None'), row('2024JJ00', null, 'None')];
    expect(families(await run({ table }))).toContain('F5_validators');
  });

  it('a statusless observed period fails; the manifest slice escape hatch rescues an out-of-slice capture', async () => {
    const table = baseTable();
    table.codes['Perioden'] = [...table.codes['Perioden']!, code('1900JJ00', null)];
    table.rows = [...table.rows, row('1900JJ00', 3, 'None')];

    const unsliced = await run({ table });
    expect(families(unsliced)).toContain('F5_validators');

    const manifest = baseManifest();
    manifest.tables = [{ tableId: 'fake:t1', slice: { periodFloor: '2000JJ00' } }];
    const sliced = await run({ table, manifest });
    expect(sliced.failures).toEqual([]);
  });

  it('schemaOnly (a TRUE metadata-only capture) skips the row + period-grammar families', async () => {
    const table = baseTable();
    table.rows = []; // genuinely metadata-only
    // daily codes — unservable grammar; would fail F2 on a servable table
    table.codes['Perioden'] = [code('20060101', null), code('20060102', null)];
    const manifest = baseManifest();
    manifest.tables = [{ tableId: 'fake:t1', schemaOnly: true }];
    const report = await run({ table, manifest });
    expect(report.failures).toEqual([]);
  });

  it('schemaOnly is VERIFIED, not trusted: a table whose adapter yields rows may not dodge the row families', async () => {
    const table = baseTable(); // carries 2 real rows
    const manifest = baseManifest();
    manifest.tables = [{ tableId: 'fake:t1', schemaOnly: true }];
    const report = await run({ table, manifest });
    const f1 = report.failures.filter((f) => f.family === 'F1_replay');
    expect(f1.some((f) => f.summary.includes('schemaOnly'))).toBe(true);
  });
});

describe('F4 — catalog-lifecycle completeness (A6)', () => {
  it('an undeclared catalog status', async () => {
    const entries = baseCatalog();
    entries[0] = { ...entries[0]!, status: 'Bizarre' };
    expect(families(await run({ catalog: entries }))).toContain('F4_catalog');
  });

  it('an undeclared datasetType', async () => {
    const entries = baseCatalog();
    entries[0] = { ...entries[0]!, datasetType: 'Hologram' };
    expect(families(await run({ catalog: entries }))).toContain('F4_catalog');
  });
});

describe('manifest shape validation is loud', () => {
  const valid = () => ({
    sourceKey: 'x',
    tables: [{ tableId: 't' }] as unknown[],
    declaredPeriodStatuses: [] as unknown[],
    declaredValueAttributes: [] as unknown[],
    declaredCatalogStatuses: [] as unknown[],
    declaredDatasetTypes: [] as unknown[],
  });

  it('rejects a manifest missing sourceKey, with empty tables, or with non-string vocab entries', () => {
    expect(() => validateManifestShape({}, 'x.json')).toThrow(/sourceKey/);
    expect(() => validateManifestShape({ ...valid(), tables: [] }, 'x.json')).toThrow(/tables/);
    expect(() => validateManifestShape({ ...valid(), declaredPeriodStatuses: [1] }, 'x.json')).toThrow(
      /declaredPeriodStatuses/,
    );
  });

  it('rejects authoring typos: unknown keys on the manifest, a table entry, or a slice', () => {
    expect(() => validateManifestShape({ ...valid(), declaredPeriodStatusses: [] }, 'x.json')).toThrow(
      /unknown key/,
    );
    expect(() =>
      validateManifestShape({ ...valid(), tables: [{ tableId: 't', schemaonly: true }] }, 'x.json'),
    ).toThrow(/unknown key/);
    expect(() =>
      validateManifestShape({ ...valid(), tables: [{ tableId: 't', slice: { periodfloor: '2000JJ00' } }] }, 'x.json'),
    ).toThrow(/unknown slice key/);
  });

  it('rejects wrongly-typed schemaOnly and slice fields', () => {
    expect(() =>
      validateManifestShape({ ...valid(), tables: [{ tableId: 't', schemaOnly: 'yes' }] }, 'x.json'),
    ).toThrow(/schemaOnly/);
    expect(() =>
      validateManifestShape({ ...valid(), tables: [{ tableId: 't', slice: { periodFloor: 42 } }] }, 'x.json'),
    ).toThrow(/periodFloor/);
    expect(() =>
      validateManifestShape(
        { ...valid(), tables: [{ tableId: 't', slice: { dimensionPrefixes: { RegioS: 'NL' } } }] },
        'x.json',
      ),
    ).toThrow(/dimensionPrefixes/);
  });
});
