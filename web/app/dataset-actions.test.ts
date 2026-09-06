// ADR 037 D8/D5/D13 — the dataset-actions.ts Server Action wire, hermetic.
// The backend it wraps (respond.ts, store.ts, chargeAndRunDataset,
// retention.ts, profile.ts) is already thoroughly PGlite-tested under
// tests/attachments/ — this file exercises the ACTION's own logic: auth
// gating, ownership double-binding (dataset AND thread), the ingest-time
// business rules (file type/size/quota), and correct wiring to the backend,
// mirroring the mocked-module convention of actions.test.ts/trial-actions.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  activeDatasetUsage: vi.fn(),
  getDataset: vi.fn(),
  insertDataset: vi.fn(),
  resolveDatasetDecision: vi.fn(),
}));
vi.mock('../backend/attachments/store.ts', () => store);

const threads = vi.hoisted(() => ({
  createDatasetThread: vi.fn(),
  validateDatasetThreadOwnership: vi.fn(),
}));
vi.mock('../backend/threads/index.ts', () => threads);

const retention = vi.hoisted(() => ({ deleteOneDataset: vi.fn() }));
vi.mock('../backend/attachments/retention.ts', () => retention);

const gate = vi.hoisted(() => ({ chargeAndRunDataset: vi.fn() }));
vi.mock('../backend/billing/dataset-gate.ts', () => gate);

const respond = vi.hoisted(() => ({ respondToDatasetQuestion: vi.fn() }));
vi.mock('../backend/attachments/respond.ts', () => respond);

// ingest/csv.ts, ingest/profile.ts stay REAL — pure, deterministic, and
// realistic test fixtures are cheaper to write as actual CSV text than to
// hand-construct a ParsedCsv/DatasetProfile mock for every case.

import {
  askDataset,
  decideDatasetFormat,
  deleteMyDataset,
  ingestFile,
} from './dataset-actions.ts';

const fakeDb = {} as Db;
const RID = '00000000-0000-4000-8000-000000000001';
const MINIMAL_PROFILE: DatasetProfile = { columns: [], rowCount: 0 };

function csvFile(content: string, name = 'x.csv'): FormData {
  const fd = new FormData();
  fd.set('file', new File([content], name, { type: 'text/csv' }));
  return fd;
}

