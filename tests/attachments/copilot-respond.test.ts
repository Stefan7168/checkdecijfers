// respondToChartEdit — the co-pilot's credited turn (session 113, co-pilot
// phase 2). Hermetic (PGlite) with a fake LlmClient, exactly the
// respond.test.ts pattern: every outcome writes exactly ONE dataset_turns
// row and returns a matching AuditedDatasetTurn.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import { COPILOT_PROMPT_VERSION } from '../../src/attachments/copilot/prompt.ts';
import { respondToChartEdit } from '../../src/attachments/copilot/respond.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import { insertDataset, setDatasetTurnCopilotFeedback } from '../../src/attachments/store.ts';
import { toClientInstruction, type ClientChartInstruction, type UserDataset } from '../../src/attachments/types.ts';
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

const CELLS = [
  ['Year', 'City', 'Revenue'],
  ['2020', 'Amsterdam', '120'],
  ['2021', 'Amsterdam', '150'],
  ['2020', 'Rotterdam', '90'],
  ['2021', 'Rotterdam', '70'],
];

async function seed(db: Db): Promise<{ dataset: UserDataset; threadId: number; userId: string }> {
  const userId = randomUUID();
  const dataset = await insertDataset(db, {
    userId,
    sourceKind: 'file_csv',
    displayName: 'omzet.csv',
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
  const { rows } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [userId]);
  return { dataset, threadId: Number(rows[0]!.id), userId };
}

const CURRENT: ClientChartInstruction = {
  version: 2,
  kind: 'line',
  x: 'c0',
  y: ['c2'],
  seriesBy: 'c1',
  filters: [],
  sort: null,
  limit: null,
  aggregate: null,
  derived: null,
  unsupported: null,
};

const CAPABILITIES = {
  forms: ['line', 'bar', 'table'],
  presentationKeys: ['lineWidth', 'grid'],
  templates: ['standard', 'newsroom'],
  lang: 'nl',
};

function fakeClient(outputText: string): { client: LlmClient; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    client: {
      complete: async (request: LlmRequest): Promise<LlmResponse> => {
        calls.push(request);
        return {
          outputText,
          model: 'claude-haiku-4-5',
          stopReason: 'end_turn',
          usage: { inputTokens: 11, outputTokens: 5 },
        };
      },
    },
  };
}

function copilotReply(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    instruction: null,
    view: [],
    refused: [],
    confidence: 0.95,
    reading: 'A style change.',
    ...fields,
  });
}

function instruction(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    kind: 'bar',
    x: 'c0',
    y: ['c2'],
    seriesBy: 'c1',
    filters: [],
    sort: null,
    limit: null,
    aggregate: { fn: 'sum' },
    derived: null,
    confidence: 0.95,
    reading: 'Total revenue per year.',
    unsupported: null,
    ...fields,
  };
}

async function turnRows(db: Db, datasetId: number) {
  const { rows } = await db.query(
    'select id, kind, envelope, chart_emitted, prompt_versions, input_tokens from dataset_turns where dataset_id = $1',
    [datasetId],
  );
  return rows;
}

const summarize = (i: ClientChartInstruction) => `chart of ${i.y.join(',')} by ${i.x}`;

