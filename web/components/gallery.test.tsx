// #237/ADR 046: the gallery's card grid — real ChartView (Present/Style/
// Insights all present, this is the product's own chart component, not a
// picture of one), every digit on the page traceable to a spec string or
// the gallery's own i18n copy (principle a), zero generateInsights calls
// for an anonymous visitor, and zero usage-tracking calls for the
// auto-opened first card (fix-wave finding 1).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { setChartUsageSink } from '../lib/chart-usage-client.ts';

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
  it('renders every built story with its question title and chart', async () => {
    render(await GalleryGrid());
    // Fix-wave finding 4: the card title is the QUESTION, never a repeat of
    // the chart's own on-screen title — both are visible, on different text.
    expect(screen.getByText('Hoe optimistisch zijn Nederlanders?')).toBeInTheDocument();
    expect(screen.getByText('Wat kostte een huis?')).toBeInTheDocument();
    expect(screen.getByText('Testreeks')).toBeInTheDocument();
    expect(screen.getByText('Andere reeks')).toBeInTheDocument();
  });

  // Session 110 a11y audit (#Fix-now 4): a story card's own default heading
  // level is <h3> — right when nested under the landing teaser's <h2>, wrong
  // on /galerij (standalone under an <h1>, skipping <h2> — axe's heading-order,
  // moderate). Default here stays <h3> so GalleryTeaser's callers are
  // byte-identical to before this fix.
  it('renders each card title as <h3> by default', async () => {
    render(await GalleryGrid());
    expect(screen.getByRole('heading', { level: 3, name: 'Hoe optimistisch zijn Nederlanders?' })).toBeInTheDocument();
  });

  // Scoped to the card's own title element (`article > h2`/`h3`), not every
  // "heading" role in the DOM — ChartView's own chart-title element is a
  // separate, unrelated `role="heading" aria-level="3"` div (its internal
  // header, out of this fix's scope) that legitimately stays put either way.
  it('renders each card title as <h2> when headingLevel={2} is passed (the /galerij page)', async () => {
    const { container } = render(await GalleryGrid({ headingLevel: 2 }));
    expect(screen.getByRole('heading', { level: 2, name: 'Hoe optimistisch zijn Nederlanders?' })).toBeInTheDocument();
    expect(container.querySelectorAll('article > h2')).toHaveLength(FOUR_CHARTS.length);
    expect(container.querySelectorAll('article > h3')).toHaveLength(0);
  });

  // Fix-wave finding 5: twelve (here, four) open Insights panels at once
  // made the real page unreadable — only the FIRST card pre-opens as the
  // worked example.
  it('pre-opens Insights on the FIRST card only — every other card opens on its own trigger', async () => {
    render(await GalleryGrid());
    expect(screen.getAllByRole('region', { name: 'Inzichten bij de grafiek' })).toHaveLength(1);
    // Every card still HAS the trigger — the other three are simply closed.
    expect(screen.getAllByRole('button', { name: 'Inzichten' })).toHaveLength(FOUR_CHARTS.length);
  });

  it('never triggers generateInsights for an anonymous visitor, across every card', async () => {
    render(await GalleryGrid());
    expect(chartInsightsActions.generateInsights).not.toHaveBeenCalled();
  });

  // Fix-wave finding 1: the auto-open (initialPanel="story" on the first
  // card only) must NOT count as a story_open usage event — that would fire
  // the site-wide countChartStyleEvent server action (an unauthenticated DB
  // write) on every anonymous page view.
  it('never sends a usage event for the auto-opened Insights panel', async () => {
    const sink = vi.fn();
    setChartUsageSink(sink);
    try {
      render(await GalleryGrid());
      expect(sink).not.toHaveBeenCalled();
    } finally {
      setChartUsageSink(null);
    }
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

  // #3 (session 110 UX audit): a cold read used to render `null` here — the
  // gallery heading/intro/CTA showed with zero cards and no explanation, so
  // the page read as broken. Now it renders an honest loading placeholder
  // instead (still fail-safe: never a broken empty grid, ADR 035 posture).
  it('renders a loading placeholder (never a broken empty grid) when no stories are built yet', async () => {
    getGalleryStories.mockResolvedValue([]);
    render(await GalleryGrid());
    expect(screen.getByText('Bezig met laden — vernieuw de pagina zo dadelijk als dit leeg blijft.')).toBeInTheDocument();
  });

  it('renders in English too', async () => {
    getLang.mockResolvedValue('en');
    render(await GalleryGrid());
    expect(screen.getByText('How optimistic are the Dutch?')).toBeInTheDocument();
    expect(screen.getByText('What did a house cost?')).toBeInTheDocument();
  });
});

describe('GalleryTeaser', () => {
  // Session 110 a11y audit (#Fix-now 4): the teaser nests under the landing
  // page's own <h2>Stories from the gallery</h2>, so its cards must stay
  // <h3> — GalleryTeaser never passes headingLevel through. The card's own
  // title (the QUESTION text) is asserted, not ChartView's separate internal
  // chart-title element (which shows the spec's own title, "Testreeks").
  it('renders each card title as <h3> — nested under the landing page\'s own <h2>', async () => {
    render(await GalleryTeaser());
    expect(
      screen.getByRole('heading', { level: 3, name: 'Hoe optimistisch zijn Nederlanders?' }),
    ).toBeInTheDocument();
  });

  it('shows only the first three stories, compact (no Insights pre-opened), plus a link to the full gallery', async () => {
    render(await GalleryTeaser());
    expect(screen.getByText('Testreeks')).toBeInTheDocument();
    expect(screen.getByText('Andere reeks')).toBeInTheDocument();
    expect(screen.getByText('Nog een reeks')).toBeInTheDocument();
    expect(screen.queryByText('Vierde reeks')).toBeNull();
    // Fix-wave finding 6: compact — no card pre-opens Insights, even the
    // first, so the teaser stays a short taste rather than a full panel.
    expect(screen.queryByRole('region', { name: 'Inzichten bij de grafiek' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Alle verhalen' })).toHaveAttribute('href', '/galerij');
  });

  it('never sends a usage event or triggers generateInsights (nothing pre-opens)', async () => {
    const sink = vi.fn();
    setChartUsageSink(sink);
    try {
      render(await GalleryTeaser());
      expect(sink).not.toHaveBeenCalled();
      expect(chartInsightsActions.generateInsights).not.toHaveBeenCalled();
    } finally {
      setChartUsageSink(null);
    }
  });

  // #3 (session 110 UX audit): the whole teaser section (heading + link)
  // used to disappear along with the cards on a cold read — now only the
  // card area degrades, to the same loading placeholder GalleryGrid uses.
  it('keeps the heading and link, and shows a loading placeholder instead of cards, when no stories are built yet', async () => {
    getGalleryStories.mockResolvedValue([]);
    render(await GalleryTeaser());
    expect(screen.getByText('Verhalen uit de galerij')).toBeInTheDocument();
    expect(screen.getByText('Bezig met laden — vernieuw de pagina zo dadelijk als dit leeg blijft.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alle verhalen' })).toHaveAttribute('href', '/galerij');
  });
});
