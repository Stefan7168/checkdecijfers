// Co-pilot phase 3 (session 114, Task 3) — "Pas deze grafiek aan" on the
// CBS/Eurostat card. Mock block copied verbatim from
// chart-commands-contract.test.tsx, plus `../app/chart-copilot-actions.ts`
// (this task's own Server Action module — without the mock its real
// `'use server'` import graph would load in jsdom) and `ChartStyleProvider`
// for a signed-in render (the chart-edits-persistence.test.tsx precedent).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
import type { ChartSpec } from '../backend/chart/types.ts';
import { makeCommand } from '../lib/chart-commands.ts';
import { describeCommand } from './chart-history-menu.tsx';

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
const chartCopilotActions = vi.hoisted(() => ({ adjustCbsChart: vi.fn() }));
vi.mock('../app/chart-copilot-actions.ts', () => chartCopilotActions);

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
        label: 'Rotterdam',
        regionCode: 'GM0599',
        points: [
          point({ resultId: 'rt-2020', periodCode: '2020', periodLabel: '2020', value: 50, formattedValue: '50' }),
          point({ resultId: 'rt-2021', periodCode: '2021', periodLabel: '2021', value: 55, formattedValue: '55' }),
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

describe('the CBS chart co-pilot doorway — when it mounts', () => {
  it('is offered signed in, in-app, with a saved answer behind it', () => {
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 7 }} />
      </Provider>,
    );
    expect(screen.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' })).toBeInTheDocument();
  });

  it('is not offered without a saved answer (no embed.auditId)', () => {
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} />
      </Provider>,
    );
    expect(screen.queryByRole('group', { name: 'Deze grafiek aanpassen via de chat' })).not.toBeInTheDocument();
  });

  it('is not offered signed out', () => {
    render(
      <Provider signedIn={false}>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 7 }} />
      </Provider>,
    );
    expect(screen.queryByRole('group', { name: 'Deze grafiek aanpassen via de chat' })).not.toBeInTheDocument();
  });

  it('is not offered in embedMode', () => {
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 7 }} embedMode />
      </Provider>,
    );
    expect(screen.queryByRole('group', { name: 'Deze grafiek aanpassen via de chat' })).not.toBeInTheDocument();
  });
});

describe('the CBS chart co-pilot doorway — sending a message', () => {
  it('applies a setSeriesView reply and eventually saves the log with source "chat"', async () => {
    const hideCommand = { kind: 'setSeriesView' as const, hiddenKeys: ['s1'], highlightedKey: null };
    chartCopilotActions.adjustCbsChart.mockResolvedValue({
      kind: 'ok',
      netCost: 10,
      reply: {
        kind: 'edit',
        text: 'Applied one change.',
        commands: [hideCommand],
        refused: [],
        dataRequest: false,
        llmCalls: [],
      },
    });
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 7 }} />
      </Provider>,
    );
    const input = screen.getByPlaceholderText('Pas deze grafiek aan');
    fireEvent.change(input, { target: { value: 'verberg Rotterdam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Versturen' }));

    const expectedLabel = describeCommand(makeCommand(hideCommand, 'chat'), 'nl');
    await screen.findByRole('button', { name: expectedLabel });

    await waitFor(() => expect(chartEditsActions.saveChartEdits).toHaveBeenCalled());
    const lastCall = chartEditsActions.saveChartEdits.mock.calls.at(-1)!;
    const log = lastCall[1] as { source: string }[];
    expect(log.at(-1)!.source).toBe('chat');
  });

  it('offers a follow-up chip for a dataRequest reply, forwarding the original message', async () => {
    chartCopilotActions.adjustCbsChart.mockResolvedValue({
      kind: 'ok',
      netCost: 10,
      reply: {
        kind: 'edit',
        text: 'That asks for other data — ask it as a follow-up question and the answer gets its own chart.',
        commands: [],
        refused: [],
        dataRequest: true,
        llmCalls: [],
      },
    });
    const onAskFollowUp = vi.fn();
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 7 }} onAskFollowUp={onAskFollowUp} />
      </Provider>,
    );
    fireEvent.change(screen.getByPlaceholderText('Pas deze grafiek aan'), { target: { value: 'gemiddelde temperatuur' } });
    fireEvent.click(screen.getByRole('button', { name: 'Versturen' }));

    const followUpButton = await screen.findByRole('button', { name: 'Stel als vervolgvraag' });
    fireEvent.click(followUpButton);
    expect(onAskFollowUp).toHaveBeenCalledWith('gemiddelde temperatuur');
  });

  it('drops a command naming an unknown key and says so, dispatching nothing', async () => {
    chartCopilotActions.adjustCbsChart.mockResolvedValue({
      kind: 'ok',
      netCost: 10,
      reply: {
        kind: 'edit',
        text: 'Applied one change.',
        commands: [{ kind: 'setSeriesView', hiddenKeys: ['s9'], highlightedKey: null }],
        refused: [],
        dataRequest: false,
        llmCalls: [],
      },
    });
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 7 }} />
      </Provider>,
    );
    fireEvent.change(screen.getByPlaceholderText('Pas deze grafiek aan'), { target: { value: 'verberg s9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Versturen' }));

    await screen.findByText('Eén onderdeel kon niet worden toegepast.');
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });
});

describe('the "Grafiek uitgebreid" badge', () => {
  it('renders when extendsPrevious is true', () => {
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 7 }} extendsPrevious />
      </Provider>,
    );
    expect(screen.getByText('Grafiek uitgebreid')).toBeInTheDocument();
  });

  it('does not render otherwise', () => {
    render(
      <Provider>
        <ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 7 }} />
      </Provider>,
    );
    expect(screen.queryByText('Grafiek uitgebreid')).not.toBeInTheDocument();
  });
});
