// UserChartView (ADR 037 D11, H2) — the first-ever test file for this
// component. The load-bearing property throughout: a UserChartSpec chart
// must be visibly/structurally impossible to confuse with a CBS ChartView —
// the badge, the dashed chrome, the provenance+disclaimer footer, and the
// ABSENCE of anything CBS-shaped (no SourceBadge, no "Bron: CBS StatLine",
// no "CC BY 4.0"). Every displayed number must be the spec's own
// formattedValue string (R6-analog, same honesty contract chart.test.tsx
// pins for ChartView).
//
// Co-pilot phase 2 (session 113, Task 5): the card now composes the shared
// shell (history, form tabs, legend, style panel, notes, title/caption,
// per-turn persistence). The Server Action modules are mocked the way
// chart-edits-persistence.test.tsx mocks them — without that, the imports
// would reach the real 'use server' modules in jsdom.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
import type { ClientChartInstruction, DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';

const datasetActions = vi.hoisted(() => ({
  renderDatasetInstruction: vi.fn(),
}));
vi.mock('../app/dataset-actions.ts', () => datasetActions);
const chartEditsActions = vi.hoisted(() => ({
  fetchChartEdits: vi.fn().mockResolvedValue({ ok: true, log: null }),
  saveChartEdits: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../app/chart-edits-actions.ts', () => chartEditsActions);

import { CHART_EDITS_SAVE_DEBOUNCE_MS } from '../lib/use-chart-edits.ts';
import { UserChartView, type UserChartEditContext } from './user-chart.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: null });
  chartEditsActions.saveChartEdits.mockResolvedValue({ ok: true });
  datasetActions.renderDatasetInstruction.mockReset();
});

function point(overrides: Partial<UserChartSpec['series'][0]['points'][0]> = {}) {
  return {
    rowRef: 'r1:c1',
    xKey: '2024',
    xLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    sourceText: '42,0',
    ...overrides,
  };
}

function spec(overrides: Partial<UserChartSpec> = {}): UserChartSpec {
  return {
    schemaVersion: 1,
    origin: 'user_dataset',
    trust: 'unverified',
    kind: 'line',
    xHeader: 'Year',
    yHeaders: ['Revenue'],
    series: [{ label: 'Revenue', points: [point()] }],
    provenance: {
      datasetId: 7,
      sourceKind: 'file_csv',
      displayName: 'verkoop-2024.csv',
      sourceUrlHost: null,
      capturedAt: '2026-09-06T12:00:00.000Z',
      contentSha256: 'deadbeef',
    },
    disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.',
    ...overrides,
  };
}

/** Two series, two points each — enough for a legend, a hidden-series count
 * and a real `.recharts-line-curve`/`.recharts-bar-rectangle` per series. */
function twoSeriesSpec(): UserChartSpec {
  return spec({
    yHeaders: ['Revenue'],
    series: [
      {
        label: 'Amsterdam',
        points: [
          point({ rowRef: 'r1:c1', xKey: '2023', xLabel: '2023', value: 40, formattedValue: '40,0', sourceText: '40,0' }),
          point({ rowRef: 'r2:c1', xKey: '2024', xLabel: '2024', value: 42, formattedValue: '42,0', sourceText: '42,0' }),
        ],
      },
      {
        label: 'Rotterdam',
        points: [
          point({ rowRef: 'r1:c2', xKey: '2023', xLabel: '2023', value: 20, formattedValue: '20,0', sourceText: '20,0' }),
          point({ rowRef: 'r2:c2', xKey: '2024', xLabel: '2024', value: 24, formattedValue: '24,0', sourceText: '24,0' }),
        ],
      },
    ],
  });
}

const PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Year', type: 'year', nulls: 0 },
    { id: 'c1', header: 'Revenue', type: 'number', numberFormat: 'nl', nulls: 0 },
  ],
  rowCount: 2,
};

const LAST_INSTRUCTION: ClientChartInstruction = {
  version: 2,
  kind: 'line',
  x: 'c0',
  y: ['c1'],
  seriesBy: null,
  filters: [],
  sort: null,
  limit: null,
  aggregate: null,
  derived: null,
  unsupported: null,
};

