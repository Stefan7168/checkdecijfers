// Chart co-pilot phase 2 (session 113), Task 4: the hydrate/save block lifted
// out of chart.tsx, now keyed by an answer OR a dataset turn (Task 3). Every
// rule pinned here is a phase-1 review finding — the whole-card versions live
// in web/components/chart-edits-persistence.test.tsx and must stay green too.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartPoint, ChartSeries, ChartSpec } from '../backend/chart/types.ts';
import type { ChartEditsKey } from './chart-edits-key.ts';

const chartEditsActions = vi.hoisted(() => ({
  fetchChartEdits: vi.fn(),
  saveChartEdits: vi.fn(),
}));
vi.mock('../app/chart-edits-actions.ts', () => chartEditsActions);

const { initialDocState, makeCommand } = await import('./chart-commands.ts');
const { useChartHistory } = await import('./use-chart-history.ts');
const { CHART_EDITS_SAVE_DEBOUNCE_MS, useChartEdits } = await import('./use-chart-edits.ts');

function point(periodCode: string, value: number): ChartPoint {
  return {
    resultId: `r-${periodCode}`,
    periodCode,
    periodLabel: periodCode,
    value,
    formattedValue: String(value),
    provisional: false,
    note: null,
  } as unknown as ChartPoint;
}
function series(label: string): ChartSeries {
  return { label, regionCode: null, points: ['2020', '2021'].map((c, i) => point(c, i + 1)) } as unknown as ChartSeries;
}
const spec = { kind: 'line', series: [series('Nederland'), series('Utrecht')] } as unknown as ChartSpec;
const ctx = { spec, alternatesCount: 0 };

function harness(editsKey: ChartEditsKey | null) {
  const history = useChartHistory(initialDocState('line'));
  useChartEdits({
    editsKey,
    history: history.history,
    replaceHistory: history.replace,
    ctx,
    initial: initialDocState('line'),
  });
  return history;
}

const storedLog = [makeCommand({ kind: 'setTitle', title: 'Hersteld' }, 'canvas')];

beforeEach(() => {
  chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: null });
  chartEditsActions.saveChartEdits.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useChartEdits — hydrate', () => {
  it('fetches with the key object and replays the stored log into the state', async () => {
    chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: JSON.parse(JSON.stringify(storedLog)) });
    const { result } = renderHook(() => harness({ kind: 'turn', id: 7 }));
    await act(async () => {});
    expect(chartEditsActions.fetchChartEdits).toHaveBeenCalledWith({ kind: 'turn', id: 7 });
    expect(result.current.state.title).toBe('Hersteld');
    expect(result.current.canUndo).toBe(true);
  });

  it('replays the reader’s in-flight commands ON TOP of the stored log, oldest first', async () => {
    let resolve!: (v: { ok: boolean; log: unknown }) => void;
    chartEditsActions.fetchChartEdits.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => harness({ kind: 'answer', id: 5 }));
    act(() => result.current.dispatch({ kind: 'setForm', form: 'bar' }, 'panel'));
    await act(async () => {
      resolve({ ok: true, log: JSON.parse(JSON.stringify(storedLog)) });
    });
    expect(result.current.state.title).toBe('Hersteld');
    expect(result.current.state.form).toBe('bar');
    expect(result.current.history.past.map((e) => e.command.kind)).toEqual(['setTitle', 'setForm']);
  });

  it('never fetches without a key', async () => {
    renderHook(() => harness(null));
    await act(async () => {});
    expect(chartEditsActions.fetchChartEdits).not.toHaveBeenCalled();
  });
});

describe('useChartEdits — save', () => {
  it('writes the sealed serialisation after the debounce, and never before', async () => {
    const { result } = renderHook(() => harness({ kind: 'answer', id: 5 }));
    await act(async () => {});
    vi.useFakeTimers();
    act(() => result.current.dispatch({ kind: 'setPresentation', patch: { grid: 'none' } }, 'panel', { transient: true }));
    await act(() => vi.advanceTimersByTimeAsync(CHART_EDITS_SAVE_DEBOUNCE_MS - 100));
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(1);
    const [key, log] = chartEditsActions.saveChartEdits.mock.calls[0]!;
    expect(key).toEqual({ kind: 'answer', id: 5 });
    // A transient (unsealed) entry is still written — serializeHistory drops
    // it, so the hook serialises a SEALED VIEW (phase-1 finding I1).
    expect((log as { kind: string }[]).map((c) => c.kind)).toEqual(['setPresentation']);
  });

  it('nothing is written while the hydrate fetch is still in flight', async () => {
    chartEditsActions.fetchChartEdits.mockReturnValueOnce(new Promise(() => {}));
    const { result } = renderHook(() => harness({ kind: 'answer', id: 5 }));
    vi.useFakeTimers();
    act(() => result.current.dispatch({ kind: 'setForm', form: 'bar' }, 'panel'));
    await act(() => vi.advanceTimersByTimeAsync(CHART_EDITS_SAVE_DEBOUNCE_MS * 2));
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });

  it('an untouched chart never writes an empty log', async () => {
    renderHook(() => harness({ kind: 'answer', id: 5 }));
    await act(async () => {});
    vi.useFakeTimers();
    await act(() => vi.advanceTimersByTimeAsync(CHART_EDITS_SAVE_DEBOUNCE_MS * 2));
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });

  it('flushes a pending save when the card goes away', async () => {
    const { result, unmount } = renderHook(() => harness({ kind: 'answer', id: 5 }));
    await act(async () => {});
    vi.useFakeTimers();
    act(() => result.current.dispatch({ kind: 'setForm', form: 'bar' }, 'panel'));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
    unmount();
    expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(1);
    expect(chartEditsActions.saveChartEdits.mock.calls[0]![0]).toEqual({ kind: 'answer', id: 5 });
  });
});

describe('useChartEdits — a key change', () => {
  it('flushes the pending save against the OLD key and never writes it to the new one', async () => {
    const { result, rerender } = renderHook(({ editsKey }: { editsKey: ChartEditsKey }) => harness(editsKey), {
      initialProps: { editsKey: { kind: 'answer', id: 5 } as ChartEditsKey },
    });
    await act(async () => {});
    vi.useFakeTimers();
    act(() => result.current.dispatch({ kind: 'setForm', form: 'bar' }, 'panel'));
    await act(() => vi.advanceTimersByTimeAsync(100));
    await act(async () => {
      rerender({ editsKey: { kind: 'turn', id: 7 } as ChartEditsKey });
    });
    expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(1);
    expect(chartEditsActions.saveChartEdits.mock.calls[0]![0]).toEqual({ kind: 'answer', id: 5 });
    // The card resets its history on a chart swap, exactly as chart.tsx's
    // spec-identity effect does. The marker was reset alongside the key, so
    // the new chart's empty log matches it and NOTHING is written — the
    // phase-1 CRITICAL fix: a chart swap must never put an empty log over
    // the new chart's stored row.
    act(() => result.current.dispatchRaw({ type: 'reset', initialForm: 'line', initialPresentation: {} }));
    await act(() => vi.advanceTimersByTimeAsync(CHART_EDITS_SAVE_DEBOUNCE_MS * 2));
    for (const call of chartEditsActions.saveChartEdits.mock.calls) {
      expect(call[0]).not.toEqual({ kind: 'turn', id: 7 });
    }
  });
});
