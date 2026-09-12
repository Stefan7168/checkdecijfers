// #237/ADR 046: the gallery's card grid — real ChartView (Present/Style/
// Insights all present, this is the product's own chart component, not a
// picture of one), every digit on the page traceable to a spec string or
// the gallery's own i18n copy (principle a), and — the public-page rule —
// zero generateInsights calls for an anonymous visitor even though every
// card mounts with initialPanel="story" (Insights open by default).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';

const { getGalleryStories } = vi.hoisted(() => ({ getGalleryStories: vi.fn() }));
vi.mock('../lib/ontdek.ts', () => ({ getGalleryStories }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../lib/i18n/server.ts', () => ({ getLang }));

const chartInsightsActions = vi.hoisted(() => ({
  generateInsights: vi.fn().mockResolvedValue({ ok: false, reason: 'unauthenticated' }),
}));
vi.mock('../app/chart-insights-actions.ts', () => chartInsightsActions);

import { GalleryGrid, GalleryTeaser } from './gallery.tsx';

function testSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: {},
    dimLabels: {},
    unit: 'percentage',
    series: [
      {
        label: 'Nederland',
        regionCode: 'NL01',
        points: [
          { resultId: 'p1', periodCode: '2022JJ00', periodLabel: '2022', value: 1, formattedValue: '1,0', decimals: 1, status: 'Definitief', provisional: false, valueAttribute: 'None' },
          { resultId: 'p2', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0', decimals: 1, status: 'Definitief', provisional: false, valueAttribute: 'None' },
          { resultId: 'p3', periodCode: '2024JJ00', periodLabel: '2024', value: 3, formattedValue: '3,0', decimals: 1, status: 'Definitief', provisional: false, valueAttribute: 'None' },
        ],
      },
    ],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'CBS · test',
    attribution: {
      tableId: '12345',
      tableTitle: 'Test tabel',
      tableVersion: 1,
      syncedAt: '2026-09-08',
      coveredPeriods: { from: '2022', to: '2024' },
      license: 'CC BY 4.0',
    },
    ...overrides,
  };
}

function scanForUnboundDigits(container: HTMLElement, specStrings: string[]): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const tokens: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
  }
  for (const tok of tokens) {
    expect(
      specStrings.some((str) => str.includes(tok)),
      `numeric token "${tok}" in the rendered DOM has no source in the spec's own strings`,
    ).toBe(true);
  }
}

const FOUR_CHARTS = [
  { slug: 'consumentenvertrouwen', spec: testSpec() },
  { slug: 'inflatie', spec: testSpec({ title: 'Andere reeks' }) },
  { slug: 'huizenprijzen', spec: testSpec({ title: 'Nog een reeks' }) },
  { slug: 'zonnestroom', spec: testSpec({ title: 'Vierde reeks' }) },
];

beforeEach(() => {
  getLang.mockResolvedValue('nl');
  getGalleryStories.mockResolvedValue(FOUR_CHARTS);
});

afterEach(() => {
  cleanup();
  getGalleryStories.mockReset();
  getLang.mockReset();
  chartInsightsActions.generateInsights.mockClear();
});

describe('GalleryGrid', () => {
  it('renders every built story with its title, lead and chart', async () => {
    render(await GalleryGrid());
    expect(screen.getByText('Consumentenvertrouwen')).toBeInTheDocument();
    expect(
      screen.getByText('Hoe optimistisch het Nederlandse publiek is over de economie, maand na maand.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Testreeks')).toBeInTheDocument();
    expect(screen.getByText('Andere reeks')).toBeInTheDocument();
  });

  it('mounts each chart with Insights already open (initialPanel="story")', async () => {
    render(await GalleryGrid());
    expect(screen.getAllByRole('region', { name: 'Inzichten bij de grafiek' }).length).toBe(FOUR_CHARTS.length);
  });

  it('never triggers generateInsights for an anonymous visitor, across every card', async () => {
    render(await GalleryGrid());
    expect(chartInsightsActions.generateInsights).not.toHaveBeenCalled();
  });

  it('every digit on the page is bound to a spec string or the gallery copy', async () => {
    const { container } = render(await GalleryGrid());
    const strings = FOUR_CHARTS.flatMap(({ spec }) => [
      spec.title,
      spec.unit,
      spec.attributionLine,
      spec.attribution.tableId,
      spec.attribution.syncedAt,
      ...spec.series.flatMap((s) => s.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
    ]);
    scanForUnboundDigits(container, strings);
  });

  it('renders nothing when no stories built (fail-safe, ADR 035 posture)', async () => {
    getGalleryStories.mockResolvedValue([]);
    const result = await GalleryGrid();
    expect(result).toBeNull();
  });

  it('renders in English too', async () => {
    getLang.mockResolvedValue('en');
    render(await GalleryGrid());
    expect(screen.getByText('Consumer confidence')).toBeInTheDocument();
    expect(
      screen.getByText('How optimistic the Dutch public is about the economy, month after month.'),
    ).toBeInTheDocument();
  });
});

describe('GalleryTeaser', () => {
  it('shows only the first three stories, plus a link to the full gallery', async () => {
    render(await GalleryTeaser());
    expect(screen.getByText('Testreeks')).toBeInTheDocument();
    expect(screen.getByText('Andere reeks')).toBeInTheDocument();
    expect(screen.getByText('Nog een reeks')).toBeInTheDocument();
    expect(screen.queryByText('Vierde reeks')).toBeNull();
    expect(screen.getByRole('link', { name: 'Alle verhalen' })).toHaveAttribute('href', '/galerij');
  });

  it('renders nothing when no stories built', async () => {
    getGalleryStories.mockResolvedValue([]);
    const result = await GalleryTeaser();
    expect(result).toBeNull();
  });
});