function editContext(overrides: Partial<UserChartEditContext> = {}): UserChartEditContext {
  return { datasetId: 3, threadId: 42, turnId: 7, profile: PROFILE, lastInstruction: LAST_INSTRUCTION, ...overrides };
}

function lineCurves(): number {
  return document.querySelectorAll('.recharts-line-curve').length;
}

describe('UserChartView — H2 structural distinction from ChartView', () => {
  it('renders the persistent "Your data · unverified" badge', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByText('Your data · unverified')).toBeInTheDocument();
  });

  it('uses a dashed, distinct container chrome (huisstijl tokens)', () => {
    const { container } = render(<UserChartView spec={spec()} />);
    expect(container.firstElementChild?.className).toContain('border-dashed');
  });

  it('never renders a SourceBadge, CBS attribution, or a license line', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.queryByText(/CC BY 4\.0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bron: CBS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/StatLine/)).not.toBeInTheDocument();
  });

  it('shows the exact disclaimer line the spec carries, verbatim', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByText('User-uploaded data — not verified by checkdecijfers.')).toBeInTheDocument();
  });

  it('shows a provenance line built from the file name, upload date, and points plotted', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByText('Uit bestand verkoop-2024.csv, geüpload op 2026-09-06 · 1 punten weergegeven')).toBeInTheDocument();
  });

  it('shows the heading built from the spec\'s own headers, verbatim (U9)', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Revenue per Year');
  });
});

describe('UserChartView — honesty contract (mirrors chart.test.tsx)', () => {
  it('renders a download menu wired to this chart\'s own disclaimer + dataset id', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('renders a legend only when there is more than one series', () => {
    const { rerender } = render(<UserChartView spec={spec()} />);
    expect(screen.queryByRole('group', { name: 'Reeksen' })).not.toBeInTheDocument();

    rerender(<UserChartView spec={twoSeriesSpec()} />);
    const legend = screen.getByRole('group', { name: 'Reeksen' });
    expect(legend).toHaveTextContent('Amsterdam');
    expect(legend).toHaveTextContent('Rotterdam');
  });

  it('accepts a bar-kind spec without throwing', () => {
    expect(() => render(<UserChartView spec={spec({ kind: 'bar' })} />)).not.toThrow();
  });

  // (g) The whole-card digit scan: every numeric token a reader can see
  // traces to one of the spec's OWN strings (a formattedValue, an xLabel, the
  // capture date) — the card itself never composes a figure. The plotted-
  // point count is structural (how many points are drawn), not a value, so it
  // is allowed explicitly.
  it('the whole-card digit scan is clean: every rendered digit traces to a spec string', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    const allowed = [
      s.provenance.capturedAt.slice(0, 10),
      s.provenance.displayName,
      String(s.series[0]!.points.length),
      ...s.series.flatMap((se) => [se.label, ...se.points.flatMap((p) => [p.formattedValue ?? '', p.xLabel])]),
    ].filter(Boolean);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const tokens: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
    }
    expect(tokens.length).toBeGreaterThan(0);
    for (const tok of tokens) {
      expect(
        allowed.some((str) => str.includes(tok)),
        `numeric token "${tok}" in the rendered DOM has no source in the spec's own strings`,
      ).toBe(true);
    }
  });
});

// (b) The form switch — the same tablist contract as the CBS card, over the
// own-data card's own command history.
describe('UserChartView — the form switch (co-pilot phase 2)', () => {
  it('renders the form tabs, switches to a bar chart, and Undo restores the line', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tabel' })).toBeInTheDocument();
    expect(lineCurves()).toBe(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(lineCurves()).toBe(2);
  });

  it('offers a table of the spec\'s own strings in Tabel form', () => {
    const s = twoSeriesSpec();
    render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('Amsterdam');
    expect(table).toHaveTextContent('42,0');
    expect(table).toHaveTextContent('2024');
  });

  it('disables a form the spec does not allow (Vlak needs a single time series)', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.getByRole('tab', { name: 'Vlak' })).toBeDisabled();
  });

  // §6's command ↔ control contract: every command kind the chat can emit has
  // an on-screen control, and the control SAYS which kind it is.
  it('marks every form tab with data-command-kind="setForm"', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    for (const name of ['Lijn', 'Vlak', 'Staaf', 'Liggend', 'Tabel']) {
      expect(screen.getByRole('tab', { name, hidden: true })).toHaveAttribute('data-command-kind', 'setForm');
    }
  });
});

