// WP218 phase 2+3 (#218 chart styling, owner C): the account-default chart
// style Server Actions — a thin, tiny-import-graph wrapper over
// backend/chart/user-styles.ts's saveUserChartStyle/deleteUserChartStyle/
// bumpBrandLookups/setAppliedBrand and backend/chart/brand-cache.ts's
// getCachedBrand/putCachedBrand, auth-gated by currentUserId (WP13, ADR 020)
// like every other per-user action. Hermetic: current-user, db, the store,
// the brand cache, the error reporter, and Brandfetch's own network-touching
// `fetchBrand` are all mocked, matching usage-actions.test.ts /
// actions-threads.test.ts's convention — but brandfetch.ts's PURE domain
// rules (normalizeDomain, isFreeMailDomain, pickBrandColours, pickBrandFont)
// are left real via importOriginal (the trial-actions.test.ts precedent),
// the same way this file already leaves chart-presentation.ts's
// sanitizeOverrides real rather than mocking a pure function. chart.tsx
// (never actions.ts) is the only real consumer, mocked separately in
// chart.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { BrandInfo } from '../backend/chart/brandfetch.ts';

const { currentUserId, currentUserEmail } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  currentUserEmail: vi.fn<() => Promise<string | null>>(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId, currentUserEmail }));

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn<() => Db>() }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const store = vi.hoisted(() => ({
  saveUserChartStyle: vi.fn(),
  deleteUserChartStyle: vi.fn(),
  bumpBrandLookups: vi.fn(),
  setAppliedBrand: vi.fn(),
}));
vi.mock('../backend/chart/user-styles.ts', () => store);

const brandCache = vi.hoisted(() => ({
  getCachedBrand: vi.fn(),
  putCachedBrand: vi.fn(),
}));
vi.mock('../backend/chart/brand-cache.ts', () => brandCache);

const { fetchBrand } = vi.hoisted(() => ({ fetchBrand: vi.fn() }));
vi.mock('../backend/chart/brandfetch.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../backend/chart/brandfetch.ts')>()),
  fetchBrand,
}));

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));

import { forgetMyChartStyle, lookupBrand, saveMyChartStyle } from './chart-style-actions.ts';

