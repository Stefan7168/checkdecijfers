// Own-data publish (ADR 057, session 127, Task 3) — TDD for the
// publish/unpublish/get Server Actions. Mocking follows web/app/embed-actions.test.ts's
// own pattern: vi.hoisted + vi.mock for every I/O boundary this module
// touches, so the pure control flow (fail-closed order, forbidden/invalid/
// changed/limit/unavailable/error mapping) is exercised hermetically.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { DatasetTurnRecord, UserDataset } from '../backend/attachments/types.ts';
import type { PublicationRow } from '../backend/attachments/publications.ts';
import type { BuildPublishedChartResult } from '../lib/own-chart-publication.ts';

const { currentUserId } = vi.hoisted(() => ({ currentUserId: vi.fn<() => Promise<string | null>>() }));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn<() => Db>() }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const { getDatasetTurnById } = vi.hoisted(() => ({ getDatasetTurnById: vi.fn() }));
vi.mock('../backend/attachments/read.ts', () => ({ getDatasetTurnById }));

const { getDataset } = vi.hoisted(() => ({ getDataset: vi.fn() }));
vi.mock('../backend/attachments/store.ts', () => ({ getDataset }));

const {
  upsertPublication,
  getPublicationForTurn,
  deletePublicationForTurn,
  countPublications,
} = vi.hoisted(() => ({
  upsertPublication: vi.fn(),
  getPublicationForTurn: vi.fn(),
  deletePublicationForTurn: vi.fn(),
  countPublications: vi.fn(),
}));
vi.mock('../backend/attachments/publications.ts', () => ({
  upsertPublication,
  getPublicationForTurn,
  deletePublicationForTurn,
  countPublications,
  MAX_PUBLICATIONS_PER_USER: 50,
  PUBLICATION_SOURCE_LINE_MAX: 120,
}));

const { buildPublishedChart } = vi.hoisted(() => ({ buildPublishedChart: vi.fn() }));
vi.mock('../lib/own-chart-publication.ts', () => ({ buildPublishedChart }));

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));

import {
  getOwnChartPublication,
  normalizeSourceLine,
  publishOwnChart,
  unpublishOwnChart,
} from './own-chart-publish-actions.ts';

const DB = {} as Db;

const TURN: DatasetTurnRecord = {
  id: 7,
  userId: 'user-1',
  datasetId: 42,
  threadId: 1,
  requestId: 'req-1',
  kind: 'chart',
  question: 'q',
  envelope: { schemaVersion: 1, kind: 'chart', question: 'q', text: 't', instruction: {} } as unknown as DatasetTurnRecord['envelope'],
  finalText: 't',
  instruction: {} as unknown as DatasetTurnRecord['instruction'],
  chartEmitted: true,
  promptVersions: {},
  llmCalls: [],
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 0,
  createdAt: '2026-09-24T00:00:00Z',
};

const DATASET: UserDataset = {
  id: 42,
  userId: 'user-1',
  sourceKind: 'file_csv',
  displayName: 'x.csv',
  sourceUrl: null,
  cells: [['a']],
  profile: {} as unknown as UserDataset['profile'],
  status: 'ready',
  contentSha256: 'abc',
  createdAt: '2026-09-24T00:00:00Z',
};

const BUILT_OK: Extract<BuildPublishedChartResult, { ok: true }> = {
  ok: true,
  state: {} as unknown as Extract<BuildPublishedChartResult, { ok: true }>['state'],
  spec: {} as unknown as Extract<BuildPublishedChartResult, { ok: true }>['spec'],
  dataset: DATASET,
  dropped: 0,
};

function publicationRow(overrides: Partial<PublicationRow> = {}): PublicationRow {
  return {
    id: 1,
    publicId: 'a'.repeat(22),
    userId: 'user-1',
    datasetId: 42,
    datasetTurnId: 7,
    log: [],
    sourceLine: null,
    createdAt: '2026-09-24T00:00:00Z',
    updatedAt: '2026-09-24T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  process.env.OWN_DATA_PUBLISH_ENABLED = '1';
  getDb.mockReturnValue(DB);
  currentUserId.mockResolvedValue('user-1');
  getDatasetTurnById.mockResolvedValue(TURN);
  getDataset.mockResolvedValue(DATASET);
  buildPublishedChart.mockReturnValue(BUILT_OK);
  getPublicationForTurn.mockResolvedValue(null);
  countPublications.mockResolvedValue(0);
  upsertPublication.mockResolvedValue({ publicId: 'new-public-id-xxxxxx' });
  deletePublicationForTurn.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.OWN_DATA_PUBLISH_ENABLED;
});

