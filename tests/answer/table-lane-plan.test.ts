// Breadth step 5, Task 2 — planTableLane, the table lane's ONE tagged
// outcome (refuse / ask / fetch) over builder → parse → bridge → breakdown
// resolver → regions → period → slice + explicit intent
// (src/answer/table-lane/plan.ts; open-questions #339 (6)).
//
// Hermetic: the LLM is a stub LlmClient returning a hand-written JSON output
// crafted per case — never a real call. Real CBS metadata from the committed
// fixtures (tests/fixtures/tableparse/schemas/) wherever a fixture has the
// shape; synthetic tables only for shapes no fixture has.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../../src/cbs-adapter/types.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import { buildTableParseSchema } from '../../src/answer/table-parse/input.ts';
import {
  buildTableParseRequest,
  serializeTableParseInput,
  tableParsePrefilterText,
  TABLE_PARSE_SCHEMA_VERSION,
} from '../../src/answer/table-parse/parse.ts';
import type { PeriodSpec, RegionScopeKind, RegionTerm } from '../../src/answer/intent/types.ts';
import type { TableLaneChoice } from '../../src/answer/table-lane/types.ts';
import {
  planTableLane,
  selectionNote,
  type TableLanePlan,
  type TableLaneTable,
} from '../../src/answer/table-lane/plan.ts';

const REF = '2026-09-29';

