import { describe, expect, it } from 'vitest';
import {
  CARD_DARK,
  CARD_LIGHT,
  FONT_OPTIONS,
  LINE_WIDTH_PX,
  RECHARTS_PALETTE,
  STOCK_PRESENTATION,
  contrastRatio,
  dotGeometry,
  findFont,
  fontStack,
  judgeColor,
  normalizeHex,
  resolvePresentation,
  sanitizeOverrides,
  seriesColor,
  withAccountDefault,
  xAxisHeight,
  xLabelOverhang,
  type PresentationContext,
} from './chart-presentation.ts';

const lineCtx: PresentationContext = { kind: 'line', form: 'line', seriesCount: 2, hasProvisional: false };
const barCtx: PresentationContext = { kind: 'bar', form: 'bar', seriesCount: 3, hasProvisional: false };
const tableCtx: PresentationContext = { kind: 'line', form: 'table', seriesCount: 2, hasProvisional: false };

describe('STOCK_PRESENTATION — the session-87 stock look, pinned', () => {
  it('deep-equals the literals chart.tsx drew before this module existed', () => {
    expect(STOCK_PRESENTATION).toEqual({
      lineWidth: 'normal',
      markers: 'all',
      grid: 'both',
      xLabels: 'flat',
      axisLines: 'shown',
      valueLabels: 'shown',
      zeroBaseline: 'auto',
      seriesColors: {},
      fontFamily: null,
      language: null,
    });
    expect(LINE_WIDTH_PX.normal).toBe(2);
    expect(RECHARTS_PALETTE).toEqual(['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f', '#ffbb28', '#ff8042']);
  });
});

describe('resolvePresentation', () => {
  it('with no overrides returns the base values, no locks on a line, pristine', () => {
    const r = resolvePresentation(lineCtx, {});
    expect(r.values).toEqual(STOCK_PRESENTATION);
    expect(r.locks).toEqual({});
    expect(r.pristine).toBe(true);
    expect([...r.applicable].sort()).toEqual(
      ['axisLines', 'fontFamily', 'grid', 'language', 'lineWidth', 'markers', 'seriesColors', 'valueLabels', 'xLabels', 'zeroBaseline'].sort(),
    );
  });

  it('applies an override and is no longer pristine', () => {
    const r = resolvePresentation(lineCtx, { lineWidth: 'thick', grid: 'none' });
    expect(r.values.lineWidth).toBe('thick');
    expect(r.values.grid).toBe('none');
    expect(r.pristine).toBe(false);
  });

  it('bar form: value labels are forced shown and the baseline forced to zero, each with a digit-free reason', () => {
    const r = resolvePresentation(barCtx, { valueLabels: 'hidden', zeroBaseline: 'auto' });
    expect(r.values.valueLabels).toBe('shown');
    expect(r.values.zeroBaseline).toBe('zero');
    expect(r.locks.valueLabels).toMatch(/staafdiagram/);
    expect(r.locks.zeroBaseline).toMatch(/nul/);
    expect(r.locks.valueLabels).not.toMatch(/\d/);
    expect(r.locks.zeroBaseline).not.toMatch(/\d/);
    expect(r.applicable.has('lineWidth')).toBe(false);
    expect(r.applicable.has('markers')).toBe(false);
    expect(r.applicable.has('zeroBaseline')).toBe(false);
    expect(r.applicable.has('grid')).toBe(true);
  });

  it('table form: only the font and the chart language are applicable', () => {
    const r = resolvePresentation(tableCtx, { lineWidth: 'thick' });
    expect([...r.applicable]).toEqual(['fontFamily', 'language']);
  });

  it('WP218 phase 4: language is always applicable and never locked, on every form', () => {
    for (const ctx of [lineCtx, barCtx, tableCtx]) {
      const r = resolvePresentation(ctx, {});
      expect(r.applicable.has('language')).toBe(true);
      expect(r.locks.language).toBeUndefined();
    }
  });

  it('WP218 phase 4: a language override is not pristine, exactly like any other chosen value', () => {
    expect(resolvePresentation(lineCtx, { language: 'en' }).pristine).toBe(false);
    expect(resolvePresentation(lineCtx, { language: null }).pristine).toBe(false);
  });

  it('a stale override for a locked key never leaks into the values (locks re-run per call)', () => {
    const chosenOnLine = resolvePresentation(lineCtx, { valueLabels: 'hidden' });
    expect(chosenOnLine.values.valueLabels).toBe('hidden');
    const sameOverridesOnBar = resolvePresentation(barCtx, { valueLabels: 'hidden' });
    expect(sameOverridesOnBar.values.valueLabels).toBe('shown');
  });

  it('merges series colours per index on top of the base and ignores junk', () => {
    const r = resolvePresentation(lineCtx, { seriesColors: { 1: '#ff0000' } }, { ...STOCK_PRESENTATION, seriesColors: { 0: '#00ff00' } });
    expect(r.values.seriesColors).toEqual({ 0: '#00ff00', 1: '#ff0000' });
    expect(seriesColor(r.values, 0)).toBe('#00ff00');
    expect(seriesColor(r.values, 1)).toBe('#ff0000');
    expect(seriesColor(r.values, 2)).toBe(RECHARTS_PALETTE[2]);
    expect(seriesColor(r.values, 9)).toBe(RECHARTS_PALETTE[1]); // cycles like seriesStyle did
  });

  it('an empty seriesColors override still counts as pristine', () => {
    expect(resolvePresentation(lineCtx, { seriesColors: {} }).pristine).toBe(true);
  });
});

