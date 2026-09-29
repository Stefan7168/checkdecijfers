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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { ensureSlice, registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { loadAuditRecord } from '../../src/answer/audit/read.ts';
import { reconstructionReport } from '../../src/answer/audit/reconstruct.ts';
import type { AuditRecord } from '../../src/answer/audit/types.ts';
import type { AuditedRespondOptions } from '../../src/answer/audit/respond-audited.ts';
import type { AnswerResponse, ClarificationResponse, RefusalResponse } from '../../src/answer/respond/types.ts';
import { planTableLane, type TableLanePlan, type TableLaneRefusalReason } from '../../src/answer/table-lane/plan.ts';
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

async function answerRecord(target: () => Db = () => db): Promise<AuditRecord> {
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
  const audited = await respondTableLane(target(), {
    row: laneRow(),
    plan,
    fetch: { ok: true, filterKey: fetched.filterKey, fromCache: false },
    referenceDate: REF,
    respondOptions: OPTIONS,
  });
  if (target() === db && audited.response.kind !== 'answer') throw new Error(`expected an answer, got ${audited.response.kind}`);
  return (await loadAuditRecord(db, audited.auditId!))!;
}

async function clarificationRecord(target: () => Db = () => db): Promise<AuditRecord> {
  const path = fileURLToPath(new URL('../fixtures/tableparse/schemas/82883NED.json', import.meta.url));
  const water = JSON.parse(readFileSync(path, 'utf8')) as TableLaneTable;
  const q = 'Hoeveel leidingwater werd in 2020 gebruikt?';
  const client = new StubParseClient(parseOutput(water, q, { measureCode: 'M005248_2', period: { kind: 'year', year: 2020 } }));
  const plan = await planTableLane({ question: q, previousQuestion: null, table: water, choices: [], referenceDate: REF, client });
  if (plan.kind !== 'ask') throw new Error('expected ask');
  const audited = await respondTableLane(target(), { row: laneRow({ question: q }), plan, fetch: null, referenceDate: REF, respondOptions: OPTIONS });
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

// ---------------------------------------------------------------------------
// Fix round 1 — Ruling R8 (stored selection), M2 (parse versions), I1
// (fail-closed replacement rows of a lane turn reconstruct).
// ---------------------------------------------------------------------------

/** A Db whose FIRST audit insert throws and whose later ones succeed — the
 * persistOrFailClosed path that stores the internal-refusal replacement. */
function firstAuditInsertFails(): Db {
  let failed = false;
  const wrapped: Db = {
    async query(text, params) {
      if (!failed && text.includes('insert into audit_answers')) {
        failed = true;
        throw new Error('transient audit insert failure');
      }
      return db.query(text, params);
    },
    withTransaction: (fn) => db.withTransaction(fn),
  };
  return wrapped;
}

async function silencingAlerts<T>(fn: () => Promise<T>): Promise<{ value: T; alerts: string[] }> {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const value = await fn();
    return { value, alerts: spy.mock.calls.map((c) => String(c[0])) };
  } finally {
    spy.mockRestore();
  }
}

describe('table-lane rows: stored selection + parse versions (fix round 1)', () => {
  it('the answer stores its selection and the parse prompt/schema versions', async () => {
    const record = await answerRecord();
    const lane = record.response.tableLane!;
    expect(lane.selection).not.toBeNull();
    expect(lane.lang).toBe('nl');
    expect(lane.parsePromptVersion).toEqual(expect.any(Number));
    expect(lane.parseSchemaVersion).toEqual(expect.any(Number));
  });

  it('tamper: the selection note alone fails (re-derived from the stored selection)', async () => {
    const t = clone(await answerRecord());
    (t.response as AnswerResponse).tableLane!.selectionNote = "Selectie: Regio's: Rotterdam";
    expect(problemsOf(t)).toContain('selectionNote');
  });

  it('tamper: a changed stored selection fails (its note no longer re-derives)', async () => {
    const t = clone(await answerRecord());
    (t.response as AnswerResponse).tableLane!.selection!.named[0]!.memberTitle = 'Rotterdam';
    expect(problemsOf(t)).toContain('selectionNote');
  });

  it('tamper: the note switched to the other language fails', async () => {
    const t = clone(await answerRecord());
    (t.response as AnswerResponse).tableLane!.lang = 'en';
    expect(problemsOf(t)).toContain('selectionNote');
  });

  it('tamper: parse versions dropped while the parse audit stays fails', async () => {
    const t = clone(await refusalRecord());
    (t.response as RefusalResponse).tableLane!.parsePromptVersion = null;
    expect(problemsOf(t)).toContain('versions');
  });
});

describe('fail-closed replacement rows of a lane turn reconstruct (fix round 1, I1)', () => {
  it('first audit write of an ANSWER fails, the retried replacement is stored: it carries tableLane and reconstructs', async () => {
    const { value: record, alerts } = await silencingAlerts(() => answerRecord(firstAuditInsertFails));
    expect(alerts.some((a) => a.startsWith('ADMIN ALERT: INTERNAL refusal'))).toBe(true);
    expect(record.kind).toBe('refusal');
    expect(record.refusalReason).toBe('internal');
    expect(record.llmCalls.map((c) => c.role)).toContain('table_parse');
    expect(record.response.tableLane?.tableId).toBe(LANE_TABLE);
    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('first audit write of a QUESTION fails: the replacement refusal carries tableLane WITHOUT the question and reconstructs', async () => {
    const { value: record } = await silencingAlerts(() => clarificationRecord(firstAuditInsertFails));
    expect(record.kind).toBe('refusal');
    expect(record.response.tableLane).toBeDefined();
    expect(record.response.tableLane!.question).toBeNull();
    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('a throw inside the turn (produce) → the internal refusal carries tableLane and reconstructs', async () => {
    // An unknown reason makes the template builder throw inside produce.
    const plan: TableLanePlan = {
      kind: 'refuse',
      reason: 'no_such_reason' as TableLaneRefusalReason,
      detail: 'x',
      parse: null,
      parseAudit: { requestHash: 'c'.repeat(64), model: 'stub-table-parse', usage: { inputTokens: 2, outputTokens: 1 }, outputText: '{}' },
    };
    const { value: audited, alerts } = await silencingAlerts(() =>
      respondTableLane(db, { row: laneRow(), plan, fetch: null, referenceDate: REF, respondOptions: OPTIONS }),
    );
    expect(alerts.some((a) => a.startsWith('ADMIN ALERT: INTERNAL refusal'))).toBe(true);
    expect(audited.auditId).not.toBeNull();
    if (audited.response.kind !== 'refusal') throw new Error('expected a refusal');
    expect(audited.response.reason).toBe('internal');
    expect(audited.response.internalNote).toContain('preparsed turn failed');
    expect(audited.response.tableLane?.parseAudit?.model).toBe('stub-table-parse');
    const record = (await loadAuditRecord(db, audited.auditId!))!;
    expect(reconstructionReport(record).problems).toEqual([]);
  });
});