function loadFixture(tableId: string): TableLaneTable {
  const path = fileURLToPath(new URL(`../fixtures/tableparse/schemas/${tableId}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as TableLaneTable;
}

class StubClient implements LlmClient {
  calls: LlmRequest[] = [];
  private readonly outputText: string | Error;
  constructor(outputText: string | Error) {
    this.outputText = outputText;
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    if (this.outputText instanceof Error) throw this.outputText;
    return { outputText: this.outputText, model: 'stub-model', stopReason: 'end_turn', usage: { inputTokens: 7, outputTokens: 3 } };
  }
}

interface OutputSpec {
  measureCode: string;
  period: PeriodSpec;
  breakdowns?: Record<string, string>;
  regions?: RegionTerm[];
  regionScope?: RegionScopeKind | null;
  derivation?: 'none' | 'difference' | 'max' | 'series';
  confidence?: number;
}

/** A model output for `question` on `table`: every OFFERED breakdown gets
 * 'niet_genoemd' unless `spec.breakdowns` names a choice for it. */
function output(table: TableLaneTable, question: string, spec: OutputSpec): string {
  const offered = buildTableParseSchema(table.schema, table.codeLists, question);
  return JSON.stringify({
    version: TABLE_PARSE_SCHEMA_VERSION,
    measureCode: spec.measureCode,
    breakdowns: offered.breakdowns.map((b) => ({ dimension: b.name, choice: spec.breakdowns?.[b.name] ?? 'niet_genoemd' })),
    period: spec.period,
    regions: spec.regions ?? [],
    regionScope: spec.regionScope ?? null,
    derivation: spec.derivation ?? 'none',
    confidence: spec.confidence ?? 0.95,
    reading: 'test',
  });
}

async function plan(
  table: TableLaneTable,
  question: string,
  spec: OutputSpec | string,
  choices: TableLaneChoice[] = [],
): Promise<{ plan: TableLanePlan; client: StubClient }> {
  const client = new StubClient(typeof spec === 'string' ? spec : output(table, question, spec));
  const result = await planTableLane({ question, previousQuestion: null, table, choices, referenceDate: REF, client });
  return { plan: result, client };
}

function code(c: string, title = c): CbsCode {
  return { code: c, title, dimensionGroup: null, status: 'Definitief', index: null };
}

/** A synthetic table: one or more numeric measures, optional extra
 * dimensions, and a TimeDimension over `periods`. */
function synthetic(opts: {
  title?: string;
  measures?: { code: string; title: string }[];
  dims?: { name: string; kind: 'Dimension' | 'GeoDimension'; title: string; codes: CbsCode[] }[];
  periods: CbsCode[];
}): TableLaneTable {
  const measures = (opts.measures ?? [{ code: 'M1', title: 'Aantal' }]).map((m) => ({
    code: m.code,
    title: m.title,
    unit: 'aantal',
    decimals: 0,
    description: '',
    dataType: 'Long',
    groupPath: [] as string[],
  }));
  const dims = opts.dims ?? [];
  const schema: CbsTableSchema = {
    tableId: 'T1',
    title: opts.title ?? 'Testtabel',
    modified: null,
    measures,
    dimensions: [
      ...dims.map((d) => ({ name: d.name, kind: d.kind, title: d.title })),
      { name: 'Perioden', kind: 'TimeDimension' as const, title: 'Perioden' },
    ],
  };
  return {
    schema,
    codeLists: { ...Object.fromEntries(dims.map((d) => [d.name, d.codes])), Perioden: opts.periods },
  };
}

const emissions = loadFixture('85669NED'); // EmissiesNaarLucht (total T001372) + Klimaatsectoren (52, total T001616); JJ 1990..2025
const water = loadFixture('82883NED'); // Watergebruikers: 52 members, NO grand total
const population = loadFixture('03759ned'); // RegioS GeoDimension (892) + 3 breakdowns with totals

// ---------------------------------------------------------------------------
// Refusals — one per branch, in planTableLane's order
// ---------------------------------------------------------------------------

describe('planTableLane — refusals, in order', () => {
  it('1. an ineligible table → table_lane_ineligible, no LLM call', async () => {
    const table = loadFixture('83052NED'); // Perioden is kind Dimension, not TimeDimension
    const { plan: p, client } = await plan(table, 'Hoeveel arbeidsongevallen in 2020?', '{}');
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_ineligible', parse: null, parseAudit: null });
    expect(client.calls).toHaveLength(0);
  });

  it('2a. a place the table cannot serve (TableParseRegionUnavailableError) → region_unavailable', async () => {
    const table = loadFixture('82291NED'); // Caribisch Nederland: region-coded breakdown, no "Nederland" member
    const q = 'Hoeveel mensen in Nederland hadden suikerziekte in 2021?';
    const { plan: p } = await plan(table, q, {
      measureCode: 'M005476_2',
      period: { kind: 'year', year: 2021 },
      regions: [{ name: 'Nederland', kind: 'land' }],
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'region_unavailable', parse: null });
    // R6: the paid call's audit is kept on every outcome where a model call happened.
    if (p.kind !== 'refuse') return;
    expect(p.parseAudit).toMatchObject({ model: 'stub-model', usage: { inputTokens: 7, outputTokens: 3 } });
    expect(p.parseAudit?.requestHash).toMatch(/^[0-9a-f]{32}$/);
    expect(p.parseAudit?.outputText).toContain('Nederland');
  });

  it("2b. malformed model output → table_lane_unsure with the validator message, the call's audit kept (R6)", async () => {
    const { plan: p } = await plan(emissions, 'Uitstoot 2020?', 'not json');
    expect(p.kind).toBe('refuse');
    if (p.kind !== 'refuse') return;
    expect(p.reason).toBe('table_lane_unsure');
    expect(p.detail).toMatch(/not valid JSON/);
    expect(p.parse).toBeNull();
    expect(p.parseAudit).toEqual({
      requestHash: expect.stringMatching(/^[0-9a-f]{32}$/),
      model: 'stub-model',
      usage: { inputTokens: 7, outputTokens: 3 },
      outputText: 'not json',
    });
  });

  it('2c. an invented measure code → table_lane_unsure', async () => {
    const { plan: p } = await plan(emissions, 'Uitstoot 2020?', { measureCode: 'XXX', period: { kind: 'year', year: 2020 } });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_unsure', parseAudit: { model: 'stub-model' } });
  });

  it('2d. an indistinguishable measure (TableParseAmbiguousMeasureError) → table_lane_unsure', async () => {
    const table = synthetic({
      measures: [
        { code: 'M1', title: 'Aantal' },
        { code: 'M2', title: 'Aantal' },
      ],
      periods: [code('2020JJ00', '2020')],
    });
    const { plan: p } = await plan(table, 'Hoeveel in 2020?', { measureCode: 'M1', period: { kind: 'year', year: 2020 } });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_unsure', parseAudit: { model: 'stub-model' } });
  });

  it('2e. any other error (e.g. the LLM call failing) propagates', async () => {
    const client = new StubClient(new Error('network down'));
    await expect(
      planTableLane({ question: 'Uitstoot 2020?', previousQuestion: null, table: emissions, choices: [], referenceDate: REF, client }),
    ).rejects.toThrow('network down');
  });

  it('3. confidence below the accept threshold → table_lane_unsure, with the parse + audit kept', async () => {
    const { plan: p } = await plan(emissions, 'Uitstoot 2020?', {
      measureCode: 'D003040',
      period: { kind: 'year', year: 2020 },
      confidence: 0.5,
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_unsure' });
    if (p.kind !== 'refuse') return;
    expect(p.parse?.confidence).toBe(0.5);
    expect(p.parseAudit).toMatchObject({ model: 'stub-model', usage: { inputTokens: 7, outputTokens: 3 } });
  });

  it("4. 'geen' → table_lane_no_measure, BEFORE any breakdown handling (an 'anders' never becomes a question)", async () => {
    const { plan: p } = await plan(emissions, 'Hoeveel koeien?', {
      measureCode: 'geen',
      period: { kind: 'year', year: 2020 },
      breakdowns: { Klimaatsectoren: 'anders' },
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_no_measure' });
  });

  it('5. a period grain the table does not publish → table_lane_period_grain', async () => {
    const { plan: p } = await plan(emissions, 'Uitstoot in maart 2020?', {
      measureCode: 'D003040',
      period: { kind: 'month', year: 2020, month: 3 },
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_period_grain' });
  });

  it('6. a region class over several periods → table_lane_region_class (one period at a time), before any fetch', async () => {
    const { plan: p } = await plan(population, 'Inwoners per provincie van 2020 tot en met 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year_range', fromYear: 2020, toYear: 2024 },
      regionScope: 'all_provincies',
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_region_class' });
  });

  it('10. an unknown place on a geo table → region_unknown', async () => {
    const { plan: p } = await plan(population, 'Inwoners van Atlantis in 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regions: [{ name: 'Atlantis', kind: 'onbekend' }],
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'region_unknown' });
  });

  it('11a. a year the table does not list → table_lane_period_missing naming the latest code', async () => {
    const { plan: p } = await plan(emissions, 'Uitstoot in 1980?', { measureCode: 'D003040', period: { kind: 'year', year: 1980 } });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_period_missing', latestPeriodCode: '2025JJ00' });
  });

  it('11b. a period kind the lane does not resolve → table_lane_period_unsupported', async () => {
    const { plan: p } = await plan(emissions, 'Hoeveel steeg de uitstoot in 2020?', {
      measureCode: 'D003040',
      period: { kind: 'change_over_year', year: 2020 },
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_period_unsupported' });
  });

  it('12. a slice over SLICE_MAX_CELLS (2,000) cells → table_lane_too_large', async () => {
    const periods: CbsCode[] = [];
    for (let y = 1850; y <= 2030; y++) for (let m = 1; m <= 12; m++) periods.push(code(`${y}MM${String(m).padStart(2, '0')}`));
    const table = synthetic({ periods }); // 2,172 monthly codes
    const { plan: p } = await plan(table, 'Aantal sinds januari 1850?', {
      measureCode: 'M1',
      period: { kind: 'since', year: 1850, quarter: null, month: 1 },
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_too_large' });
  });
});

// ---------------------------------------------------------------------------
// fetch — exact slice + explicit-target intent
// ---------------------------------------------------------------------------

describe('planTableLane — fetch', () => {
  it('a confident parse on a table without breakdowns → the exact slice and intent', async () => {
    const table = synthetic({ periods: [code('2019JJ00', '2019'), code('2020JJ00', '2020')] });
    const { plan: p } = await plan(table, 'Hoeveel in 2020?', { measureCode: 'M1', period: { kind: 'year', year: 2020 } });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice).toEqual({ measures: ['M1'], members: {}, periods: ['2020JJ00'] });
    expect(p.intent).toEqual({
      schemaVersion: 1,
      target: { kind: 'explicit', tableId: 'T1', measure: 'M1', dims: {} },
      period: { kind: 'codes', codes: ['2020JJ00'] },
      derivation: 'none',
    });
    expect(p.selection).toEqual({ named: [], defaults: [] });
    expect(p.parseAudit.outputText).toContain('"measureCode":"M1"');
  });

  it('unnamed breakdowns with a unique CBS total → fetch with stated defaults', async () => {
    const { plan: p } = await plan(emissions, 'Hoeveel broeikasgas werd in 2020 uitgestoten?', {
      measureCode: 'D003040',
      period: { kind: 'year', year: 2020 },
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice).toEqual({
      measures: ['D003040'],
      members: { EmissiesNaarLucht: ['T001372'], Klimaatsectoren: ['T001616'] },
      periods: ['2020JJ00'],
    });
    expect(p.intent).toEqual({
      schemaVersion: 1,
      target: {
        kind: 'explicit',
        tableId: '85669NED',
        measure: 'D003040',
        dims: { EmissiesNaarLucht: 'T001372', Klimaatsectoren: 'T001616' },
      },
      period: { kind: 'codes', codes: ['2020JJ00'] },
      derivation: 'none',
    });
    expect(p.selection).toEqual({
      named: [],
      defaults: [
        { dimension: 'EmissiesNaarLucht', dimensionTitle: 'Emissies naar lucht', code: 'T001372', memberTitle: 'Totaal broeikasgassen' },
        { dimension: 'Klimaatsectoren', dimensionTitle: 'Klimaatsectoren', code: 'T001616', memberTitle: 'Totaal klimaatsectoren' },
      ],
    });
  });

  it('a named breakdown member → a named selection; a contiguous year range → a range period', async () => {
    const { plan: p } = await plan(emissions, 'Hoeveel CO2 werd van 2018 tot en met 2021 uitgestoten?', {
      measureCode: 'D003040',
      period: { kind: 'year_range', fromYear: 2018, toYear: 2021 },
      breakdowns: { EmissiesNaarLucht: 'A044109' },
      derivation: 'series',
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice.periods).toEqual(['2018JJ00', '2019JJ00', '2020JJ00', '2021JJ00']);
    expect(p.intent.period).toEqual({ kind: 'range', from: '2018JJ00', to: '2021JJ00' });
    expect(p.intent.derivation).toBe('series');
    expect(p.intent.target).toMatchObject({ dims: { EmissiesNaarLucht: 'A044109', Klimaatsectoren: 'T001616' } });
    expect(p.selection.named).toEqual([
      { dimension: 'EmissiesNaarLucht', dimensionTitle: 'Emissies naar lucht', code: 'A044109', memberTitle: 'Kooldioxide (CO2)' },
    ]);
  });

  it('a non-contiguous set of published years → a codes period, never a range over the gaps', async () => {
    const table = synthetic({ periods: [code('2013JJ00', '2013'), code('2017JJ00', '2017/2018'), code('2021JJ00', '2021')] });
    const { plan: p } = await plan(table, 'Aantal 2012 tot 2022?', {
      measureCode: 'M1',
      period: { kind: 'year_range', fromYear: 2012, toYear: 2022 },
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.intent.period).toEqual({ kind: 'codes', codes: ['2013JJ00', '2017JJ00', '2021JJ00'] });
  });

  it('no period named → the latest yearly period, stated as a default', async () => {
    const { plan: p } = await plan(emissions, 'Hoeveel broeikasgas wordt er uitgestoten?', {
      measureCode: 'D003040',
      period: { kind: 'none' },
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice.periods).toEqual(['2025JJ00']);
    expect(p.selection.defaults).toContainEqual({
      dimension: 'Perioden',
      dimensionTitle: 'Perioden',
      code: '2025JJ00',
      memberTitle: '2025',
    });
  });

  it('a named place on a geo table → its region code in intent.regions and the slice', async () => {
    const { plan: p } = await plan(population, 'Hoeveel inwoners had Amsterdam op 1 januari 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice).toEqual({
      measures: ['M000352'],
      members: { BurgerlijkeStaat: ['T001019'], Geslacht: ['T001038'], Leeftijd: ['10000'], RegioS: ['GM0363'] },
      periods: ['2024JJ00'],
    });
    expect(p.intent).toEqual({
      schemaVersion: 1,
      target: {
        kind: 'explicit',
        tableId: '03759ned',
        measure: 'M000352',
        dims: { BurgerlijkeStaat: 'T001019', Geslacht: 'T001038', Leeftijd: '10000' },
      },
      regions: ['GM0363'],
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    });
    expect(p.selection.named).toEqual([{ dimension: 'RegioS', dimensionTitle: "Regio's", code: 'GM0363', memberTitle: 'Amsterdam' }]);
  });

  it('no place on a geo table → the NL member, stated as a default', async () => {
    const { plan: p } = await plan(population, 'Hoeveel inwoners in 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.intent.regions).toEqual(['NL01']);
    expect(p.selection.defaults).toContainEqual({ dimension: 'RegioS', dimensionTitle: "Regio's", code: 'NL01', memberTitle: 'Nederland' });
  });

  it('"Nederland" on a national-only table → no region at all, and the national-table selection line', async () => {
    const q = 'Hoeveel broeikasgas stootte Nederland uit in 2020?';
    const { plan: p } = await plan(emissions, q, {
      measureCode: 'D003040',
      period: { kind: 'year', year: 2020 },
      regions: [{ name: 'Nederland', kind: 'land' }],
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.intent).not.toHaveProperty('regions');
    expect(Object.keys(p.slice.members).sort()).toEqual(['EmissiesNaarLucht', 'Klimaatsectoren']);
    expect(p.selection.nationalTable).toBe(true);
    expect(selectionNote(p.selection, 'nl')).toContain('Regio: Nederland (landelijke tabel)');
    // The audit keeps the model's own output, the dropped place included.
    expect(p.parse.regions).toEqual([{ name: 'Nederland', kind: 'land' }]);
    expect(p.parseAudit.outputText).toContain('Nederland');
    expect(p.parseAudit.model).toBe('stub-model');
  });

  it('"Nederland" plus another place on a national-only table → region_unavailable (only Nederland is absorbed)', async () => {
    const { plan: p } = await plan(emissions, 'Uitstoot Nederland en Utrecht 2020?', {
      measureCode: 'D003040',
      period: { kind: 'year', year: 2020 },
      regions: [
        { name: 'Nederland', kind: 'land' },
        { name: 'Utrecht', kind: 'onbekend' },
      ],
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'region_unavailable' });
  });

  it('"Nederland" on a national-only table titled with "Caribisch" → region_unavailable', async () => {
    const table = synthetic({ title: 'Caribisch Nederland; bevolking', periods: [code('2020JJ00', '2020')] });
    const { plan: p } = await plan(table, 'Hoeveel in Nederland in 2020?', {
      measureCode: 'M1',
      period: { kind: 'year', year: 2020 },
      regions: [{ name: 'Nederland', kind: 'land' }],
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'region_unavailable' });
  });

  it('a geo-like dimension (kind Dimension) → the region code goes in dims, not regions', async () => {
    const table = synthetic({
      dims: [
        {
          name: 'Regio',
          kind: 'Dimension',
          title: 'Regio',
          codes: [code('NL01', 'Nederland'), code('PV20', 'Groningen (PV)'), code('PV21', 'Fryslân (PV)'), code('PV22', 'Drenthe (PV)')],
        },
      ],
      periods: [code('2020JJ00', '2020')],
    });
    const { plan: p } = await plan(table, 'Aantal in Groningen in 2020?', {
      measureCode: 'M1',
      period: { kind: 'year', year: 2020 },
      regions: [{ name: 'Groningen', kind: 'provincie' }],
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.intent.target).toEqual({ kind: 'explicit', tableId: 'T1', measure: 'M1', dims: { Regio: 'PV20' } });
    expect(p.intent).not.toHaveProperty('regions');
    expect(p.slice.members).toEqual({ Regio: ['PV20'] });
  });

  it('two GeoDimensions → region_unavailable, before the period/slice steps can shadow it', async () => {
    const periods: CbsCode[] = [];
    for (let y = 1850; y <= 2030; y++) for (let m = 1; m <= 12; m++) periods.push(code(`${y}MM${String(m).padStart(2, '0')}`));
    const table = synthetic({
      dims: [
        { name: 'RegioA', kind: 'GeoDimension', title: 'Regio A', codes: [code('NL01', 'Nederland'), code('PV20', 'Groningen (PV)')] },
        { name: 'RegioB', kind: 'GeoDimension', title: 'Regio B', codes: [code('NL01', 'Nederland'), code('PV21', 'Fryslân (PV)')] },
      ],
      periods, // "since 1850" would be table_lane_too_large if the geo check came after the slice
    });
    const { plan: p } = await plan(table, 'Aantal sinds januari 1850?', {
      measureCode: 'M1',
      period: { kind: 'since', year: 1850, quarter: null, month: 1 },
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'region_unavailable' });
  });

  it('"Nederland" on a regionless table with region-coded breakdown members → the NL01 member of that breakdown', async () => {
    const table = loadFixture('85004NED'); // RegioS is an ordinary (16 % region-coded) breakdown with NL01
    const { plan: p } = await plan(table, 'Hoeveel windenergie op land werd in Nederland opgewekt in 2023?', {
      measureCode: 'M002195',
      period: { kind: 'year', year: 2023 },
      breakdowns: { BronEnTechniek: 'E006637', RegioS: 'NL01' },
      regions: [{ name: 'Nederland', kind: 'land' }],
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.intent).not.toHaveProperty('regions');
    expect(p.intent.target).toMatchObject({ dims: { BronEnTechniek: 'E006637', RegioS: 'NL01' } });
    expect(p.selection.nationalTable).toBeUndefined();
    expect(p.selection.named).toContainEqual({ dimension: 'RegioS', dimensionTitle: "Regio's", code: 'NL01', memberTitle: 'Nederland' });
  });

  // Task 7 (replaces Ruling R2's "not passed yet" pin): a follow-up's
  // previous question reaches the parser's user turn — and the member
  // pre-filter, so a sector only the previous question named stays offered.
  it('passes previousQuestion to the parser: the version-3 user turn with the previous-question line', async () => {
    const previous = 'Hoeveel broeikasgas kwam vrij door elektriciteit in 2019?';
    const question = 'En in 2020?';
    const offered = buildTableParseSchema(emissions.schema, emissions.codeLists, tableParsePrefilterText(question, previous));
    const client = new StubClient(
      JSON.stringify({
        version: TABLE_PARSE_SCHEMA_VERSION,
        measureCode: 'D003040',
        breakdowns: offered.breakdowns.map((b) => ({ dimension: b.name, choice: b.name === 'Klimaatsectoren' ? 'A050124' : 'niet_genoemd' })),
        period: { kind: 'year', year: 2020 },
        regions: [],
        regionScope: null,
        derivation: 'none',
        confidence: 0.95,
        reading: 'test',
      }),
    );
    const p = await planTableLane({ question, previousQuestion: previous, table: emissions, choices: [], referenceDate: REF, client });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.question).toBe(serializeTableParseInput(question, offered, previous));
    expect(client.calls[0]!.question.split('\n')[0]).toBe(`Vorige vraag in dit gesprek: ${JSON.stringify(previous)}`);
    // The follow-up's own pre-filter would have cut the sector the previous
    // question named; with the previous question it is offered and chosen.
    const bare = buildTableParseSchema(emissions.schema, emissions.codeLists, question);
    expect(bare.breakdowns.find((b) => b.name === 'Klimaatsectoren')!.members.map((m) => m.code)).not.toContain('A050124');
    expect(offered.breakdowns.find((b) => b.name === 'Klimaatsectoren')!.members.map((m) => m.code)).toContain('A050124');
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice.members['Klimaatsectoren']).toEqual(['A050124']);
    expect(p.slice.periods).toEqual(['2020JJ00']);
  });

  it('without a previous question the parser request is byte-identical to the plain (version-2 user turn) request', async () => {
    const question = 'Uitstoot 2020?';
    const client = new StubClient(output(emissions, question, { measureCode: 'D003040', period: { kind: 'year', year: 2020 } }));
    await planTableLane({ question, previousQuestion: null, table: emissions, choices: [], referenceDate: REF, client });
    const offered = buildTableParseSchema(emissions.schema, emissions.codeLists, question);
    expect(client.calls[0]).toEqual(buildTableParseRequest(question, offered));
    expect(client.calls[0]!.question).not.toContain('Vorige vraag');
  });
});

// ---------------------------------------------------------------------------
// ask — button questions, and choices answering them
// ---------------------------------------------------------------------------

describe('planTableLane — ask and choices', () => {
  const waterQ = 'Hoeveel leidingwater werd in 2020 gebruikt?';
  const waterSpec: OutputSpec = { measureCode: 'M005248_2', period: { kind: 'year', year: 2020 } };

  it('a breakdown without a CBS total → ask with the FULL member list (first 12 shown, totalOptions = dimension size)', async () => {
    const { plan: p } = await plan(water, waterQ, waterSpec);
    expect(p.kind).toBe('ask');
    if (p.kind !== 'ask') return;
    expect(p.question.dimension).toBe('Watergebruikers');
    expect(p.question.totalOptions).toBe(water.codeLists.Watergebruikers!.length);
    expect(p.question.totalOptions).toBe(52);
    expect(p.question.options).toHaveLength(12);
    expect(p.question.options[0]).toEqual({ code: 'B000579', title: 'Nederlandse economie totaal' });
    expect(p.parseAudit.model).toBe('stub-model');
    expect(p.offered.tableId).toBe('82883NED');
  });

  it("an 'anders' choice → a question for that dimension's FULL member list, never the total", async () => {
    const { plan: p } = await plan(emissions, 'Hoeveel broeikasgas stootte het verkeer uit in 2020?', {
      measureCode: 'D003040',
      period: { kind: 'year', year: 2020 },
      breakdowns: { Klimaatsectoren: 'anders' },
    });
    expect(p.kind).toBe('ask');
    if (p.kind !== 'ask') return;
    expect(p.question.dimension).toBe('Klimaatsectoren');
    expect(p.question.totalOptions).toBe(52);
  });

  it('a choices entry resolves the previously asked dimension → fetch with a named selection', async () => {
    const { plan: p } = await plan(water, waterQ, waterSpec, [{ dimension: 'Watergebruikers', code: '1050010' }]);
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice.members).toEqual({ Watergebruikers: ['1050010'] });
    expect(p.selection.named).toEqual([
      { dimension: 'Watergebruikers', dimensionTitle: 'Watergebruikers', code: '1050010', memberTitle: 'Particuliere huishoudens' },
    ]);
  });

  it("a choices entry overrides an 'anders' parse choice, including a member the pre-filter did not offer", async () => {
    const { plan: p } = await plan(
      emissions,
      'Hoeveel broeikasgas stootte het verkeer uit in 2020?',
      { measureCode: 'D003040', period: { kind: 'year', year: 2020 }, breakdowns: { Klimaatsectoren: 'anders' } },
      [{ dimension: 'Klimaatsectoren', code: 'A052483' }],
    );
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice.members.Klimaatsectoren).toEqual(['A052483']);
  });

  it('a choice whose code is not a member, or for the time / an unknown dimension, throws (caller bug)', async () => {
    await expect(plan(water, waterQ, waterSpec, [{ dimension: 'Watergebruikers', code: 'NOPE' }])).rejects.toThrow();
    await expect(plan(water, waterQ, waterSpec, [{ dimension: 'Perioden', code: '2020JJ00' }])).rejects.toThrow();
    await expect(plan(water, waterQ, waterSpec, [{ dimension: 'Bestaatniet', code: 'X' }])).rejects.toThrow();
  });

  it('a named place with two or more matches → ask over those matches; a region choice then resolves it', async () => {
    const spec: OutputSpec = {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regions: [{ name: 'Utrecht', kind: 'onbekend' }],
    };
    const q = 'Hoeveel inwoners had Utrecht in 2024?';
    const first = await plan(population, q, spec);
    expect(first.plan.kind).toBe('ask');
    if (first.plan.kind !== 'ask') return;
    expect(first.plan.question.dimension).toBe('RegioS');
    expect(first.plan.question.options.map((o) => o.code)).toEqual(['PV26', 'CR17', 'GM0344']);
    expect(first.plan.question.totalOptions).toBe(3);

    const second = await plan(population, q, spec, [{ dimension: 'RegioS', code: 'GM0344' }]);
    expect(second.plan.kind).toBe('fetch');
    if (second.plan.kind !== 'fetch') return;
    expect(second.plan.intent.regions).toEqual(['GM0344']);
  });
});

// ---------------------------------------------------------------------------
// selectionNote
// ---------------------------------------------------------------------------

describe('selectionNote', () => {
  const named = [{ dimension: 'Geslacht', dimensionTitle: 'Geslacht', code: '3000', memberTitle: 'Mannen' }];
  const defaults = [
    { dimension: 'Leeftijd', dimensionTitle: 'Leeftijd', code: '10000', memberTitle: 'Totaal' },
    { dimension: 'Perioden', dimensionTitle: 'Perioden', code: '2025JJ00', memberTitle: '2025' },
  ];

  it('nl — exact string', () => {
    expect(selectionNote({ named, defaults }, 'nl')).toBe(
      'Selectie: Geslacht: Mannen · Uitgangspunt: Leeftijd: Totaal; Perioden: 2025',
    );
  });

  it('en — exact string (CBS titles verbatim)', () => {
    expect(selectionNote({ named, defaults }, 'en')).toBe('Selection: Geslacht: Mannen · Assumed: Leeftijd: Totaal; Perioden: 2025');
  });

  it('the national-table line, nl and en', () => {
    expect(selectionNote({ named: [], defaults: [], nationalTable: true }, 'nl')).toBe('Regio: Nederland (landelijke tabel)');
    expect(selectionNote({ named: [], defaults: [], nationalTable: true }, 'en')).toBe('Region: the Netherlands (national table)');
    expect(selectionNote({ named, defaults: [], nationalTable: true }, 'nl')).toBe(
      'Selectie: Geslacht: Mannen · Regio: Nederland (landelijke tabel)',
    );
  });

  it('null when nothing is fixed', () => {
    expect(selectionNote({ named: [], defaults: [] }, 'nl')).toBeNull();
    expect(selectionNote({ named: [], defaults: [] }, 'en')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2026-10-01 (#340): region classes — the curated rules over the table's own
// CBS dimension groups; the intent carries `regionSet`, the slice the roster.
// ---------------------------------------------------------------------------

const PROVINCES = ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26', 'PV27', 'PV28', 'PV29', 'PV30', 'PV31'];

function groupCodes(table: TableLaneTable, dim: string, group: string): string[] {
  return table.codeLists[dim]!.filter((c) => c.dimensionGroup === group).map((c) => c.code);
}

describe('planTableLane — region classes', () => {
  it('"per provincie" → fetch: the 12 CBS provinces as the slice, regionSet on the intent, no named regions', async () => {
    const { plan: p } = await plan(population, 'Hoeveel inwoners had elke provincie op 1 januari 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regionScope: 'all_provincies',
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice.members.RegioS).toEqual(PROVINCES);
    expect(p.slice.periods).toEqual(['2024JJ00']);
    expect(p.intent.regionSet).toEqual({ kind: 'all_provincies' });
    expect(p.intent).not.toHaveProperty('regions');
    expect(p.intent.derivation).toBe('none');
    // The class is not a fixed coordinate: the selection names none for RegioS.
    expect([...p.selection.named, ...p.selection.defaults].some((s) => s.dimension === 'RegioS')).toBe(false);
  });

  it('"welke provincie had de meeste …" → max over the class (the query layer ranks it)', async () => {
    const { plan: p } = await plan(population, 'Welke provincie had op 1 januari 2024 de meeste inwoners?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regionScope: 'all_provincies',
      derivation: 'max',
    });
    expect(p).toMatchObject({ kind: 'fetch', intent: { regionSet: { kind: 'all_provincies' }, derivation: 'max' } });
  });

  it('"per landsdeel" → the 4 LD codes', async () => {
    const { plan: p } = await plan(population, 'Inwoners per landsdeel in 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regionScope: 'all_landsdelen',
    });
    expect(p).toMatchObject({ kind: 'fetch', slice: { members: { RegioS: ['LD01', 'LD02', 'LD03', 'LD04'] } } });
  });

  it('"de gemeenten in Utrecht" → the province resolves as a provincie (PV26), the roster is CBS group GMPV26', async () => {
    const { plan: p } = await plan(population, 'Welke gemeente in Utrecht had in 2024 de meeste inwoners?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regions: [{ name: 'Utrecht', kind: 'onbekend' }],
      regionScope: 'gemeenten_in_provincie',
      derivation: 'max',
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.intent.regionSet).toEqual({ kind: 'gemeenten_in_provincie', parent: 'PV26' });
    expect(p.intent).not.toHaveProperty('regions');
    expect(p.slice.members.RegioS).toEqual(groupCodes(population, 'RegioS', 'GMPV26'));
    expect(p.slice.members.RegioS).toHaveLength(54);
  });

  it('"alle gemeenten" → the union of every province\'s gemeente group, never the GM prefix (GM0997 "OVERIG" excluded)', async () => {
    const { plan: p } = await plan(population, 'Inwoners van alle gemeenten in 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regionScope: 'all_gemeenten',
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    const expected = PROVINCES.flatMap((pv) => groupCodes(population, 'RegioS', `GM${pv}`));
    expect(new Set(p.slice.members.RegioS)).toEqual(new Set(expected));
    expect(p.slice.members.RegioS).toHaveLength(834);
    expect(p.slice.members.RegioS).not.toContain('GM0997');
  });

  it('"de gemeenten in Nederland" (only Nederland named) → every gemeente', async () => {
    const { plan: p } = await plan(population, 'Inwoners van de gemeenten in Nederland in 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regions: [{ name: 'Nederland', kind: 'land' }],
      regionScope: 'gemeenten_in_provincie',
    });
    expect(p).toMatchObject({ kind: 'fetch', intent: { regionSet: { kind: 'all_gemeenten' } } });
  });

  it('gemeenten_in_provincie naming no province, or two → region_unknown (never a guessed province)', async () => {
    const none = await plan(population, 'Welke gemeente in de provincie had de meeste inwoners in 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regionScope: 'gemeenten_in_provincie',
    });
    expect(none.plan).toMatchObject({ kind: 'refuse', reason: 'region_unknown' });
    const two = await plan(population, 'Gemeenten in Utrecht en Zeeland in 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regions: [
        { name: 'Utrecht', kind: 'provincie' },
        { name: 'Zeeland', kind: 'provincie' },
      ],
      regionScope: 'gemeenten_in_provincie',
    });
    expect(two.plan).toMatchObject({ kind: 'refuse', reason: 'region_unknown' });
  });

  it('gemeenten_in_provincie with an unknown province → region_unknown', async () => {
    const { plan: p } = await plan(population, 'Gemeenten in Atlantis in 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regions: [{ name: 'Atlantis', kind: 'onbekend' }],
      regionScope: 'gemeenten_in_provincie',
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'region_unknown' });
  });

  it('a class next to a NAMED place → the named place wins (the curated rule): regions, no regionSet', async () => {
    const { plan: p } = await plan(population, 'Inwoners per provincie, en Amsterdam, in 2024?', {
      measureCode: 'M000352',
      period: { kind: 'year', year: 2024 },
      regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
      regionScope: 'all_provincies',
    });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.intent.regions).toEqual(['GM0363']);
    expect(p.intent).not.toHaveProperty('regionSet');
  });

  it('a class on a table whose regions are a plain (geo-like) dimension → table_lane_region_class', async () => {
    const table = synthetic({
      dims: [
        {
          name: 'Regio',
          kind: 'Dimension',
          title: 'Regio',
          codes: PROVINCES.map((c) => ({ ...code(c, `${c} (PV)`), dimensionGroup: 'PV' })),
        },
      ],
      periods: [code('2024JJ00', '2024')],
    });
    const { plan: p } = await plan(table, 'Aantal per provincie in 2024?', {
      measureCode: 'M1',
      period: { kind: 'year', year: 2024 },
      regionScope: 'all_provincies',
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_region_class' });
  });

  it('a GeoDimension without CBS province groups → table_lane_region_class (never a prefix scan)', async () => {
    const table = synthetic({
      dims: [
        {
          name: 'RegioS',
          kind: 'GeoDimension',
          title: 'Regio',
          codes: [code('NL01', 'Nederland'), ...PROVINCES.map((c) => code(c, `${c} (PV)`))], // dimensionGroup null
        },
      ],
      periods: [code('2024JJ00', '2024')],
    });
    const { plan: p } = await plan(table, 'Aantal per provincie in 2024?', {
      measureCode: 'M1',
      period: { kind: 'year', year: 2024 },
      regionScope: 'all_provincies',
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_region_class' });
    if (p.kind === 'refuse') expect(p.detail).toMatch(/dimension group "PV" is empty/);
  });

  it('a class on a national-only table → region_unavailable (the parser\'s own rule, unchanged)', async () => {
    const { plan: p } = await plan(emissions, 'Uitstoot per provincie in 2020?', {
      measureCode: 'D003040',
      period: { kind: 'year', year: 2020 },
      regionScope: 'all_provincies',
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'region_unavailable' });
  });
});

// ---------------------------------------------------------------------------
// 2026-10-01 (#342 (b)): now-versus-then, date ranges, relative periods and
// the curated derivation rules.
// ---------------------------------------------------------------------------

describe('planTableLane — period shapes and derivations', () => {
  it('"nu vergeleken met 5 jaar geleden" → two codes, the model\'s difference kept', async () => {
    const { plan: p } = await plan(emissions, 'Met hoeveel is de uitstoot veranderd ten opzichte van 5 jaar geleden?', {
      measureCode: 'D003040',
      period: { kind: 'now_vs_ago', unit: 'year', amount: 5 },
      derivation: 'difference',
    });
    expect(p).toMatchObject({
      kind: 'fetch',
      slice: { periods: ['2020JJ00', '2025JJ00'] },
      intent: { period: { kind: 'codes', codes: ['2020JJ00', '2025JJ00'] }, derivation: 'difference' },
    });
  });

  it('"vorig jaar" → the calendar year before the reference date, when the table lists it', async () => {
    const { plan: p } = await plan(population, 'Hoeveel inwoners had Nederland vorig jaar?', {
      measureCode: 'M000352',
      period: { kind: 'relative', unit: 'year', offset: -1 },
      regions: [{ name: 'Nederland', kind: 'land' }],
    });
    expect(p).toMatchObject({ kind: 'fetch', intent: { period: { kind: 'codes', codes: ['2025JJ00'] } } });
  });

  it('an explicit date range over whole years on a yearly table → those years, forced to a series', async () => {
    const { plan: p } = await plan(emissions, 'Uitstoot van 1 januari 2018 tot en met 31 december 2020?', {
      measureCode: 'D003040',
      period: {
        kind: 'date_range',
        from: { year: 2018, month: 1, day: 1 },
        to: { year: 2020, month: 12, day: 31 },
        toInclusive: true,
      },
    });
    expect(p).toMatchObject({
      kind: 'fetch',
      intent: { period: { kind: 'range', from: '2018JJ00', to: '2020JJ00' }, derivation: 'series' },
    });
  });

  it('a date range that collapses to ONE year keeps the model\'s own hint (the curated collapse rule)', async () => {
    const { plan: p } = await plan(emissions, 'Uitstoot van 1 januari tot en met 31 december 2020?', {
      measureCode: 'D003040',
      period: {
        kind: 'date_range',
        from: { year: 2020, month: 1, day: 1 },
        to: { year: 2020, month: 12, day: 31 },
        toInclusive: true,
      },
      derivation: 'none',
    });
    expect(p).toMatchObject({ kind: 'fetch', intent: { period: { kind: 'codes', codes: ['2020JJ00'] }, derivation: 'none' } });
  });

  it('a year range with a "difference" hint becomes a series (a difference over >2 cells cannot execute)', async () => {
    const { plan: p } = await plan(emissions, 'Met hoeveel steeg de uitstoot van 2015 tot en met 2020?', {
      measureCode: 'D003040',
      period: { kind: 'year_range', fromYear: 2015, toYear: 2020 },
      derivation: 'difference',
    });
    expect(p).toMatchObject({ kind: 'fetch', intent: { derivation: 'series' } });
  });

  it('a series over ONE period → table_lane_single_period, before any fetch', async () => {
    const { plan: p } = await plan(emissions, 'Hoe ontwikkelde de uitstoot zich sinds 2025?', {
      measureCode: 'D003040',
      period: { kind: 'since', year: 2025, quarter: null, month: null },
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_single_period', latestPeriodCode: '2025JJ00' });
  });

  it('a difference over ONE period ("vorig jaar gestegen") → table_lane_single_period', async () => {
    const { plan: p } = await plan(emissions, 'Hoeveel is de uitstoot vorig jaar gestegen?', {
      measureCode: 'D003040',
      period: { kind: 'relative', unit: 'year', offset: -1 },
      derivation: 'difference',
    });
    expect(p).toMatchObject({ kind: 'refuse', reason: 'table_lane_single_period' });
  });
});
