// Chart co-pilot phase 1 (session 112, ADR 056), Task 5 — in-place title and
// caption editing on the chart card. Both are the READER's own words, so both
// go through the command history (undoable, and logged like every other edit)
// and both render OUTSIDE the export container. Session 136 (#278): a download
// now carries a title and the caption as SEPARATELY drawn text lines — the
// reader's own only when every number in it is on the chart (the numbers
// rule, web/lib/chart-publish.ts), otherwise the spec title and no caption.
//
// Mock block copied verbatim from chart-history-ui.test.tsx; the fixture is
// chart.test.tsx's own `twoSeriesLineSpec` (that file exports no fixtures).
// Accessible names come from the i18n table (nl, ChartView's default).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';

const chartHeadlineActions = vi.hoisted(() => ({
  draftChartHeadline: vi.fn(),
  saveChartHeadline: vi.fn(),
  fetchChartHeadline: vi.fn().mockResolvedValue({ ok: true, headline: null }),
}));
vi.mock('../app/chart-headline-actions.ts', () => chartHeadlineActions);
// Task 7 (co-pilot phase 1): chart.tsx imports the chart_edits Server Action
// module directly — without this mock the real module (and its db/auth
// imports) would load in jsdom.
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

// Fix round 1, finding 5: the story lock needs a spec `buildFindings` actually
// returns something for, or the Insights trigger is never offered. Copied from
// chart-history-ui.test.tsx's own `twoSeriesFindingsSpec`, which exists for the
// same reason.
function twoSeriesFindingsSpec(): ChartSpec {
  return {
    ...twoSeriesLineSpec(),
    title: 'Werkloosheidspercentage',
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
          point({ resultId: 'ut-2025', periodCode: '2025JJ00', periodLabel: '2025', value: 2.2, formattedValue: '2,2' }),
        ],
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});


/** WP-LOOK part (a) (session 142): every reader control now lives in the one
 * Edit popup (next/dynamic — its content lands a tick after the click). */
async function openEdit(index = 0): Promise<void> {
  fireEvent.click(screen.getAllByRole('button', { name: /^(Bewerken|Edit)$/ })[index]!);
  await screen.findAllByRole('tablist', { name: /^(Weergave|Chart type)$/ });
}
function closeEdit(): void {
  fireEvent.keyDown(document.querySelector('[role=dialog]')!, { key: 'Escape' });
}