describe('withAccountDefault — WP218 phase 2 (owner C): the account default as resolvePresentation\'s base', () => {
  it('junk collapses to the stock look', () => {
    expect(withAccountDefault(null)).toEqual(STOCK_PRESENTATION);
    expect(withAccountDefault(undefined)).toEqual(STOCK_PRESENTATION);
    expect(withAccountDefault('nonsense')).toEqual(STOCK_PRESENTATION);
    expect(withAccountDefault({ bogus: 1, lineWidth: 'huge' })).toEqual(STOCK_PRESENTATION);
  });

  it('a valid partial merges on top of stock, the rest staying stock', () => {
    expect(withAccountDefault({ lineWidth: 'thick', grid: 'none' })).toEqual({
      ...STOCK_PRESENTATION,
      lineWidth: 'thick',
      grid: 'none',
    });
  });

  it('WP218 phase 4: a saved language default round-trips through withAccountDefault', () => {
    expect(withAccountDefault({ language: 'en' })).toEqual({ ...STOCK_PRESENTATION, language: 'en' });
  });

  it('a valid seriesColors partial replaces the (empty) stock map, junk entries dropped', () => {
    expect(withAccountDefault({ seriesColors: { 0: '#ABCDEF', 1: 'not-a-colour' } })).toEqual({
      ...STOCK_PRESENTATION,
      seriesColors: { 0: '#abcdef' },
    });
  });
});

describe('sanitizeOverrides — allow-list, never throws', () => {
  it('drops unknown keys, wrong enum values, malformed colours and non-objects', () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides('x')).toEqual({});
    expect(sanitizeOverrides({ lineWidth: 'huge', grid: 'none', bogus: 1 })).toEqual({ grid: 'none' });
    expect(sanitizeOverrides({ seriesColors: { 0: '#ABCDEF', 1: 'red', x: '#000000' } })).toEqual({ seriesColors: { 0: '#abcdef' } });
    expect(sanitizeOverrides({ fontFamily: 'Roboto' })).toEqual({ fontFamily: 'Roboto' });
    expect(sanitizeOverrides({ fontFamily: '<script>' })).toEqual({});
    expect(sanitizeOverrides({ fontFamily: null })).toEqual({ fontFamily: null });
  });

  it('WP218 phase 4: language accepts nl/en/null, drops any other value', () => {
    expect(sanitizeOverrides({ language: 'en' })).toEqual({ language: 'en' });
    expect(sanitizeOverrides({ language: 'nl' })).toEqual({ language: 'nl' });
    expect(sanitizeOverrides({ language: null })).toEqual({ language: null });
    expect(sanitizeOverrides({ language: 'fr' })).toEqual({});
    expect(sanitizeOverrides({ language: 1 })).toEqual({});
  });
});