// Review fix round 1 (IMPORTANT 1): `valueLabels` used to be a live toggle in
// the style panel that changed nothing on this card — and the resolver FORCES
// it on for bar/hbar ("zonder waarden heeft een staafdiagram geen schaal"),
// which is exactly the state the own-data bar was in: no number anywhere but
// the tooltip.
describe('UserChartView — value labels (co-pilot phase 2)', () => {
  function labelTexts(): string[] {
    return [...document.querySelectorAll('.recharts-label-list text')].map((el) => el.textContent ?? '');
  }

  it('bar form labels every point with its own formattedValue', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    const texts = labelTexts();
    for (const value of ['40,0', '42,0', '20,0', '24,0']) expect(texts).toContain(value);
  });

  // Through the one real product path that sets a presentation value before
  // the first paint: the signed-in account default (`withAccountDefault`).
  it('draws no value label at all once the reader turns them off (line form)', () => {
    render(
      <ChartStyleProvider initial={{ valueLabels: 'hidden' }}>
        <UserChartView spec={twoSeriesSpec()} />
      </ChartStyleProvider>,
    );
    expect(labelTexts()).toEqual([]);
  });

  it('labels a line chart\'s points while they are shown (the stock default)', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(labelTexts()).toContain('42,0');
  });
});

// (c) The lifted legend — one component, both cards.
describe('UserChartView — the legend (co-pilot phase 2)', () => {
  it('hides a series, and ⌘Z brings it back', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    expect(lineCurves()).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    expect(lineCurves()).toBe(1);

    fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true });
    expect(lineCurves()).toBe(2);
  });

  it('highlights one series and dims the others', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Markeer Amsterdam' }));
    expect(document.querySelector('[data-series-dimmed="true"]')).not.toBeNull();
  });

  it('dims a series via the legend button, keeping it visible at reduced opacity', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    // Both lines visible before dimming
    expect(lineCurves()).toBe(2);

    // Click the dim button for Amsterdam
    const dimButton = screen.getByRole('button', { name: /Dim Amsterdam/ });
    fireEvent.click(dimButton);

    // Series should still be visible (not removed from DOM)
    expect(lineCurves()).toBe(2);

    // Dim button should be pressed
    expect(dimButton).toHaveAttribute('aria-pressed', 'true');

    // Amsterdam (s0) line should have 0.35 opacity
    const dimmedLine = document.querySelector('path[stroke-opacity="0.35"]');
    expect(dimmedLine).not.toBeNull();
  });
});

