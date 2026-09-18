// Co-pilot phase 2 (session 113, Task 8) — the two Server Actions the chat
// doorway calls. The backend they wrap (respondToChartEdit,
// setDatasetTurnCopilotFeedback, chargeAndRunDataset) is PGlite-tested under
// tests/attachments/; this file exercises the ACTIONS' own logic — the input
// guards, the auth gate, the dataset/thread ownership double-binding and the
// wiring — mirroring dataset-actions.test.ts's mocked-module convention.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { DatasetProfile, UserDataset } from '../backend/attachments/types.ts';

const { currentUserId, getDb } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  getDb: vi.fn<() => Db>(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));

vi.mock('../lib/error-report.ts', () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../backend/answer/llm/client.ts', () => ({ AnthropicLlmClient: vi.fn() }));

const store = vi.hoisted(() => ({
  getDataset: vi.fn(),
  setDatasetTurnCopilotFeedback: vi.fn(),
}));
vi.mock('../backend/attachments/store.ts', () => store);

const read = vi.hoisted(() => ({ isOwnChartTurn: vi.fn() }));
vi.mock('../backend/attachments/read.ts', () => read);

const threads = vi.hoisted(() => ({ validateDatasetThreadOwnership: vi.fn() }));
vi.mock('../backend/threads/index.ts', () => threads);

const gate = vi.hoisted(() => ({ chargeAndRunDataset: vi.fn() }));
vi.mock('../backend/billing/dataset-gate.ts', () => gate);

const copilot = vi.hoisted(() => ({ respondToChartEdit: vi.fn() }));
vi.mock('../backend/attachments/copilot/respond.ts', () => copilot);

import { adjustDatasetChart, submitCopilotFeedback } from './dataset-copilot-actions.ts';

const fakeDb = {} as Db;
const RID = '00000000-0000-4000-8000-000000000001';
const PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Gemeente', type: 'text', distinct: ['Amsterdam'], nulls: 0 },
    { id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', nulls: 0 },
  ],
  rowCount: 1,
};

const INSTRUCTION = {
  version: 2,
  kind: 'bar',
  x: 'c0',
  y: ['c1'],
  seriesBy: null,
  filters: [],
  sort: null,
  limit: null,
  aggregate: { fn: 'sum' },
  derived: null,
  unsupported: null,
};

const CAPABILITIES = { forms: ['bar', 'table'], presentationKeys: ['grid'], templates: ['newsroom'], lang: 'en' };

function fakeDataset(overrides: Partial<UserDataset> = {}): UserDataset {
  return {
    id: 1,
    userId: 'user-1',
    sourceKind: 'file_csv',
    displayName: 'x.csv',
    sourceUrl: null,
    cells: [['Gemeente', 'Omzet'], ['Amsterdam', '3']],
    profile: PROFILE,
    status: 'ready',
    contentSha256: 'deadbeef',
    createdAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUserId.mockResolvedValue('user-1');
  getDb.mockReturnValue(fakeDb);
  store.getDataset.mockResolvedValue(fakeDataset());
  store.setDatasetTurnCopilotFeedback.mockResolvedValue(true);
  threads.validateDatasetThreadOwnership.mockResolvedValue(42);
  read.isOwnChartTurn.mockResolvedValue(true);
  gate.chargeAndRunDataset.mockResolvedValue({ kind: 'ok', envelope: { kind: 'chart' }, auditId: 1, datasetGone: false, netCost: 4 });
});