describe('publishOwnChart', () => {
  it('refuses when the flag is unset, never calling currentUserId', async () => {
    vi.stubEnv('OWN_DATA_PUBLISH_ENABLED', '');
    const result = await publishOwnChart(7, [], null);
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(currentUserId).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('refuses a signed-out caller', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await publishOwnChart(7, [], null)).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(getDatasetTurnById).not.toHaveBeenCalled();
  });

  it.each([
    ['the turn does not exist', () => getDatasetTurnById.mockResolvedValue(null)],
    ['the turn belongs to another user', () => getDatasetTurnById.mockResolvedValue({ ...TURN, userId: 'someone-else' })],
    ['the turn is not a chart turn', () => getDatasetTurnById.mockResolvedValue({ ...TURN, kind: 'refusal' })],
    ['the turn never emitted a chart', () => getDatasetTurnById.mockResolvedValue({ ...TURN, chartEmitted: false })],
    ['the dataset does not exist', () => getDataset.mockResolvedValue(null)],
    ['the dataset is not ready', () => getDataset.mockResolvedValue({ ...DATASET, status: 'needs_decision' })],
    // R2 (defence in depth): the loaded dataset's own id must equal the
    // turn's datasetId, even though getDataset is queried BY that id.
    ["the loaded dataset's id does not match the turn's datasetId", () => getDataset.mockResolvedValue({ ...DATASET, id: 999 })],
  ])('returns forbidden when %s', async (_label, setup) => {
    setup();
    expect(await publishOwnChart(7, [], null)).toEqual({ ok: false, reason: 'forbidden' });
    expect(buildPublishedChart).not.toHaveBeenCalled();
  });

  it('refuses an oversized log without ever calling buildPublishedChart', async () => {
    const hugeLog = [{ padding: 'x'.repeat(70_000) }];
    expect(await publishOwnChart(7, hugeLog, null)).toEqual({ ok: false, reason: 'invalid' });
    expect(buildPublishedChart).not.toHaveBeenCalled();
  });

  it('maps a buildPublishedChart failure to invalid', async () => {
    buildPublishedChart.mockReturnValue({ ok: false, reason: 'render_failed' });
    expect(await publishOwnChart(7, [], null)).toEqual({ ok: false, reason: 'invalid' });
    expect(upsertPublication).not.toHaveBeenCalled();
  });

  it('maps a nonzero dropped count to changed, never publishing a silently different chart', async () => {
    buildPublishedChart.mockReturnValue({ ...BUILT_OK, dropped: 1 });
    expect(await publishOwnChart(7, [], null)).toEqual({ ok: false, reason: 'changed' });
    expect(upsertPublication).not.toHaveBeenCalled();
  });

  describe('source line normalization', () => {
    it.each([
      ['  Bron  ', 'Bron'],
      ['', null],
      ['   ', null],
      [null, null],
      [undefined, null],
      ['a\u0000b\u0007c', 'abc'],
    ] as const)('%j is stored as %j', async (input, stored) => {
      const result = await publishOwnChart(7, [], input);
      expect(result).toEqual({ ok: true, publicId: 'new-public-id-xxxxxx' });
      expect(upsertPublication).toHaveBeenCalledWith(DB, expect.objectContaining({ sourceLine: stored }));
    });

    it('refuses 121 characters', async () => {
      expect(await publishOwnChart(7, [], 'a'.repeat(121))).toEqual({ ok: false, reason: 'invalid' });
      expect(upsertPublication).not.toHaveBeenCalled();
    });

    it('refuses a non-string, non-nullish value', async () => {
      expect(await publishOwnChart(7, [], 42)).toEqual({ ok: false, reason: 'invalid' });
      expect(upsertPublication).not.toHaveBeenCalled();
    });
  });

  it('refuses at the 50-publication limit when this turn has no existing publication', async () => {
    getPublicationForTurn.mockResolvedValue(null);
    countPublications.mockResolvedValue(50);
    expect(await publishOwnChart(7, [], null)).toEqual({ ok: false, reason: 'limit' });
    expect(upsertPublication).not.toHaveBeenCalled();
  });

  it('allows an update at the limit when this turn already has a publication', async () => {
    getPublicationForTurn.mockResolvedValue(publicationRow());
    countPublications.mockResolvedValue(50);
    expect(await publishOwnChart(7, [], null)).toEqual({ ok: true, publicId: 'new-public-id-xxxxxx' });
  });

  it('returns unavailable when the publications table is absent', async () => {
    upsertPublication.mockResolvedValue(null);
    expect(await publishOwnChart(7, [], null)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('publishes on the happy path, calling upsertPublication with the right shape', async () => {
    const log = [{ kind: 'setTitle', title: 'x' }];
    const result = await publishOwnChart(7, log, 'Bron: eigen data');
    expect(result).toEqual({ ok: true, publicId: 'new-public-id-xxxxxx' });
    expect(upsertPublication).toHaveBeenCalledWith(DB, {
      userId: 'user-1',
      datasetId: 42,
      datasetTurnId: 7,
      log,
      sourceLine: 'Bron: eigen data',
    });
  });

  it('returns a typed error and reports it on a thrown DB error, never throwing itself', async () => {
    getDatasetTurnById.mockRejectedValue(new Error('db exploded'));
    const result = await publishOwnChart(7, [], null);
    expect(result).toEqual({ ok: false, reason: 'error' });
    expect(reportError).toHaveBeenCalledWith('publishOwnChart', expect.any(Error), expect.objectContaining({ userId: 'user-1', extra: { turnId: 7 } }));
  });

  it.each([0, -1, 1.5, NaN])('returns forbidden for a non-positive-integer turnId (%s), never touching the DB', async (turnId) => {
    expect(await publishOwnChart(turnId, [], null)).toEqual({ ok: false, reason: 'forbidden' });
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe('unpublishOwnChart', () => {
  it('returns ok:false when the flag is unset', async () => {
    vi.stubEnv('OWN_DATA_PUBLISH_ENABLED', '');
    expect(await unpublishOwnChart(7)).toEqual({ ok: false });
    expect(currentUserId).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('returns ok:false when signed out', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await unpublishOwnChart(7)).toEqual({ ok: false });
    expect(deletePublicationForTurn).not.toHaveBeenCalled();
  });

  it('deletes and returns the store result when found', async () => {
    deletePublicationForTurn.mockResolvedValue(true);
    expect(await unpublishOwnChart(7)).toEqual({ ok: true });
    expect(deletePublicationForTurn).toHaveBeenCalledWith(DB, 'user-1', 7);
  });

  it('returns ok:false when nothing was deleted', async () => {
    deletePublicationForTurn.mockResolvedValue(false);
    expect(await unpublishOwnChart(7)).toEqual({ ok: false });
  });

  it.each([0, -1, 1.5, NaN])('returns ok:false for a non-positive-integer turnId (%s), never touching the DB', async (turnId) => {
    expect(await unpublishOwnChart(turnId)).toEqual({ ok: false });
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe('getOwnChartPublication', () => {
  it('returns null when the flag is unset', async () => {
    vi.stubEnv('OWN_DATA_PUBLISH_ENABLED', '');
    expect(await getOwnChartPublication(7)).toBeNull();
    expect(currentUserId).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('returns null when signed out', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await getOwnChartPublication(7)).toBeNull();
    expect(getPublicationForTurn).not.toHaveBeenCalled();
  });

  it('returns null when there is no publication for this turn', async () => {
    getPublicationForTurn.mockResolvedValue(null);
    expect(await getOwnChartPublication(7)).toBeNull();
  });

  it('returns the publicId and sourceLine when found', async () => {
    getPublicationForTurn.mockResolvedValue(publicationRow({ publicId: 'existing-id-xxxxxxxxxx', sourceLine: 'Bron: X' }));
    expect(await getOwnChartPublication(7)).toEqual({ publicId: 'existing-id-xxxxxxxxxx', sourceLine: 'Bron: X' });
  });

  it.each([0, -1, 1.5, NaN])('returns null for a non-positive-integer turnId (%s), never touching the DB', async (turnId) => {
    expect(await getOwnChartPublication(turnId)).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe('normalizeSourceLine', () => {
  it.each([
    ['  Bron  ', { ok: true, value: 'Bron' }],
    ['', { ok: true, value: null }],
    ['   ', { ok: true, value: null }],
    [null, { ok: true, value: null }],
    [undefined, { ok: true, value: null }],
    ['a\u0000b\u0007c', { ok: true, value: 'abc' }],
    ['a'.repeat(120), { ok: true, value: 'a'.repeat(120) }],
    ['a'.repeat(121), { ok: false }],
    [42, { ok: false }],
  ] as const)('%j -> %j', (input, expected) => {
    expect(normalizeSourceLine(input)).toEqual(expected);
  });
});
