// The anonymous chart-style usage counter's Server Action (WP218 phase 6,
// Task 3): a thin, no-auth wrapper over backend/chart/user-styles.ts's
// recordChartStyleEvent. No auth check — trial/anonymous homepage visitors
// count too, same as everyone else. Hermetic: getDb, the store, and
// reportError are all mocked, matching the actions-errorlog.test.ts /
// dataset-actions.test.ts convention (real error-report.ts stays untested
// here — its own fail-open contract is covered by actions-errorlog.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn<() => Db>() }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const store = vi.hoisted(() => ({ recordChartStyleEvent: vi.fn() }));
vi.mock('../backend/chart/user-styles.ts', () => ({
  ...store,
  // WP218 phase 3 (owner B): 'brand_applied' joined the real enum
  // (src/chart/user-styles.ts) — mirrored here so this mock never drifts
  // from what isChartStyleEvent actually validates against. 'brand_fetch'
  // joined the same enum with the global monthly Brandfetch cap (owner
  // decision 2026-09-09). 'story_open' and 'story_step' joined for story
  // mode (session 92). 'frame_changed' joined for the frame task (phase 5).
  // 'embed_open'/'embed_copy' joined for the embed feature (Task 4, spec
  // Part B1). 'template_*' joined for chart templates (ADR 043). 'stage_open'
  // and 'stage_autoplay' joined for the full-viewport Story stage (ADR 044,
  // Story-stage plan Task 4).
  CHART_STYLE_EVENTS: [
    'panel_open',
    'option_changed',
    'default_saved',
    'default_forgotten',
    'brand_applied',
    'brand_fetch',
    'story_open',
    'story_step',
    'frame_changed',
    'embed_open',
    'embed_copy',
    'template_standard',
    'template_classic',
    'template_newsroom',
    'template_presentation',
    'template_social',
    'template_minimal',
    'stage_open',
    'stage_autoplay',
  ],
}));

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));

import { countChartStyleEvent } from './usage-actions.ts';

const fakeDb = {} as Db;

beforeEach(() => {
  getDb.mockReturnValue(fakeDb);
  store.recordChartStyleEvent.mockResolvedValue(undefined);
  reportError.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('countChartStyleEvent', () => {
  it.each([
    'panel_open',
    'option_changed',
    'default_saved',
    'default_forgotten',
    'brand_applied',
    'brand_fetch',
    'story_open',
    'story_step',
    'frame_changed',
    'embed_open',
    'embed_copy',
    'template_standard',
    'template_classic',
    'template_newsroom',
    'template_presentation',
    'template_social',
    'template_minimal',
    'stage_open',
    'stage_autoplay',
  ] as const)(
    'records a valid event (%s) via the store, using the real db and a fresh date',
    async (event) => {
      await countChartStyleEvent(event);

      expect(store.recordChartStyleEvent).toHaveBeenCalledTimes(1);
      const [db, recordedEvent, day] = store.recordChartStyleEvent.mock.calls[0]!;
      expect(db).toBe(fakeDb);
      expect(recordedEvent).toBe(event);
      expect(day).toBeInstanceOf(Date);
    },
  );

  it.each([
    'not_a_real_event',
    '',
    null,
    undefined,
    42,
    { event: 'panel_open' },
    ['panel_open'],
  ])('silently returns for an invalid/unknown raw value (%j) — never calls the store', async (raw) => {
    await countChartStyleEvent(raw);

    expect(store.recordChartStyleEvent).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports (never throws) when the store rejects', async () => {
    const boom = new Error('db unavailable');
    store.recordChartStyleEvent.mockRejectedValue(boom);

    await expect(countChartStyleEvent('panel_open')).resolves.toBeUndefined();

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('countChartStyleEvent', boom);
  });
});