describe('adjustDatasetChart', () => {
  it('returns unauthenticated with no session', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await adjustDatasetChart(1, 42, 7, 'hi', RID, INSTRUCTION, CAPABILITIES)).toEqual({ kind: 'unauthenticated' });
    expect(gate.chargeAndRunDataset).not.toHaveBeenCalled();
  });

  it('returns not_found when the thread/dataset pairing does not validate', async () => {
    threads.validateDatasetThreadOwnership.mockResolvedValue(null);
    expect(await adjustDatasetChart(1, 42, 7, 'hi', RID, INSTRUCTION, CAPABILITIES)).toEqual({ kind: 'not_found' });
    expect(gate.chargeAndRunDataset).not.toHaveBeenCalled();
  });

  // Final review (session 113): the turn id is bound to the caller AND this
  // thread before it can reach the stored envelope / the edits key.
  it('returns not_found when the target turn is not the callers own chart turn in this thread', async () => {
    read.isOwnChartTurn.mockResolvedValue(false);
    expect(await adjustDatasetChart(1, 42, 7, 'hi', RID, INSTRUCTION, CAPABILITIES)).toEqual({ kind: 'not_found' });
    expect(read.isOwnChartTurn).toHaveBeenCalledWith(fakeDb, 'user-1', 42, 7);
    expect(gate.chargeAndRunDataset).not.toHaveBeenCalled();
  });

  it('returns not_found when the dataset itself is gone', async () => {
    store.getDataset.mockResolvedValue(null);
    expect(await adjustDatasetChart(1, 42, 7, 'hi', RID, INSTRUCTION, CAPABILITIES)).toEqual({ kind: 'not_found' });
  });

  it('returns needs_decision with the profile when the dataset is not yet ready', async () => {
    store.getDataset.mockResolvedValue(fakeDataset({ status: 'needs_decision' }));
    expect(await adjustDatasetChart(1, 42, 7, 'hi', RID, INSTRUCTION, CAPABILITIES)).toEqual({ kind: 'needs_decision', profile: PROFILE });
    expect(gate.chargeAndRunDataset).not.toHaveBeenCalled();
  });

  it('returns not_found for a failed/redacted dataset', async () => {
    store.getDataset.mockResolvedValue(fakeDataset({ status: 'failed' }));
    expect(await adjustDatasetChart(1, 42, 7, 'hi', RID, INSTRUCTION, CAPABILITIES)).toEqual({ kind: 'not_found' });
  });

  it('charges and runs the edit turn, passing the target turn and the untrusted client state through', async () => {
    const result = await adjustDatasetChart(1, 42, 7, 'maak er een staaf van', RID, INSTRUCTION, CAPABILITIES);
    expect(result).toMatchObject({ kind: 'ok' });
    const [db, userId, requestId, run] = gate.chargeAndRunDataset.mock.calls[0]!;
    expect([db, userId, requestId]).toEqual([fakeDb, 'user-1', RID]);
    await run();
    expect(copilot.respondToChartEdit).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({
        threadId: 42,
        targetTurnId: 7,
        message: 'maak er een staaf van',
        requestId: RID,
        current: INSTRUCTION,
        capabilities: CAPABILITIES,
      }),
    );
  });

  it('injects summarizeInstruction in the language the validated capabilities asked for', async () => {
    await adjustDatasetChart(1, 42, 7, 'hi', RID, INSTRUCTION, CAPABILITIES);
    await gate.chargeAndRunDataset.mock.calls[0]![3]();
    const { summarize } = copilot.respondToChartEdit.mock.calls[0]![1] as { summarize: (i: unknown) => string };
    expect(summarize(INSTRUCTION)).toBe('Sum of Omzet by Gemeente');
  });

  it('falls back to Dutch when the claimed capabilities name no known language', async () => {
    await adjustDatasetChart(1, 42, 7, 'hi', RID, INSTRUCTION, { lang: 'klingon' });
    await gate.chargeAndRunDataset.mock.calls[0]![3]();
    const { summarize } = copilot.respondToChartEdit.mock.calls[0]![1] as { summarize: (i: unknown) => string };
    expect(summarize(INSTRUCTION)).toBe('Som van Omzet per Gemeente');
  });

  it('throws on a malformed requestId (guard, not a real UI path)', async () => {
    await expect(adjustDatasetChart(1, 42, 7, 'hi', 'not-a-uuid', INSTRUCTION, CAPABILITIES)).rejects.toThrow(/malformed requestId/);
    expect(currentUserId).not.toHaveBeenCalled();
  });

  it('throws on an oversized message (guard belt)', async () => {
    await expect(adjustDatasetChart(1, 42, 7, 'x'.repeat(501), RID, INSTRUCTION, CAPABILITIES)).rejects.toThrow(/not a string within/);
  });

  it('throws on a non-positive dataset/turn id (guard belt)', async () => {
    await expect(adjustDatasetChart(0, 42, 7, 'hi', RID, INSTRUCTION, CAPABILITIES)).rejects.toThrow(/datasetId/);
    await expect(adjustDatasetChart(1, 42, -1, 'hi', RID, INSTRUCTION, CAPABILITIES)).rejects.toThrow(/targetTurnId/);
  });
});

describe('submitCopilotFeedback', () => {
  it('returns ok: false with no session, without touching the store', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await submitCopilotFeedback(9, 'up')).toEqual({ ok: false });
    expect(store.setDatasetTurnCopilotFeedback).not.toHaveBeenCalled();
  });

  it('records the vote against the caller\'s own turn', async () => {
    expect(await submitCopilotFeedback(9, 'down')).toEqual({ ok: true });
    expect(store.setDatasetTurnCopilotFeedback).toHaveBeenCalledWith(fakeDb, 'user-1', 9, 'down');
  });

  it('reports ok: false for a turn that is not the caller\'s (indistinguishable from absent)', async () => {
    store.setDatasetTurnCopilotFeedback.mockResolvedValue(false);
    expect(await submitCopilotFeedback(9, 'up')).toEqual({ ok: false });
  });

  it('throws on a malformed vote or turn id (guards, not real UI paths)', async () => {
    await expect(submitCopilotFeedback(9, 'sideways' as 'up')).rejects.toThrow(/vote/);
    await expect(submitCopilotFeedback('9' as unknown as number, 'up')).rejects.toThrow(/turnId/);
  });
});
