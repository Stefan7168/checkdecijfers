// Eurostat study step 4 (session 153): the table lane's planning on a REAL
// Eurostat structure (tests/fixtures/eurostat-structure/, read by the
// structure reader), with the model's reading stubbed — no AI, no network.
// What step 4 adds: Eurostat totals ("T"/"TOTAL"/"Total …", position-free,
// exactly one), a one-member dimension as its own default, `freq` following
// the resolved period grain (never offered to the model), and Dutch country
// names ("Duitsland" → DE) on the geo dimension. CBS behaviour is pinned by
// the existing CBS suites staying byte-identical.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eurostatLayoutFromStructure, readEurostatStructure } from '../../src/eurostat-adapter/sdmx-structure.ts';
import { buildTableParseSchema } from '../../src/answer/table-parse/input.ts';
import { applySeasonalAdjustmentRule, TABLE_PARSE_SCHEMA_VERSION, type TableParseResult } from '../../src/answer/table-parse/parse.ts';
import { planTableLane, type TableLaneTable } from '../../src/answer/table-lane/plan.ts';
import { eurostatGrandTotal, grandTotalFor } from '../../src/query/breakdowns.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';

const FIXTURES = new URL('../fixtures/eurostat-structure/', import.meta.url);

function layout(code: string): TableLaneTable {
  const read = (suffix: string) => readFileSync(new URL(`${code}.${suffix}.xml`, FIXTURES), 'utf8');
  const l = eurostatLayoutFromStructure(`eurostat:${code}`, readEurostatStructure(code, read('dataflow'), read('constraint')), () => 1);
  if (!('schema' in l)) throw new Error(`fixture ${code} did not lay out: ${JSON.stringify(l)}`);
  return { schema: l.schema, codeLists: l.codeLists } as TableLaneTable;
}

