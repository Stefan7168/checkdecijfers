// Breadth step 5, Task 3 — shared fixtures for the table-lane respond and
// reconstruct suites: a real CBS table (83625NED, committed fixture) served
// through FixtureSource, a stub table-parse client (never a real LLM), and a
// TableLaneRow builder. Hermetic: PGlite + fixtures only.
import { fileURLToPath } from 'node:url';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { CbsSource } from '../../src/cbs-adapter/types.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import { buildTableParseSchema } from '../../src/answer/table-parse/input.ts';
import { TABLE_PARSE_SCHEMA_VERSION } from '../../src/answer/table-parse/parse.ts';
import type { PeriodSpec, RegionTerm } from '../../src/answer/intent/types.ts';
import type { TableLaneTable } from '../../src/answer/table-lane/types.ts';
import type { TableLaneRow } from '../../src/ingestion/table-lane-store.ts';

export const LANE_TABLE = '83625NED';
export const LANE_MEASURE = 'M001534';
export const LANE_QUESTION = 'Wat was de gemiddelde verkoopprijs van een koopwoning in Amsterdam in 2024?';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

export async function laneSource(): Promise<CbsSource> {
  return new FixtureSource(await loadFixtureDocs(`${FIXTURES_DIR}/${LANE_TABLE}`));
}

/** The table as the job would hand it to planTableLane: live schema + every
 * non-measure dimension's code list, from the same source. */
export async function laneTable(source: CbsSource, tableId = LANE_TABLE): Promise<TableLaneTable> {
  const schema = await source.fetchTableSchema(tableId);
  const codeLists: TableLaneTable['codeLists'] = {};
  for (const d of schema.dimensions) codeLists[d.name] = await source.fetchCodeList(tableId, d.name);
  return { schema, codeLists };
}

/** A stub table-parse client: returns one hand-written output, records the
 * request. Usage 7/3 so the audit's token counts are recognisable. */
export class StubParseClient implements LlmClient {
  calls: LlmRequest[] = [];
  private readonly outputText: string;
  constructor(outputText: string) {
    this.outputText = outputText;
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    return { outputText: this.outputText, model: 'stub-table-parse', stopReason: 'end_turn', usage: { inputTokens: 7, outputTokens: 3 } };
  }
}

/** Errors on every call, so composeAnswer falls through to its deterministic
 * template (the respond-staleness.test.ts ThrowingAnswerClient pattern). */
export class ThrowingAnswerClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('compose client not used in this test');
  }
}

export function parseOutput(
  table: TableLaneTable,
  question: string,
  spec: { measureCode: string; period: PeriodSpec; regions?: RegionTerm[]; confidence?: number; breakdowns?: Record<string, string> },
): string {
  const offered = buildTableParseSchema(table.schema, table.codeLists, question);
  return JSON.stringify({
    version: TABLE_PARSE_SCHEMA_VERSION,
    measureCode: spec.measureCode,
    breakdowns: offered.breakdowns.map((b) => ({ dimension: b.name, choice: spec.breakdowns?.[b.name] ?? 'niet_genoemd' })),
    period: spec.period,
    regions: spec.regions ?? [],
    regionScope: null,
    derivation: 'none',
    confidence: spec.confidence ?? 0.95,
    reading: 'test',
  });
}

export function laneRow(overrides: Partial<TableLaneRow> = {}): TableLaneRow {
  return {
    id: 41,
    userId: '11111111-1111-1111-1111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
    threadId: null,
    lang: 'nl',
    question: LANE_QUESTION,
    tableId: LANE_TABLE,
    finderConfidence: 0.91,
    parentId: null,
    previousQuestion: null,
    choices: [],
    status: 'running',
    attempts: 1,
    debitTransactionId: 1,
    auditId: null,
    outcomeKind: null,
    createdAt: new Date('2026-09-29T08:00:00.000Z'),
    startedAt: new Date('2026-09-29T08:00:01.000Z'),
    finishedAt: null,
    failureSummary: null,
    ...overrides,
  };
}
