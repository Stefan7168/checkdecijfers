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
  it('lists the thirteen looks in order with their catalogue keys (the original eight first, unchanged; the five session-120 house styles after)', () => {
    expect(CHART_TEMPLATES.map((t) => t.id)).toEqual([
      'standard', 'classic', 'newsroom', 'presentation', 'social', 'minimal', 'warm', 'earth',
      'salmon', 'studio', 'broadsheet', 'autumn', 'brutalist',
    ]);
    for (const t of CHART_TEMPLATES) {
      expect(t.nameKey).toBe(`chart.template.${t.id}`);
      expect(t.descriptionKey).toBe(`chart.template.${t.id}Description`);
    }
  });
  it('standard is the designed default itself, applied explicitly (the stock look minus colour/font/language); classic is the session-87 look with the classic colours', () => {
    const { seriesColors: _c, fontFamily: _f, language: _l, ...stockLook } = STOCK_PRESENTATION;
    expect(templateById('standard').overrides).toEqual(stockLook);
    expect(templateById('standard').overrides).not.toHaveProperty('seriesColors');
    expect(templateById('standard').overrides).not.toHaveProperty('fontFamily');
    expect(templateById('standard').overrides).not.toHaveProperty('language');
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
  it('the five session-120 house styles (#275) carry exactly their designed values — solid paper, own full palette, own font', () => {
    expect(templateById('salmon').overrides).toEqual({
      frameBackground: { kind: 'solid', hex: '#f4d6bf' },
      frameCorners: 'rounded',
      frameShadow: 'soft',
      framePadding: 'medium',
      grid: 'horizontal',
      axisLines: 'hidden',
      fontFamily: 'Playfair Display',
      seriesColors: { 0: '#a8455a', 1: '#8a5d1c', 2: '#56704b', 3: '#4d6d7d', 4: '#7a3d5f', 5: '#5a4a1a', 6: '#6b3a52', 7: '#3d5c40' },
    });
    expect(templateById('studio').overrides).toEqual({
      frameBackground: { kind: 'solid', hex: '#eae7e2' },
      frameCorners: 'square',
      frameShadow: 'none',
      framePadding: 'small',
      grid: 'none',
      axisLines: 'hidden',
      lineWidth: 'thin',
      fontFamily: 'Lato',
      seriesColors: { 0: '#726f68', 1: '#d3652c', 2: '#6f6a62', 3: '#7c7871', 4: '#a8642e', 5: '#5f6a63', 6: '#8a6a3f', 7: '#4a4844' },
    });
    expect(templateById('broadsheet').overrides).toEqual({
      frameBackground: { kind: 'solid', hex: '#fafaf8' },
      frameCorners: 'square',
      frameShadow: 'none',
      framePadding: 'small',
      grid: 'horizontal',
      axisLines: 'hidden',
      fontFamily: 'Georgia',
      seriesColors: { 0: '#3a3a38', 1: '#b3211e', 2: '#5a5a56', 3: '#7a7a74', 4: '#8f2a26', 5: '#2a2a28', 6: '#6b1e1b', 7: '#4a4a46' },
    });
    expect(templateById('autumn').overrides).toEqual({
      frameBackground: { kind: 'solid', hex: '#fbeed9' },
      frameCorners: 'veryRounded',
      frameShadow: 'soft',
      framePadding: 'medium',
      grid: 'horizontal',
      axisLines: 'hidden',
      markers: 'ends',
      fontFamily: 'Open Sans',
      seriesColors: { 0: '#c1502e', 1: '#9a7a1f', 2: '#8a7d3a', 3: '#a8622f', 4: '#96701f', 5: '#6f6a2e', 6: '#9a4a28', 7: '#7a5a1f' },
    });
    expect(templateById('brutalist').overrides).toEqual({
      frameBackground: { kind: 'solid', hex: '#121212' },
      frameCorners: 'square',
      frameShadow: 'none',
      framePadding: 'small',
      grid: 'none',
      axisLines: 'shown',
      lineWidth: 'thick',
      fontFamily: 'Archivo Black',
      seriesColors: { 0: '#d9d9d9', 1: '#c6ff3d', 2: '#8f8f8f', 3: '#f2f2f2', 4: '#9fe23a', 5: '#bdbdbd', 6: '#e0e0e0', 7: '#7ac82e' },
    });
  });
  it('every template survives sanitizeOverrides byte-identical — no key the resolver does not know', () => {
    for (const t of CHART_TEMPLATES) expect(sanitizeOverrides(t.overrides)).toEqual(t.overrides);
  });
  it('design-time contrast gate: no template refuses any colour of its own declared palette (or, when it declares none, any default colour) against its own backdrops', () => {
    // classic's declared palette IS RECHARTS_PALETTE, so its check is unchanged
    // by reading the override; the five session-120 house styles each declare
    // their own full palette and are judged against their own solid paper.
    expect(Object.values(templateById('classic').overrides.seriesColors!)).toEqual(RECHARTS_PALETTE);
    for (const t of CHART_TEMPLATES) {
      const values = resolvePresentation(lineCtx, t.overrides).values;
      const backdrops = frameBackdrops(values);
      const palette = t.overrides.seriesColors ? Object.values(t.overrides.seriesColors) : DEFAULT_PALETTE;
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
  it('a chart wearing the exact stock look is standard; a chart wearing another template matches it; a tweaked chart matches nothing', () => {
    expect(matchTemplate(STOCK_PRESENTATION)).toBe('standard');
    for (const t of CHART_TEMPLATES) {
      if (t.id === 'standard') continue;
      const values = resolvePresentation(lineCtx, t.overrides).values;
      expect(matchTemplate(values), t.id).toBe(t.id);
    }
    const tweaked = resolvePresentation(lineCtx, { ...templateById('newsroom').overrides, lineWidth: 'thin' }).values;
    expect(matchTemplate(tweaked)).toBeNull();
  });
  it('a chart equal to stock but with one tweak matches nothing, and the most specific match wins', () => {
    const almostStock: typeof STOCK_PRESENTATION = { ...STOCK_PRESENTATION, lineWidth: 'thin' };
    expect(matchTemplate(almostStock)).toBeNull();
    // minimal ⊂ nothing else, but a chart with minimal's keys AND newsroom's extra keys is neither
    const both = resolvePresentation(lineCtx, { ...templateById('minimal').overrides, framePadding: 'small' }).values;
    expect(matchTemplate(both)).toBe('minimal');
  });
  it('standard still matches on bar/hbar/area forms, where zeroBaseline is honesty-locked to "zero" regardless of the template (a real form constraint, not a "look")', () => {
    const hbarCtx: PresentationContext = { kind: 'bar', form: 'hbar', seriesCount: 3, hasProvisional: true };
    const areaCtx: PresentationContext = { kind: 'line', form: 'area', seriesCount: 1, hasProvisional: true };
    for (const ctx of [barCtx, hbarCtx, areaCtx]) {
      const resolved = resolvePresentation(ctx, templateById('standard').overrides);
      expect(resolved.values.zeroBaseline, ctx.form).toBe('zero');
      expect(matchTemplate(resolved.values, resolved.locks), ctx.form).toBe('standard');
    }
  });
  it('a locked key does not let an otherwise-mismatched template match — only the locked key itself is excused', () => {
    const resolved = resolvePresentation(barCtx, { ...templateById('standard').overrides, lineWidth: 'thin' });
    expect(matchTemplate(resolved.values, resolved.locks)).toBeNull();
  });
  it('an account default shaped like Klassiek is matched as classic; applying standard on top of it matches standard', () => {
    const classicBase = { ...STOCK_PRESENTATION, ...templateById('classic').overrides };
    const values = resolvePresentation(lineCtx, {}, classicBase).values;
    expect(matchTemplate(values)).toBe('classic');
    const standardOnClassicBase = resolvePresentation(lineCtx, templateById('standard').overrides, classicBase).values;
    expect(matchTemplate(standardOnClassicBase)).toBe('standard');
  });
});
