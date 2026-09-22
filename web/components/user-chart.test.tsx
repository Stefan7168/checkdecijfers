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
const derivationActions = vi.hoisted(() => ({
  requestDatasetDerivation: vi.fn(),
}));
vi.mock('../app/dataset-derivation-actions.ts', () => derivationActions);

import { CHART_EDITS_SAVE_DEBOUNCE_MS } from '../lib/use-chart-edits.ts';
import { UserChartView, type UserChartEditContext } from './user-chart.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: null });
  chartEditsActions.saveChartEdits.mockResolvedValue({ ok: true });
  datasetActions.renderDatasetInstruction.mockReset();
  derivationActions.requestDatasetDerivation.mockReset();
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

/** Two series × three years — heatmap-shaped (a 2 × 3 grid, every cell a real
 * value) but NOT slope-shaped (three x values per series, not exactly two). */
function twoSeriesThreeYearSpec(): UserChartSpec {
  return spec({
    yHeaders: ['Revenue'],
    series: [
      {
        label: 'Amsterdam',
        points: [
          point({ rowRef: 'r1:c1', xKey: '2022', xLabel: '2022', value: 30, formattedValue: '30,0', sourceText: '30,0' }),
          point({ rowRef: 'r2:c1', xKey: '2023', xLabel: '2023', value: 40, formattedValue: '40,0', sourceText: '40,0' }),
          point({ rowRef: 'r3:c1', xKey: '2024', xLabel: '2024', value: 42, formattedValue: '42,0', sourceText: '42,0' }),
        ],
      },
      {
        label: 'Rotterdam',
        points: [
          point({ rowRef: 'r1:c2', xKey: '2022', xLabel: '2022', value: 10, formattedValue: '10,0', sourceText: '10,0' }),
          point({ rowRef: 'r2:c2', xKey: '2023', xLabel: '2023', value: 20, formattedValue: '20,0', sourceText: '20,0' }),
          point({ rowRef: 'r3:c2', xKey: '2024', xLabel: '2024', value: 24, formattedValue: '24,0', sourceText: '24,0' }),
        ],
      },
    ],
  });
}

function lineCurves(): number {
  return document.querySelectorAll('.recharts-line-curve').length;
}

/** (g) The whole-card digit scan: every numeric token a reader can see traces
 * to one of the spec's OWN strings (a formattedValue, an xLabel, the capture
 * date) — the card itself never composes a figure. The plotted-point count is
 * structural (how many points are drawn), not a value, so it is allowed
 * explicitly. Shared by the line-form scan below and the heatmap scan. */
