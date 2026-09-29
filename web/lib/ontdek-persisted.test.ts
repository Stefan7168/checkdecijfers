// #347 (WP-LOOK part c, session 144): the Data Cache layer in ontdek.ts.
// Separate file from ontdek.test.ts because the persisted branch is chosen
// at module load (NEXT_RUNTIME set), so the module is imported fresh here
// under a stubbed runtime and a recording double for `unstable_cache`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { buildCuratedCharts } = vi.hoisted(() => ({ buildCuratedCharts: vi.fn() }));
vi.mock('../backend/chart/index.ts', () => ({ buildCuratedCharts, GALLERY_STORIES: [] }));
vi.mock('./db.ts', () => ({ getDb: () => ({}) }));

// A stand-in for Next's Data Cache: records what the wrapped callback
// RESOLVED with (a throw stores nothing, exactly like the real store).
const store = vi.hoisted(() => ({ entries: [] as unknown[], keys: [] as string[][] }));
vi.mock('next/cache', () => ({
  unstable_cache: (cb: () => Promise<unknown>, keyParts: string[]) => {
    store.keys.push(keyParts);
    return async () => {
      const value = await cb();
      store.entries.push(value);
      return value;
    };
  },
}));

const chartA = { slug: 'a', spec: { title: 'A' } };

beforeEach(() => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  buildCuratedCharts.mockReset();
  store.entries.length = 0;
  store.keys.length = 0;
});

describe('getGalleryStories — the persisted (Data Cache) layer', () => {
  it('routes the build through unstable_cache under a Next runtime and stores a built set', async () => {
    buildCuratedCharts.mockResolvedValue({ charts: [chartA], skipped: [], toggleSkipped: [] });
    const { getGalleryStories } = await import('./ontdek.ts');
    await expect(getGalleryStories()).resolves.toEqual([chartA]);
    expect(store.keys).toEqual([['curated-feed', 'galerij']]);
    expect(store.entries).toEqual([{ charts: [chartA], skipped: [], toggleSkipped: [] }]);
  });

  it('never stores an outcome with zero charts, yet still serves it and logs every skip', async () => {
    buildCuratedCharts.mockResolvedValue({
      charts: [],
      skipped: [{ slug: 'a', reason: 'pool saturated' }],
      toggleSkipped: [],
    });
    const { getGalleryStories } = await import('./ontdek.ts');
    await expect(getGalleryStories()).resolves.toEqual([]);
    expect(store.entries).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith("[galerij] chart 'a' skipped: pool saturated");
  });

  it('still propagates a real build failure to the honest degrade (empty set, warning)', async () => {
    buildCuratedCharts.mockRejectedValue(new Error('pool down'));
    const { getGalleryStories } = await import('./ontdek.ts');
    await expect(getGalleryStories()).resolves.toEqual([]);
    expect(store.entries).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      '[galerij] charts unavailable, serving previous set if any:',
      expect.any(Error),
    );
  });
});
