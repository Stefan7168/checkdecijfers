// Journalist chart-headline server actions (session 105,
// docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
// Hermetic, following this repo's real convention (actions-chart-style.test.ts,
// actions-threads.test.ts): vi.hoisted() + vi.mock() for every dependency,
// not bare vi.mock() factories referenced via vi.mocked(import). The task
// brief's own illustrative mocks used bare vi.mock()/vi.mocked() — checked
// against chart-insights-actions.test.ts first (it does not exist in this
// repo) and against actions-chart-style.test.ts (the real, existing
// precedent for this exact file shape), and the hoisted-object pattern below
// is what that precedent actually uses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { ChartSpec } from '../backend/chart/types.ts';

const { currentUserId } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn<() => Db>() }));
vi.mock('../lib/db.ts', () => ({ getDb }));

// Constructed but never called in these tests — draftHeadline itself is
// mocked below, so the real AnthropicLlmClient never fires a network call.
vi.mock('../backend/answer/llm/client.ts', () => ({ AnthropicLlmClient: vi.fn() }));

const { draftHeadline } = vi.hoisted(() => ({ draftHeadline: vi.fn() }));
vi.mock('../backend/chart/headline-phrase.ts', () => ({ draftHeadline }));

const store = vi.hoisted(() => ({
  upsertChartHeadline: vi.fn(),
  getOwnChartHeadline: vi.fn(),
  // Real normalizeHeadlineText/CHART_HEADLINE_MAX_LENGTH behavior (Task 2),
  // not stubbed — the action's own pre-normalize length guard and the
  // normalization it delegates to are both exercised for real.
  normalizeHeadlineText: (v: unknown) =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 140) : null,
  CHART_HEADLINE_MAX_LENGTH: 140,
}));
vi.mock('../backend/chart/headline-store.ts', () => store);

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));

import { draftChartHeadline, fetchChartHeadline, saveChartHeadline } from './chart-headline-actions.ts';

const fakeDb = {} as Db;

// A minimal but schema-VALID spec (real chartSpecSchema, not mocked) so the
// invalid_spec branch and the parses-fine branch are both exercised for
// real rather than assumed.
const VALID_SPEC = {
  schemaVersion: 1,
  kind: 'line',
  title: 'Werkloosheid',
  dims: {},
  dimLabels: {},
  unit: 'percentage',
  series: [
    {
      label: 'Nederland',
      regionCode: null,
      points: [
        {
          resultId: 'r1',
          periodCode: '2024',
          periodLabel: '2024',
          value: 3.5,
          formattedValue: '3,5%',
          decimals: 1,
          status: 'final',
          provisional: false,
          valueAttribute: 'value',
        },
      ],
    },
  ],
  provisionalNote: null,
  nullNotes: [],
  definitionLine: null,
  attributionLine: 'CBS, 2024',
  attribution: {
    tableId: '12345',
    tableTitle: 'Werkloosheid',
    tableVersion: 1,
    syncedAt: '2024-01-01T00:00:00.000Z',
    coveredPeriods: { from: '2020', to: '2024' },
    license: 'CC BY 4.0',
  },
} as unknown as ChartSpec;

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  getDb.mockReturnValue(fakeDb);
  reportError.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('draftChartHeadline', () => {
  it('returns unauthenticated when no user, before ever parsing the spec', async () => {
    currentUserId.mockResolvedValue(null);

    const result = await draftChartHeadline({ kind: 'line' });

    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(draftHeadline).not.toHaveBeenCalled();
  });

  it('returns invalid_spec for a malformed spec, before ever calling draftHeadline', async () => {
    const result = await draftChartHeadline({ not: 'a spec' });

    expect(result).toEqual({ ok: false, reason: 'invalid_spec' });
    expect(draftHeadline).not.toHaveBeenCalled();
  });

  it('passes the parsed spec through to draftHeadline and returns its ok result', async () => {
    draftHeadline.mockResolvedValue({ ok: true, headline: 'Werkloosheid daalt verder' });

    const result = await draftChartHeadline(VALID_SPEC);

    expect(result).toEqual({ ok: true, headline: 'Werkloosheid daalt verder' });
    expect(draftHeadline).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Werkloosheid' }),
      expect.objectContaining({ client: expect.anything() }),
    );
  });

  it('passes a no_findings result straight through', async () => {
    draftHeadline.mockResolvedValue({ ok: false, reason: 'no_findings' });

    await expect(draftChartHeadline(VALID_SPEC)).resolves.toEqual({ ok: false, reason: 'no_findings' });
  });

  it('folds a phrasing_failed result into the generic error reason (not part of the public contract)', async () => {
    draftHeadline.mockResolvedValue({ ok: false, reason: 'phrasing_failed' });

    await expect(draftChartHeadline(VALID_SPEC)).resolves.toEqual({ ok: false, reason: 'error' });
  });

  it('reports (never throws) when draftHeadline rejects', async () => {
    const boom = new Error('provider outage');
    draftHeadline.mockRejectedValue(boom);

    await expect(draftChartHeadline(VALID_SPEC)).resolves.toEqual({ ok: false, reason: 'error' });

    expect(reportError).toHaveBeenCalledWith('draftChartHeadline', boom, { userId: 'user-1' });
  });
});

