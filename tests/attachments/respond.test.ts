// respondToDatasetQuestion — the turn orchestration (D8). Hermetic (PGlite)
// with a fake LlmClient (no live LLM). Every outcome must write exactly one
// turn and return a matching AuditedDatasetTurn.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MIN_INSTRUCTION_CONFIDENCE, respondToDatasetQuestion } from '../../src/attachments/respond.ts';
import { insertDataset } from '../../src/attachments/store.ts';
import { toClientInstruction, type ChartInstruction, type UserDataset } from '../../src/attachments/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

const CELLS = [
  ['Year', 'City', 'Revenue'],
  ['2020', 'Amsterdam', '120,5'],
  ['2021', 'Amsterdam', '150,0'],
  ['2022', 'Amsterdam', '90,0'],
];

async function seed(db: Db): Promise<{ dataset: UserDataset; threadId: number }> {
  const userId = randomUUID();
  const dataset = await insertDataset(db, {
    userId,
    sourceKind: 'file_csv',
    displayName: 'x.csv',
    sourceUrl: null,
    mimeSniffed: 'text/csv',
    byteSize: 10,
    contentSha256: 'deadbeef',
    requestId: null,
    fileBytes: null,
    cells: CELLS,
    profile: buildDatasetProfile(CELLS),
    status: 'ready',
  });
  const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
    userId,
  ]);
  return { dataset, threadId: Number(rows[0]!.id) };
}

function fakeClient(outputText: string): LlmClient {
  return {
    complete: async (_request: LlmRequest): Promise<LlmResponse> => ({
      outputText,
      model: 'claude-haiku-4-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  };
}

function chartInstructionOutput(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    kind: 'line',
    x: 'c0',
    y: ['c2'],
    seriesBy: null,
    filters: [],
    sort: null,
    limit: null,
    confidence: 0.9,
    reading: 'Revenue over time.',
    unsupported: null,
    ...fields,
  });
}

async function countTurns(db: Db, datasetId: number): Promise<number> {
  const { rows } = await db.query('select count(*)::int as n from dataset_turns where dataset_id = $1', [
    datasetId,
  ]);
  return Number(rows[0]!.n);
}

describe('respondToDatasetQuestion — deterministic pre-checks (zero LLM)', () => {
  it('refuses an empty question', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      const result = await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: '   ',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient('should never be called') },
      });
      expect(result.envelope).toMatchObject({ kind: 'refusal', reason: 'empty_question' });
      expect(await countTurns(db, dataset.id)).toBe(1);
    });
  });

  it('refuses a CBS-comparison ask without calling the LLM', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      let called = false;
      const client: LlmClient = { complete: async (r) => { called = true; return fakeClient('x').complete(r); } };
      const result = await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'compare this with CBS inflation',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client },
      });
      expect(result.envelope).toMatchObject({ kind: 'refusal', reason: 'compare_with_cbs' });
      expect(called).toBe(false);
    });
  });

  it('gives the export hint without calling the LLM', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      let called = false;
      const client: LlmClient = { complete: async (r) => { called = true; return fakeClient('x').complete(r); } };
      const result = await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'can I download this?',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client },
      });
      expect(result.envelope).toMatchObject({ kind: 'refusal', reason: 'export_hint' });
      expect(called).toBe(false);
    });
  });
});

describe('respondToDatasetQuestion — a confident chart', () => {
  it('produces a chart envelope, writes the turn, and returns chartEmitted-worthy state', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      const result = await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'show revenue per year',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput()) },
      });
      expect(result.envelope.kind).toBe('chart');
      expect(result.datasetGone).toBe(false);
      expect(result.auditId).toBeGreaterThan(0);
      if (result.envelope.kind === 'chart') {
        expect(result.envelope.chart.series[0]!.points).toHaveLength(3);
        expect(result.envelope.state.lastInstruction).not.toHaveProperty('reading');
      }
    });
  });
});

describe('respondToDatasetQuestion — low confidence clarifies instead of guessing', () => {
  it('clarifies below the threshold, using profile-derived options', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      const result = await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'something vague',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: {
          client: fakeClient(chartInstructionOutput({ confidence: MIN_INSTRUCTION_CONFIDENCE - 0.01 })),
        },
      });
      expect(result.envelope).toMatchObject({ kind: 'clarification', reason: 'low_confidence' });
      if (result.envelope.kind === 'clarification') {
        expect(result.envelope.options.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('respondToDatasetQuestion — unsupported requests refuse honestly', () => {
  it('refuses an aggregation ask with the model\'s own detail', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      const result = await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'what is the total revenue',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: {
          client: fakeClient(
            chartInstructionOutput({ unsupported: { reason: 'aggregation', detail: 'totals are not supported yet' } }),
          ),
        },
      });
      expect(result.envelope).toMatchObject({ kind: 'refusal', reason: 'aggregation' });
    });
  });
});