const fakeDb = {} as Db;

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  currentUserEmail.mockResolvedValue(null);
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

  it('ok: passes the store result straight through, and never touches setAppliedBrand without a brandApplied argument', async () => {
    store.saveUserChartStyle.mockResolvedValue({ ok: true });

    await expect(saveMyChartStyle({ lineWidth: 'thick' })).resolves.toEqual({ ok: true });
    expect(store.setAppliedBrand).not.toHaveBeenCalled();
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

  describe('brandApplied (WP218 phase 3, Task 3)', () => {
    it('valid brandApplied: calls setAppliedBrand with the allow-list-parsed fields after a successful save', async () => {
      store.saveUserChartStyle.mockResolvedValue({ ok: true });
      store.setAppliedBrand.mockResolvedValue(undefined);

      const result = await saveMyChartStyle(
        { lineWidth: 'thick' },
        { domain: 'HTTPS://WWW.Example.COM', name: 'Example Inc', fetchedAt: '2026-09-09T12:00:00.000Z' },
      );

      expect(result).toEqual({ ok: true });
      expect(store.setAppliedBrand).toHaveBeenCalledExactlyOnceWith(fakeDb, 'user-1', {
        domain: 'example.com',
        name: 'Example Inc',
        fetchedAt: '2026-09-09T12:00:00.000Z',
      });
    });

    it('invalid brandApplied (unparsable domain): ignored — save still succeeds, setAppliedBrand not called', async () => {
      store.saveUserChartStyle.mockResolvedValue({ ok: true });

      const result = await saveMyChartStyle(
        { lineWidth: 'thick' },
        { domain: 'not a domain', name: 'Example Inc', fetchedAt: '2026-09-09T12:00:00.000Z' },
      );

      expect(result).toEqual({ ok: true });
      expect(store.setAppliedBrand).not.toHaveBeenCalled();
    });

    it('invalid brandApplied (name out of the 1-80 range): ignored', async () => {
      store.saveUserChartStyle.mockResolvedValue({ ok: true });

      await saveMyChartStyle(
        {},
        { domain: 'example.com', name: 'x'.repeat(81), fetchedAt: '2026-09-09T12:00:00.000Z' },
      );

      expect(store.setAppliedBrand).not.toHaveBeenCalled();
    });

    it('invalid brandApplied (fetchedAt not an ISO string): ignored', async () => {
      store.saveUserChartStyle.mockResolvedValue({ ok: true });

      await saveMyChartStyle({}, { domain: 'example.com', name: 'Example Inc', fetchedAt: 'yesterday' });

      expect(store.setAppliedBrand).not.toHaveBeenCalled();
    });

    it('invalid brandApplied (not an object): ignored', async () => {
      store.saveUserChartStyle.mockResolvedValue({ ok: true });

      await saveMyChartStyle({}, 'not-an-object');

      expect(store.setAppliedBrand).not.toHaveBeenCalled();
    });

    it('does not call setAppliedBrand when the underlying save itself failed', async () => {
      store.saveUserChartStyle.mockResolvedValue({ ok: false, reason: 'too-large' });

      const result = await saveMyChartStyle(
        {},
        { domain: 'example.com', name: 'Example Inc', fetchedAt: '2026-09-09T12:00:00.000Z' },
      );

      expect(result).toEqual({ ok: false, reason: 'too-large' });
      expect(store.setAppliedBrand).not.toHaveBeenCalled();
    });
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

describe('lookupBrand (WP218 phase 3, Task 3)', () => {
  const NOW_ISO = '2026-09-09T12:00:00.000Z';
  const TODAY = '2026-09-09';

  const SAMPLE_BRAND: BrandInfo = {
    name: 'Example Inc',
    domain: 'example.com',
    colors: [{ hex: '#112233', type: 'brand' }],
    fonts: [{ family: 'Inter', role: 'body', origin: 'google' }],
  };

  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.BRANDFETCH_API_KEY;
    process.env.BRANDFETCH_API_KEY = 'test-key';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));

    brandCache.getCachedBrand.mockResolvedValue(null);
    brandCache.putCachedBrand.mockResolvedValue(undefined);
    store.bumpBrandLookups.mockResolvedValue({ allowed: true, count: 1 });
    fetchBrand.mockResolvedValue({ ok: true, brand: SAMPLE_BRAND });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalApiKey === undefined) delete process.env.BRANDFETCH_API_KEY;
    else process.env.BRANDFETCH_API_KEY = originalApiKey;
  });

  it('unauthenticated: returns the reason without touching the key, the cache, or the store', async () => {
    currentUserId.mockResolvedValue(null);

    await expect(lookupBrand('example.com')).resolves.toEqual({ ok: false, reason: 'unauthenticated' });

    expect(brandCache.getCachedBrand).not.toHaveBeenCalled();
    expect(fetchBrand).not.toHaveBeenCalled();
  });

  it('no key configured: unavailable, before any cache/DB work', async () => {
    delete process.env.BRANDFETCH_API_KEY;

    await expect(lookupBrand('example.com')).resolves.toEqual({ ok: false, reason: 'unavailable' });

    expect(brandCache.getCachedBrand).not.toHaveBeenCalled();
    expect(fetchBrand).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('free-mail email, no website given: need_website, before any cache/DB work', async () => {
    currentUserEmail.mockResolvedValue('person@gmail.com');

    await expect(lookupBrand()).resolves.toEqual({ ok: false, reason: 'need_website' });

    expect(brandCache.getCachedBrand).not.toHaveBeenCalled();
    expect(store.bumpBrandLookups).not.toHaveBeenCalled();
    expect(fetchBrand).not.toHaveBeenCalled();
  });

  it('no email on the account and no website given: need_website', async () => {
    currentUserEmail.mockResolvedValue(null);

    await expect(lookupBrand()).resolves.toEqual({ ok: false, reason: 'need_website' });
  });

  it('non-free-mail email, no website given: uses the email domain', async () => {
    currentUserEmail.mockResolvedValue('person@Example.COM');

    const result = await lookupBrand();

    expect(brandCache.getCachedBrand).toHaveBeenCalledWith(fakeDb, 'example.com', new Date(NOW_ISO));
    expect(result).toEqual({ ok: true, brand: expect.objectContaining({ domain: 'example.com' }) });
  });

  it('an unparsable website: invalid_domain', async () => {
    await expect(lookupBrand('not a domain')).resolves.toEqual({ ok: false, reason: 'invalid_domain' });

    expect(brandCache.getCachedBrand).not.toHaveBeenCalled();
  });

  it('website given: the normalised domain is used for the cache lookup and the fetch, not the raw input', async () => {
    await lookupBrand('HTTPS://WWW.Example.COM/pricing');

    expect(brandCache.getCachedBrand).toHaveBeenCalledWith(fakeDb, 'example.com', new Date(NOW_ISO));
    expect(store.bumpBrandLookups).toHaveBeenCalledWith(fakeDb, 'user-1', TODAY);
    expect(fetchBrand).toHaveBeenCalledWith('example.com', { apiKey: 'test-key' });
  });

  it('cache hit: skips the fetch AND the daily cap entirely', async () => {
    brandCache.getCachedBrand.mockResolvedValue({ brand: SAMPLE_BRAND, fetchedAt: NOW_ISO });

    const result = await lookupBrand('example.com');

    expect(store.bumpBrandLookups).not.toHaveBeenCalled();
    expect(fetchBrand).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      brand: {
        name: 'Example Inc',
        domain: 'example.com',
        colors: ['#112233'],
        font: { family: 'Inter', origin: 'google' },
        fetchedAt: NOW_ISO,
        cached: true,
      },
    });
  });

  it('cache hit reports the CACHE ROW\'s own fetchedAt, not the moment of this read (final-review fix)', async () => {
    const staleFetchedAt = '2026-08-15T00:00:00.000Z';
    brandCache.getCachedBrand.mockResolvedValue({ brand: SAMPLE_BRAND, fetchedAt: staleFetchedAt });

    const result = await lookupBrand('example.com');

    expect(result).toEqual({
      ok: true,
      brand: expect.objectContaining({ fetchedAt: staleFetchedAt }),
    });
  });

  it('cache miss: bumps the cap, then fetches with the key, then caches the result', async () => {
    const result = await lookupBrand('example.com');

    expect(store.bumpBrandLookups).toHaveBeenCalledWith(fakeDb, 'user-1', TODAY);
    expect(fetchBrand).toHaveBeenCalledWith('example.com', { apiKey: 'test-key' });
    expect(brandCache.putCachedBrand).toHaveBeenCalledWith(fakeDb, 'example.com', SAMPLE_BRAND, new Date(NOW_ISO));
    expect(result).toEqual({
      ok: true,
      brand: {
        name: 'Example Inc',
        domain: 'example.com',
        colors: ['#112233'],
        font: { family: 'Inter', origin: 'google' },
        fetchedAt: NOW_ISO,
        cached: false,
      },
    });
  });

  it('404 from Brandfetch: not_found, and the miss is never cached', async () => {
    fetchBrand.mockResolvedValue({ ok: false, reason: 'not_found' });

    await expect(lookupBrand('example.com')).resolves.toEqual({ ok: false, reason: 'not_found' });

    expect(brandCache.putCachedBrand).not.toHaveBeenCalled();
  });

  it('rate_limited from Brandfetch: passed straight through', async () => {
    fetchBrand.mockResolvedValue({ ok: false, reason: 'rate_limited' });

    await expect(lookupBrand('example.com')).resolves.toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('daily cap already reached: daily_cap, and Brandfetch is never called', async () => {
    store.bumpBrandLookups.mockResolvedValue({ allowed: false, count: 5 });

    await expect(lookupBrand('example.com')).resolves.toEqual({ ok: false, reason: 'daily_cap' });

    expect(fetchBrand).not.toHaveBeenCalled();
    expect(brandCache.putCachedBrand).not.toHaveBeenCalled();
  });

  it('unauthorized (a bad key): unavailable to the caller, but reportError fires so the owner sees it in the logs', async () => {
    fetchBrand.mockResolvedValue({ ok: false, reason: 'unauthorized' });

    await expect(lookupBrand('example.com')).resolves.toEqual({ ok: false, reason: 'unavailable' });

    expect(reportError).toHaveBeenCalledTimes(1);
    const [source, error, context] = reportError.mock.calls[0];
    expect(source).toBe('lookupBrand');
    expect(error).toBeInstanceOf(Error);
    expect(context).toEqual({ userId: 'user-1', extra: { domain: 'example.com' } });
  });

  it('reports (never throws) on an unexpected rejection', async () => {
    const boom = new Error('db unavailable');
    brandCache.getCachedBrand.mockRejectedValue(boom);

    await expect(lookupBrand('example.com')).resolves.toEqual({ ok: false, reason: 'error' });

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('lookupBrand', boom, { userId: 'user-1' });
  });
});