describe('saveChartHeadline', () => {
  it('rejects an unauthenticated caller without ever touching the store', async () => {
    currentUserId.mockResolvedValue(null);

    expect(await saveChartHeadline(1, 'Kop')).toEqual({ ok: false });
    expect(store.upsertChartHeadline).not.toHaveBeenCalled();
  });

  it('rejects a malformed (non-numeric) auditId without ever touching the store', async () => {
    expect(await saveChartHeadline('not-a-number', 'Kop')).toEqual({ ok: false });
    expect(store.upsertChartHeadline).not.toHaveBeenCalled();
  });

  it('rejects a non-integer auditId without ever touching the store', async () => {
    expect(await saveChartHeadline(1.5, 'Kop')).toEqual({ ok: false });
    expect(store.upsertChartHeadline).not.toHaveBeenCalled();
  });

  it('rejects a non-positive auditId without ever touching the store', async () => {
    expect(await saveChartHeadline(0, 'Kop')).toEqual({ ok: false });
    expect(await saveChartHeadline(-1, 'Kop')).toEqual({ ok: false });
    expect(store.upsertChartHeadline).not.toHaveBeenCalled();
  });

  it('rejects headline text over the max length without ever touching the store', async () => {
    expect(await saveChartHeadline(1, 'x'.repeat(500))).toEqual({ ok: false });
    expect(store.upsertChartHeadline).not.toHaveBeenCalled();
  });

  it('rejects a non-string headline without ever touching the store', async () => {
    expect(await saveChartHeadline(1, 42)).toEqual({ ok: false });
    expect(store.upsertChartHeadline).not.toHaveBeenCalled();
  });

  it('rejects a blank/whitespace-only headline (normalizes to null) without ever touching the store', async () => {
    expect(await saveChartHeadline(1, '   ')).toEqual({ ok: false });
    expect(store.upsertChartHeadline).not.toHaveBeenCalled();
  });

  it('calls the store with the normalized headline for a valid request', async () => {
    store.upsertChartHeadline.mockResolvedValue(true);

    const result = await saveChartHeadline(1, '  Werkloosheid daalt  ');

    expect(result).toEqual({ ok: true });
    expect(store.upsertChartHeadline).toHaveBeenCalledWith(fakeDb, {
      auditAnswerId: 1,
      userId: 'user-1',
      headline: 'Werkloosheid daalt',
    });
  });

  it('passes a false (ownership guard did not match) store result straight through', async () => {
    store.upsertChartHeadline.mockResolvedValue(false);

    await expect(saveChartHeadline(1, 'Kop')).resolves.toEqual({ ok: false });
  });

  it('reports (never throws) when the store rejects', async () => {
    const boom = new Error('db unavailable');
    store.upsertChartHeadline.mockRejectedValue(boom);

    await expect(saveChartHeadline(1, 'Kop')).resolves.toEqual({ ok: false });

    expect(reportError).toHaveBeenCalledWith('saveChartHeadline', boom, {});
  });
});

describe('fetchChartHeadline', () => {
  it('rejects an unauthenticated caller without ever touching the store', async () => {
    currentUserId.mockResolvedValue(null);

    expect(await fetchChartHeadline(1)).toEqual({ ok: false });
    expect(store.getOwnChartHeadline).not.toHaveBeenCalled();
  });

  it('rejects a malformed auditId without ever touching the store', async () => {
    expect(await fetchChartHeadline('not-a-number')).toEqual({ ok: false });
    expect(store.getOwnChartHeadline).not.toHaveBeenCalled();
  });

  it("returns the stored headline for the caller's own chart", async () => {
    store.getOwnChartHeadline.mockResolvedValue('Kop');

    expect(await fetchChartHeadline(1)).toEqual({ ok: true, headline: 'Kop' });
    expect(store.getOwnChartHeadline).toHaveBeenCalledWith(fakeDb, 1, 'user-1');
  });

  it('returns null when no headline has been saved yet', async () => {
    store.getOwnChartHeadline.mockResolvedValue(null);

    expect(await fetchChartHeadline(1)).toEqual({ ok: true, headline: null });
  });

  it('reports (never throws) when the store rejects', async () => {
    const boom = new Error('db unavailable');
    store.getOwnChartHeadline.mockRejectedValue(boom);

    await expect(fetchChartHeadline(1)).resolves.toEqual({ ok: false });

    expect(reportError).toHaveBeenCalledWith('fetchChartHeadline', boom, {});
  });
});
