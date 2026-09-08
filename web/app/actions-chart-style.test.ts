// WP218 phase 2 (#218 chart styling, owner C): the account-default chart
// style Server Actions — a thin, tiny-import-graph wrapper over
// backend/chart/user-styles.ts's saveUserChartStyle/deleteUserChartStyle,
// auth-gated by currentUserId (WP13, ADR 020) like every other per-user
// action. Hermetic: current-user, db, the store and the error reporter are
// all mocked, matching usage-actions.test.ts / actions-threads.test.ts's
// convention. chart.tsx (never actions.ts) is the only real consumer,
// mocked separately in chart.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';

const { currentUserId } = vi.hoisted(() => ({ currentUserId: vi.fn<() => Promise<string | null>>() }));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn<() => Db>() }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const store = vi.hoisted(() => ({
  saveUserChartStyle: vi.fn(),
  deleteUserChartStyle: vi.fn(),
}));
vi.mock('../backend/chart/user-styles.ts', () => store);

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));

import { forgetMyChartStyle, saveMyChartStyle } from './chart-style-actions.ts';

const fakeDb = {} as Db;

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  getDb.mockReturnValue(fakeDb);
  reportError.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('saveMyChartStyle', () => {
  it('unauthenticated: returns the reason without ever touching the store', async () => {
    currentUserId.mockResolvedValue(null);

    const result = await saveMyChartStyle({ lineWidth: 'thick' });

    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(store.saveUserChartStyle).not.toHaveBeenCalled();
  });

  it('sanitises the raw input (the allow-list) before it ever reaches the store', async () => {
    store.saveUserChartStyle.mockResolvedValue({ ok: true });

    await saveMyChartStyle({ lineWidth: 'thick', notARealField: 'x', markers: 'bogus' });

    expect(store.saveUserChartStyle).toHaveBeenCalledWith(fakeDb, 'user-1', { lineWidth: 'thick' });
  });

  it('ok: passes the store result straight through', async () => {
    store.saveUserChartStyle.mockResolvedValue({ ok: true });

    await expect(saveMyChartStyle({ lineWidth: 'thick' })).resolves.toEqual({ ok: true });
  });

  it('unavailable (table absent): passes the store result straight through', async () => {
    store.saveUserChartStyle.mockResolvedValue({ ok: false, reason: 'unavailable' });

    await expect(saveMyChartStyle({})).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('too-large: passes the store result straight through', async () => {
    store.saveUserChartStyle.mockResolvedValue({ ok: false, reason: 'too-large' });

    await expect(saveMyChartStyle({})).resolves.toEqual({ ok: false, reason: 'too-large' });
  });

  it('reports (never throws) when the store rejects', async () => {
    const boom = new Error('db unavailable');
    store.saveUserChartStyle.mockRejectedValue(boom);

    await expect(saveMyChartStyle({})).resolves.toEqual({ ok: false, reason: 'error' });

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('saveMyChartStyle', boom, { userId: 'user-1' });
  });
});

describe('forgetMyChartStyle', () => {
  it('unauthenticated: returns false without ever touching the store', async () => {
    currentUserId.mockResolvedValue(null);

    await expect(forgetMyChartStyle()).resolves.toEqual({ ok: false });

    expect(store.deleteUserChartStyle).not.toHaveBeenCalled();
  });

  it('ok: passes the store result straight through', async () => {
    store.deleteUserChartStyle.mockResolvedValue(true);

    await expect(forgetMyChartStyle()).resolves.toEqual({ ok: true });
  });

  it('false (no saved default / table absent): passes the store result straight through', async () => {
    store.deleteUserChartStyle.mockResolvedValue(false);

    await expect(forgetMyChartStyle()).resolves.toEqual({ ok: false });
  });

  it('reports (never throws) when the store rejects', async () => {
    const boom = new Error('db unavailable');
    store.deleteUserChartStyle.mockRejectedValue(boom);

    await expect(forgetMyChartStyle()).resolves.toEqual({ ok: false });

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('forgetMyChartStyle', boom, { userId: 'user-1' });
  });
});