// (d) The reader's own title, as an undoable command.
describe('UserChartView — the title (co-pilot phase 2)', () => {
  it('adds a title the reader typed and shows it as the card\'s heading', () => {
    render(<UserChartView spec={spec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Titel toevoegen' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Omzet loopt op' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('user-chart-title')).toHaveTextContent('Omzet loopt op');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Omzet loopt op');
  });

  it('offers a caption under the chart too', () => {
    render(<UserChartView spec={spec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift toevoegen' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Eigen cijfers' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('chart-caption')).toHaveTextContent('Eigen cijfers');
  });
});

// (e) Persistence — the SAME hook the CBS card uses, keyed by dataset turn.
describe('UserChartView — per-turn persistence (co-pilot phase 2)', () => {
  it('fetches this turn\'s stored log when signed in with an edit context', async () => {
    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    await waitFor(() => expect(chartEditsActions.fetchChartEdits).toHaveBeenCalledWith({ kind: 'turn', id: 7 }));
  });

  it('replays a stored setTitle command onto the card', async () => {
    chartEditsActions.fetchChartEdits.mockResolvedValue({
      ok: true,
      log: [{ kind: 'setTitle', title: 'Bewaarde titel', id: 'c1', at: '2026-09-18T00:00:00.000Z', source: 'panel' }],
    });
    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    expect(await screen.findByTestId('user-chart-title')).toHaveTextContent('Bewaarde titel');
  });

  it('never fetches or saves without an edit context (a hand-built spec)', async () => {
    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true'));
    expect(chartEditsActions.fetchChartEdits).not.toHaveBeenCalled();
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });
});

// Review fix round 1 (IMPORTANT 2): a stored log whose first command is a
// DATA change, followed by commands that name the series of the spec that
// data change produces. Before the fix, hydrate validated those later
// commands against the spec the card happened to be showing, dropped them
// all, and the next debounce persisted the loss.
describe('UserChartView — hydrating a stored data edit (co-pilot phase 2)', () => {
  const OTHER_INSTRUCTION: ClientChartInstruction = { ...LAST_INSTRUCTION, kind: 'bar' };

  function storedLog() {
    return [
      { kind: 'setInstruction', instruction: OTHER_INSTRUCTION, summary: 'Omzet per gemeente', id: 'c1', at: '2026-09-18T00:00:00.000Z', source: 'chat' },
      { kind: 'toggleSeries', key: 's1', id: 'c2', at: '2026-09-18T00:00:01.000Z', source: 'canvas' },
    ];
  }

  it('renders the stored instruction\'s chart with the stored series hidden — never dropping the toggle', async () => {
    // The card mounts on a ONE-series spec, so 's1' is invalid against it and
    // only the freshly rendered two-series spec makes the toggle replayable.
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: twoSeriesSpec() });
    chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: storedLog() });

    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Rotterdam' })).toHaveAttribute('aria-pressed', 'false'));
    expect(lineCurves()).toBe(1);
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledWith(3, OTHER_INSTRUCTION);

    // …and nothing writes the dropped command back to the row.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, CHART_EDITS_SAVE_DEBOUNCE_MS + 200));
    });
    for (const call of chartEditsActions.saveChartEdits.mock.calls) {
      expect((call[1] as { kind: string }[]).map((c) => c.kind)).toContain('toggleSeries');
    }
  });

  it('does not re-fire a refused instruction when the reader redoes across it', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'invalid', reason: 'zero_rows' });
    chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: storedLog() });

    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );

    // The refusal line shows, the previous chart stands, and the action was
    // called exactly once however often the instruction is revisited.
    expect(await screen.findByText('Geen rijen voldoen aan dit filter.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(screen.queryByText('Geen rijen voldoen aan dit filter.')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    await screen.findByText('Geen rijen voldoen aan dit filter.');
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
  });
});

// Task 5 review ask, built in Task 6: the card's miss→fetch→apply path
// through its FIRST real doorway (the Data panel) — a live control change,
// one free deterministic render call, the plot swapped for what came back,
// and Undo going back through the cache without a second call.
describe('UserChartView — a data command from the Data panel (co-pilot phase 2)', () => {
  function aggregatedSpec(): UserChartSpec {
    return spec({
      kind: 'bar',
      yHeaders: ['Sum of Revenue'],
      series: [{ label: 'Sum of Revenue', points: [point({ rowRef: 'g1', value: 99, formattedValue: '99,0', sourceText: '99,0' })] }],
    });
  }

  it('renders the new spec on a cache miss and restores the original on Undo — one call in total', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: aggregatedSpec() });
    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Revenue per Year');

    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });

    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Sum of Revenue per Year'));
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledWith(3, { ...LAST_INSTRUCTION, aggregate: { fn: 'sum' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Revenue per Year'));
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
  });

  it('offers no Data doorway at all without an edit context (no profile to validate against)', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.queryByRole('button', { name: 'Data' })).not.toBeInTheDocument();
  });
});

// WP218 phase 4 (#219): proves the language switch reaches this surface (the
// heading/provenance line the component itself composes; disclaimerLine is
// backend data and stays as given regardless of language).
describe('UserChartView — en', () => {
  it('renders the English heading + provenance line under LangProvider lang="en"', () => {
    render(
      <LangProvider lang="en">
        <UserChartView spec={spec()} />
      </LangProvider>,
    );
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Revenue by Year');
    expect(screen.getByText('From file verkoop-2024.csv, uploaded 2026-09-06 · 1 points plotted')).toBeInTheDocument();
  });

  it('renders the English form tabs and style trigger', () => {
    render(
      <LangProvider lang="en">
        <UserChartView spec={spec()} />
      </LangProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Style' })).toBeInTheDocument();
  });
});
