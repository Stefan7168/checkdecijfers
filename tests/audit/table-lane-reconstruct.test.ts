// Breadth step 5, Task 3 — R8 for table-lane rows: an audited table-lane
// answer / question / refusal reconstructs from the stored row alone, and the
// present-only `tableLane` envelope key is shape-checked against the rest of
// the record (reconstruct.ts checkTableLane): version pin, the table it names
// = the answer's attributed table, the table-parse call in llm_calls = the
// envelope's parse audit (model + tokens, exactly once), a question iff the
// row is a clarification, an answer only ever from a stored slice.
// Hermetic: PGlite, committed CBS fixtures, stub LLM clients.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { ensureSlice, registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { loadAuditRecord } from '../../src/answer/audit/read.ts';
import { reconstructionReport } from '../../src/answer/audit/reconstruct.ts';
import type { AuditRecord } from '../../src/answer/audit/types.ts';
import type { AuditedRespondOptions } from '../../src/answer/audit/respond-audited.ts';
import type { AnswerResponse, ClarificationResponse, RefusalResponse } from '../../src/answer/respond/types.ts';
import { planTableLane, type TableLanePlan } from '../../src/answer/table-lane/plan.ts';
import { respondTableLane } from '../../src/answer/table-lane/respond.ts';
import type { TableLaneTable } from '../../src/answer/table-lane/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import {
  LANE_MEASURE,
  LANE_QUESTION,
  LANE_TABLE,
  StubParseClient,
  ThrowingAnswerClient,
  laneRow,
  laneSource,
  laneTable,
  parseOutput,
} from '../helpers/table-lane-fixture.ts';

const REF = '2026-09-29';

let db: Db;
let close: () => Promise<void>;
let table: TableLaneTable;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  table = await laneTable(await laneSource());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.query(
    'truncate table audit_answers, slice_fetches, observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade',
  );
});

const OPTIONS: AuditedRespondOptions = {
  intentClient: new ThrowingAnswerClient(),
  answerClient: new ThrowingAnswerClient(),
  referenceDate: REF,
};

async function answerRecord(): Promise<AuditRecord> {
  const client = new StubParseClient(
    parseOutput(table, LANE_QUESTION, {
      measureCode: LANE_MEASURE,
      period: { kind: 'year', year: 2024 },
      regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
    }),
  );
  const plan = await planTableLane({ question: LANE_QUESTION, previousQuestion: null, table, choices: [], referenceDate: REF, client });
  if (plan.kind !== 'fetch') throw new Error(`expected fetch, got ${plan.kind}`);
  const source = await laneSource();
  const reg = await registerSchemaOnly(db, source, LANE_TABLE);
  if (!reg.ok) throw new Error(reg.summary);
  const fetched = await ensureSlice(db, source, LANE_TABLE, plan.slice);
  if (!fetched.ok) throw new Error(fetched.summary);
  const audited = await respondTableLane(db, {
    row: laneRow(),
    plan,
    fetch: { ok: true, filterKey: fetched.filterKey, fromCache: false },
    referenceDate: REF,
    respondOptions: OPTIONS,
  });
  if (audited.response.kind !== 'answer') throw new Error(`expected an answer, got ${audited.response.kind}`);
  return (await loadAuditRecord(db, audited.auditId!))!;
}

async function clarificationRecord(): Promise<AuditRecord> {
  const path = fileURLToPath(new URL('../fixtures/tableparse/schemas/82883NED.json', import.meta.url));
  const water = JSON.parse(readFileSync(path, 'utf8')) as TableLaneTable;
  const q = 'Hoeveel leidingwater werd in 2020 gebruikt?';
  const client = new StubParseClient(parseOutput(water, q, { measureCode: 'M005248_2', period: { kind: 'year', year: 2020 } }));
  const plan = await planTableLane({ question: q, previousQuestion: null, table: water, choices: [], referenceDate: REF, client });
  if (plan.kind !== 'ask') throw new Error('expected ask');
  const audited = await respondTableLane(db, { row: laneRow({ question: q }), plan, fetch: null, referenceDate: REF, respondOptions: OPTIONS });
  return (await loadAuditRecord(db, audited.auditId!))!;
}