describe('respondToChartEdit — the happy path', () => {
  it('writes ONE chart turn whose copilot envelope holds setInstruction then setForm', async () => {
    const db = sharedDb;
    const { dataset, threadId } = await seed(db);
    const { client, calls } = fakeClient(
      copilotReply({ instruction: instruction(), view: [{ kind: 'setForm', form: 'bar' }] }),
    );
    const result = await respondToChartEdit(db, {
      dataset,
      threadId,
      targetTurnId: 42,
      message: 'maak er een staafdiagram van met totalen',
      requestId: randomUUID(),
      current: CURRENT,
      capabilities: CAPABILITIES,
      llmOptions: { client },
      summarize,
    });

    expect(calls).toHaveLength(1);
    expect(result.envelope.kind).toBe('chart');
    const rows = await turnRows(db, dataset.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]! as Record<string, any>;
    expect(row.kind).toBe('chart');
    expect(row.chart_emitted).toBe(true);
    expect(row.prompt_versions.copilot).toBe(COPILOT_PROMPT_VERSION);
    expect(row.input_tokens).toBe(11);
    expect(row.envelope.copilot.commands.map((c: { kind: string }) => c.kind)).toEqual([
      'setInstruction',
      'setForm',
    ]);
    expect(row.envelope.copilot.refused).toEqual([]);
    expect(row.envelope.copilot.targetTurnId).toBe(42);
    expect(row.envelope.copilot.feedback).toBeNull();
    expect(row.envelope.copilot.message).toBe('maak er een staafdiagram van met totalen');
    // The envelope's chart is the chart AFTER the new instruction.
    expect(row.envelope.instruction.aggregate).toEqual({ fn: 'sum' });
    expect(row.envelope.state.lastInstruction).toEqual(
      toClientInstruction(row.envelope.instruction),
    );
    expect(row.envelope.text).not.toMatch(/[0-9]/);
  });

  it('keeps the current instruction when the model changes only the view', async () => {
    const db = sharedDb;
    const { dataset, threadId } = await seed(db);
    const { client } = fakeClient(copilotReply({ view: [{ kind: 'resetPresentation' }] }));
    const result = await respondToChartEdit(db, {
      dataset,
      threadId,
      targetTurnId: 1,
      message: 'terug naar de standaardstijl',
      requestId: randomUUID(),
      current: CURRENT,
      capabilities: CAPABILITIES,
      llmOptions: { client },
      summarize,
    });
    const envelope = result.envelope as Extract<typeof result.envelope, { kind: 'chart' }>;
    expect(envelope.state.lastInstruction).toEqual(CURRENT);
    expect(envelope.copilot?.commands).toEqual([{ kind: 'resetPresentation' }]);
  });
});

describe('respondToChartEdit — refusals and clarifications', () => {
  it('refuses a stale current instruction WITHOUT calling the model', async () => {
    const db = sharedDb;
    const { dataset, threadId } = await seed(db);
    const { client, calls } = fakeClient('should never be called');
    const result = await respondToChartEdit(db, {
      dataset,
      threadId,
      targetTurnId: 1,
      message: 'maak de lijn dikker',
      requestId: randomUUID(),
      current: { ...CURRENT, y: ['c7'] },
      capabilities: CAPABILITIES,
      llmOptions: { client },
      summarize,
    });
    expect(calls).toHaveLength(0);
    expect(result.envelope).toMatchObject({ kind: 'refusal', reason: 'internal' });
    expect(await turnRows(db, dataset.id)).toHaveLength(1);
  });

  it('refuses an empty message without calling the model', async () => {
    const db = sharedDb;
    const { dataset, threadId } = await seed(db);
    const { client, calls } = fakeClient('should never be called');
    const result = await respondToChartEdit(db, {
      dataset,
      threadId,
      targetTurnId: 1,
      message: '   ',
      requestId: randomUUID(),
      current: CURRENT,
      capabilities: CAPABILITIES,
      llmOptions: { client },
      summarize,
    });
    expect(calls).toHaveLength(0);
    expect(result.envelope).toMatchObject({ kind: 'refusal', reason: 'empty_question' });
  });

  it('refuses a title carrying a number that is not on the chart', async () => {
    const db = sharedDb;
    const { dataset, threadId } = await seed(db);
    const { client } = fakeClient(
      copilotReply({ view: [{ kind: 'setTitle', title: 'Omzet stijgt met 12 procent' }] }),
    );
    await respondToChartEdit(db, {
      dataset,
      threadId,
      targetTurnId: 1,
      message: 'zet een titel boven de grafiek',
      requestId: randomUUID(),
      current: CURRENT,
      capabilities: CAPABILITIES,
      llmOptions: { client },
      summarize,
    });
    const row = (await turnRows(db, dataset.id))[0]! as Record<string, any>;
    expect(row.envelope.copilot.commands).toEqual([]);
    expect(row.envelope.copilot.refused).toEqual([
      { request: 'Omzet stijgt met 12 procent', reason: 'unplotted_number', control: 'none' },
    ]);
    expect(row.envelope.text).toContain('Nothing applied');
  });

  it('clarifies on low confidence', async () => {
    const db = sharedDb;
    const { dataset, threadId } = await seed(db);
    const { client } = fakeClient(copilotReply({ confidence: 0.2 }));
    const result = await respondToChartEdit(db, {
      dataset,
      threadId,
      targetTurnId: 1,
      message: 'doe iets moois',
      requestId: randomUUID(),
      current: CURRENT,
      capabilities: CAPABILITIES,
      llmOptions: { client },
      summarize,
    });
    expect(result.envelope).toMatchObject({ kind: 'clarification', reason: 'low_confidence' });
  });

  it('clarifies when the model output fails validation, and still records the call', async () => {
    const db = sharedDb;
    const { dataset, threadId } = await seed(db);
    const { client } = fakeClient(copilotReply({ view: [{ kind: 'setZoom' }] }));
    const result = await respondToChartEdit(db, {
      dataset,
      threadId,
      targetTurnId: 1,
      message: 'zoom in',
      requestId: randomUUID(),
      current: CURRENT,
      capabilities: CAPABILITIES,
      llmOptions: { client },
      summarize,
    });
    expect(result.envelope).toMatchObject({ kind: 'clarification', reason: 'validation' });
    const row = (await turnRows(db, dataset.id))[0]! as Record<string, any>;
    expect(row.input_tokens).toBe(11);
  });

  it('drops a capability the client never offered instead of echoing it', async () => {
    const db = sharedDb;
    const { dataset, threadId } = await seed(db);
    const { client, calls } = fakeClient(copilotReply());
    await respondToChartEdit(db, {
      dataset,
      threadId,
      targetTurnId: 1,
      message: 'maak het mooi',
      requestId: randomUUID(),
      current: CURRENT,
      capabilities: { forms: ['line', 'hologram'], presentationKeys: ['grid', 'wobble'], templates: ['neon'], lang: 'fr' },
      llmOptions: { client },
      summarize,
    });
    const prompt = calls[0]!.question;
    expect(prompt).not.toContain('hologram');
    expect(prompt).not.toContain('wobble');
    expect(prompt).not.toContain('neon');
    expect(prompt).toContain('lang=nl');
  });
});

