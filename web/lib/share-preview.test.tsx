// WP-LOOK part (a2) (session 143): the share-link preview card never shows a
// number that is not in the stored spec, and the neutral card shows none.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import {
  buildSharePreview,
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
    expect(model.strings).toContain('checkdecijfers.nl');
    const allowed = new Set([
      ...s.series.flatMap((se) => se.points.flatMap((p) => [...digitRuns(p.formattedValue ?? ''), ...digitRuns(p.periodLabel)])),
      ...digitRuns(s.attributionLine),
      ...digitRuns(s.title),
    ]);
    for (const str of model.strings) for (const run of digitRuns(str)) expect(allowed, `digit run ${run} in "${str}"`).toContain(run);
  });
  it('embeds the server renderer\'s own SVG (with the attribution footer and every plotted value) as a data URI that fits the card', () => {
    const model = buildSharePreview(spec(), null);
    expect(model.plotSvg.startsWith('<svg')).toBe(true);
    expect(model.plotSvg).toContain('86141NED');
    // The subtitle inside the plot carries the human label, never CBS's leading code.
    expect(model.plotSvg).toContain('Alle bestedingen');
    expect(model.plotSvg).not.toContain('000000 Alle');
    for (const v of ['1,3', '2,7', '10,0', '3,3']) expect(model.plotSvg).toContain(v);
    expect(model.plotDataUri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(model.plotDataUri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')).toBe(model.plotSvg);
    expect(model.plot.width).toBeLessThanOrEqual(SHARE_PREVIEW_SIZE.width - 96);
    expect(model.plot.height).toBeLessThanOrEqual(SHARE_PREVIEW_SIZE.height - 96);
    expect(model.plot.width).toBeGreaterThan(600);
  });
  it('carries the saved journalist headline sentence when there is one', () => {
    const model = buildSharePreview(spec(), 'Inflatie zakte in 2024 naar 3,3 procent');
    expect(model.strings[0]).toBe('Inflatie zakte in 2024 naar 3,3 procent');
    const html = renderToStaticMarkup(<SharePreviewCard model={model} />);
    expect(html).toContain('Inflatie zakte in 2024 naar 3,3 procent');
    expect(html).toContain('checkdecijfers.nl');
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
