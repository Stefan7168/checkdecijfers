// replayDatasetTurns / lastChartState (src/attachments/replay.ts) — the
// CBS-side src/threads/replay.ts analog for this tier. Zero LLM, pure
// functions over already-loaded rows: fixtures here are built by hand
// (DatasetTurnRecord objects) for the pure-function tests, and via the REAL
// respondToDatasetQuestion + getDatasetTurnsByThread round trip for the
// integration tests, mirroring reconstruct.test.ts's own convention.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lastChartState, replayDatasetTurns } from '../../src/attachments/replay.ts';
import { getDatasetTurnsByThread } from '../../src/attachments/read.ts';
import { deleteOneDataset } from '../../src/attachments/retention.ts';
import { respondToDatasetQuestion } from '../../src/attachments/respond.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import { insertDataset } from '../../src/attachments/store.ts';
import type { ChartInstruction, DatasetTurnRecord, UserDataset } from '../../src/attachments/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

function baseRecord(overrides: Partial<DatasetTurnRecord> = {}): DatasetTurnRecord {
  return {
    id: 1,
    userId: 'u1',
    datasetId: 1,
    threadId: 1,
    requestId: randomUUID(),
    kind: 'refusal',
    question: 'q',
    envelope: { schemaVersion: 1, kind: 'refusal', question: 'q', text: 'a', reason: 'other', guidance: null },
    finalText: 'a',
    instruction: null,
    chartEmitted: false,
    promptVersions: {},
    llmCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CHART_INSTRUCTION: ChartInstruction = {
  version: 1,
  kind: 'line',
  x: 'c0',
  y: ['c1'],
  seriesBy: null,
  filters: [],
  sort: null,
  limit: null,
  confidence: 0.9,
  reading: 'r',
  unsupported: null,
};

const CHART_SPEC = {
  schemaVersion: 1 as const,
  origin: 'user_dataset' as const,
  trust: 'unverified' as const,
  kind: 'line' as const,
  xHeader: 'Year',
  yHeaders: ['Revenue'],
  series: [],
  provenance: { datasetId: 1, sourceKind: 'file_csv' as const, displayName: 'x.csv', sourceUrlHost: null, capturedAt: '2026-01-01', contentSha256: 'x' },
  disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.' as const,
};

describe('replayDatasetTurns — pure function', () => {
  it('replays a refusal row as one user turn + one assistant turn', () => {
    const record = baseRecord({ question: 'what is the total', envelope: { schemaVersion: 1, kind: 'refusal', question: 'what is the total', text: "I can't do that.", reason: 'aggregation', guidance: null } });
    expect(replayDatasetTurns([record])).toEqual([
      { role: 'user', text: 'what is the total' },
      { role: 'assistant', kind: 'refusal', text: "I can't do that.", guidance: null },
    ]);
  });

  it('replays a clarification row with its options', () => {
    const record = baseRecord({
      kind: 'clarification',
      envelope: { schemaVersion: 1, kind: 'clarification', question: 'q', text: 'Did you mean?', options: ['A', 'B'], instruction: null, reason: 'low_confidence' },
    });
    expect(replayDatasetTurns([record])).toEqual([
      { role: 'user', text: 'q' },
      { role: 'assistant', kind: 'clarification', text: 'Did you mean?', options: ['A', 'B'] },
    ]);
  });

  it('replays a chart row with the chart spec and lastInstruction', () => {
    const record = baseRecord({
      kind: 'chart',
      question: 'show revenue',
      envelope: {
        schemaVersion: 1,
        kind: 'chart',
        question: 'show revenue',
        text: "Here's your chart.",
        instruction: CHART_INSTRUCTION,
        chart: CHART_SPEC,
        state: { datasetId: 1, lastInstruction: { ...CHART_INSTRUCTION, unsupported: null } },
      },
    });
    const messages = replayDatasetTurns([record]);
    expect(messages[0]).toEqual({ role: 'user', text: 'show revenue' });
    expect(messages[1]).toMatchObject({ role: 'assistant', kind: 'chart', chart: CHART_SPEC });
  });

  it('⟨A7⟩ analog: a redacted row replays as ONE placeholder, never a user+assistant pair', () => {
    const record = baseRecord({
      question: '[deleted question]',
      finalText: '[deleted question]',
      envelope: { schemaVersion: 1, kind: 'refusal', question: '[deleted question]', text: '[deleted question]', redacted: true },
    });
    expect(replayDatasetTurns([record])).toEqual([{ role: 'redacted' }]);
  });

  it('replays multiple rows in the given order', () => {
    const first = baseRecord({ id: 1, question: 'q1' });
    const second = baseRecord({ id: 2, question: 'q2' });
    const messages = replayDatasetTurns([first, second]);
    expect(messages.map((m) => ('text' in m ? m.text : null))).toEqual(['q1', 'a', 'q2', 'a']);
  });
});

describe('lastChartState — the D8 step 2 resumed refinement referent', () => {
  const chartRecord = (id: number, lastInstruction = { ...CHART_INSTRUCTION, unsupported: null }) =>
    baseRecord({
      id,
      kind: 'chart',
      envelope: {
        schemaVersion: 1,
        kind: 'chart',
        question: 'q',
        text: 't',
        instruction: CHART_INSTRUCTION,
        chart: CHART_SPEC,
        state: { datasetId: 1, lastInstruction },
      },
    });

  it('returns null when there is no chart turn yet', () => {
    expect(lastChartState([baseRecord()])).toBeNull();
  });

  it('returns the LAST chart turn\'s state, not the first', () => {
    const first = chartRecord(1, { ...CHART_INSTRUCTION, unsupported: null, limit: 1 });
    const second = chartRecord(2, { ...CHART_INSTRUCTION, unsupported: null, limit: 2 });
    expect(lastChartState([first, second])).toEqual({ datasetId: 1, lastInstruction: { ...CHART_INSTRUCTION, unsupported: null, limit: 2 } });
  });

  it('skips a redacted chart row (the D9 "check redaction first" discipline)', () => {
    const redactedChart = baseRecord({
      id: 1,
      kind: 'chart',
      envelope: { schemaVersion: 1, kind: 'chart', question: '[deleted question]', text: '[deleted question]', redacted: true },
    });
    const liveClarification = baseRecord({
      id: 2,
      kind: 'clarification',
      envelope: { schemaVersion: 1, kind: 'clarification', question: 'q', text: 't', options: [], instruction: null, reason: 'zero_rows' },
    });
    expect(lastChartState([redactedChart, liveClarification])).toBeNull();
  });
});

const CELLS = [
  ['Year', 'Revenue'],
  ['2020', '120,5'],
  ['2021', '150,0'],
];

function fakeClient(outputText: string): LlmClient {
  return {
    complete: async (_r: LlmRequest): Promise<LlmResponse> => ({
      outputText,
      model: 'claude-haiku-4-5',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  };
}

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
  const { rows } = await db.query('insert into chat_threads (user_id, dataset_id) values ($1::uuid, $2) returning id', [
    userId,
    dataset.id,
  ]);
  return { dataset, threadId: Number(rows[0]!.id) };
}

describe('getDatasetTurnsByThread — integration with the real respond.ts write path', () => {
  it('reads back every turn for the thread, in order, scoped to the caller', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: '   ',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient('n/a') },
      });
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: 'download this?',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient('n/a') },
      });

      const rows = await getDatasetTurnsByThread(db, dataset.userId, threadId);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.question)).toEqual(['   ', 'download this?']);

      const messages = replayDatasetTurns(rows);
      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual({ role: 'user', text: '   ' });
    });
  });

  it('CROSS-USER: never returns another user\'s dataset turns', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: '   ',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient('n/a') },
      });
      expect(await getDatasetTurnsByThread(db, randomUUID(), threadId)).toEqual([]);
    });
  });

  it('replays a redacted thread as placeholders only, matching redactedTurnIntegrityReport\'s sentinel', async () => {
    await withDb(async (db) => {
      const { dataset, threadId } = await seed(db);
      await respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question: '   ',
        requestId: randomUUID(),
        rawState: null,
        llmOptions: { client: fakeClient('n/a') },
      });
      await deleteOneDataset(db, dataset.userId, dataset.id);
      const rows = await getDatasetTurnsByThread(db, dataset.userId, threadId);
      expect(replayDatasetTurns(rows)).toEqual([{ role: 'redacted' }]);
    });
  });
});
