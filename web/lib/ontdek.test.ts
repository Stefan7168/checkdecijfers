// The Ontdek feed's two jobs (ADR 035): keep anonymous traffic off the
// database (TTL cache) and NEVER break the public landing (stale-over-
// nothing, empty-over-crash). Both behaviors are pinned here with the module
// boundaries mocked, per web test convention.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { buildCuratedCharts } = vi.hoisted(() => ({ buildCuratedCharts: vi.fn() }));
vi.mock('../backend/chart/index.ts', () => ({ buildCuratedCharts }));
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn(() => ({})) }));
vi.mock('./db.ts', () => ({ getDb }));

import { getOntdekCharts, resetOntdekCache } from './ontdek.ts';
import { ANONYMOUS_READ_DEADLINE_MS } from './deadline.ts';

const chartA = { slug: 'a', spec: { title: 'A' } };
const chartB = { slug: 'b', spec: { title: 'B' } };

beforeEach(() => {
  resetOntdekCache();
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('getOntdekCharts', () => {
  it('returns the built charts and logs skipped series', async () => {
    buildCuratedCharts.mockResolvedValue({
      charts: [chartA],
      skipped: [{ slug: 'b', reason: 'query refused (freshness): too old' }],
    });
    await expect(getOntdekCharts()).resolves.toEqual([chartA]);
    expect(console.warn).toHaveBeenCalledWith(
      "[ontdek] chart 'b' skipped: query refused (freshness): too old",
    );
  });

  // #170(4): a chart that DID build still serves (present in `charts`) even
  // when its optional toggle degraded — logged distinctly from a whole-chart
  // skip, never silently dropped.
  it('logs a degraded toggle separately from a whole-chart skip, and still serves the chart', async () => {
    buildCuratedCharts.mockResolvedValue({
      charts: [chartA],
      skipped: [],
      toggleSkipped: [{ slug: 'a', reason: 'alternate reading refused (freshness): too old' }],
    });
    await expect(getOntdekCharts()).resolves.toEqual([chartA]);
    expect(console.warn).toHaveBeenCalledWith(
      "[ontdek] chart 'a' toggle skipped: alternate reading refused (freshness): too old",
    );
  });

  it('tolerates a test double that omits toggleSkipped entirely (defensive default)', async () => {
    buildCuratedCharts.mockResolvedValue({ charts: [chartA], skipped: [] });
    await expect(getOntdekCharts()).resolves.toEqual([chartA]);
  });

  it('caches within the TTL — one DB build for many requests', async () => {
    buildCuratedCharts.mockResolvedValue({ charts: [chartA], skipped: [] });
    await getOntdekCharts();
    await getOntdekCharts();
    await getOntdekCharts();
    expect(buildCuratedCharts).toHaveBeenCalledTimes(1);
  });

  it('rebuilds after the TTL expires', async () => {
    buildCuratedCharts.mockResolvedValue({ charts: [chartA], skipped: [] });
    await getOntdekCharts();
    vi.advanceTimersByTime(31 * 60 * 1000);
    buildCuratedCharts.mockResolvedValue({ charts: [chartB], skipped: [] });
    await expect(getOntdekCharts()).resolves.toEqual([chartB]);
    expect(buildCuratedCharts).toHaveBeenCalledTimes(2);
  });

  it('serves the previous set when a rebuild fails (stale over nothing)', async () => {
    buildCuratedCharts.mockResolvedValue({ charts: [chartA], skipped: [] });
    await getOntdekCharts();
    vi.advanceTimersByTime(31 * 60 * 1000);
    buildCuratedCharts.mockRejectedValue(new Error('pool down'));
    await expect(getOntdekCharts()).resolves.toEqual([chartA]);
  });

  it('degrades to an empty list when there is no cache to fall back on', async () => {
    buildCuratedCharts.mockRejectedValue(new Error('no DATABASE_URL'));
    await expect(getOntdekCharts()).resolves.toEqual([]);
  });

  it('retries immediately after a failure once the DB is back', async () => {
    buildCuratedCharts.mockRejectedValue(new Error('down'));
    await getOntdekCharts();
    buildCuratedCharts.mockResolvedValue({ charts: [chartB], skipped: [] });
    await expect(getOntdekCharts()).resolves.toEqual([chartB]);
  });

  it('coalesces concurrent cache-miss requests onto ONE build', async () => {
    let release!: (v: { charts: unknown[]; skipped: unknown[] }) => void;
    buildCuratedCharts.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = getOntdekCharts();
    const second = getOntdekCharts();
    release({ charts: [chartA], skipped: [] });
    await expect(first).resolves.toEqual([chartA]);
    await expect(second).resolves.toEqual([chartA]);
    expect(buildCuratedCharts).toHaveBeenCalledTimes(1);
  });
});

// #190(b): rebuild() degrades on a THROWN error but not on a WAIT. Under pool
// saturation it simply blocks, and the public landing blocked with it — so the
// section that is designed to be omissible could not omit itself.
describe('the chart feed degrades instead of waiting (#190b)', () => {
  it('serves an empty section when the build never settles (nothing cached yet)', async () => {
    buildCuratedCharts.mockReturnValue(new Promise(() => {}));
    const charts = getOntdekCharts();
    await vi.advanceTimersByTimeAsync(ANONYMOUS_READ_DEADLINE_MS + 1);
    await expect(charts).resolves.toEqual([]);
  });

  it('serves the STALE set when a refresh never settles', async () => {
    buildCuratedCharts.mockResolvedValue({ charts: [chartA], skipped: [] });
    await expect(getOntdekCharts()).resolves.toEqual([chartA]);
    vi.advanceTimersByTime(31 * 60 * 1000);
    buildCuratedCharts.mockReturnValue(new Promise(() => {}));
    const stale = getOntdekCharts();
    await vi.advanceTimersByTimeAsync(ANONYMOUS_READ_DEADLINE_MS + 1);
    // Stale-over-nothing, the posture this module already chose for a THROWN
    // failure — now reached for a hung one too.
    await expect(stale).resolves.toEqual([chartA]);
  });
});

// Found by a review of the COMBINED session diff, not by any per-change review:
// `buildCuratedCharts(getDb())` evaluates getDb() as a plain argument before any
// await, and getDb() throws SYNCHRONOUSLY when DATABASE_URL is missing or the CA
// cert will not load — the "no DATABASE_URL (local dev)" case this module's own
// header names as a degrade it handles. rebuild() then completed synchronously,
// its in-body `finally` cleared `inflight` BEFORE `inflight ??= rebuild()`
// assigned it, and the assignment latched a settled promise forever.
//
// The existing 'retries immediately after a failure' test could not catch this:
// it mocks an ASYNC rejection, which suspends at a real await, so the finally
// runs after the assignment and the slot clears correctly.
describe('a SYNCHRONOUS build failure must not latch the in-flight slot', () => {
  it('retries on the next request after getDb() throws synchronously', async () => {
    getDb.mockImplementationOnce(() => {
      throw new Error('DATABASE_URL is not set');
    });
    // First request: the section degrades to empty, as designed.
    await expect(getOntdekCharts()).resolves.toEqual([]);
    // Second request, config now fine. Before the fix this returned [] forever
    // and buildCuratedCharts was never called again on this instance.
    buildCuratedCharts.mockResolvedValue({ charts: [chartA], skipped: [] });
    await expect(getOntdekCharts()).resolves.toEqual([chartA]);
    expect(buildCuratedCharts).toHaveBeenCalledTimes(1);
  });
});