function fakeDataset(overrides: Partial<UserDataset> = {}): UserDataset {
  return {
    id: 1,
    userId: 'user-1',
    sourceKind: 'file_csv',
    displayName: 'x.csv',
    sourceUrl: null,
    cells: [['Year'], ['2020']],
    profile: MINIMAL_PROFILE,
    status: 'ready',
    contentSha256: 'deadbeef',
    createdAt: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  getDb.mockReturnValue(fakeDb);
  store.activeDatasetUsage.mockResolvedValue({ count: 0, totalBytes: 0 });
  store.insertDataset.mockResolvedValue(fakeDataset());
  threads.createDatasetThread.mockResolvedValue(42);
  threads.validateDatasetThreadOwnership.mockResolvedValue(42);
  store.getDataset.mockResolvedValue(fakeDataset());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ingestFile', () => {
  it('returns unauthenticated with no session', async () => {
    currentUserId.mockResolvedValue(null);
    const result = await ingestFile(csvFile('Year\n2020\n'));
    expect(result).toEqual({ kind: 'unauthenticated' });
    expect(store.insertDataset).not.toHaveBeenCalled();
  });

  it('refuses an unsupported file extension without touching the db', async () => {
    const result = await ingestFile(csvFile('a,b\n1,2\n', 'x.xlsx'));
    expect(result).toMatchObject({ kind: 'refused' });
    expect(store.insertDataset).not.toHaveBeenCalled();
  });

  it('refuses when the file exceeds MAX_FILE_BYTES', async () => {
    const huge = 'a'.repeat(4 * 1024 * 1024 + 1);
    const result = await ingestFile(csvFile(huge));
    expect(result).toMatchObject({ kind: 'refused' });
    expect(store.activeDatasetUsage).not.toHaveBeenCalled();
  });

  it('refuses when the per-user dataset COUNT quota is exceeded', async () => {
    store.activeDatasetUsage.mockResolvedValue({ count: 25, totalBytes: 0 });
    const result = await ingestFile(csvFile('Year\n2020\n'));
    expect(result).toMatchObject({ kind: 'refused' });
    expect(store.insertDataset).not.toHaveBeenCalled();
  });

  it('refuses when the per-user BYTES quota is exceeded', async () => {
    store.activeDatasetUsage.mockResolvedValue({ count: 0, totalBytes: 50 * 1024 * 1024 - 5 });
    const result = await ingestFile(csvFile('Year\n2020\n'));
    expect(result).toMatchObject({ kind: 'refused' });
    expect(store.insertDataset).not.toHaveBeenCalled();
  });

  it('refuses a CSV whose shape trips a parseCsv cap (real parser, not mocked)', async () => {
    // A header cell longer than MAX_HEADER_CHARS (40) — a real CsvTooLargeError.
    const result = await ingestFile(csvFile(`${'h'.repeat(41)}\n1\n`));
    expect(result).toMatchObject({ kind: 'refused' });
    expect(store.insertDataset).not.toHaveBeenCalled();
  });

  it('ingests a clean CSV as status ready with no ambiguous columns', async () => {
    const result = await ingestFile(csvFile('Year,City\n2020,Amsterdam\n2021,Rotterdam\n'));
    expect(result).toMatchObject({ kind: 'ok', status: 'ready', ambiguousColumnIds: [] });
    expect(store.insertDataset).toHaveBeenCalledTimes(1);
    const params = store.insertDataset.mock.calls[0]![1];
    expect(params).toMatchObject({ userId: 'user-1', sourceKind: 'file_csv', status: 'ready', requestId: null });
    expect(threads.createDatasetThread).toHaveBeenCalledWith(fakeDb, 'user-1', fakeDataset().id);
  });

  it('ingests a .tsv file as sourceKind file_tsv', async () => {
    await ingestFile(csvFile('Year\tCity\n2020\tAmsterdam\n', 'x.tsv'));
    const params = store.insertDataset.mock.calls[0]![1];
    expect(params).toMatchObject({ sourceKind: 'file_tsv' });
  });

  it('sets status to needs_decision when a column is numerically ambiguous', async () => {
    const result = await ingestFile(csvFile('Omzet\n9.800\n1.500\n'));
    expect(result).toMatchObject({ kind: 'ok', status: 'needs_decision', ambiguousColumnIds: ['c0'] });
    const params = store.insertDataset.mock.calls[0]![1];
    expect(params).toMatchObject({ status: 'needs_decision' });
  });

  it('rejects a non-File "file" field as a guard-clause throw', async () => {
    const fd = new FormData();
    fd.set('file', 'not-a-file');
    await expect(ingestFile(fd)).rejects.toThrow(/no file received/);
  });
});

describe('decideDatasetFormat', () => {
  beforeEach(() => {
    store.getDataset.mockResolvedValue(
      fakeDataset({ status: 'needs_decision', profile: { columns: [{ id: 'c0', header: 'Omzet', type: 'number', numberFormat: 'ambiguous', nulls: 0 }], rowCount: 2 }, cells: [['Omzet'], ['9.800'], ['1.500']] }),
    );
    store.resolveDatasetDecision.mockResolvedValue(true);
  });

  it('returns unauthenticated with no session', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await decideDatasetFormat(1, { c0: 'nl' })).toEqual({ kind: 'unauthenticated' });
  });

  it('returns nothing_to_decide when the dataset does not exist', async () => {
    store.getDataset.mockResolvedValue(null);
    expect(await decideDatasetFormat(1, { c0: 'nl' })).toEqual({ kind: 'nothing_to_decide' });
  });

  it('returns nothing_to_decide when the dataset is already ready', async () => {
    store.getDataset.mockResolvedValue(fakeDataset({ status: 'ready' }));
    expect(await decideDatasetFormat(1, { c0: 'nl' })).toEqual({ kind: 'nothing_to_decide' });
  });

  it('returns nothing_to_decide when resolveDatasetDecision loses the U12 race', async () => {
    store.resolveDatasetDecision.mockResolvedValue(false);
    expect(await decideDatasetFormat(1, { c0: 'nl' })).toEqual({ kind: 'nothing_to_decide' });
  });

  it('resolves the ambiguous column and returns the new profile', async () => {
    const result = await decideDatasetFormat(1, { c0: 'nl' });
    expect(result).toMatchObject({ kind: 'ok' });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.profile.columns[0]).toMatchObject({ numberFormat: 'nl' });
    expect(store.resolveDatasetDecision).toHaveBeenCalledWith(fakeDb, 'user-1', 1, expect.any(Array), result.profile);
  });

  it('throws on a malformed decision value (not a real UI path)', async () => {
    await expect(decideDatasetFormat(1, { c0: 'invalid' })).rejects.toThrow(/invalid decision/);
  });
});