describe('geometry helpers', () => {
  it('dotGeometry keeps the hollow ring legible at every width (r = max(4, px + 2), ring 2)', () => {
    expect(dotGeometry('thin')).toEqual({ r: 4, ring: 2 });
    expect(dotGeometry('normal')).toEqual({ r: 4, ring: 2 });
    expect(dotGeometry('thick')).toEqual({ r: 5, ring: 2 });
    expect(dotGeometry('extraThick')).toEqual({ r: 6, ring: 2 });
  });
  it('xLabelOverhang reserves left margin only for tilted labels, capped (browser-pass clipping fix)', () => {
    expect(xLabelOverhang('flat', '2024 november')).toBe(0);
    expect(xLabelOverhang('tilted', '2024 november')).toBe(Math.ceil(13 * 6.5 * 0.71));
    expect(xLabelOverhang('tilted', 'x'.repeat(200))).toBe(96);
  });
  it('xAxisHeight reserves room only for tilted labels, capped', () => {
    expect(xAxisHeight('flat', '2021 1e kwartaal')).toBeUndefined();
    expect(xAxisHeight('tilted', '2021')).toBe(Math.ceil(4 * 6.5 * 0.71) + 20);
    expect(xAxisHeight('tilted', 'x'.repeat(200))).toBe(96);
  });
});

describe('colours — normalise, contrast, judge', () => {
  it('normalizeHex accepts 3- and 6-digit forms with or without #, lowercases, rejects the rest', () => {
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });
  it('contrastRatio is the WCAG ratio (white/black = 21, identical = 1)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
  it('every stock palette colour is accepted (never refused) — the default look must always be choosable', () => {
    for (const hex of RECHARTS_PALETTE) expect(judgeColor(hex).ok).toBe(true);
  });
  it('refuses near-white (invisible on the light card) and near-black (invisible on the dark card) with a digit-free reason', () => {
    const white = judgeColor('#fefefe');
    expect(white.ok).toBe(false);
    if (!white.ok) expect(white.reason).not.toMatch(/\d/);
    expect(judgeColor(CARD_DARK).ok).toBe(false);
    expect(judgeColor('#1a1a1a').ok).toBe(false);
  });
  it('warns per theme when contrast is weak but the ring is still visible', () => {
    expect(judgeColor('#ffc658')).toEqual({ ok: true, warning: 'light' });
    expect(judgeColor('#3a3a3a')).toEqual({ ok: true, warning: 'dark' });
    expect(judgeColor('#ff0000')).toEqual({ ok: true, warning: null });
    expect(contrastRatio('#ffc658', CARD_LIGHT)).toBeLessThan(3);
  });
});

describe('fonts', () => {
  it('offers the curated list, page font first, and builds a safe stack', () => {
    expect(FONT_OPTIONS[0]).toEqual({ family: 'Roboto', source: 'google', stack: '"Roboto", ui-sans-serif, system-ui, sans-serif' });
    expect(FONT_OPTIONS.map((f) => f.family)).toEqual(['Roboto', 'Open Sans', 'Lato', 'Merriweather', 'Playfair Display', 'Georgia', 'Arial']);
    expect(fontStack(null)).toBeUndefined();
    expect(fontStack('Georgia')).toBe('"Georgia", ui-serif, Georgia, serif');
    expect(fontStack('Nope')).toBe('"Nope", ui-sans-serif, system-ui, sans-serif'); // an unknown (brand) family still gets a stack
    expect(findFont('Lato')?.source).toBe('google');
    expect(findFont('Arial')?.source).toBe('system');
  });
});