class StubClient implements LlmClient {
  private readonly outputText: string;
  constructor(outputText: string) {
    this.outputText = outputText;
  }
  async complete(_request: LlmRequest): Promise<LlmResponse> {
    return { outputText: this.outputText, model: 'stub', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

function output(table: TableLaneTable, question: string, spec: Record<string, unknown> & { breakdowns?: Record<string, string> }) {
  const offered = buildTableParseSchema(table.schema, table.codeLists, question);
  return JSON.stringify({
    version: TABLE_PARSE_SCHEMA_VERSION,
    measureCode: spec.measureCode,
    breakdowns: offered.breakdowns.map((b) => ({ dimension: b.name, choice: spec.breakdowns?.[b.name] ?? 'niet_genoemd' })),
    period: spec.period,
    regions: spec.regions ?? [],
    regionScope: null,
    derivation: 'none',
    confidence: 0.9,
    reading: 'test',
  });
}

async function plan(table: TableLaneTable, question: string, spec: Record<string, unknown> & { breakdowns?: Record<string, string> }) {
  const client = new StubClient(output(table, question, spec));
  return planTableLane({ question, previousQuestion: null, table, choices: [], referenceDate: '2026-10-02', client });
}

describe('Eurostat totals (step 4)', () => {
  it('finds the real Eurostat totals the CBS rule cannot, and none where there is none', () => {
    const asylum = layout('migr_asyappctza');
    for (const dim of ['sex', 'age', 'applicant']) {
      const members = asylum.codeLists[dim]!.map((c) => ({ code: c.code, title: c.title }));
      // With the Dutch label the CBS title rule would also see "Totaal"; Eurostat tables use the Eurostat rule.
      expect(eurostatGrandTotal(members)?.title).toBe('Totaal'); // the reviewed Dutch label (dutch-labels.ts)
    }
    const unemployment = layout('une_rt_q');
    expect(eurostatGrandTotal(unemployment.codeLists['s_adj']!.map((c) => ({ code: c.code, title: c.title })))).toBeNull();
  });

  it('two "Total …" members are no total (the reader is asked); one member is its own default', () => {
    expect(eurostatGrandTotal([{ code: 'TOTAL', title: 'Total' }, { code: 'X', title: 'Total excluding energy' }])).toBeNull();
    expect(grandTotalFor([{ code: 'A', title: 'Annual' }], 'eurostat')?.code).toBe('A');
    expect(grandTotalFor([{ code: 'A', title: 'Annual' }], undefined)).toBeNull(); // CBS rule unchanged
  });
});

describe('planTableLane on a Eurostat table (step 4, hermetic)', () => {
  const une = layout('une_rt_q');
  const question = 'Hoe hoog was de werkloosheid in Duitsland in het tweede kwartaal van 2024?';
  const base = {
    measureCode: 'une_rt_q|PC_ACT',
    period: { kind: 'quarter', year: 2024, quarter: 2 },
    regions: [{ name: 'Duitsland', kind: 'land' }],
    breakdowns: { s_adj: 'SA', age: 'Y15-74' },
  };

  it('freq is never offered to the model', () => {
    expect(buildTableParseSchema(une.schema, une.codeLists, question).breakdowns.map((b) => b.name)).not.toContain('freq');
  });

  it('plans DE, sex = Total (stated default), freq = Q from the quarter, exactly that quarter', async () => {
    const p = await plan(une, question, base);
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice.periods).toEqual(['2024KW02']);
    expect(p.slice.members).toMatchObject({ geo: ['DE'], sex: ['T'], freq: ['Q'], s_adj: ['SA'], age: ['Y15-74'] });
    expect(p.selection.defaults.map((d) => d.dimension)).toContain('sex');
  });

  it('a non-country place kind never matches a Eurostat country; an unknown name is refused', async () => {
    const provincie = await plan(une, question, { ...base, regions: [{ name: 'Duitsland', kind: 'provincie' }] });
    expect(provincie.kind).toBe('refuse');
    const unknown = await plan(une, question, { ...base, regions: [{ name: 'Atlantis', kind: 'land' }] });
    expect(unknown.kind).toBe('refuse');
  });

  it('a quarter question that says nothing about adjustment gets the seasonally adjusted series', async () => {
    const p = await plan(une, question, { ...base, breakdowns: { age: 'Y15-74' } });
    expect(p.kind).toBe('fetch');
    if (p.kind !== 'fetch') return;
    expect(p.slice.members).toMatchObject({ s_adj: ['SA'] });
  });

  it('no age class named and no total → the reader is asked (principle c)', async () => {
    const p = await plan(une, question, { ...base, breakdowns: { s_adj: 'SA' } });
    expect(p.kind).toBe('ask');
  });
});

describe('the seasonal rule on a Eurostat s_adj dimension (step 4)', () => {
  const gdp = layout('namq_10_gdp');
  const input = buildTableParseSchema(gdp.schema, gdp.codeLists, 'bbp');
  const result = (choice: TableParseResult['breakdowns'][string], period: TableParseResult['period']): TableParseResult => ({
    measureCode: 'namq_10_gdp|CLV_PCH_PRE',
    breakdowns: Object.fromEntries(input.breakdowns.map((b) => [b.name, b.name === 's_adj' ? choice : { kind: 'not_named' }])),
    period,
    regions: [],
    regionScope: null,
    derivation: 'none',
    confidence: 0.9,
    reading: 'test',
    periodGrainUnavailable: false,
  } as TableParseResult);
  const quarter = { kind: 'quarter', year: 2025, quarter: 1 } as TableParseResult['period'];
  const sAdj = (r: TableParseResult) => r.breakdowns['s_adj'];

  it('quarter, nothing said → seasonally AND calendar adjusted (the headline series)', () => {
    expect(sAdj(applySeasonalAdjustmentRule('Hoeveel groeide het bbp in het eerste kwartaal van 2025?', result({ kind: 'not_named' }, quarter), input))).toEqual({ kind: 'member', code: 'SCA' });
  });

  it('the question asks for unadjusted figures → NSA', () => {
    expect(sAdj(applySeasonalAdjustmentRule('Het niet-seizoengecorrigeerde bbp in het eerste kwartaal van 2025?', result({ kind: 'not_named' }, quarter), input))).toEqual({ kind: 'member', code: 'NSA' });
  });

  it('a member the model chose is kept; a year question takes the unadjusted series', () => {
    expect(sAdj(applySeasonalAdjustmentRule('bbp', result({ kind: 'member', code: 'CA' }, quarter), input))).toEqual({ kind: 'member', code: 'CA' });
    expect(sAdj(applySeasonalAdjustmentRule('bbp in 2024', result({ kind: 'not_named' }, { kind: 'year', year: 2024 } as TableParseResult['period']), input))).toEqual({ kind: 'member', code: 'NSA' });
  });
});
