// reconstructDatasetTurn / redactedTurnIntegrityReport — the R8 analog for
// this tier (D9). Hermetic (PGlite), no live LLM: every fixture is written
// through the REAL respondToDatasetQuestion orchestration (respond.ts) with
// a fake LlmClient, then read back via getDatasetTurnById and reconstructed
// against the CURRENT dataset row — exactly the path scripts/
// verify-dataset-turns.ts runs against a real database.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import { deleteOneDataset } from '../../src/attachments/retention.ts';
import { getDatasetTurnById } from '../../src/attachments/read.ts';
import { reconstructDatasetTurn, redactedTurnIntegrityReport } from '../../src/attachments/reconstruct.ts';
import { respondToDatasetQuestion } from '../../src/attachments/respond.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import { getDataset, insertDataset } from '../../src/attachments/store.ts';
import type { UserDataset } from '../../src/attachments/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';

let sharedDb: Db;
let closeSharedDb: () => Promise<void>;

beforeAll(async () => {
  ({ db: sharedDb, close: closeSharedDb } = await createTestDb());
});

afterAll(async () => {
  await closeSharedDb();
});

beforeEach(async () => {
  await resetTestDb(sharedDb);
});

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  await fn(sharedDb);
}

const CELLS = [
  ['Year', 'City', 'Revenue'],
  ['2020', 'Amsterdam', '120,5'],
  ['2021', 'Amsterdam', '150,0'],
  ['2022', 'Amsterdam', '90,0'],
];

async function seed(db: Db, cells: string[][] = CELLS): Promise<{ dataset: UserDataset; threadId: number }> {
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
    cells,
    profile: buildDatasetProfile(cells),
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
    version: 2,
    kind: 'line',
    x: 'c0',
    y: ['c2'],
    seriesBy: null,
    filters: [],
    sort: null,
    limit: null,
    aggregate: null,
    derived: null,
    confidence: 0.9,
    reading: 'Revenue over time.',
    unsupported: null,
    ...fields,
  });
}

async function lastTurnId(db: Db, datasetId: number): Promise<number> {
  const { rows } = await db.query(
    'select id from dataset_turns where dataset_id = $1 order by id desc limit 1',
    [datasetId],
  );
  return Number(rows[0]!.id);
}

describe('reconstructDatasetTurn — chart turns', () => {
  it('reconstructs a real chart turn written by respondToDatasetQuestion', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'show revenue by year',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput()) },
      });
      const turnId = await lastTurnId(db, dataset.id);
      const record = await getDatasetTurnById(db, turnId);
      expect(record).not.toBeNull();
      const currentDataset = await getDataset(db, dataset.userId, dataset.id);
      const report = reconstructDatasetTurn(record!, currentDataset!);
      expect(report).toEqual({ ok: true, problems: [] });
    });
  });

  it('flags a chart whose stored spec was tampered with', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'show revenue by year',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput()) },
      });
      const turnId = await lastTurnId(db, dataset.id);
      // Simulate corruption: overwrite the stored envelope's chart series
      // directly at the SQL layer (bypassing every application code path).
      await db.query(
        `update dataset_turns set envelope = jsonb_set(envelope, '{chart,series}', '[]'::jsonb) where id = $1`,
        [turnId],
      );
      const record = await getDatasetTurnById(db, turnId);
      const currentDataset = await getDataset(db, dataset.userId, dataset.id);
      const report = reconstructDatasetTurn(record!, currentDataset!);
      expect(report.ok).toBe(false);
      expect(report.problems).toContain('chart spec does not re-derive from the current dataset + stored instruction');
    });
  });

  it('flags an envelope whose schemaVersion no longer matches DATASET_TURN_ENVELOPE_VERSION', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'show revenue by year',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput()) },
      });
      const turnId = await lastTurnId(db, dataset.id);
      await db.query(`update dataset_turns set envelope = jsonb_set(envelope, '{schemaVersion}', '99') where id = $1`, [
        turnId,
      ]);
      const record = await getDatasetTurnById(db, turnId);
      const currentDataset = await getDataset(db, dataset.userId, dataset.id);
      const report = reconstructDatasetTurn(record!, currentDataset!);
      expect(report.ok).toBe(false);
      expect(report.problems).toContain('envelope schemaVersion 99 is not the v1 this reconstructor handles');
    });
  });

  it('flags a stored instruction that diverges from the envelope', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'show revenue by year',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput()) },
      });
      const turnId = await lastTurnId(db, dataset.id);
      await db.query(`update dataset_turns set instruction = jsonb_set(instruction, '{limit}', '7') where id = $1`, [
        turnId,
      ]);
      const record = await getDatasetTurnById(db, turnId);
      const currentDataset = await getDataset(db, dataset.userId, dataset.id);
      const report = reconstructDatasetTurn(record!, currentDataset!);
      expect(report.ok).toBe(false);
      expect(report.problems).toContain('stored instruction column differs from envelope.instruction');
    });
  });
});

