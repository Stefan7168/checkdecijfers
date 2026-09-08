// VisualDock's first dedicated test file (design doc's own "fixed in review"
// finding — only incidental coverage via workspace.test.tsx's mocked
// dashboard before this). Two things this file exists to pin: (1) `chart`/
// `card` visuals (userChart: null) render EXACTLY as before this increment —
// tabs, the active ChartView/StatCard render, nothing userChart-shaped in
// the tree; (2) a `userChart` visual renders UserChartView, with the same
// tab-selection/active-pick mechanics as any other kind.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import type { UserChartSpec } from '../backend/attachments/types.ts';
import type { DockVisual } from '../lib/dock-visuals.ts';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { VisualDock } from './visual-dock.tsx';

afterEach(cleanup);

const CHART_SPEC: ChartSpec = {
  schemaVersion: 1,
  kind: 'line',
  title: 'Testreeks',
  dims: { Kenmerk: '000000' },
  dimLabels: { Kenmerk: 'Alle kenmerken' },
  unit: '%',
  series: [{
    label: 'Nederland',
    regionCode: 'NL01',
    points: [{
      resultId: 'r1',
      periodCode: '2024JJ00',
      periodLabel: '2024',
      value: 42,
      formattedValue: '42,0',
      decimals: 1,
      status: 'Definitief',
      provisional: false,
      valueAttribute: 'None',
    }],
  }],
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

const USER_CHART_SPEC: UserChartSpec = {
  schemaVersion: 1,
  origin: 'user_dataset',
  trust: 'unverified',
  kind: 'line',
  xHeader: 'Year',
  yHeaders: ['Revenue'],
  series: [{ label: 'Revenue', points: [{ rowRef: 'r1:c1', xKey: '2020', xLabel: '2020', value: 100, formattedValue: '100,0', sourceText: '100,0' }] }],
  provenance: { datasetId: 1, sourceKind: 'file_csv', displayName: 'verkoop.csv', sourceUrlHost: null, capturedAt: '2026-01-01', contentSha256: 'x' },
  disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.',
};

function chartVisual(overrides: Partial<DockVisual> = {}): DockVisual {
  return { id: 'visual-0', kind: 'chart', label: 'Grafiek 1', question: 'hoeveel', chart: CHART_SPEC, card: null, userChart: null, ...overrides };
}

describe('VisualDock — chart/card visuals stay byte-identical (userChart: null)', () => {
  it('renders no dock when there are no visuals', () => {
    const { container } = render(<VisualDock visuals={[]} activeVisualId={null} onSelect={vi.fn()} busy={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the ChartView for a chart visual and no UserChartView-only chrome', () => {
    render(<VisualDock visuals={[chartVisual()]} activeVisualId="visual-0" onSelect={vi.fn()} busy={false} />);
    expect(screen.getByRole('tab', { name: /Grafiek 1/ })).toBeInTheDocument();
    expect(screen.queryByText('Your data · unverified')).not.toBeInTheDocument();
  });

  it('renders the StatCard for a card visual', () => {
    const cardVisual: DockVisual = {
      id: 'visual-1',
      kind: 'card',
      label: 'Kaart 1',
      question: 'hoeveel',
      chart: null,
      userChart: null,
      card: { value: '42,0', unitSuffix: '%', measureTitle: 'Test', context: 'Nederland', provisional: false, tableId: '12345NED', sourceLabel: 'CBS StatLine', syncedDate: '2026-07-01' },
    };
    render(<VisualDock visuals={[cardVisual]} activeVisualId="visual-1" onSelect={vi.fn()} busy={false} />);
    expect(screen.getByText('42,0')).toBeInTheDocument();
  });

  it('falls back to the last visual when activeVisualId matches none, and switches on tab click', () => {
    const onSelect = vi.fn();
    const visuals = [chartVisual({ id: 'visual-0', label: 'Grafiek 1' }), chartVisual({ id: 'visual-1', label: 'Grafiek 2' })];
    render(<VisualDock visuals={visuals} activeVisualId="nonexistent" onSelect={onSelect} busy={false} />);
    expect(screen.getByRole('tab', { name: /Grafiek 2/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /Grafiek 1/ }));
    expect(onSelect).toHaveBeenCalledWith('visual-0');
  });
});

describe('VisualDock — the userChart branch (ADR 037 D10/WP202a)', () => {
  it('renders UserChartView (its H2 badge/chrome) for a userChart visual', () => {
    const visual: DockVisual = { id: 'visual-0', kind: 'userChart', label: 'Your chart 1', question: 'show revenue by year', chart: null, card: null, userChart: USER_CHART_SPEC };
    render(<VisualDock visuals={[visual]} activeVisualId="visual-0" onSelect={vi.fn()} busy={false} />);
    expect(screen.getByRole('tab', { name: /Your chart 1/ })).toBeInTheDocument();
    expect(screen.getByText('Your data · unverified')).toBeInTheDocument();
  });

  it('a userChart tab sits alongside CBS tabs, switching renders the right component for each', () => {
    const onSelect = vi.fn();
    const visuals = [chartVisual({ id: 'visual-0', label: 'Grafiek 1' }), { id: 'visual-1', kind: 'userChart' as const, label: 'Your chart 1', question: 'q', chart: null, card: null, userChart: USER_CHART_SPEC }];
    const { rerender } = render(<VisualDock visuals={visuals} activeVisualId="visual-0" onSelect={onSelect} busy={false} />);
    expect(screen.queryByText('Your data · unverified')).not.toBeInTheDocument();
    rerender(<VisualDock visuals={visuals} activeVisualId="visual-1" onSelect={onSelect} busy={false} />);
    expect(screen.getByText('Your data · unverified')).toBeInTheDocument();
  });
});

describe('VisualDock — busy skeleton (chat interaction polish, session 88)', () => {
  it('shows a chart skeleton instead of the active visual while busy', () => {
    render(<VisualDock visuals={[chartVisual()]} activeVisualId="visual-0" onSelect={vi.fn()} busy={true} />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  });

  it('keeps the tabs visible and clickable while busy', () => {
    const onSelect = vi.fn();
    const visuals = [chartVisual({ id: 'visual-0', label: 'Grafiek 1' }), chartVisual({ id: 'visual-1', label: 'Grafiek 2' })];
    render(<VisualDock visuals={visuals} activeVisualId="visual-1" onSelect={onSelect} busy={true} />);
    fireEvent.click(screen.getByRole('tab', { name: /Grafiek 1/ }));
    expect(onSelect).toHaveBeenCalledWith('visual-0');
  });

  it('shows the real chart again once busy clears', () => {
    const { rerender } = render(<VisualDock visuals={[chartVisual()]} activeVisualId="visual-0" onSelect={vi.fn()} busy={true} />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    rerender(<VisualDock visuals={[chartVisual()]} activeVisualId="visual-0" onSelect={vi.fn()} busy={false} />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
  });
});

// WP218 phase 4 (#219): proves the language switch reaches the dock's own
// chrome (the tab labels/questions are DockVisual data, out of scope here).
describe('VisualDock — en', () => {
  it('renders the English header + tablist label under LangProvider lang="en"', () => {
    render(
      <LangProvider lang="en">
        <VisualDock visuals={[chartVisual()]} activeVisualId="visual-0" onSelect={vi.fn()} busy={false} />
      </LangProvider>,
    );
    expect(screen.getByText('Charts')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Visualizations' })).toBeInTheDocument();
  });
});
