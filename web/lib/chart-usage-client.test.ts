// The injectable sink for the anonymous chart-style usage counter (WP218
// phase 6, Task 3). Deliberately pure client-side dispatch — no DB, no
// server action import — so these tests register a spy sink directly and
// never touch the network. The default (no sink registered) MUST be a
// silent no-op: server renders and every other test file that mounts
// chart.tsx without registering a sink must never throw or reach the real
// action.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setChartUsageSink, trackChartStyleEvent } from './chart-usage-client.ts';

afterEach(() => setChartUsageSink(null));

describe('trackChartStyleEvent', () => {
  it('is a no-op when no sink is registered', () => {
    expect(() => trackChartStyleEvent('panel_open')).not.toThrow();
  });

  it('calls the registered sink with the event', () => {
    const sink = vi.fn();
    setChartUsageSink(sink);

    trackChartStyleEvent('option_changed');

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith('option_changed');
  });

  it('never awaits the sink — it returns before an async sink resolves', () => {
    let resolved = false;
    const sink = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve();
          }, 0);
        }),
    );
    setChartUsageSink(sink);

    trackChartStyleEvent('default_saved');

    expect(resolved).toBe(false);
  });

  it('swallows a rejecting sink instead of surfacing an unhandled rejection', async () => {
    const sink = vi.fn().mockRejectedValue(new Error('boom'));
    setChartUsageSink(sink);

    expect(() => trackChartStyleEvent('default_saved')).not.toThrow();

    // Let the microtask queue drain so the rejection is actually caught by
    // trackChartStyleEvent's own .catch(() => {}), not left pending.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('swallows a synchronously-throwing sink', () => {
    const sink = vi.fn(() => {
      throw new Error('sync boom');
    });
    setChartUsageSink(sink);

    expect(() => trackChartStyleEvent('default_forgotten')).not.toThrow();
  });

  it('setChartUsageSink(null) unregisters — subsequent calls become no-ops', () => {
    const sink = vi.fn();
    setChartUsageSink(sink);
    setChartUsageSink(null);

    trackChartStyleEvent('panel_open');

    expect(sink).not.toHaveBeenCalled();
  });
});