describe('reconstructDatasetTurn — the #314 incomplete flag', () => {
  // 2021's group has a blank Revenue cell: the yearly sum skips it and the
  // point carries `incomplete: true`.
  const GAPPY = [
    ['Year', 'City', 'Revenue'],
    ['2020', 'Amsterdam', '120,5'],
    ['2020', 'Rotterdam', '80,0'],
    ['2021', 'Amsterdam', '150,0'],
    ['2021', 'Rotterdam', ''],
  ];

  async function gappyTurn(db: Db) {
    const { dataset, threadId } = await seed(db, GAPPY);
    await respondToDatasetQuestion(db, {
      dataset,
      threadId,
      question: 'total revenue by year',
      requestId: randomUUID(),
      rawState: null,
      llmOptions: { client: fakeClient(chartInstructionOutput({ kind: 'bar', aggregate: { fn: 'sum' } })) },
    });
    const record = (await getDatasetTurnById(db, await lastTurnId(db, dataset.id)))!;
    const currentDataset = (await getDataset(db, dataset.userId, dataset.id))!;
    return { record, currentDataset };
  }

  /** The same record as a pre-#314 writer would have stored it: identical,
   * minus every `incomplete` key. */
  function asPreFlagRow<T>(record: T): T {
    return JSON.parse(JSON.stringify(record, (key, value) => (key === 'incomplete' ? undefined : value))) as T;
  }

  it('a chart turn with an incomplete sum stores the flag and reconstructs', async () => {
    await withDb(async (db) => {
      const { record, currentDataset } = await gappyTurn(db);
      expect(JSON.stringify(record.envelope)).toContain('"incomplete":true');
      expect(reconstructDatasetTurn(record, currentDataset)).toEqual({ ok: true, problems: [] });
    });
  });

  it('a turn stored BEFORE the flag existed still reconstructs (the flag is disclosure, never a value)', async () => {
    await withDb(async (db) => {
      const { record, currentDataset } = await gappyTurn(db);
      const legacy = asPreFlagRow(record);
      expect(JSON.stringify(legacy.envelope)).not.toContain('incomplete');
      expect(reconstructDatasetTurn(legacy, currentDataset)).toEqual({ ok: true, problems: [] });
    });
  });

  it('the legacy allowance never masks a changed value', async () => {
    await withDb(async (db) => {
      const { record, currentDataset } = await gappyTurn(db);
      const legacy = asPreFlagRow(record);
      const chart = (legacy.envelope as { chart: { series: { points: { value: number | null }[] }[] } }).chart;
      chart.series[0]!.points[1]!.value = 999;
      const report = reconstructDatasetTurn(legacy, currentDataset);
      expect(report.ok).toBe(false);
      expect(report.problems).toContain('chart spec does not re-derive from the current dataset + stored instruction');
    });
  });

  it('a post-#314 row that LOST its flag is not treated as legacy when another point still has one', async () => {
    await withDb(async (db) => {
      const { record, currentDataset } = await gappyTurn(db);
      // Keep the key present elsewhere in the stored chart (as a post-#314
      // writer always would), but drop it from the incomplete point: the
      // rebuild disagrees and the legacy allowance must not apply.
      const tampered = JSON.parse(JSON.stringify(record)) as typeof record;
      const chart = (tampered.envelope as unknown as { chart: { series: { points: Record<string, unknown>[] }[] } }).chart;
      delete chart.series[0]!.points[1]!['incomplete'];
      chart.series[0]!.points[0]!['incomplete'] = true;
      const report = reconstructDatasetTurn(tampered, currentDataset);
      expect(report.ok).toBe(false);
    });
  });
});

