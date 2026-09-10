import { describe, expect, it } from 'vitest';
import {
  CLASSIC_PRESENTATION,
  DEFAULT_PALETTE,
  FRAME_GRADIENT_PRESETS,
  frameBackdrops,
  judgeColorAgainst,
  RECHARTS_PALETTE,
  resolvePresentation,
  sanitizeOverrides,
  STOCK_PRESENTATION,
  type PresentationContext,
} from './chart-presentation.ts';
import { CHART_TEMPLATES, matchTemplate, templateById } from './chart-templates.ts';

const lineCtx: PresentationContext = { kind: 'line', form: 'line', seriesCount: 2, hasProvisional: true };
const barCtx: PresentationContext = { kind: 'bar', form: 'bar', seriesCount: 3, hasProvisional: true };

describe('CHART_TEMPLATES — the v1 roster (ADR 043), pinned', () => {
  it('lists the six looks in order with their catalogue keys', () => {
    expect(CHART_TEMPLATES.map((t) => t.id)).toEqual(['standard', 'classic', 'newsroom', 'presentation', 'social', 'minimal']);
    for (const t of CHART_TEMPLATES) {
      expect(t.nameKey).toBe(`chart.template.${t.id}`);
      expect(t.descriptionKey).toBe(`chart.template.${t.id}Description`);
    }
  });
  it('standard is the designed default itself (no overrides); classic is the session-87 look with the classic colours', () => {
    expect(templateById('standard').overrides).toEqual({});
    const classic = templateById('classic').overrides;
    expect(classic).toEqual({
      lineWidth: 'normal',
      markers: 'all',
      grid: 'both',
      axisLines: 'shown',
      areaFill: 'flat',
      seriesColors: Object.fromEntries(RECHARTS_PALETTE.map((hex, i) => [i, hex])),
    });
    const r = resolvePresentation(lineCtx, classic);
    for (const key of ['lineWidth', 'markers', 'grid', 'axisLines', 'areaFill'] as const) expect(r.values[key]).toBe(CLASSIC_PRESENTATION[key]);
  });
  it('newsroom, presentation, social and minimal carry exactly their designed values', () => {
    expect(templateById('newsroom').overrides).toEqual({
      lineWidth: 'thick',
      markers: 'provisionalOnly',
      grid: 'horizontal',
      axisLines: 'hidden',
      valueLabels: 'shown',
      framePadding: 'small',
      frameAspect: '16:9',
    });
    expect(templateById('presentation').overrides).toEqual({
      lineWidth: 'thick',
      frameBackground: { kind: 'gradient', from: '#334155', to: '#0f172a' },
      frameInset: 'small',
      framePadding: 'medium',
      frameCorners: 'rounded',
      frameShadow: 'strong',
      frameAspect: '16:9',
    });
    const ocean = FRAME_GRADIENT_PRESETS.find((p) => p.id === 'ocean')!;
    expect(templateById('social').overrides).toEqual({
      lineWidth: 'thick',
      valueLabels: 'shown',
      frameBackground: { kind: 'gradient', from: ocean.from, to: ocean.to },
      frameInset: 'small',
      framePadding: 'medium',
      frameCorners: 'veryRounded',
      frameShadow: 'soft',
      frameAspect: '4:5',
    });
    expect(templateById('minimal').overrides).toEqual({ grid: 'none', axisLines: 'hidden', markers: 'provisionalOnly', valueLabels: 'shown' });
  });
  it('every template survives sanitizeOverrides byte-identical — no key the resolver does not know', () => {
    for (const t of CHART_TEMPLATES) expect(sanitizeOverrides(t.overrides)).toEqual(t.overrides);
  });
  it('design-time contrast gate: no template refuses any default colour (or, for classic, any classic colour) against its own backdrops', () => {
    for (const t of CHART_TEMPLATES) {
      const values = resolvePresentation(lineCtx, t.overrides).values;
      const backdrops = frameBackdrops(values);
      const palette = t.id === 'classic' ? RECHARTS_PALETTE : DEFAULT_PALETTE;
      for (const hex of palette) expect(judgeColorAgainst(hex, backdrops).ok, `${t.id} × ${hex}`).toBe(true);
    }
  });
  it('the honesty locks still win over a template on a bar chart (value labels stay shown, baseline stays zero)', () => {
    const r = resolvePresentation(barCtx, templateById('minimal').overrides);
    expect(r.values.valueLabels).toBe('shown');
    expect(r.values.zeroBaseline).toBe('zero');
    expect(r.locks.valueLabels).toBeDefined();
  });
});

describe('matchTemplate — which template the chart currently wears', () => {
  it('a pristine chart is standard; a chart wearing a template matches it; a tweaked chart matches nothing', () => {
    expect(matchTemplate(STOCK_PRESENTATION, true)).toBe('standard');
    for (const t of CHART_TEMPLATES) {
      if (t.id === 'standard') continue;
      const values = resolvePresentation(lineCtx, t.overrides).values;
      expect(matchTemplate(values, false), t.id).toBe(t.id);
    }
    const tweaked = resolvePresentation(lineCtx, { ...templateById('newsroom').overrides, lineWidth: 'thin' }).values;
    expect(matchTemplate(tweaked, false)).toBeNull();
  });
  it('a non-pristine chart that happens to equal the stock values is not standard, and the most specific match wins', () => {
    expect(matchTemplate(STOCK_PRESENTATION, false)).toBeNull();
    // minimal ⊂ nothing else, but a chart with minimal's keys AND newsroom's extra keys is neither
    const both = resolvePresentation(lineCtx, { ...templateById('minimal').overrides, framePadding: 'small' }).values;
    expect(matchTemplate(both, false)).toBe('minimal');
  });
});