describe('askDataset', () => {
  beforeEach(() => {
    gate.chargeAndRunDataset.mockResolvedValue({ kind: 'ok', envelope: { kind: 'chart' }, auditId: 1, datasetGone: false, netCost: 5 });
  });

  it('returns unauthenticated with no session', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await askDataset(1, 42, 'hi', RID, null)).toEqual({ kind: 'unauthenticated' });
  });

  it('returns not_found when the thread/dataset pairing does not validate', async () => {
    threads.validateDatasetThreadOwnership.mockResolvedValue(null);
    expect(await askDataset(1, 42, 'hi', RID, null)).toEqual({ kind: 'not_found' });
    expect(gate.chargeAndRunDataset).not.toHaveBeenCalled();
  });

  it('returns not_found when the dataset itself is gone', async () => {
    store.getDataset.mockResolvedValue(null);
    expect(await askDataset(1, 42, 'hi', RID, null)).toEqual({ kind: 'not_found' });
  });

  it('returns needs_decision with the profile when the dataset is not yet ready', async () => {
    const profile = { columns: [], rowCount: 0 };
    store.getDataset.mockResolvedValue(fakeDataset({ status: 'needs_decision', profile }));
    expect(await askDataset(1, 42, 'hi', RID, null)).toEqual({ kind: 'needs_decision', profile });
    expect(gate.chargeAndRunDataset).not.toHaveBeenCalled();
  });

  it('returns not_found for a failed/redacted dataset', async () => {
    store.getDataset.mockResolvedValue(fakeDataset({ status: 'failed' }));
    expect(await askDataset(1, 42, 'hi', RID, null)).toEqual({ kind: 'not_found' });
  });

  it('charges and runs the turn on a ready dataset', async () => {
    const result = await askDataset(1, 42, 'hi', RID, null);
    expect(result).toMatchObject({ kind: 'ok' });
    expect(gate.chargeAndRunDataset).toHaveBeenCalledTimes(1);
    const [db, userId, requestId, run] = gate.chargeAndRunDataset.mock.calls[0]!;
    expect(db).toBe(fakeDb);
    expect(userId).toBe('user-1');
    expect(requestId).toBe(RID);
    await run();
    expect(respond.respondToDatasetQuestion).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ threadId: 42, question: 'hi', requestId: RID, rawState: null }),
    );
  });

  it('throws on a malformed requestId (guard, not a real UI path)', async () => {
    await expect(askDataset(1, 42, 'hi', 'not-a-uuid', null)).rejects.toThrow(/malformed requestId/);
    expect(currentUserId).not.toHaveBeenCalled();
  });

  it('throws on an oversized question (guard belt)', async () => {
    await expect(askDataset(1, 42, 'x'.repeat(2001), RID, null)).rejects.toThrow(/not a string within/);
  });
});

describe('deleteMyDataset', () => {
  it('throws when not authenticated', async () => {
    currentUserId.mockResolvedValue(null);
    await expect(deleteMyDataset(1)).rejects.toThrow(/not authenticated/);
    expect(retention.deleteOneDataset).not.toHaveBeenCalled();
  });

  it('delegates to deleteOneDataset, bound by the session user', async () => {
    retention.deleteOneDataset.mockResolvedValue(true);
    expect(await deleteMyDataset(1)).toEqual({ deleted: true });
    expect(retention.deleteOneDataset).toHaveBeenCalledWith(fakeDb, 'user-1', 1);
  });

  it('returns deleted: false for a nonexistent/foreign id, never throws', async () => {
    retention.deleteOneDataset.mockResolvedValue(false);
    expect(await deleteMyDataset(999)).toEqual({ deleted: false });
  });
});