describe('reconstructDatasetTurn — clarification and refusal turns', () => {
  it('reconstructs an empty-question refusal (no LLM call)', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: '   ',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient('should never be called') },
      });
      const turnId = await lastTurnId(db, dataset.id);
      const record = await getDatasetTurnById(db, turnId);
      const currentDataset = await getDataset(db, dataset.userId, dataset.id);
      expect(reconstructDatasetTurn(record!, currentDataset!)).toEqual({ ok: true, problems: [] });
    });
  });

  it('reconstructs a low-confidence clarification', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'do something with this',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput({ confidence: 0.2 })) },
      });
      const turnId = await lastTurnId(db, dataset.id);
      const record = await getDatasetTurnById(db, turnId);
      expect(record!.kind).toBe('clarification');
      const currentDataset = await getDataset(db, dataset.userId, dataset.id);
      expect(reconstructDatasetTurn(record!, currentDataset!)).toEqual({ ok: true, problems: [] });
    });
  });

  it('reconstructs a chart with a seriesBy grouping', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'show revenue by year, grouped by city',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput({ seriesBy: 'c1' })) },
      });
      const turnId = await lastTurnId(db, dataset.id);
      const record = await getDatasetTurnById(db, turnId);
      const currentDataset = await getDataset(db, dataset.userId, dataset.id);
      expect(reconstructDatasetTurn(record!, currentDataset!)).toEqual({ ok: true, problems: [] });
    });
  });

  it('reconstructs a not-chartable refusal (LLM marks the instruction unsupported)', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'write me a poem about this data',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: {
          client: fakeClient(
            chartInstructionOutput({ unsupported: { reason: 'not_chartable', detail: "that isn't a chart" } }),
          ),
        },
      });
      const turnId = await lastTurnId(db, dataset.id);
      const record = await getDatasetTurnById(db, turnId);
      expect(record!.kind).toBe('refusal');
      const currentDataset = await getDataset(db, dataset.userId, dataset.id);
      expect(reconstructDatasetTurn(record!, currentDataset!)).toEqual({ ok: true, problems: [] });
    });
  });
});

describe('redactedTurnIntegrityReport', () => {
  it('verifies a turn redacted by deleteOneDataset', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'show revenue by year',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput()) },
      });
      const turnId = await lastTurnId(db, dataset.id);
      await deleteOneDataset(db, dataset.userId, dataset.id);
      const record = await getDatasetTurnById(db, turnId);
      expect(redactedTurnIntegrityReport(record!)).toEqual({ ok: true, problems: [] });
    });
  });

  it('flags a redacted row whose question was not actually cleared', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'show revenue by year',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient(chartInstructionOutput()) },
      });
      const turnId = await lastTurnId(db, dataset.id);
      await deleteOneDataset(db, dataset.userId, dataset.id);
      await db.query(`update dataset_turns set question = 'leaked question text' where id = $1`, [turnId]);
      const record = await getDatasetTurnById(db, turnId);
      const report = redactedTurnIntegrityReport(record!);
      expect(report.ok).toBe(false);
      expect(report.problems).toContain('question is not the redaction sentinel');
    });
  });

  it('rejects a non-redacted record', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: '   ',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient('should never be called') },
      });
      const turnId = await lastTurnId(db, dataset.id);
      const record = await getDatasetTurnById(db, turnId);
      expect(redactedTurnIntegrityReport(record!)).toEqual({ ok: false, problems: ['envelope is not a redacted sentinel'] });
    });
  });
});