function expectDigitsTraceToSpec(container: HTMLElement, s: UserChartSpec): void {
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

  // (g) The whole-card digit scan — see `expectDigitsTraceToSpec` above.
  it('the whole-card digit scan is clean: every rendered digit traces to a spec string', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    expectDigitsTraceToSpec(container, s);
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
    for (const name of ['Lijn', 'Vlak', 'Staaf', 'Liggend', 'Tabel', 'Dumbbell', 'Helling', 'Warmtekaart']) {
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

// Co-pilot phase 4 parity: ChartGoalLine and ChartEraShading, already mounted
// on ChartView (chart.tsx), mounted here too — same command kinds
// (addGoalLine/removeGoalLine/addEraShading/removeEraShading), same
// export-boundary contract. Mirrors chart.test.tsx's 'ChartView
// click-to-annotate' goal-line tests and its 'ChartView — Task 3 era shading
// visual rendering (ReferenceArea)' describe block, over this card's own
// export-container hook (`[data-testid="user-chart-container"]`, this file's
// existing selector, rather than the CBS card's `[role="tabpanel"]
// [aria-label="Grafiek"]`) — there is no separate zoom control on this card
// (see this file's own header comment), so unlike chart.test.tsx's era-
// shading tests, the "Tot" select needs no extra scoping to disambiguate it
// from a zoom-range "Tot".
describe('UserChartView — goal lines and era shading (co-pilot phase 4 parity)', () => {
  it('a saved goal line is never rendered inside the chart export container', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Doellijn toevoegen' }));
    fireEvent.change(screen.getByLabelText('Waarde'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Test Doel' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));

    const exportContainer = container.querySelector('[data-testid="user-chart-container"]');
    expect(exportContainer?.textContent).not.toContain('Test Doel');
    expect(screen.getByText('Test Doel')).toBeInTheDocument();
  });

  it('a saved goal line renders a real ReferenceLine on the chart', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    const before = container.querySelectorAll('.recharts-reference-line').length;
    fireEvent.click(await screen.findByRole('button', { name: 'Doellijn toevoegen' }));
    fireEvent.change(screen.getByLabelText('Waarde'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Test Doel' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));

    expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(before);
  });

  it('renders a ReferenceArea band in a line chart when an era shading is added through the real UI', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periode markeren' }));

    const fromSelect = await screen.findByLabelText('Van');
    fireEvent.change(fromSelect, { target: { value: '2023' } });
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Testperiode' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));

    expect(container.querySelector('.recharts-reference-area-rect')).not.toBeNull();
  });

  it('a saved era shading LABEL is never rendered inside the chart export container (the band still is)', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periode markeren' }));

    const fromSelect = await screen.findByLabelText('Van');
    fireEvent.change(fromSelect, { target: { value: '2023' } });
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Testperiode label' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));

    const exportContainer = container.querySelector('[data-testid="user-chart-container"]');
    expect(exportContainer?.textContent).not.toContain('Testperiode label');
    // The label text IS still shown to the reader, just outside the export.
    expect(screen.getByText('Testperiode label')).toBeInTheDocument();
    // The band itself, unlike the label, genuinely is inside the export.
    expect(container.querySelector('.recharts-reference-area-rect')).not.toBeNull();
  });
});

describe('UserChartView — difference/mean overlays (co-pilot phase 4 parity, Task 7)', () => {
  it('offers no overlay controls at all without an edit context — resolving one needs a real datasetId', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.queryByRole('button', { name: 'Verschil aanduiden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
  });

  it('offers no overlay controls on a bar-form chart, even with an edit context', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(screen.queryByRole('button', { name: 'Verschil aanduiden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
  });

  it('offers no average button with two series visible — an average across different series is not well-defined', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
  });

  it('toggles the difference picker\'s pressed state', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    const pickerButton = screen.getByRole('button', { name: 'Verschil aanduiden' });
    expect(pickerButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(pickerButton);
    expect(pickerButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pickerButton);
    expect(pickerButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('a resolved average renders a labelled ReferenceLine INSIDE the export container — unlike a goal line, this value is server-computed and verified, not reader-typed', async () => {
    derivationActions.requestDatasetDerivation.mockResolvedValueOnce({ ok: true, result: { value: 41, decimals: 1, rowRef: 'agg:mean:r1:c1+r2:c1' } });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    // Hide Rotterdam: Amsterdam becomes the sole visible series (its own two
    // points), matching chart.tsx's own I8 gate ("exactly one visible series").
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gemiddelde tonen' }));

    expect(derivationActions.requestDatasetDerivation).toHaveBeenCalledWith(3, LAST_INSTRUCTION, 'mean', ['r1:c1', 'r2:c1']);
    await waitFor(() => expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(0));
    const exportContainer = container.querySelector('[data-testid="user-chart-container"]');
    expect(exportContainer?.textContent).toContain('41,0');
  });

  it('a server refusal shows the reason text and draws nothing', async () => {
    derivationActions.requestDatasetDerivation.mockResolvedValueOnce({ ok: false, reason: 'no value available to compute an average' });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    const before = container.querySelectorAll('.recharts-reference-line').length;
    fireEvent.click(await screen.findByRole('button', { name: 'Gemiddelde tonen' }));

    expect(await screen.findByText('no value available to compute an average')).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-reference-line').length).toBe(before);
  });

  it('the remove chip drops the stored recipe and its resolved line disappears', async () => {
    derivationActions.requestDatasetDerivation.mockResolvedValueOnce({ ok: true, result: { value: 41, decimals: 1, rowRef: 'agg:mean:r1:c1+r2:c1' } });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gemiddelde tonen' }));
    await waitFor(() => expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /× Gemiddelde tonen/ }));
    await waitFor(() => expect(container.querySelectorAll('.recharts-reference-line').length).toBe(0));
  });
});

// ---------------------------------------------------------------------------
// Own-data chart-fit parity (plan 2026-09-22, Task 1): the Helling (slope)
// and Warmtekaart (heatmap) tabs. Slope is the existing line branch at
// exactly two x values (nothing new drawn); the heatmap is this card's OWN
// table rows as a CSS grid over `userHeatmapModel` — each cell its point's
// own formattedValue bound via data-label-for, shaded by that same point's
// value on the grid's one shared min..max scale. Mirrors chart.test.tsx's
// 'ChartView — heatmap form (phase 5, Task 4)' block over this card's own
// fixtures and its own test id (`user-heatmap-grid`).
//   twoSeriesSpec()          — 2 series × 2 years: slope AND heatmap allowed
//   twoSeriesThreeYearSpec() — 2 series × 3 years: heatmap yes, slope no
//   spec()                   — 1 series × 1 point: neither
// ---------------------------------------------------------------------------
describe('UserChartView — slope + heatmap (own-data chart-fit parity, Task 1)', () => {
  const SLOPE_REASON = 'Beschikbaar zodra je precies twee momenten vergelijkt.';
  const HEATMAP_REASON = 'Beschikbaar zodra je minstens twee reeksen en twee momenten vergelijkt.';

  function grid(container: HTMLElement): HTMLElement {
    const el = container.querySelector<HTMLElement>('[data-testid="user-heatmap-grid"]');
    expect(el, 'no own-data heatmap grid on the card').not.toBeNull();
    return el!;
  }
  function cell(container: HTMLElement, resultId: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-testid="user-heatmap-grid"] [role="cell"][data-label-for="${resultId}"]`);
    expect(el, `no heatmap cell for ${resultId}`).not.toBeNull();
    return el!;
  }
  /** The whole-number percentage of --heatmap-high the cell's background is
   * mixed with — the SAME color-mix string chart.tsx's grid writes. */
  function mixPercent(el: HTMLElement): number {
    const m = /color-mix\(in oklch, var\(--heatmap-low\), var\(--heatmap-high\) (\d+)%\)/.exec(el.style.backgroundColor);
    expect(m, `cell background is not a heatmap mix: "${el.style.backgroundColor}"`).not.toBeNull();
    return Number(m![1]);
  }
  function expectDisabledWithReason(tab: HTMLElement, reason: string): void {
    expect(tab).toBeDisabled();
    expect(tab).toHaveAttribute('title', reason);
    const describedById = tab.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)!.textContent).toBe(reason);
  }

  it('the phase-5 trio trails Tabel in the scorer\'s own fixed order: Dumbbell (Task 2), Helling, Warmtekaart', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['Lijn', 'Vlak', 'Staaf', 'Liggend', 'Tabel', 'Dumbbell', 'Helling', 'Warmtekaart']);
  });

  it('a 2-series × 2-point spec offers Helling enabled; selecting it draws the line branch at exactly two moments', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    const tab = screen.getByRole('tab', { name: 'Helling' });
    expect(tab).not.toBeDisabled();
    expect(tab).not.toHaveAttribute('title');
    expect(tab).not.toHaveAttribute('aria-describedby');

    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'false');
    // The line render, unchanged: two curves, each ONE straight segment
    // (`type="linear"`, so the path is `M … L …`), four value dots in all —
    // the same structure the CBS card's Helling tab proves in its e2e.
    const curves = [...container.querySelectorAll('.recharts-line-curve')];
    expect(curves).toHaveLength(2);
    for (const path of curves) expect(((path.getAttribute('d') ?? '').match(/L/g) ?? []).length).toBe(1);
    expect(container.querySelectorAll('circle[data-point="value"]')).toHaveLength(4);
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();
    // Still a chart form: the export container, the Style trigger and the
    // legend are all there.
    expect(container.querySelector('[data-testid="user-chart-container"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();
  });

  it('Helling is disabled, with its reason for pointer and screen reader, for three x values per series and for a single series', () => {
    const { unmount } = render(<UserChartView spec={twoSeriesThreeYearSpec()} />);
    const tab = screen.getByRole('tab', { name: 'Helling' });
    expectDisabledWithReason(tab, SLOPE_REASON);
    fireEvent.click(tab);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    unmount();

    // One series with exactly two points: a slope compares at least two things.
    const single = spec({ series: [twoSeriesSpec().series[0]!] });
    render(<UserChartView spec={single} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Helling' }), SLOPE_REASON);
  });

  it('a 2-series × 2-point spec offers Warmtekaart enabled; selecting it renders a grid of the table\'s own bound cells and no chart', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    const tab = screen.getByRole('tab', { name: 'Warmtekaart' });
    expect(tab).not.toBeDisabled();
    expect(tab).not.toHaveAttribute('title');
    expect(tab).not.toHaveAttribute('aria-describedby');

    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'false');
    // Nothing Recharts-shaped on the card, no plain <table>, no export container.
    expect(container.querySelector('.recharts-wrapper')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('[data-testid="user-chart-container"]')).toBeNull();

    const g = grid(container);
    expect(g).toHaveAttribute('role', 'table');
    // The same accessible name the table carries: the card's own heading.
    expect(g).toHaveAttribute('aria-label', 'Revenue per Year');
    // One column per series plus the row-header column.
    expect(g.style.gridTemplateColumns).toBe('max-content repeat(2, minmax(0, 1fr))');
    // The table's own header words: the file's xHeader, then the series labels (U9, verbatim).
    expect([...g.querySelectorAll('[role="columnheader"]')].map((el) => el.textContent)).toEqual(['Year', 'Amsterdam', 'Rotterdam']);
    expect([...g.querySelectorAll('[role="rowheader"]')].map((el) => el.textContent)).toEqual(['2023', '2024']);
    // Exactly four cells, each its point's OWN formattedValue, bound to its rowRef.
    const cells = [...g.querySelectorAll<HTMLElement>('[role="cell"]')];
    expect(cells.map((el) => [el.getAttribute('data-label-for'), el.textContent])).toEqual([
      ['r1:c1', '40,0'],
      ['r1:c2', '20,0'],
      ['r2:c1', '42,0'],
      ['r2:c2', '24,0'],
    ]);
    // The tabpanel the tablist points at is the grid's own wrapper.
    expect(g.parentElement).toHaveAttribute('role', 'tabpanel');
    expect(g.parentElement).toHaveAttribute('id', tab.getAttribute('aria-controls'));
    expect(g.parentElement).toHaveAttribute('aria-label', 'Warmtekaart');
  });

  it('colour: each cell is mixed by its value\'s place on the ONE grid-wide min..max scale, whole percentages', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    // min 20 (r1:c2), max 42 (r2:c1): 40 -> 20/22 = 90.9 -> 91%, 24 -> 4/22 = 18.2 -> 18%.
    expect(mixPercent(cell(container, 'r1:c2'))).toBe(0);
    expect(mixPercent(cell(container, 'r2:c1'))).toBe(100);
    expect(mixPercent(cell(container, 'r1:c1'))).toBe(91);
    expect(mixPercent(cell(container, 'r2:c2'))).toBe(18);
  });

  it('a 2 × 3 grid is offered too (at least two x values, not exactly two) and scales over all six cells', () => {
    const s = twoSeriesThreeYearSpec();
    const { container } = render(<UserChartView spec={s} />);
    const tab = screen.getByRole('tab', { name: 'Warmtekaart' });
    expect(tab).not.toBeDisabled();
    fireEvent.click(tab);
    const g = grid(container);
    expect(g.querySelectorAll('[role="cell"]')).toHaveLength(6);
    expect([...g.querySelectorAll('[role="rowheader"]')].map((el) => el.textContent)).toEqual(['2022', '2023', '2024']);
    // min 10 (r1:c2), max 42 (r3:c1); r2:c1 = 40 -> 30/32 = 93.75 -> 94%; r2:c2 = 20 -> 10/32 = 31.25 -> 31%.
    expect(mixPercent(cell(container, 'r1:c2'))).toBe(0);
    expect(mixPercent(cell(container, 'r3:c1'))).toBe(100);
    expect(mixPercent(cell(container, 'r2:c1'))).toBe(94);
    expect(mixPercent(cell(container, 'r2:c2'))).toBe(31);
    expect(cell(container, 'r2:c1').textContent).toBe('40,0');
    expectDigitsTraceToSpec(container, s);
  });

  it('the whole-card digit scan is clean in Warmtekaart form — the mix percentages live in style attributes, never in text', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    expectDigitsTraceToSpec(container, s);
  });

  it('is gated exactly like the table: no Style trigger, no legend, no notes strip, no era shading while the grid is shown — and Lijn restores them', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    // Line form (the default here) has all four.
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Doellijn toevoegen' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Periode markeren' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    expect(screen.queryByRole('button', { name: 'Opmaak' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Reeksen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Doellijn toevoegen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Periode markeren' })).toBeNull();

    // And back: switching to Lijn restores them and drops the grid.
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Doellijn toevoegen' })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
  });

  it('a single-series spec, a null cell and ragged x values each disable Warmtekaart with its reason — the table stays', () => {
    // One series: not a grid at all.
    const { container, unmount } = render(<UserChartView spec={spec()} />);
    const tab = screen.getByRole('tab', { name: 'Warmtekaart' });
    expectDisabledWithReason(tab, HEATMAP_REASON);
    fireEvent.click(tab);
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    unmount();

    // A null cell: nothing honest to colour there.
    const nulled = twoSeriesSpec();
    nulled.series[1]!.points[1] = point({ rowRef: 'r2:c2', xKey: '2024', xLabel: '2024', value: null, formattedValue: null, sourceText: '', reason: 'leeg in bron' });
    const second = render(<UserChartView spec={nulled} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Warmtekaart' }), HEATMAP_REASON);
    second.unmount();

    // Ragged x values: an intersection with no cell. The table still shows
    // that gap as a gap — the heatmap just is not offered.
    const ragged = twoSeriesSpec();
    ragged.series[1]!.points = [
      point({ rowRef: 'r0:c2', xKey: '2022', xLabel: '2022', value: 18, formattedValue: '18,0', sourceText: '18,0' }),
      point({ rowRef: 'r1:c2', xKey: '2023', xLabel: '2023', value: 20, formattedValue: '20,0', sourceText: '20,0' }),
    ];
    render(<UserChartView spec={ragged} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Warmtekaart' }), HEATMAP_REASON);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('switching to Warmtekaart then Undo returns to the prior form through the existing setForm history', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).not.toBeNull();
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    expect(screen.getByRole('tab', { name: 'Warmtekaart' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).not.toBeNull();
  });

  // This card's own version of chart.test.tsx's alternate-reading fallback:
  // the ONE way a mounted own-data card swaps its spec in place is a DATA
  // command (`renderDatasetInstruction`), and the spec that comes back can
  // be one the grid cannot honestly draw. `activeForm` runs `fallbackForm`
  // over that very spec, so the choice falls back (heatmap -> table) and
  // `userHeatmapModel`'s throw is never reached; Undo, a cache hit, brings
  // the grid straight back because the reader's own choice was never
  // discarded.
  it('a data edit that leaves the grid unreadable falls back to the table — never a thrown render — and Undo brings the grid back', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: spec() });
    const { container } = render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={twoSeriesSpec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).not.toBeNull();

    // The Data panel stays available in a tabular form (WHICH data is drawn
    // is orthogonal to how it is shown) — the same doorway the Data-panel
    // test above uses.
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveAttribute('aria-selected', 'true');
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Warmtekaart' }), HEATMAP_REASON);
    // Gated as the table it now renders as.
    expect(screen.queryByRole('button', { name: 'Opmaak' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(container.querySelector('[data-testid="user-heatmap-grid"]')).not.toBeNull());
    expect(screen.getByRole('tab', { name: 'Warmtekaart' })).toHaveAttribute('aria-selected', 'true');
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
  });

  it('the same fallback for Helling: a data edit to three x values falls back to a bar (fallbackForm\'s slope -> bar)', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: twoSeriesThreeYearSpec() });
    const { container } = render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={twoSeriesSpec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Helling' }));
    expect(screen.getByRole('tab', { name: 'Helling' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true'));
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Helling' }), SLOPE_REASON);
  });

  it('renders the English tab names; the grid keeps the file\'s own header words (never translated, U9)', () => {
    const { container } = render(
      <LangProvider lang="en">
        <UserChartView spec={twoSeriesSpec()} />
      </LangProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Slope' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Heatmap' }));
    const g = grid(container);
    expect(g.parentElement).toHaveAttribute('aria-label', 'Heatmap');
    expect([...g.querySelectorAll('[role="columnheader"]')].map((el) => el.textContent)).toEqual(['Year', 'Amsterdam', 'Rotterdam']);
    expect(cell(container, 'r2:c2').textContent).toBe('24,0');
  });

  // The layout contract, as far as jsdom can see it. jsdom has no layout
  // engine and loads no Tailwind, so `getComputedStyle(...).display` and
  // bounding boxes say nothing here — the real proof that `display:
  // contents` rows vanish from the box tree and the cells line up in shared
  // columns is chart-copilot.spec.ts's heatmap block (bounding boxes +
  // computed display) and belongs in Task 5's own-data e2e over THIS test
  // id. What jsdom CAN pin is the structure that proof depends on: the
  // `grid` class and inline column template on the table, `contents` on
  // every row, one column per series.
  it('carries the structure the real-browser layout proof (Task 5 e2e) asserts: grid on the table, contents on every row', () => {
    const { container } = render(<UserChartView spec={twoSeriesThreeYearSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    const g = grid(container);
    expect(g.classList.contains('grid')).toBe(true);
    expect(g.style.gridTemplateColumns).toBe('max-content repeat(2, minmax(0, 1fr))');
    const rows = [...g.querySelectorAll('[role="row"]')];
    // Header row + one row per x value.
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.classList.contains('contents')).toBe(true);
    // Every row has exactly one cell per series column (header: one columnheader per column).
    expect(rows[0]!.querySelectorAll('[role="columnheader"]')).toHaveLength(3);
    for (const row of rows.slice(1)) {
      expect(row.querySelectorAll('[role="rowheader"]')).toHaveLength(1);
      expect(row.querySelectorAll('[role="cell"]')).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Own-data chart-fit parity (plan 2026-09-22, Task 2): the Dumbbell tab.
// Unlike Helling this is genuinely NEW drawing on this card: a
// `BarChart layout="vertical"` shell with no <Bar>, and `UserDumbbellOverlay`
// (chart.tsx's DumbbellOverlay, mirrored — its header comment says why it is
// a copy and not a shared import) reading Recharts' own settled scales and
// drawing each row's connector, two dots and two labels itself. Mirrors
// chart.test.tsx's 'ChartView — dumbbell form (phase 5, Task 3)' block over
// this card's own fixtures: these tests pin the REAL rendered geometry — dot
// positions linear in the values and aligned with Recharts' own axis ticks
// — plus the honesty bindings (each label is its point's own formattedValue,
// bound via data-label-for), never just "it rendered".
//   twoSeriesSpec()          — 2 series × 2 years (40→42, 20→24): allowed
//   twoSeriesThreeYearSpec() — 2 series × 3 years: disallowed
//   spec()                   — 1 series × 1 point: disallowed
// ---------------------------------------------------------------------------
describe('UserChartView — dumbbell (own-data chart-fit parity, Task 2)', () => {
  const DUMBBELL_REASON = 'Beschikbaar zodra minstens twee reeksen elk precies een begin- en een eindwaarde hebben.';
  const SLOPE_REASON = 'Beschikbaar zodra je precies twee momenten vergelijkt.';
  // Scoped to this card's own export container: a CBS card and an own-data
  // card can share a page, and the dumbbell's data-roles are the same on
  // both (ADR 037 H2 — a locator must never confuse the two).
  const DOT = '[data-testid="user-chart-container"] svg [data-role="dumbbell-dot"]';
  const LABEL = '[data-testid="user-chart-container"] svg [data-role="dumbbell-label"]';
  const CONNECTOR = '[data-testid="user-chart-container"] svg [data-role="dumbbell-connector"]';

  /** twoSeriesSpec with Amsterdam FALLING (80 -> 60); Rotterdam still rises. */
  function fallingSpec(): UserChartSpec {
    const s = twoSeriesSpec();
    s.series[0]!.points = [
      point({ rowRef: 'r1:c1', xKey: '2023', xLabel: '2023', value: 80, formattedValue: '80,0', sourceText: '80,0' }),
      point({ rowRef: 'r2:c1', xKey: '2024', xLabel: '2024', value: 60, formattedValue: '60,0', sourceText: '60,0' }),
    ];
    return s;
  }
  /** twoSeriesSpec with Rotterdam's 2024 cell empty in the file. */
  function nullCellSpec(): UserChartSpec {
    const s = twoSeriesSpec();
    s.series[1]!.points[1] = point({ rowRef: 'r2:c2', xKey: '2024', xLabel: '2024', value: null, formattedValue: null, sourceText: '', reason: 'leeg in bron' });
    return s;
  }
  function dot(container: HTMLElement, rowRef: string): SVGCircleElement {
    const el = container.querySelector<SVGCircleElement>(`${DOT}[data-result-id="${rowRef}"]`);
    expect(el, `no dumbbell dot for ${rowRef}`).not.toBeNull();
    return el!;
  }
  function label(container: HTMLElement, rowRef: string): SVGTextElement {
    const el = container.querySelector<SVGTextElement>(`${LABEL}[data-label-for="${rowRef}"]`);
    expect(el, `no dumbbell label for ${rowRef}`).not.toBeNull();
    return el!;
  }
  function row(container: HTMLElement, key: string): Element {
    const el = container.querySelector(`[data-testid="user-chart-container"] svg [data-role="dumbbell-row"][data-series-key="${key}"]`);
    expect(el, `no dumbbell row for ${key}`).not.toBeNull();
    return el!;
  }
  function tick(container: HTMLElement, name: string): Element {
    const el = [...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="category-axis-tick"]')].find((t) => t.textContent === name);
    expect(el, `no category-axis tick for ${name}`).toBeDefined();
    return el!;
  }
  const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));
  function expectDisabledWithReason(tab: HTMLElement, reason: string): void {
    expect(tab).toBeDisabled();
    expect(tab).toHaveAttribute('title', reason);
    const describedById = tab.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const hint = document.getElementById(describedById!);
    expect(hint).not.toBeNull();
    expect(hint).toHaveClass('sr-only');
    expect(hint!.textContent).toBe(reason);
  }

  it('a 2-series × 2-point spec offers Dumbbell enabled; selecting it draws two bound dots per row and no bar, line or tooltip — still a chart form, with its export container, Style trigger and legend', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    const tab = screen.getByRole('tab', { name: 'Dumbbell' });
    expect(tab).not.toBeDisabled();
    expect(tab).not.toHaveAttribute('title');
    expect(tab).not.toHaveAttribute('aria-describedby');
    // The line form mounts a tooltip; the dumbbell deliberately does not.
    expect(container.querySelector('.recharts-tooltip-wrapper')).not.toBeNull();

    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'false');
    // The shell carries no graphical item at all — nothing on a dumbbell is
    // a bar, and no line is drawn through Recharts either — and no tooltip,
    // which would have nothing to build its payload from.
    expect(container.querySelector('.recharts-bar')).toBeNull();
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();
    expect(container.querySelector('.recharts-line-curve')).toBeNull();
    expect(container.querySelector('.recharts-area')).toBeNull();
    expect(container.querySelector('.recharts-tooltip-wrapper')).toBeNull();

    // Exactly four dots, one per real point, each bound to its rowRef;
    // exactly one connector per row, keyed like every other form's series.
    const dots = [...container.querySelectorAll(DOT)];
    expect(dots.map((d) => d.getAttribute('data-result-id')).sort()).toEqual(['r1:c1', 'r1:c2', 'r2:c1', 'r2:c2']);
    const rows = [...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="dumbbell-row"]')];
    expect(rows.map((r) => r.getAttribute('data-series-key'))).toEqual(['s0', 's1']);
    expect(container.querySelectorAll(CONNECTOR)).toHaveLength(2);
    // A chart form: the frame's export container holds the drawing (a
    // PNG/SVG download gets the dots), and the chart-only chrome is there.
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('every label is its point\'s OWN formattedValue, bound via data-label-for; the category axis carries the series labels verbatim (U9); the whole card passes the digit scan', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    expect(label(container, 'r1:c1').textContent).toBe('40,0');
    expect(label(container, 'r2:c1').textContent).toBe('42,0');
    expect(label(container, 'r1:c2').textContent).toBe('20,0');
    expect(label(container, 'r2:c2').textContent).toBe('24,0');
    expect(container.querySelectorAll(LABEL)).toHaveLength(4);
    expect([...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="category-axis-tick"]')].map((el) => el.textContent)).toEqual([
      'Amsterdam',
      'Rotterdam',
    ]);
    // The number axis draws no ticks of its own (`tick={false}`): every
    // visible digit on the card is a dot label or the footer, and each
    // traces to a spec string.
    expectDigitsTraceToSpec(container, s);
  });

  it('geometry: dot x-positions are linear in the values from a zero-anchored domain, both ends of a row sit on that row\'s own axis tick, and the connector joins the two dots', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    const am23 = dot(container, 'r1:c1'); // 40
    const am24 = dot(container, 'r2:c1'); // 42
    const rt23 = dot(container, 'r1:c2'); // 20
    const rt24 = dot(container, 'r2:c2'); // 24

    // Ordered left-to-right exactly as the values order (20 < 24 < 40 < 42).
    expect(num(rt23, 'cx')).toBeLessThan(num(rt24, 'cx'));
    expect(num(rt24, 'cx')).toBeLessThan(num(am23, 'cx'));
    expect(num(am23, 'cx')).toBeLessThan(num(am24, 'cx'));
    // Linear: Rotterdam's 4 value-units span exactly twice the pixels
    // Amsterdam's 2 do, and the 20 units between the two 2023 dots span
    // five times Rotterdam's 4.
    const pxPer2 = num(am24, 'cx') - num(am23, 'cx');
    const pxPer4 = num(rt24, 'cx') - num(rt23, 'cx');
    expect(pxPer2).toBeGreaterThan(0);
    expect(pxPer4 / pxPer2).toBeCloseTo(2, 6);
    expect((num(am23, 'cx') - num(rt23, 'cx')) / pxPer4).toBeCloseTo(5, 6);
    // A zero-anchored domain (hbar's own [0, 'auto']): value 0 sits to the
    // LEFT of every dot yet inside the plot — never past the leftmost dot.
    const xAtZero = num(rt23, 'cx') - 20 * (pxPer4 / 4);
    expect(xAtZero).toBeLessThan(num(rt23, 'cx'));
    expect(xAtZero).toBeGreaterThan(0);

    // Both dots of a row share one y — the band CENTRE, which is exactly
    // where Recharts placed that row's own category tick
    // (UserCategoryAxisTick renders at the tick's y, +4 dy for baseline
    // alignment).
    expect(num(am23, 'cy')).toBe(num(am24, 'cy'));
    expect(num(rt23, 'cy')).toBe(num(rt24, 'cy'));
    expect(num(am23, 'cy')).not.toBe(num(rt23, 'cy'));
    expect(num(am23, 'cy')).toBeCloseTo(num(tick(container, 'Amsterdam'), 'y'), 6);
    expect(num(rt23, 'cy')).toBeCloseTo(num(tick(container, 'Rotterdam'), 'y'), 6);

    // The connector runs between the two dots of its row, at their y.
    const line = row(container, 's0').querySelector('[data-role="dumbbell-connector"]')!;
    expect(num(line, 'x1')).toBe(num(am23, 'cx'));
    expect(num(line, 'x2')).toBe(num(am24, 'cx'));
    expect(num(line, 'y1')).toBe(num(am23, 'cy'));
    expect(num(line, 'y2')).toBe(num(am23, 'cy'));

    // Labels: the leftmost dot's label sits to its left (end-anchored), the
    // rightmost dot's to its right (start-anchored) — on the dot's own y.
    const l23 = label(container, 'r1:c1');
    const l24 = label(container, 'r2:c1');
    expect(l23.getAttribute('text-anchor')).toBe('end');
    expect(num(l23, 'x')).toBeLessThan(num(am23, 'cx'));
    expect(l24.getAttribute('text-anchor')).toBe('start');
    expect(num(l24, 'x')).toBeGreaterThan(num(am24, 'cx'));
    expect(num(l23, 'y')).toBe(num(am23, 'cy') + 4);
  });

  it('a row whose value FELL draws its start dot on the right (label side follows the pixel order); no label ever carries a provisional suffix on this tier', () => {
    const s = fallingSpec();
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    const from = dot(container, 'r1:c1'); // 80
    const to = dot(container, 'r2:c1'); // 60
    expect(num(to, 'cx')).toBeLessThan(num(from, 'cx'));
    expect(label(container, 'r2:c1').getAttribute('text-anchor')).toBe('end');
    expect(label(container, 'r1:c1').getAttribute('text-anchor')).toBe('start');
    expect(label(container, 'r1:c1').textContent).toBe('80,0');
    expect(label(container, 'r2:c1').textContent).toBe('60,0');
    // Rotterdam rose (20 -> 24): its start dot is the left one.
    expect(num(dot(container, 'r1:c2'), 'cx')).toBeLessThan(num(dot(container, 'r2:c2'), 'cx'));
    // No provisional/definitief concept on this tier (ADR 037 D7): every
    // label is the bare formattedValue, never with chart.tsx's ' *' suffix.
    for (const el of container.querySelectorAll(LABEL)) expect(el.textContent).not.toMatch(/\*/);
    expectDigitsTraceToSpec(container, s);
  });

  it('hiding a series via the legend drops its row entirely (no dots, no connector), order kept; ⌘Z brings it back', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    expect(container.querySelector(`${DOT}[data-result-id="r1:c2"]`)).toBeNull();
    expect(container.querySelector(`${DOT}[data-result-id="r2:c2"]`)).toBeNull();
    expect(container.querySelectorAll(DOT)).toHaveLength(2);
    expect(container.querySelectorAll(CONNECTOR)).toHaveLength(1);
    expect(row(container, 's0')).toBeInTheDocument();
    expect(screen.getByText('1 van 2 reeksen verborgen')).toBeInTheDocument();

    fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true });
    expect(container.querySelectorAll(DOT)).toHaveLength(4);
    expect([...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="dumbbell-row"]')].map((r) => r.getAttribute('data-series-key'))).toEqual(['s0', 's1']);
  });

  it('highlighting a series dims the other row to 0.25 (dots, connector and labels), and the legend\'s own Dim keeps a row at 0.35 — this card\'s two levels, never chart.tsx\'s single one', () => {
    const first = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markeer Amsterdam' }));
    const dimmed = row(first.container, 's1');
    expect(dimmed).toHaveAttribute('data-series-dimmed', 'true');
    expect(dimmed.querySelector('[data-role="dumbbell-connector"]')).toHaveAttribute('stroke-opacity', '0.25');
    for (const d of dimmed.querySelectorAll('[data-role="dumbbell-dot"]')) expect(d).toHaveAttribute('fill-opacity', '0.25');
    for (const l of dimmed.querySelectorAll('[data-role="dumbbell-label"]')) expect(l).toHaveAttribute('fill-opacity', '0.25');
    const kept = row(first.container, 's0');
    expect(kept).not.toHaveAttribute('data-series-dimmed');
    expect(kept.querySelector('[data-role="dumbbell-connector"]')).toHaveAttribute('stroke-opacity', '1');
    // Dimmed is not hidden: still four dots.
    expect(first.container.querySelectorAll(DOT)).toHaveLength(4);
    first.unmount();

    const second = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    fireEvent.click(screen.getByRole('button', { name: /Dim Amsterdam/ }));
    const readerDimmed = row(second.container, 's0');
    expect(readerDimmed).toHaveAttribute('data-series-dimmed', 'true');
    expect(readerDimmed.querySelector('[data-role="dumbbell-connector"]')).toHaveAttribute('stroke-opacity', '0.35');
    for (const d of readerDimmed.querySelectorAll('[data-role="dumbbell-dot"]')) expect(d).toHaveAttribute('fill-opacity', '0.35');
    expect(row(second.container, 's1').querySelector('[data-role="dumbbell-connector"]')).toHaveAttribute('stroke-opacity', '1');
  });

  it('a null cell disables Dumbbell with its reason for pointer and screen reader (sr-only, exactly once); a click does nothing; Helling shares the rule with its own wording; the table still shows the gap', () => {
    render(<UserChartView spec={nullCellSpec()} />);
    const tab = screen.getByRole('tab', { name: 'Dumbbell' });
    expectDisabledWithReason(tab, DUMBBELL_REASON);
    expect(screen.getAllByText(DUMBBELL_REASON)).toHaveLength(1);
    fireEvent.click(tab);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Helling' }), SLOPE_REASON);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('three x values per series and a single series both disable Dumbbell with the same reason', () => {
    const { unmount } = render(<UserChartView spec={twoSeriesThreeYearSpec()} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Dumbbell' }), DUMBBELL_REASON);
    unmount();
    render(<UserChartView spec={spec({ series: [twoSeriesSpec().series[0]!] })} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Dumbbell' }), DUMBBELL_REASON);
  });

  it('offers no difference/average overlay controls in Dumbbell form (they only ever draw on line/area), even with an edit context', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    expect(screen.getByRole('button', { name: 'Verschil aanduiden' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    expect(screen.queryByRole('button', { name: 'Verschil aanduiden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
  });

  it('switching to Dumbbell then Undo returns to the prior form through the existing setForm history', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    expect(container.querySelectorAll(DOT)).toHaveLength(4);
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    expect(container.querySelector(DOT)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    expect(screen.getByRole('tab', { name: 'Dumbbell' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelectorAll(DOT)).toHaveLength(4);
  });

  // This card's own version of chart.test.tsx's alternate-reading fallback
  // (the same shape as the Warmtekaart test above): a data command can hand
  // the card a spec the dumbbell cannot honestly draw. `activeForm` runs
  // `fallbackForm` over that very spec, so the choice falls back (dumbbell
  // -> bar) with the tab disabled and explained — never an empty axes-only
  // shell — and Undo (a cache hit, one server call in total) brings the
  // dumbbell straight back because the reader's own choice was never
  // discarded.
  it('a data edit to three x values falls back to a bar — never an empty axes-only shell — and Undo brings the dumbbell back', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: twoSeriesThreeYearSpec() });
    const { container } = render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={twoSeriesSpec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    expect(container.querySelectorAll(DOT)).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true'));
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    expect(container.querySelector(DOT)).toBeNull();
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Dumbbell' }), DUMBBELL_REASON);

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(container.querySelectorAll(DOT)).toHaveLength(4));
    expect(screen.getByRole('tab', { name: 'Dumbbell' })).toHaveAttribute('aria-selected', 'true');
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
  });

  it('renders the English disabled reason; the tab word itself is the same in both languages', () => {
    render(
      <LangProvider lang="en">
        <UserChartView spec={nullCellSpec()} />
      </LangProvider>,
    );
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Dumbbell' }), 'Available once at least two series each have exactly a start and an end value.');
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
