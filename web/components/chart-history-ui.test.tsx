// Chart co-pilot phase 1 (session 112, ADR 056) — undo/redo at the chart
// card: every reader edit goes through the command history, the app's own
// view moves (a story step, the spec-swap reset, stage mode, the embed
// `?form=` seed) never do.
//
// Mock block copied verbatim from chart-headline-ui.test.tsx; the fixture is
// chart.test.tsx's own `twoSeriesLineSpec` (that file exports no fixtures).
// Every accessible name below is taken from an existing test: the form tabs
// ('Lijn'/'Staaf') from chart.test.tsx:1414-1418, the legend's hide button
// (its name is just the series label) from chart.test.tsx:2350, the Embed
// trigger from chart-embed-dialog.test.tsx (Dutch label 'Insluiten' here,
// since ChartView defaults to nl).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';

const chartHeadlineActions = vi.hoisted(() => ({
  draftChartHeadline: vi.fn(),
  saveChartHeadline: vi.fn(),
  fetchChartHeadline: vi.fn().mockResolvedValue({ ok: true, headline: null }),
}));
vi.mock('../app/chart-headline-actions.ts', () => chartHeadlineActions);
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

// Fix round 1: a spec with a sharp jump on the first series, so
// `buildFindings` returns at least one finding and the Insights story is
// actually available (`storyAvailable`). Copied from chart-headline-ui.test.tsx's
// own `twoSeriesFindingsSpec`, which exists for exactly the same reason.
function twoSeriesFindingsSpec(): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Werkloosheidspercentage',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
    series: [
      {
        label: 'Nederland',
        regionCode: 'NL01',
        points: [
          point({ resultId: 'nl-2023', periodCode: '2023JJ00', periodLabel: '2023', value: 3.0, formattedValue: '3,0' }),
          point({ resultId: 'nl-2024', periodCode: '2024JJ00', periodLabel: '2024', value: 3.1, formattedValue: '3,1' }),
          point({ resultId: 'nl-2025', periodCode: '2025JJ00', periodLabel: '2025', value: 5.2, formattedValue: '5,2' }),
        ],
      },
      {
        label: 'Utrecht',
        regionCode: 'PV26',
        points: [
          point({ resultId: 'ut-2023', periodCode: '2023JJ00', periodLabel: '2023', value: 2.0, formattedValue: '2,0' }),
          point({ resultId: 'ut-2024', periodCode: '2024JJ00', periodLabel: '2024', value: 2.1, formattedValue: '2,1' }),
          point({ resultId: 'ut-2025', periodCode: '2025JJ00', periodLabel: '2025', value: 2.3, formattedValue: '2,3' }),
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
      coveredPeriods: { from: '2023', to: '2025' },
      license: 'CC BY 4.0',
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('undo / redo at the chart card', () => {
  it('hiding a series then Undo brings it back; Redo hides it again', () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Nederland' }));
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(1);
  });

  it('⌘Z on the card undoes; ⇧⌘Z redoes; both buttons are disabled when there is nothing to do', () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    const undoBtn = screen.getByRole('button', { name: 'Ongedaan maken' });
    const redoBtn = screen.getByRole('button', { name: 'Opnieuw' });
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(undoBtn).toBeEnabled();
    fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true });
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true, shiftKey: true });
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Ctrl+Y redoes too (the Windows idiom)', () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    fireEvent.keyDown(container.firstElementChild!, { key: 'z', ctrlKey: true });
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(container.firstElementChild!, { key: 'y', ctrlKey: true });
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
  });

  it("⌘Z inside a text field is left to the field's own native undo", () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    // A text field mounted INSIDE the card: the handler sits on the card
    // root, so an event bubbling from an <input> must be left alone.
    const input = document.createElement('input');
    container.firstElementChild!.appendChild(input);
    fireEvent.keyDown(input, { key: 'z', metaKey: true, bubbles: true });
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
  });

  it('the spec-swap reset never leaves history entries behind', () => {
    const { rerender } = render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeEnabled();
    const other = twoSeriesLineSpec();
    other.title = 'Andere grafiek';
    rerender(<ChartView spec={other} />);
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeDisabled();
  });

  it('embed mode renders no undo controls', () => {
    render(<ChartView spec={twoSeriesLineSpec()} embedMode embed={{ auditId: 1 }} embedFooter="x" />);
    expect(screen.queryByRole('button', { name: 'Ongedaan maken' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Opnieuw' })).toBeNull();
  });

  // Fix round 1 (review finding 1): while the Insights story is open, every
  // reader control that could contradict the active step's caption is
  // disabled (the legend, the Vanaf/Tot selects, small multiples). Undo/Redo
  // must obey the SAME lock — an undo that silently put a hidden series back
  // would walk straight through it — and a story STEP is the app moving its
  // own view, never a reader edit, so it leaves no history entry behind.
  describe('the story-mode control lock', () => {
    it('disables Undo/Redo while the story is open, and ⌘Z does nothing', () => {
      const { container } = render(<ChartView spec={twoSeriesFindingsSpec()} />);
      // One real edit first, so Undo would otherwise be enabled.
      fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
      expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeEnabled();
      // Back to Lijn: the story is only available off the table form, and
      // this leaves a second entry so Redo is live too.
      fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
      expect(screen.getByRole('button', { name: 'Opnieuw' })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
      expect(screen.getByRole('region', { name: 'Inzichten bij de grafiek' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Opnieuw' })).toBeDisabled();

      const formBefore = screen.getByRole('tab', { name: 'Staaf' }).getAttribute('aria-selected');
      fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true });
      fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true, shiftKey: true });
      expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', formBefore!);
    });

    it('a story step never creates a history entry', () => {
      render(<ChartView spec={twoSeriesFindingsSpec()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
      expect(screen.getByRole('region', { name: 'Inzichten bij de grafiek' })).toBeInTheDocument();
      // Stepping through the story moves the highlight (a raw dispatch).
      fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
      // Close the story again: the lock lifts, and there is still nothing to undo.
      fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
      expect(screen.queryByRole('region', { name: 'Inzichten bij de grafiek' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Opnieuw' })).toBeDisabled();
    });
  });

  it('the embed dialog still receives the current form (the same state serialises as before)', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 42 }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insluiten' }));
    expect(await screen.findByText(/form=bar/)).toBeInTheDocument();
  });
});
