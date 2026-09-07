// ADR 037 D10: loadMyThread's own dedicated test — a design-doc-named gap
// (every web-level test previously mocked actions.ts wholesale, so this
// dispatch logic itself had zero coverage). Verifies: a CBS thread
// (getThreadDatasetId -> null) takes today's replay path unchanged; a
// dataset thread (getThreadDatasetId -> a number) takes the new dataset
// path and never touches the CBS replay machinery; a deleted dataset
// degrades to the empty result exactly like an unowned/forged thread id.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';

const { currentUserId, getDb } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  getDb: vi.fn<() => Db>(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));
vi.mock('../lib/error-report.ts', () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

const threads = vi.hoisted(() => ({
  validateThreadOwnership: vi.fn(),
  attachOrCreateThread: vi.fn(),
  listThreads: vi.fn(),
  getThreadRows: vi.fn(),
  getThreadDatasetId: vi.fn(),
}));
vi.mock('../backend/threads/index.ts', () => threads);

const threadReplay = vi.hoisted(() => ({
  rebuildContext: vi.fn(),
  replayParts: vi.fn(),
}));
vi.mock('../backend/threads/replay.ts', () => threadReplay);

vi.mock('../lib/replay-assemble.ts', () => ({ assembleMessages: vi.fn(() => []) }));

vi.mock('../backend/answer/context/index.ts', () => ({
  validateConversationContext: vi.fn().mockResolvedValue(null),
  buildConversationContext: vi.fn().mockResolvedValue(null),
}));

const datasetRead = vi.hoisted(() => ({ getDatasetTurnsByThread: vi.fn() }));
vi.mock('../backend/attachments/read.ts', () => datasetRead);

const datasetReplay = vi.hoisted(() => ({ replayDatasetTurns: vi.fn(), lastChartState: vi.fn() }));
vi.mock('../backend/attachments/replay.ts', () => datasetReplay);

const datasetStore = vi.hoisted(() => ({ getDataset: vi.fn() }));
vi.mock('../backend/attachments/store.ts', () => datasetStore);

// The rest of actions.ts's module graph (billing/audit/websearch/onboarding)
// is irrelevant to loadMyThread but must still resolve for the module to
// import cleanly.
vi.mock('../backend/billing/index.ts', () => ({
  chargeAndRun: vi.fn(),
  compensate: vi.fn(),
  getActionClassPrice: vi.fn(),
  getBalance: vi.fn(),
  reserveWebSearchDebit: vi.fn(),
}));
vi.mock('../backend/answer/audit/index.ts', () => ({
  answerQuestionAudited: vi.fn(),
  answerClarificationReplyAudited: vi.fn(),
  deleteUserQuestionHistory: vi.fn(),
  FEEDBACK_TEXT_MAX_LENGTH: 2000,
  upsertAnswerFeedback: vi.fn(),
}));
vi.mock('../backend/answer/llm/client.ts', () => ({ AnthropicLlmClient: vi.fn() }));
vi.mock('../backend/websearch/index.ts', () => ({ AnthropicWebSearchClient: vi.fn() }));

import { loadMyThread } from './actions.ts';

const fakeDb = {} as Db;

beforeEach(() => {
  getDb.mockReturnValue(fakeDb);
  currentUserId.mockResolvedValue('user-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('loadMyThread — dispatch (ADR 037 D10)', () => {
  it('returns the empty result when unauthenticated, touching nothing else', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await loadMyThread(1)).toEqual({ kind: 'empty' });
    expect(threads.validateThreadOwnership).not.toHaveBeenCalled();
  });

  it('returns the empty result for an unowned/forged thread id', async () => {
    threads.validateThreadOwnership.mockResolvedValue(null);
    expect(await loadMyThread(999)).toEqual({ kind: 'empty' });
    expect(threads.getThreadDatasetId).not.toHaveBeenCalled();
  });

  it('a CBS thread (getThreadDatasetId -> null) takes the CBS replay path unchanged', async () => {
    threads.validateThreadOwnership.mockResolvedValue(7);
    threads.getThreadDatasetId.mockResolvedValue(null);
    threads.getThreadRows.mockResolvedValue(['row']);
    threadReplay.replayParts.mockReturnValue(['part']);
    threadReplay.rebuildContext.mockResolvedValue(null);

    const result = await loadMyThread(7);
    expect(result).toMatchObject({ kind: 'cbs', threadId: 7 });
    expect(threads.getThreadRows).toHaveBeenCalledWith(fakeDb, 'user-1', 7);
    expect(datasetRead.getDatasetTurnsByThread).not.toHaveBeenCalled();
    expect(datasetStore.getDataset).not.toHaveBeenCalled();
  });

  it('a dataset thread (getThreadDatasetId -> a number) takes the dataset path, never the CBS one', async () => {
    threads.validateThreadOwnership.mockResolvedValue(7);
    threads.getThreadDatasetId.mockResolvedValue(3);
    datasetStore.getDataset.mockResolvedValue({
      id: 3,
      userId: 'user-1',
      sourceKind: 'file_csv',
      displayName: 'x.csv',
      sourceUrl: null,
      cells: [],
      profile: { columns: [], rowCount: 0 },
      status: 'ready',
      contentSha256: 'x',
      createdAt: '2026-01-01',
    });
    datasetRead.getDatasetTurnsByThread.mockResolvedValue(['turn']);
    datasetReplay.replayDatasetTurns.mockReturnValue([{ role: 'user', text: 'hi' }]);
    datasetReplay.lastChartState.mockReturnValue(null);

    const result = await loadMyThread(7);
    expect(result).toEqual({
      kind: 'dataset',
      threadId: 7,
      datasetId: 3,
      displayName: 'x.csv',
      status: 'ready',
      profile: { columns: [], rowCount: 0 },
      messages: [{ role: 'user', text: 'hi' }],
      rawState: null,
    });
    expect(datasetStore.getDataset).toHaveBeenCalledWith(fakeDb, 'user-1', 3);
    expect(datasetRead.getDatasetTurnsByThread).toHaveBeenCalledWith(fakeDb, 'user-1', 7);
    expect(threads.getThreadRows).not.toHaveBeenCalled();
    expect(threadReplay.replayParts).not.toHaveBeenCalled();
  });

  it('carries the last chart turn\'s state as the resumed rawState referent', async () => {
    threads.validateThreadOwnership.mockResolvedValue(7);
    threads.getThreadDatasetId.mockResolvedValue(3);
    datasetStore.getDataset.mockResolvedValue({
      id: 3,
      userId: 'user-1',
      sourceKind: 'file_csv',
      displayName: 'x.csv',
      sourceUrl: null,
      cells: [],
      profile: { columns: [], rowCount: 0 },
      status: 'ready',
      contentSha256: 'x',
      createdAt: '2026-01-01',
    });
    datasetRead.getDatasetTurnsByThread.mockResolvedValue(['turn']);
    datasetReplay.replayDatasetTurns.mockReturnValue([]);
    const lastInstruction = { version: 1, kind: 'line', x: 'c0', y: ['c1'], seriesBy: null, filters: [], sort: null, limit: null, unsupported: null };
    datasetReplay.lastChartState.mockReturnValue({ datasetId: 3, lastInstruction });

    const result = await loadMyThread(7);
    expect(result).toMatchObject({ kind: 'dataset', rawState: { datasetId: 3, lastInstruction } });
  });

  it('a dataset thread whose dataset no longer exists degrades to the empty result', async () => {
    threads.validateThreadOwnership.mockResolvedValue(7);
    threads.getThreadDatasetId.mockResolvedValue(3);
    datasetStore.getDataset.mockResolvedValue(null);

    expect(await loadMyThread(7)).toEqual({ kind: 'empty' });
    expect(datasetRead.getDatasetTurnsByThread).not.toHaveBeenCalled();
  });

  it('an unexpected error anywhere degrades to the empty result, never throws', async () => {
    threads.validateThreadOwnership.mockResolvedValue(7);
    threads.getThreadDatasetId.mockRejectedValue(new Error('db blip'));
    expect(await loadMyThread(7)).toEqual({ kind: 'empty' });
  });
});
