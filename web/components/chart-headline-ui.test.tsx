// Journalist chart-headline UI (Task 6): draft/edit/save/display, in a NEW
// adjacent file rather than growing the already-2,800+-line chart.test.tsx
// (plan's own file-structure guidance).
//
// Mocking/render conventions copied verbatim from chart.test.tsx (confirmed
// this session, not guessed): `vi.hoisted` + `vi.mock` for a Server Action
// module chart.tsx imports directly (mirrors chartInsightsActions there);
// `render(<ChartView spec={...} />)` bare = signedIn false (the
// ChartStyleContext default, web/lib/chart-style-context.tsx:32); wrapping
// in `<ChartStyleProvider initial={{}}>...</ChartStyleProvider>` = signedIn
// true (same file, line 50).
//
// The fixture below is NOT copied from the task brief verbatim: the brief's
// own inline fixture omitted `schemaVersion`/`attribution`/`attributionLine`/
// `dims`/`dimLabels`, which chart.tsx requires (it renders an early
// "chart.schemaRefusal" bail-out whenever `spec.schemaVersion !== 1`, before
// any of this feature's UI is reached). Modelled instead on chart.test.tsx's
// own working `spec()`/`point()` helpers (chart.test.tsx:87-125), since
// chart.test.tsx does not export its fixtures for reuse.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
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

// Two series, several points each, with a sharp jump on the first series so
// scoreFindings(spec) reliably returns at least one finding (the trigger's
// own gate, mirroring the Insights trigger's storyAvailable-from-findings
// gate).
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
  chartHeadlineActions.draftChartHeadline.mockReset();
  chartHeadlineActions.saveChartHeadline.mockReset();
  chartHeadlineActions.fetchChartHeadline.mockReset().mockResolvedValue({ ok: true, headline: null });
});

describe('chart headline — trigger visibility', () => {
  it('shows a "Kop voorstellen" trigger only when embed.auditId is present and findings exist', () => {
    render(<ChartView spec={twoSeriesFindingsSpec()} embed={{ auditId: 1 }} />);
    expect(screen.getByText('Kop voorstellen')).toBeInTheDocument();
  });

  it('shows no trigger without an auditId (e.g. an anonymous/trial chart)', () => {
    render(<ChartView spec={twoSeriesFindingsSpec()} />);
    expect(screen.queryByText('Kop voorstellen')).not.toBeInTheDocument();
  });
});

describe('chart headline — draft, edit, save', () => {
  it('drafts via the mocked action, lets the user edit the draft, and saves it', async () => {
    chartHeadlineActions.draftChartHeadline.mockResolvedValue({ ok: true, headline: 'Werkloosheid stijgt scherp' });
    chartHeadlineActions.saveChartHeadline.mockResolvedValue({ ok: true });
    render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={twoSeriesFindingsSpec()} embed={{ auditId: 1 }} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByText('Kop voorstellen'));
    await screen.findByDisplayValue('Werkloosheid stijgt scherp');
    fireEvent.change(screen.getByDisplayValue('Werkloosheid stijgt scherp'), { target: { value: 'Werkloosheid stijgt fors' } });
    fireEvent.click(screen.getByText('Opslaan'));
    await screen.findByTestId('chart-headline-text');
    expect(screen.getByTestId('chart-headline-text')).toHaveTextContent('Werkloosheid stijgt fors');
    expect(chartHeadlineActions.saveChartHeadline).toHaveBeenCalledWith(1, 'Werkloosheid stijgt fors');
  });

  it('shows the unauthenticated message when drafting while signed out', () => {
    render(<ChartView spec={twoSeriesFindingsSpec()} embed={{ auditId: 1 }} />);
    fireEvent.click(screen.getByText('Kop voorstellen'));
    expect(screen.getByText('Log in om een kop toe te voegen.')).toBeInTheDocument();
    expect(chartHeadlineActions.draftChartHeadline).not.toHaveBeenCalled();
  });

  // #6 (session 110 UX audit pass 2): a failed DRAFT used to show "Kon de
  // kop niet opslaan" (the SAVE error) — nothing was being saved yet. The
  // draft path must use its own string.
  it('shows a draft-specific error when the AI draft call fails, not the save-error message', async () => {
    chartHeadlineActions.draftChartHeadline.mockResolvedValue({ ok: false, reason: 'error' });
    render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={twoSeriesFindingsSpec()} embed={{ auditId: 1 }} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByText('Kop voorstellen'));
    expect(await screen.findByText('Kon de kop niet voorstellen.')).toBeInTheDocument();
    expect(screen.queryByText('Kon de kop niet opslaan.')).not.toBeInTheDocument();
  });

  // #15 (session 110 UX audit pass 2): the headline error paragraph had no
  // role="alert" — a screen-reader user who triggered a failure heard
  // nothing.
  it('announces a draft failure to assistive tech via role="alert"', async () => {
    chartHeadlineActions.draftChartHeadline.mockResolvedValue({ ok: false, reason: 'error' });
    render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={twoSeriesFindingsSpec()} embed={{ auditId: 1 }} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByText('Kop voorstellen'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kon de kop niet voorstellen.');
  });

  // #15 also covers the SAVE-error paragraph (the second `headlineError`
  // render branch, shown while still in edit mode) — same requirement.
  it('announces a save failure to assistive tech via role="alert"', async () => {
    chartHeadlineActions.draftChartHeadline.mockResolvedValue({ ok: true, headline: 'Werkloosheid stijgt scherp' });
    chartHeadlineActions.saveChartHeadline.mockResolvedValue({ ok: false });
    render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={twoSeriesFindingsSpec()} embed={{ auditId: 1 }} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByText('Kop voorstellen'));
    await screen.findByDisplayValue('Werkloosheid stijgt scherp');
    fireEvent.click(screen.getByText('Opslaan'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kon de kop niet opslaan.');
  });
});
