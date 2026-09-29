// WP-LOOK part (a2) round 2 (session 144): the renderer's plot-only mode —
// marks in the SVG, every piece of text handed back for the caller to set —
// under the same honesty contract as the full SVG (R6, docs/05): every
// handed-back string is a spec string, no value is invented, a null point is
// still an honest gap, and the thinning never drops the first or last period.
import { describe, expect, it } from 'vitest';
import { buildChartSpec, renderChartPlot, renderChartSvg, thinXLabels } from '../../src/chart/index.ts';
import type { ChartSpec } from '../../src/chart/index.ts';
import { findNumericTokens, normalizeForScan } from '../../src/answer/compose/format.ts';
import { makeCell, makeResult } from './helpers.ts';

function monthly(n: number): ChartSpec {
  const cells = Array.from({ length: n }, (_, i) =>
    makeCell({ periodCode: `${String(2024 + Math.floor(i / 12))}MM${String((i % 12) + 1).padStart(2, '0')}`, value: 2 + ((i * 7) % 11) / 10, unit: '%', decimals: 1 }),
  );
  return buildChartSpec(makeResult('series', cells))!;
}

function allowedTokens(spec: ChartSpec): Set<string> {
  const strings = [
    spec.title,
    spec.unit,
    ...Object.values(spec.dimLabels),
    ...spec.series.flatMap((s) => [s.label, ...s.points.flatMap((p) => [p.periodLabel, ...(p.formattedValue === null ? [] : [p.formattedValue])])]),
  ];
  const tokens = new Set<string>();
  for (const s of strings) for (const t of findNumericTokens(normalizeForScan(s))) tokens.add(t.token);
  return tokens;
}

describe('renderChartPlot', () => {
  it('hands back only spec strings: every numeric token in the texts is in the spec, and the SVG carries no text at all', () => {
    const spec = monthly(24);
    const plot = renderChartPlot(spec, { width: 1112, plotHeight: 240, fontSize: 20 });
    expect(plot.svg).not.toContain('<text');
    const allowed = allowedTokens(spec);
    for (const t of plot.texts) {
      for (const tok of findNumericTokens(normalizeForScan(t.text))) expect(allowed, `token ${tok.token} in "${t.text}"`).toContain(tok.token);
    }
    // One marker per point, as in the full SVG.
    expect(plot.svg.match(/data-point="value"/g)?.length).toBe(24);
  });

  it('thins x labels to what fits and keeps the first and the last period; the full SVG still labels every period', () => {
    const spec = monthly(24);
    const plot = renderChartPlot(spec, { width: 1112, plotHeight: 240, fontSize: 20 });
    const xs = plot.texts.filter((t) => t.role === 'x-label').map((t) => t.text);
    const all = spec.series[0]!.points.map((p) => p.periodLabel);
    expect(xs[0]).toBe(all[0]);
    expect(xs[xs.length - 1]).toBe(all[all.length - 1]);
    expect(xs.length).toBeLessThan(all.length);
    expect(xs.length).toBeGreaterThanOrEqual(3);
    for (const l of all) expect(renderChartSvg(spec)).toContain(`>${l}<`);
  });

  it('labels the last point beside it and the extremes on the axis; the first point only when it is not an extreme', () => {
    const spec = monthly(24);
    const plot = renderChartPlot(spec, { width: 1112, plotHeight: 240, fontSize: 20 });
    const points = spec.series[0]!.points;
    const last = points[points.length - 1]!;
    const values = plot.texts.filter((t) => t.role === 'value');
    expect(values.find((t) => t.text === last.formattedValue)?.anchor).toBe('start');
    const ticks = plot.texts.filter((t) => t.role === 'y-tick').map((t) => t.text);
    const nums = points.map((p) => p.value!);
    expect(ticks).toContain(points[nums.indexOf(Math.min(...nums))]!.formattedValue);
    expect(ticks).toContain(points[nums.indexOf(Math.max(...nums))]!.formattedValue);
    expect(ticks).toHaveLength(2);
  });

  it('draws bars over time on a zero baseline and an area fill under the line, from the same spec', () => {
    const spec = monthly(12);
    const line = renderChartPlot(spec, { width: 800, plotHeight: 200, form: 'line' });
    const area = renderChartPlot(spec, { width: 800, plotHeight: 200, form: 'area' });
    const bars = renderChartPlot(spec, { width: 800, plotHeight: 200, form: 'bar' });
    expect(line.svg).toContain('<polyline');
    expect(line.svg).not.toContain('<polygon');
    expect(area.svg).toContain('<polygon');
    expect(area.svg).toContain('<polyline');
    expect(bars.svg).not.toContain('<polyline');
    expect(bars.svg.match(/<rect /g)?.length).toBe(12);
    // Bars: heights proportional to values (zero baseline).
    const rects = [...bars.svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)"/g)].map((m) => Number(m[1]));
    const vals = spec.series[0]!.points.map((p) => p.value!);
    const ratio = rects[0]! / vals[0]!;
    rects.forEach((h, i) => expect(h / vals[i]!).toBeCloseTo(ratio, 1));
  });

  it('a null point stays an honest gap in every form: a × text, a broken line, no bar', () => {
    const spec = monthly(6);
    spec.series[0]!.points[2]!.value = null;
    spec.series[0]!.points[2]!.formattedValue = null;
    for (const form of ['line', 'area', 'bar'] as const) {
      const plot = renderChartPlot(spec, { width: 800, plotHeight: 200, form });
      expect(plot.texts.filter((t) => t.role === 'null')).toHaveLength(1);
      if (form === 'bar') expect(plot.svg.match(/<rect /g)?.length).toBe(5);
      else expect(plot.svg.match(/<polyline/g)?.length).toBe(2);
    }
  });

  it('thinXLabels: every step-th label from the first, the last always, the one before it dropped only on collision', () => {
    const labels = Array.from({ length: 24 }, (_, i) => `2024 maand ${String(i + 1)}`);
    const wide = thinXLabels(labels, 200, 12);
    expect([...wide]).toEqual(labels.map((_, i) => i));
    const narrow = thinXLabels(labels, 40, 20);
    expect(narrow.has(0)).toBe(true);
    expect(narrow.has(23)).toBe(true);
    expect(narrow.size).toBeLessThan(10);
    expect(thinXLabels([], 40, 20).size).toBe(0);
  });
});
