// Chart co-pilot phase 1, Task 7 (session 112, ADR 056, #274): the command
// log is saved per account and restored when the reader reopens the chart.
//
// Mock block and fixture copied verbatim from chart-history-ui.test.tsx (the
// sibling Task 3 suite), plus the new `../app/chart-edits-actions.ts` mock —
// without it chart.tsx's import would reach the real Server Action module in
// jsdom. `signedIn` is the PRESENCE of ChartStyleProvider, not a prop
// (web/lib/chart-style-context.tsx's module header), so the `Provider`
// helper below wraps or doesn't.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
import type { ChartSpec } from '../backend/chart/types.ts';

const chartHeadlineActions = vi.hoisted(() => ({
  draftChartHeadline: vi.fn(),
  saveChartHeadline: vi.fn(),
  fetchChartHeadline: vi.fn().mockResolvedValue({ ok: true, headline: null }),
}));
vi.mock('../app/chart-headline-actions.ts', () => chartHeadlineActions);
const chartEditsActions = vi.hoisted(() => ({
  fetchChartEdits: vi.fn().mockResolvedValue({ ok: true, log: null }),
  saveChartEdits: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../app/chart-edits-actions.ts', () => chartEditsActions);
const chartInsightsActions = vi.hoisted(() => ({
  generateInsights: vi.fn().mockResolvedValue({ ok: true, phrased: {} }),
}));
vi.mock('../app/chart-insights-actions.ts', () => chartInsightsActions);
const chartStyleActions = vi.hoisted(() => ({
  saveMyChartStyle: vi.fn(),
  forgetMyChartStyle: vi.fn(),
  lookupBrand: vi.fn(),
}));
vi.mock('../app/chart-style-actions.ts', () => chartStyleActions);
const { createEmbedCode } = vi.hoisted(() => ({ createEmbedCode: vi.fn() }));
vi.mock('../app/embed-actions.ts', () => ({ createEmbedCode }));

import { ChartView } from './chart.tsx';

function point(overrides: Partial<ChartSpec['series'][0]['points'][0]> = {}) {
  return {
    resultId: 'r1',
    periodCode: '2024JJ00',
    periodLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    decimals: 1,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    ...overrides,
  };
}

function twoSeriesLineSpec(): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
    series: [
      {
        label: 'Nederland',
        regionCode: null,
        points: [
          point({ resultId: 'nl-2020', periodCode: '2020', periodLabel: '2020', value: 100, formattedValue: '100' }),
          point({ resultId: 'nl-2021', periodCode: '2021', periodLabel: '2021', value: 110, formattedValue: '110' }),
        ],
      },
      {
        label: 'Utrecht',
        regionCode: 'GM0344',
        points: [
          point({ resultId: 'ut-2020', periodCode: '2020', periodLabel: '2020', value: 50, formattedValue: '50' }),
          point({ resultId: 'ut-2021', periodCode: '2021', periodLabel: '2021', value: 55, formattedValue: '55' }),
        ],
      },
    ],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 12345NED.',
    attribution: {
      tableId: '12345NED',
      tableTitle: 'Test',
      tableVersion: 1,
      syncedAt: '2026-07-01',
      coveredPeriods: { from: '2020', to: '2024' },
      license: 'CC BY 4.0',
    },
  };
}

function Provider({ signedIn = true, children }: { signedIn?: boolean; children: React.ReactNode }) {
  return signedIn ? <ChartStyleProvider initial={{}}>{children}</ChartStyleProvider> : <>{children}</>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: null });
  chartEditsActions.saveChartEdits.mockResolvedValue({ ok: true });
  chartHeadlineActions.fetchChartHeadline.mockResolvedValue({ ok: true, headline: null });
});