describe('setDatasetTurnCopilotFeedback', () => {
  it('flips the stored feedback for the owner only', async () => {
    const db = sharedDb;
    const { dataset, threadId, userId } = await seed(db);
    const { client } = fakeClient(copilotReply({ view: [{ kind: 'setForm', form: 'bar' }] }));
    const result = await respondToChartEdit(db, {
      dataset,
      threadId,
      targetTurnId: 1,
      message: 'staafdiagram',
      requestId: randomUUID(),
      current: CURRENT,
      capabilities: CAPABILITIES,
      llmOptions: { client },
      summarize,
    });
    const turnId = result.auditId!;

    expect(await setDatasetTurnCopilotFeedback(db, randomUUID(), turnId, 'down')).toBe(false);
    expect(await setDatasetTurnCopilotFeedback(db, userId, turnId, 'down')).toBe(true);

    const row = (await turnRows(db, dataset.id))[0]! as Record<string, any>;
    expect(row.envelope.copilot.feedback).toBe('down');
    // Nothing else in the envelope moved.
    expect(row.envelope.copilot.commands).toHaveLength(1);
  });

  it('returns false for a turn with no copilot envelope', async () => {
    const db = sharedDb;
    const { dataset, threadId, userId } = await seed(db);
    const { rows } = await db.query(
      `insert into dataset_turns (user_id, dataset_id, thread_id, request_id, kind, question, envelope,
         final_text, chart_emitted, prompt_versions, llm_calls, input_tokens, output_tokens, latency_ms)
       values ($1::uuid, $2, $3, $4, 'refusal', 'q', '{"schemaVersion":1,"kind":"refusal"}'::jsonb, 't',
         false, '{}'::jsonb, '[]'::jsonb, 0, 0, 0) returning id`,
      [userId, dataset.id, threadId, randomUUID()],
    );
    expect(await setDatasetTurnCopilotFeedback(db, userId, Number(rows[0]!.id), 'up')).toBe(false);
  });
});