describe('in-place title', () => {
  it('editing the title replaces the heading, keeps the spec title in the subtitle, and Undo restores it', async () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Titel bewerken' }));
    const input = screen.getByPlaceholderText('Eigen titel') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Mijn kop' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Mijn kop');
    expect(screen.getByText(twoSeriesLineSpec().title)).toBeTruthy(); // the original in the subtitle
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    closeEdit();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(twoSeriesLineSpec().title);
  });

  it('an empty or unchanged title clears the override (no history entry for a no-op)', async () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Titel bewerken' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Eigen titel'), { key: 'Enter' });
    await openEdit();
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeDisabled();
  });

  it('Escape cancels without a history entry; a title longer than the cap is cut by the input', async () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Titel bewerken' }));
    const input = screen.getByPlaceholderText('Eigen titel') as HTMLInputElement;
    expect(input.maxLength).toBe(120);
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await openEdit();
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeDisabled();
  });

  // Final-review finding M4: `commitTitle` must obey the story lock exactly
  // like `commitCaption` does — an editor already open when the story starts
  // must not be able to write a title through the lock.
  it('Enter pressed in the title editor while the story is open writes nothing', async () => {
    render(<ChartView spec={twoSeriesFindingsSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Titel bewerken' }));
    const input = screen.getByPlaceholderText('Eigen titel') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Mag niet' } });
    // The story opens with the title editor still on screen.
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    expect(screen.getByRole('region', { name: 'Inzichten bij de grafiek' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    await openEdit();
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeDisabled();
    expect(screen.queryByText('Mag niet')).toBeNull();
  });

  it('embed mode shows no edit button', () => {
    render(<ChartView spec={twoSeriesLineSpec()} embedMode embed={{ auditId: 1 }} embedFooter="x" />);
    expect(screen.queryByRole('button', { name: 'Titel bewerken' })).toBeNull();
  });
});

describe('caption', () => {
  it('adding, editing and removing a caption are three undoable steps', async () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    // WP-LOOK part (a): the caption's "add" control lives in the Edit popup;
    // the card shows the caption itself only once there is one.
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift toevoegen' }));
    fireEvent.change(screen.getByPlaceholderText('Bijschrift onder de grafiek'), { target: { value: 'Bron: eigen bewerking' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(screen.getByTestId('chart-caption')).toHaveTextContent('Bron: eigen bewerking');
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift bewerken' }));
    fireEvent.change(screen.getByPlaceholderText('Bijschrift onder de grafiek'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(screen.queryByTestId('chart-caption')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByTestId('chart-caption')).toHaveTextContent('Bron: eigen bewerking');
  });

  // Fix round 1, finding 5: `commitCaption` itself obeys the story lock, not
  // only the buttons that OPEN the editor — an editor already open when the
  // story starts must not be able to write a caption through the lock.
  it('the caption editor and the story never share the screen: the story closes the popup, the popup closes the story', async () => {
    // Before WP-LOOK part (a) this test pressed Save with the story open and
    // expected the story lock to refuse the write. The caption editor now
    // lives in the Edit popup, and the popup and the story share ONE
    // `openPanel` slot — so an editor open when the story starts is
    // structurally impossible: the popup (editor included) is gone while
    // the story is showing, and reopening the popup ends the story.
    render(<ChartView spec={twoSeriesFindingsSpec()} />);
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift toevoegen' }));
    fireEvent.change(screen.getByPlaceholderText('Bijschrift onder de grafiek'), { target: { value: 'Mag niet' } });
    closeEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    expect(screen.getByRole('region', { name: 'Inzichten bij de grafiek' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Opslaan' })).toBeNull();
    expect(screen.queryByText('Mag niet')).toBeNull();
    await openEdit();
    expect(screen.queryByRole('region', { name: 'Inzichten bij de grafiek' })).toBeNull();
  });

  it('the caption is rendered outside the export container', async () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift toevoegen' }));
    fireEvent.change(screen.getByPlaceholderText('Bijschrift onder de grafiek'), { target: { value: 'tekst' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    closeEdit();
    const svgHost = container.querySelector('.recharts-wrapper')!.closest('[data-chart-container], [data-testid="chart-container"]');
    expect(svgHost?.contains(screen.getByTestId('chart-caption'))).toBe(false);
  });
});

describe('title and caption in downloads (session 136, #278)', () => {
  async function downloadSvgMarkup(): Promise<string> {
    let captured: Blob | undefined;
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn((blob: Blob) => {
      captured = blob;
      return 'blob:mock';
    });
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download als SVG' }));
    const markup = await captured!.text();
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    return markup;
  }

  function setTitle(text: string): void {
    fireEvent.click(screen.getByRole('button', { name: 'Titel bewerken' }));
    const input = screen.getByPlaceholderText('Eigen titel') as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }

  async function setCaption(text: string): Promise<void> {
    await openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift toevoegen' }));
    fireEvent.change(screen.getByPlaceholderText('Bijschrift onder de grafiek'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    closeEdit();
  }

  it('an untouched chart downloads with its standard title', async () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    const markup = await downloadSvgMarkup();
    expect(markup).toMatch(/data-title-line="true"[^>]*>Testreeks</);
    expect(markup).not.toContain('data-caption-line');
  });

  it('a reader title and caption whose numbers are on the chart go into the download, with no notice', async () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    setTitle('Utrecht groeit naar 55 in 2021');
    await setCaption('Eigen bewerking');
    const markup = await downloadSvgMarkup();
    expect(markup).toContain('Utrecht groeit naar 55 in 2021');
    expect(markup).toContain('Eigen bewerking');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.queryByTestId('chart-download-notice')).toBeNull();
  });

  it('a reader title or caption with a number the chart does not show stays out, and the menu says so', async () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    setTitle('Bijna 60 procent');
    await setCaption('Was 38 in 2019');
    const markup = await downloadSvgMarkup();
    expect(markup).not.toContain('Bijna 60');
    expect(markup).not.toContain('Was 38');
    expect(markup).toMatch(/data-title-line="true"[^>]*>Testreeks</);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.getByTestId('chart-download-notice').textContent).toMatch(/getal dat niet in de grafiek staat/);
  });
});

describe('embed mode shows the published caption (session 136)', () => {
  it('renders a published caption read-only and never an editor', () => {
    render(
      <ChartView
        spec={twoSeriesLineSpec()}
        embedMode
        embedFooter="x"
        publishedLog={[{ id: 'c', at: '2026-09-27T00:00:00Z', source: 'panel', kind: 'setCaption', caption: 'Eigen bewerking' }]}
      />,
    );
    expect(screen.getByTestId('chart-caption')).toHaveTextContent('Eigen bewerking');
    expect(screen.queryByRole('button', { name: 'Bijschrift bewerken' })).toBeNull();
  });
});