describe('chart_edits persistence', () => {
  it('a saved log is replayed on mount and stays undoable', async () => {
    chartEditsActions.fetchChartEdits.mockResolvedValueOnce({
      ok: true,
      log: [{ kind: 'setForm', form: 'bar', id: 'a', at: '2026-09-18T00:00:00.000Z', source: 'panel' }],
    });
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Staaf|Bar/ })).toHaveAttribute('aria-selected', 'true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByRole('tab', { name: /Lijn|Line/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('an invalid stored command is dropped, the rest applied', async () => {
    chartEditsActions.fetchChartEdits.mockResolvedValueOnce({
      ok: true,
      log: [
        { kind: 'toggleSeries', key: 's9', id: 'x', at: 'now', source: 'panel' },
        { kind: 'setTitle', title: 'Hersteld', id: 'y', at: 'now', source: 'canvas' },
      ],
    });
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Hersteld'));
  });

  it('an edit is saved once, debounced, with the serialised log; undo saves the shorter log', async () => {
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    // Let the hydrate effect settle (it resolves `{ log: null }`) before the
    // fake clock takes over, so no real-timer promise is left pending.
    await waitFor(() => expect(chartEditsActions.fetchChartEdits).toHaveBeenCalled());
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
      fireEvent.click(screen.getByRole('tab', { name: /Lijn|Line/ }));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(1);
      const [id, log] = chartEditsActions.saveChartEdits.mock.calls[0]!;
      expect(id).toBe(5);
      expect((log as { kind: string }[]).map((c) => c.kind)).toEqual(['setForm', 'setForm']);
      fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(2);
      expect((chartEditsActions.saveChartEdits.mock.calls[1]![1] as unknown[]).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never fetches or saves when signed out, in embed mode, or without an audit id', async () => {
    render(
      <Provider signedIn={false}>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embedMode embed={{ auditId: 5 }} />
      </Provider>,
    );
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} />
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole('tab', { name: /Staaf|Bar/ })[0]!);
    await act(() => new Promise((r) => setTimeout(r, 900)));
    expect(chartEditsActions.fetchChartEdits).not.toHaveBeenCalled();
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });

  // Fix round 1, finding 1 (CRITICAL): the visual dock and the Ontdek toggle
  // hand a DIFFERENT chart to the SAME mounted ChartView (no `key` at either
  // call site), which resets the history to empty. If the "last saved" marker
  // still held the previous chart's log, the save effect would see a change
  // and write `[]` over the NEW chart's stored row — destroying another
  // chart's edits for nothing but a tab switch.
  it('a chart swap on the same mounted card never writes an empty log over the new chart', async () => {
    const { rerender } = render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 1 }} />
      </Provider>,
    );
    await waitFor(() => expect(chartEditsActions.fetchChartEdits).toHaveBeenCalledWith(1));
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(1);
      expect(chartEditsActions.saveChartEdits.mock.calls[0]![0]).toBe(1);

      const other = twoSeriesLineSpec();
      other.title = 'Een andere grafiek';
      rerender(
        <Provider>
          <ChartView spec={other} embed={{ auditId: 2 }} />
        </Provider>,
      );
      await act(() => vi.advanceTimersByTimeAsync(2000));
      for (const call of chartEditsActions.saveChartEdits.mock.calls) {
        expect(call[0]).not.toBe(2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // Fix round 1, finding 2: a reader who edits and immediately closes the chat
  // (or switches chart) used to lose the last 800 ms of work — the effect
  // cleanup only cancelled the timer.
  it('a save still in the debounce window is flushed when the card goes away', async () => {
    const { unmount } = render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    await waitFor(() => expect(chartEditsActions.fetchChartEdits).toHaveBeenCalled());
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
      await act(() => vi.advanceTimersByTimeAsync(100)); // well inside the 800 ms window
      expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
      unmount();
      expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(1);
      const [id, log] = chartEditsActions.saveChartEdits.mock.calls[0]!;
      expect(id).toBe(5);
      expect((log as { kind: string }[]).map((c) => c.kind)).toEqual(['setForm']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an untouched chart never saves an empty log', async () => {
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    await act(() => new Promise((r) => setTimeout(r, 900)));
    expect(chartEditsActions.fetchChartEdits).toHaveBeenCalledWith(5);
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });
});

// Final-review finding I1 (IMPORTANT): a colour drag is pushed as a TRANSIENT
// entry and `serializeHistory` drops those, while the only seal the panel
// fires is the picker's own blur — which Chrome skips when the modal unmounts.
// A drag that is the reader's LAST action was therefore never saved at all.
describe('an unsealed colour drag is still saved', () => {
  async function openColorPicker() {
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    await screen.findByRole('tab', { name: 'Grafiek' });
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    return (await screen.findByLabelText('Kleur van Nederland kiezen')) as HTMLInputElement;
  }

  it('a transient colour change that is never sealed is written after the debounce', async () => {
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    await waitFor(() => expect(chartEditsActions.fetchChartEdits).toHaveBeenCalled());
    const picker = await openColorPicker();
    vi.useFakeTimers();
    try {
      fireEvent.change(picker, { target: { value: '#ff8800' } });
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(1);
      const log = chartEditsActions.saveChartEdits.mock.calls[0]![1] as { kind: string }[];
      expect(log.map((c) => c.kind)).toEqual(['setPresentation']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closing the Style panel seals the drag, so the next drag is its own step', async () => {
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    await waitFor(() => expect(chartEditsActions.fetchChartEdits).toHaveBeenCalled());
    const picker = await openColorPicker();
    fireEvent.change(picker, { target: { value: '#ff8800' } });
    // Close the panel — no blur is fired on the picker, exactly like the
    // browser case this finding is about (the modal unmounts under the
    // cursor and Chrome skips the blur).
    fireEvent.keyDown(document.querySelector('[role=dialog]')!, { key: 'Escape' });
    await act(async () => {});
    const again = await openColorPicker();
    vi.useFakeTimers();
    try {
      fireEvent.change(again, { target: { value: '#33aa55' } });
      await act(() => vi.advanceTimersByTimeAsync(1000));
      const calls = chartEditsActions.saveChartEdits.mock.calls;
      const log = calls[calls.length - 1]![1] as { kind: string }[];
      expect(log.map((c) => c.kind)).toEqual(['setPresentation', 'setPresentation']);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Final-review finding I2 (IMPORTANT): a click made WHILE the hydrate fetch is
// in flight used to destroy the stored log — hydration was skipped (the reader
// had started editing) and the save then overwrote the row with only the new
// click. The stored log and the reader's own commands are merged instead, and
// nothing is written until the fetch has settled.
describe('an edit during the hydrate fetch', () => {
  function deferredFetch() {
    let resolve!: (v: { ok: boolean; log: unknown }) => void;
    const promise = new Promise<{ ok: boolean; log: unknown }>((r) => {
      resolve = r;
    });
    chartEditsActions.fetchChartEdits.mockReturnValueOnce(promise);
    return { resolve };
  }
  const storedLog = [{ kind: 'setTitle', title: 'Hersteld', id: 'y', at: '2026-09-18T00:00:00.000Z', source: 'canvas' }];

  it('nothing is saved while the fetch is still in flight', async () => {
    deferredFetch();
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
    await act(() => new Promise((r) => setTimeout(r, 1000)));
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });

  it('the stored log and the reader’s own click are merged, oldest first', async () => {
    const { resolve } = deferredFetch();
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
    await act(async () => {
      resolve({ ok: true, log: storedLog });
      await Promise.resolve();
    });
    // Both edits are in the live state: the stored title AND the new form.
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Hersteld'));
    expect(screen.getByRole('tab', { name: /Staaf|Bar/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [id, log] = chartEditsActions.saveChartEdits.mock.calls[0]!;
    expect(id).toBe(5);
    expect((log as { kind: string }[]).map((c) => c.kind)).toEqual(['setTitle', 'setForm']);
  });
});