describe('respondToDatasetQuestion — a validation-failing model output clarifies, never crashes', () => {
  it('clarifies when the model invents an off-allowlist column id', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      const result = await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'q',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput({ x: 'c99' })) },
      });
      expect(result.envelope).toMatchObject({ kind: 'clarification', reason: 'validation' });
    });
  });
});

describe('respondToDatasetQuestion — zero-row and too-many-points execution outcomes', () => {
  it('clarifies on a filter COMBINATION that matches nothing (each value individually real, per validateInstruction)', async () => {
    await withDb(async (db) => {
      // A second city, but only in 2022 — filtering City=Rotterdam AND
      // Year=2020 is a valid instruction (both values are real, per the
      // profile) that nonetheless matches zero actual rows, unlike an
      // outright invented filter value (which validateInstruction itself
      // rejects before execute.ts ever runs — a different, already-tested
      // path, "a validation-failing model output clarifies" above).
      const cellsWithRotterdam = [...CELLS, ['2022', 'Rotterdam', '200,0']];
      const userId = randomUUID();
      const dataset = await insertDataset(db, {
        userId,
        sourceKind: 'file_csv',
        displayName: 'x.csv',
        sourceUrl: null,
        mimeSniffed: 'text/csv',
        byteSize: 10,
        contentSha256: 'deadbeef',
        requestId: null,
        fileBytes: null,
        cells: cellsWithRotterdam,
        profile: buildDatasetProfile(cellsWithRotterdam),
        status: 'ready',
      });
      const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [
        userId,
      ]);
      const threadId = Number(rows[0]!.id);

      const result = await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'q',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: {
          client: fakeClient(
            chartInstructionOutput({
              filters: [
                { column: 'c1', op: 'in', values: ['Rotterdam'] },
                { column: 'c0', op: 'between', from: 2020, to: 2020 },
              ],
            }),
          ),
        },
      });
      expect(result.envelope).toMatchObject({ kind: 'clarification', reason: 'zero_rows' });
    });
  });
});

describe('respondToDatasetQuestion — rawState revalidation (D8 step 2)', () => {
  it('carries forward a valid previous instruction as prompt context', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      const previous: ChartInstruction = {
        version: 1,
        kind: 'line',
        x: 'c0',
        y: ['c2'],
        seriesBy: null,
        filters: [],
        sort: null,
        limit: null,
        confidence: 0.95,
        reading: '',
        unsupported: null,
      };
      let seenQuestion = '';
      const client: LlmClient = {
        complete: async (request) => {
          seenQuestion = request.question;
          return fakeClient(chartInstructionOutput({ kind: 'bar' })).complete(request);
        },
      };
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'make it a bar chart',
        requestId: randomUUID(),
        rawState: { datasetId: dataset.id, lastInstruction: toClientInstruction(previous) },
        llmOptions: { client },
      });
      expect(seenQuestion).toContain('"kind":"line"'); // the previous instruction reached the prompt
      expect(seenQuestion).not.toContain('None — this is a fresh question.');
    });
  });

  it('drops an invalid rawState (off-allowlist column) and parses fresh instead of crashing', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      const staleInvalid: ChartInstruction = {
        version: 1,
        kind: 'line',
        x: 'c99', // no longer/never a real column
        y: ['c2'],
        seriesBy: null,
        filters: [],
        sort: null,
        limit: null,
        confidence: 0.95,
        reading: '',
        unsupported: null,
      };
      let seenQuestion = '';
      const client: LlmClient = {
        complete: async (request) => {
          seenQuestion = request.question;
          return fakeClient(chartInstructionOutput()).complete(request);
        },
      };
      const result = await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'q',
        requestId: randomUUID(),
        rawState: { datasetId: dataset.id, lastInstruction: toClientInstruction(staleInvalid) },
        llmOptions: { client },
      });
      expect(seenQuestion).toContain('None — this is a fresh question.');
      expect(result.envelope.kind).toBe('chart'); // still produces a real chart from the fresh parse
    });
  });
});
