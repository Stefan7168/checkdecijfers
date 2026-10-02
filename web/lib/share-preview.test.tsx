// WP-LOOK part (a2) (session 143): the share-link preview card never shows a
// number that is not in the stored spec, and the neutral card shows none.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import {
  buildSharePreview,
  previewFormFor,
  NEUTRAL_PREVIEW_STRINGS,
  NeutralPreviewCard,
  SHARE_PREVIEW_SIZE,
  SharePreviewCard,
} from './share-preview.tsx';

function point(periodLabel: string, value: number, formattedValue: string, i: number) {
  return {
    resultId: `r${i}`,
    periodCode: `${periodLabel}JJ00`,
    periodLabel,
    value,
    formattedValue,
    decimals: 1,
    status: 'final',
    provisional: false,
    valueAttribute: 'Value',
  };
}

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Jaarmutatie CPI',
    dims: { Bestedingscategorieen: '000000' },
    dimLabels: { Bestedingscategorieen: '000000 Alle bestedingen' },
    unit: '%',
    series: [
      {
        label: 'Jaarmutatie CPI',
        regionCode: null,
        points: [point('2020', 1.3, '1,3', 1), point('2021', 2.7, '2,7', 2), point('2022', 10, '10,0', 3), point('2024', 3.3, '3,3', 5)],
      },
    ],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 86141NED — Consumentenprijzen. Gegevens gesynchroniseerd op 2026-09-29. Licentie: CC BY 4.0.',
    attribution: {
      tableId: '86141NED',
      tableTitle: 'Consumentenprijzen',
      tableVersion: 1,
      syncedAt: '2026-09-29',
      coveredPeriods: { from: '2020', to: '2024' },
      license: 'CC BY 4.0',
    },
    ...overrides,
  } as ChartSpec;
}

const digitRuns = (s: string): string[] => s.match(/\d+(?:[.,]\d+)*/g) ?? [];

describe('buildSharePreview', () => {
  it('shows the last point as the headline figure, verbatim, and the brand; every number on the card is a spec number', () => {
    const s = spec();
    const model = buildSharePreview(s, null);
    expect(model.headline?.value).toBe('3,3');
    expect(model.strings).toContain('3,3');
    expect(model.strings).toContain('% · 2024');
    expect(model.strings).toContain('graphmaker.studio');
    const allowed = new Set([
      ...s.series.flatMap((se) => se.points.flatMap((p) => [...digitRuns(p.formattedValue ?? ''), ...digitRuns(p.periodLabel)])),
      ...digitRuns(s.attributionLine),
      ...digitRuns(s.title),
    ]);
    for (const str of model.strings) for (const run of digitRuns(str)) expect(allowed, `digit run ${run} in "${str}"`).toContain(run);
  });
  it('draws the plot marks as a data URI SVG and hands every label back as text the card sets itself (round 2)', () => {
    const model = buildSharePreview(spec(), null);
    expect(model.plot.svg.startsWith('<svg')).toBe(true);
    // Marks only: no <text> inside the SVG (the image tool cannot font it).
    expect(model.plot.svg).not.toContain('<text');
    expect(model.plot.svg).toContain('<polyline');
    expect(model.plotDataUri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(model.plotDataUri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')).toBe(model.plot.svg);
    // The card's own subtitle carries the human label, never CBS's leading code.
    expect(model.subtitle).toBe('% · Alle bestedingen');
    // Handed-back text: the period labels, the lowest and highest value as
    // y-axis ticks, the first and the last point's value.
    const texts = model.plot.texts.map((t) => t.text);
    for (const l of ['2020', '2024']) expect(texts).toContain(l);
    for (const v of ['1,3', '10,0', '3,3']) expect(texts).toContain(v);
    expect(model.plot.texts.find((t) => t.text === '3,3' && t.role === 'value')?.anchor).toBe('start');
    expect(model.plot.width).toBe(SHARE_PREVIEW_SIZE.width - 88);
    expect(model.plot.height).toBeGreaterThan(200);
    expect(model.plot.height).toBeLessThan(SHARE_PREVIEW_SIZE.height - 200);
    // Every handed-back string is on the digit-scan list.
    for (const t of texts) expect(model.strings).toContain(t);
  });
  it('follows the reader\'s form — bars over time, an area fill — and falls back to the line for a form it cannot draw', () => {
    expect(buildSharePreview(spec(), null, 'bar').plot.svg).toContain('<rect');
    expect(buildSharePreview(spec(), null, 'bar').plot.svg).not.toContain('<polyline');
    expect(buildSharePreview(spec(), null, 'area').plot.svg).toContain('<polygon');
    expect(previewFormFor('dumbbell')).toBe('line');
    expect(previewFormFor('area')).toBe('area');
    expect(previewFormFor(null)).toBe('line');
    expect(buildSharePreview(spec({ kind: 'bar' }), null, 'area').form).toBe('line');
  });
  it('thins the x-axis labels of a long monthly series to what fits, keeping the first and the last', () => {
    const months = Array.from({ length: 24 }, (_, i) => ({
      ...point(`2024 maand ${String(i + 1)}`, 2 + i / 10, `${String(2 + Math.floor(i / 10))},${String(i % 10)}`, i + 1),
      // Codes sort chronologically only when zero-padded (CBS's own shape).
      periodCode: `2024MM${String(i + 1).padStart(2, '0')}`,
    }));
    const model = buildSharePreview(spec({ series: [{ label: 'x', regionCode: null, points: months }] }), null);
    const xLabels = model.plot.texts.filter((t) => t.role === 'x-label').map((t) => t.text);
    expect(xLabels.length).toBeGreaterThanOrEqual(3);
    expect(xLabels.length).toBeLessThan(12);
    expect(xLabels[0]).toBe('2024 maand 1');
    expect(xLabels[xLabels.length - 1]).toBe('2024 maand 24');
  });
  it('carries the saved journalist headline sentence when there is one', () => {
    const model = buildSharePreview(spec(), 'Inflatie zakte in 2024 naar 3,3 procent');
    expect(model.strings).toContain('Inflatie zakte in 2024 naar 3,3 procent');
    const html = renderToStaticMarkup(<SharePreviewCard model={model} />);
    expect(html).toContain('Inflatie zakte in 2024 naar 3,3 procent');
    expect(html).toContain('graphmaker.studio');
    expect(html).toContain('data:image/svg+xml');
  });
});

describe('NeutralPreviewCard', () => {
  it('shows the brand and the public claim and not a single digit', () => {
    const html = renderToStaticMarkup(<NeutralPreviewCard />);
    for (const s of NEUTRAL_PREVIEW_STRINGS) expect(html).toContain(s);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/style="[^"]*"/g, '');
    expect(text).not.toMatch(/\d/);
  });
});

describe('shareTaglineFor (session 153, #357)', () => {
  it('a Eurostat chart names Eurostat; a CBS chart keeps the public claim byte-identically', async () => {
    const { shareTaglineFor, SHARE_PREVIEW_TAGLINE } = await import('./share-preview.tsx');
    expect(shareTaglineFor('85245NED')).toBe(SHARE_PREVIEW_TAGLINE);
    expect(shareTaglineFor('eurostat:env_wasmun')).toBe('Elk getal herleidbaar tot een officiële Eurostat-tabel');
  });
});