async function refusalRecord(): Promise<AuditRecord> {
  const plan: TableLanePlan = {
    kind: 'refuse',
    reason: 'table_lane_unsure',
    detail: 'confidence 0.4 below 0.8',
    parse: null,
    parseAudit: { requestHash: 'b'.repeat(64), model: 'stub-table-parse', usage: { inputTokens: 9, outputTokens: 4 }, outputText: '{}' },
  };
  const audited = await respondTableLane(db, { row: laneRow(), plan, fetch: null, referenceDate: REF, respondOptions: OPTIONS });
  return (await loadAuditRecord(db, audited.auditId!))!;
}

function clone(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

function problemsOf(record: AuditRecord): string {
  const report = reconstructionReport(record);
  expect(report.ok).toBe(false);
  return report.problems.join(' | ');
}

describe('table-lane rows reconstruct (R8)', () => {
  it('an answer, a question and a refusal each reconstruct cleanly', async () => {
    for (const record of [await answerRecord(), await clarificationRecord(), await refusalRecord()]) {
      expect(record.response.tableLane).toBeDefined();
      expect(reconstructionReport(record).problems).toEqual([]);
    }
  });

  it('tamper: a changed cell value fails (the existing body re-validation)', async () => {
    const t = clone(await answerRecord());
    const answer = t.response as AnswerResponse;
    answer.result.cells[0]!.value = (answer.result.cells[0]!.value ?? 0) + 1;
    problemsOf(t);
  });

  it('tamper: tableLane naming another table than the answer attributes fails', async () => {
    const t = clone(await answerRecord());
    (t.response as AnswerResponse).tableLane!.tableId = '85669NED';
    expect(problemsOf(t)).toContain('tableLane');
  });

  it('tamper: an unsupported tableLane version fails', async () => {
    const t = clone(await answerRecord());
    (t.response.tableLane as { version: number }).version = 2;
    expect(problemsOf(t)).toContain('tableLane');
  });

  it('tamper: the table-parse call missing from llm_calls fails', async () => {
    const t = clone(await answerRecord());
    t.llmCalls = t.llmCalls.filter((c) => c.role !== 'table_parse');
    expect(problemsOf(t)).toContain('table_parse');
  });

  it('tamper: llm_calls disagreeing with the envelope parse audit fails', async () => {
    const t = clone(await refusalRecord());
    (t.response as RefusalResponse).tableLane!.parseAudit!.usage.inputTokens = 999;
    expect(problemsOf(t)).toContain('table_parse');
  });

  it('tamper: a table-parse call on a row with no tableLane envelope fails', async () => {
    const t = clone(await refusalRecord());
    delete (t.response as RefusalResponse).tableLane;
    expect(problemsOf(t)).toContain('table_parse');
  });

  it('tamper: an answer claiming no stored slice fails', async () => {
    const t = clone(await answerRecord());
    (t.response as AnswerResponse).tableLane!.sliceFilterKey = null;
    expect(problemsOf(t)).toContain('tableLane');
  });

  it('tamper: a clarification without its question, or with different options, fails', async () => {
    const record = await clarificationRecord();
    const noQuestion = clone(record);
    (noQuestion.response as ClarificationResponse).tableLane!.question = null;
    expect(problemsOf(noQuestion)).toContain('tableLane');

    const otherOptions = clone(record);
    (otherOptions.response as ClarificationResponse).options = ['Iets anders'];
    expect(problemsOf(otherOptions)).toContain('tableLane');
  });

  it('tamper: a refusal carrying a question fails', async () => {
    const answerQ = (await clarificationRecord()).response.tableLane!.question;
    const t = clone(await refusalRecord());
    (t.response as RefusalResponse).tableLane!.question = answerQ;
    expect(problemsOf(t)).toContain('tableLane');
  });
});
