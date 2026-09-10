import { describe, expect, it } from 'vitest';
import {
  CARD_DARK,
  CARD_LIGHT,
  CHART_MAX_HEIGHT_PX,
  CHART_MIN_HEIGHT_PX,
  CLASSIC_PRESENTATION,
  DEFAULT_PALETTE,
  FONT_OPTIONS,
  FRAME_CORNER_PX,
  FRAME_GRADIENT_PRESETS,
  FRAME_INSET_PX,
  FRAME_PADDING_PX,
  FRAME_SHADOW,
  LINE_WIDTH_PX,
  LOCK_REASONS,
  RECHARTS_PALETTE,
  STOCK_PRESENTATION,
  chartHeightForWidth,
  contrastRatio,
  dotGeometry,
  findFont,
  fontStack,
  frameAspectRatio,
  frameBackdrops,
  isFramePristine,
  judgeColor,
  judgeColorAgainst,
  markerVisible,
  normalizeHex,
  resolvePresentation,
  sanitizeOverrides,
  seriesColor,
  withAccountDefault,
  xAxisHeight,
  xLabelOverhang,
  type PresentationContext,
} from './chart-presentation.ts';

// Design-time arithmetic for the default palette (session-92 lesson turned
// into a gate). Machado et al. 2009, severity 1.0, applied in linear sRGB;
// distance measured in OKLab. Only what the pins below need — not a colour
// library.
const degamma = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(degamma) as [number, number, number];
}
function linearToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const CVD_MATRICES: Record<string, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
function simulate(matrix: number[][], rgb: [number, number, number]): [number, number, number] {
  return matrix.map((row) => row[0]! * rgb[0] + row[1]! * rgb[1] + row[2]! * rgb[2]) as [number, number, number];
}
function oklabDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const lineCtx: PresentationContext = { kind: 'line', form: 'line', seriesCount: 2, hasProvisional: false };
const barCtx: PresentationContext = { kind: 'bar', form: 'bar', seriesCount: 3, hasProvisional: false };
const tableCtx: PresentationContext = { kind: 'line', form: 'table', seriesCount: 2, hasProvisional: false };
// WP218 phase 5: area is a single-series line-kind spec shown as a filled
// area; hbar is a bar-kind (comparison) spec shown as horizontal bars.
const areaCtx: PresentationContext = { kind: 'line', form: 'area', seriesCount: 1, hasProvisional: false };
const hbarCtx: PresentationContext = { kind: 'bar', form: 'hbar', seriesCount: 3, hasProvisional: false };

describe('the designed default (ADR 042) and the classic session-87 look, both pinned', () => {
  it('STOCK_PRESENTATION is the designed default: ends markers, horizontal grid, no axis lines, gradient area fill', () => {
    expect(STOCK_PRESENTATION).toEqual({
      lineWidth: 'normal',
      markers: 'ends',
      grid: 'horizontal',
      xLabels: 'flat',
      axisLines: 'hidden',
      valueLabels: 'shown',
      zeroBaseline: 'auto',
      areaFill: 'gradient',
      seriesColors: {},
      fontFamily: null,
      language: null,
      frameBackground: 'none',
      framePadding: 'none',
      frameCorners: 'square',
      frameShadow: 'none',
      frameInset: 'none',
      frameAspect: 'auto',
    });
  });
  it('CLASSIC_PRESENTATION deep-equals the literals chart.tsx drew in session 87 (kept for the Classic look)', () => {
    expect(CLASSIC_PRESENTATION).toEqual({
      lineWidth: 'normal',
      markers: 'all',
      grid: 'both',
      xLabels: 'flat',
      axisLines: 'shown',
      valueLabels: 'shown',
      zeroBaseline: 'auto',
      areaFill: 'flat',
      seriesColors: {},
      fontFamily: null,
      language: null,
      frameBackground: 'none',
      framePadding: 'none',
      frameCorners: 'square',
      frameShadow: 'none',
      frameInset: 'none',
      frameAspect: 'auto',
    });
  });
  it('the classic palette literals are unchanged and the default palette is the eight ADR-042 hues', () => {
    expect(RECHARTS_PALETTE).toEqual(['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f', '#ffbb28', '#ff8042']);
    expect(DEFAULT_PALETTE).toEqual(['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#b8860b', '#3a8fc4', '#6a5acd', '#6f8d2a']);
    expect(new Set(DEFAULT_PALETTE).size).toBe(DEFAULT_PALETTE.length);
    for (const c of DEFAULT_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('resolvePresentation', () => {
  it('with no overrides returns the base values, no locks on a line, pristine', () => {
    const r = resolvePresentation(lineCtx, {});
    expect(r.values).toEqual(STOCK_PRESENTATION);
    expect(r.locks).toEqual({});
    expect(r.pristine).toBe(true);
    expect([...r.applicable].sort()).toEqual(
      [
        'axisLines',
        'fontFamily',
        'frameAspect',
        'frameBackground',
        'frameCorners',
        'frameInset',
        'framePadding',
        'frameShadow',
        'grid',
        'language',
        'lineWidth',
        'markers',
        'seriesColors',
        'valueLabels',
        'xLabels',
        'zeroBaseline',
      ].sort(),
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

  it('WP218 phase 5: area form behaves like line but forces zeroBaseline to zero with its own digit-free reason', () => {
    const r = resolvePresentation(areaCtx, { zeroBaseline: 'auto', lineWidth: 'thick', markers: 'provisionalOnly' });
    expect(r.values.zeroBaseline).toBe('zero');
    expect(r.locks.zeroBaseline).toBe(LOCK_REASONS.zeroBaselineArea);
    expect(r.locks.zeroBaseline).not.toMatch(/\d/);
    // "Like line" otherwise: lineWidth/markers/grid/xLabels/etc. are neither
    // forced nor removed from applicable — only zeroBaseline is touched.
    expect(r.values.lineWidth).toBe('thick');
    expect(r.values.markers).toBe('provisionalOnly');
    expect([...r.applicable].sort()).toEqual(
      [
        'areaFill',
        'axisLines',
        'fontFamily',
        'frameAspect',
        'frameBackground',
        'frameCorners',
        'frameInset',
        'framePadding',
        'frameShadow',
        'grid',
        'language',
        'lineWidth',
        'markers',
        'seriesColors',
        'valueLabels',
        'xLabels',
        'zeroBaseline',
      ].sort(),
    );
    expect(r.locks.valueLabels).toBeUndefined();
  });

  it('WP218 phase 5: area\'s zeroBaseline reason is distinct from the bar reason (own copy, own key)', () => {
    expect(LOCK_REASONS.zeroBaselineArea).not.toBe(LOCK_REASONS.zeroBaselineBar);
    expect(LOCK_REASONS.zeroBaselineArea).toMatch(/nul/);
  });

  it('WP218 phase 5: hbar behaves like bar (value labels + zero baseline locked, lineWidth/markers not applicable), reusing the SAME bar reasons', () => {
    const r = resolvePresentation(hbarCtx, { valueLabels: 'hidden', zeroBaseline: 'auto' });
    expect(r.values.valueLabels).toBe('shown');
    expect(r.values.zeroBaseline).toBe('zero');
    expect(r.locks.valueLabels).toBe(LOCK_REASONS.valueLabelsBar);
    expect(r.locks.zeroBaseline).toBe(LOCK_REASONS.zeroBaselineBar);
    expect(r.applicable.has('lineWidth')).toBe(false);
    expect(r.applicable.has('markers')).toBe(false);
    expect(r.applicable.has('zeroBaseline')).toBe(false);
    expect(r.applicable.has('grid')).toBe(true);
    expect(r.applicable.has('seriesColors')).toBe(true);
  });

  it('WP218 phase 5: hbar additionally makes xLabels not applicable — labels sit on the category axis, not the number axis', () => {
    const r = resolvePresentation(hbarCtx, {});
    expect(r.applicable.has('xLabels')).toBe(false);
    // ...whereas plain bar keeps xLabels applicable, unchanged by this phase.
    expect(resolvePresentation(barCtx, {}).applicable.has('xLabels')).toBe(true);
  });

  // Final-review fix: the Style panel (ChartConfigPanel, which is where
  // fontFamily, language and the Frame tab are all offered) is never mounted
  // in Tabel form (chart.tsx: `state.form !== 'table'`) — table form gets NO
  // frame and NO Style panel, as before the Frame-tab feature. Only
  // `language` stays applicable there, since it has no honesty consequence.
  it('table form: only language is applicable — the style panel (including the frame) is never offered there', () => {
    const r = resolvePresentation(tableCtx, {
      lineWidth: 'thick',
      fontFamily: 'Roboto',
      language: 'en',
      frameBackground: { kind: 'solid', hex: '#ff0000' },
    });
    expect([...r.applicable].sort()).toEqual(['language']);
  });

  it('WP218 phase 4: language is applicable and never locked on every form the panel is offered on — including table', () => {
    for (const ctx of [lineCtx, barCtx, areaCtx, hbarCtx, tableCtx]) {
      const r = resolvePresentation(ctx, {});
      expect(r.applicable.has('language')).toBe(true);
      expect(r.locks.language).toBeUndefined();
    }
  });

  it('frame keys pass through unchanged and applicable on every non-table form, but NOT in table form', () => {
    const overrides = {
      frameBackground: { kind: 'solid' as const, hex: '#ff0000' },
      framePadding: 'large' as const,
      frameCorners: 'veryRounded' as const,
      frameShadow: 'strong' as const,
      frameInset: 'large' as const,
      frameAspect: '16:9' as const,
    };
    for (const ctx of [lineCtx, barCtx]) {
      const r = resolvePresentation(ctx, overrides);
      expect(r.values.frameBackground).toEqual(overrides.frameBackground);
      expect(r.values.framePadding).toBe('large');
      expect(r.values.frameCorners).toBe('veryRounded');
      expect(r.values.frameShadow).toBe('strong');
      expect(r.values.frameInset).toBe('large');
      expect(r.values.frameAspect).toBe('16:9');
      for (const key of ['frameBackground', 'framePadding', 'frameCorners', 'frameShadow', 'frameInset', 'frameAspect'] as const) {
        expect(r.applicable.has(key)).toBe(true);
      }
    }
    // Table form: values still pass through the resolver unmolested (they're
    // just not `applicable` — the panel that would offer them is unmounted).
    const tableResult = resolvePresentation(tableCtx, overrides);
    for (const key of ['frameBackground', 'framePadding', 'frameCorners', 'frameShadow', 'frameInset', 'frameAspect'] as const) {
      expect(tableResult.applicable.has(key)).toBe(false);
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
    expect(seriesColor(r.values, 2)).toBe(DEFAULT_PALETTE[2]);
    expect(seriesColor(r.values, 9)).toBe(DEFAULT_PALETTE[1]); // cycles like seriesStyle did
  });

  it('an empty seriesColors override still counts as pristine', () => {
    expect(resolvePresentation(lineCtx, { seriesColors: {} }).pristine).toBe(true);
  });

  it('areaFill is applicable in area form only — never offered on line, bar, hbar or table', () => {
    expect(resolvePresentation({ ...lineCtx, form: 'area' }, {}).applicable.has('areaFill')).toBe(true);
    expect(resolvePresentation(lineCtx, {}).applicable.has('areaFill')).toBe(false);
    expect(resolvePresentation({ ...lineCtx, kind: 'bar', form: 'bar' }, {}).applicable.has('areaFill')).toBe(false);
    expect(resolvePresentation({ ...lineCtx, kind: 'bar', form: 'hbar' }, {}).applicable.has('areaFill')).toBe(false);
    expect(resolvePresentation({ ...lineCtx, form: 'table' }, {}).applicable.has('areaFill')).toBe(false);
  });
  it('an areaFill override passes through in area form and is sanitised like any enum', () => {
    expect(resolvePresentation({ ...lineCtx, form: 'area' }, { areaFill: 'flat' }).values.areaFill).toBe('flat');
    expect(sanitizeOverrides({ areaFill: 'striped' })).toEqual({});
    expect(sanitizeOverrides({ markers: 'ends' })).toEqual({ markers: 'ends' });
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

  it('accepts each valid frame value', () => {
    expect(sanitizeOverrides({ frameBackground: 'none' })).toEqual({ frameBackground: 'none' });
    expect(sanitizeOverrides({ frameBackground: { kind: 'solid', hex: '#ABCDEF' } })).toEqual({
      frameBackground: { kind: 'solid', hex: '#abcdef' },
    });
    expect(sanitizeOverrides({ frameBackground: { kind: 'gradient', from: '#fde68a', to: '#f472b6' } })).toEqual({
      frameBackground: { kind: 'gradient', from: '#fde68a', to: '#f472b6' },
    });
    expect(sanitizeOverrides({ frameBackground: { kind: 'image' } })).toEqual({ frameBackground: { kind: 'image' } });
    expect(sanitizeOverrides({ framePadding: 'large' })).toEqual({ framePadding: 'large' });
    expect(sanitizeOverrides({ frameCorners: 'veryRounded' })).toEqual({ frameCorners: 'veryRounded' });
    expect(sanitizeOverrides({ frameShadow: 'strong' })).toEqual({ frameShadow: 'strong' });
    expect(sanitizeOverrides({ frameInset: 'small' })).toEqual({ frameInset: 'small' });
    expect(sanitizeOverrides({ frameAspect: '4:5' })).toEqual({ frameAspect: '4:5' });
  });

  it('drops invalid frame values without throwing', () => {
    expect(sanitizeOverrides({ framePadding: 'huge' })).toEqual({});
    expect(sanitizeOverrides({ frameBackground: { kind: 'solid', hex: '#abc' } })).toEqual({});
    expect(sanitizeOverrides({ frameBackground: { kind: 'gradient', from: '#fde68a' } })).toEqual({});
    expect(sanitizeOverrides({ frameBackground: { kind: 'image', extra: 'nope' } })).toEqual({});
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
  it('every DEFAULT palette colour clears the warning line on BOTH cards — never a warning, let alone a refusal (ADR 042)', () => {
    for (const hex of DEFAULT_PALETTE) expect(judgeColor(hex), hex).toEqual({ ok: true, warning: null });
  });
  it('every CLASSIC palette colour is still accepted (never refused) — the Classic look must stay choosable', () => {
    for (const hex of RECHARTS_PALETTE) expect(judgeColor(hex).ok).toBe(true);
  });
  it('the first four default colours stay apart under protanopia, deuteranopia and tritanopia (OKLab distance ≥ 0.07)', () => {
    const four = DEFAULT_PALETTE.slice(0, 4);
    for (const [name, matrix] of Object.entries(CVD_MATRICES)) {
      for (let i = 0; i < four.length; i++) {
        for (let j = i + 1; j < four.length; j++) {
          const a = linearToOklab(simulate(matrix, hexToLinear(four[i]!)));
          const b = linearToOklab(simulate(matrix, hexToLinear(four[j]!)));
          expect(oklabDistance(a, b), `${name}: ${four[i]} vs ${four[j]}`).toBeGreaterThanOrEqual(0.07);
        }
      }
    }
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
  it('judgeColor(hex) is byte-identical to judgeColorAgainst(hex, [CARD_LIGHT, CARD_DARK])', () => {
    for (const hex of [...RECHARTS_PALETTE, '#fefefe', CARD_DARK, '#ffc658', '#3a3a3a']) {
      expect(judgeColor(hex)).toEqual(judgeColorAgainst(hex, [CARD_LIGHT, CARD_DARK]));
    }
  });
  it('judgeColorAgainst refuses when contrast is below COLOR_REFUSE_BELOW against ANY given backdrop', () => {
    expect(judgeColorAgainst('#8884d8', ['#8884d8']).ok).toBe(false);
    expect(judgeColorAgainst('#8884d8', ['#8884d8', CARD_LIGHT]).ok).toBe(false);
    expect(judgeColorAgainst('#8884d8', [CARD_LIGHT, CARD_DARK]).ok).toBe(true);
  });
});

describe('frame', () => {
  it('frameAspectRatio maps each named aspect, auto is null', () => {
    expect(frameAspectRatio('auto')).toBeNull();
    expect(frameAspectRatio('16:9')).toBeCloseTo(16 / 9, 5);
    expect(frameAspectRatio('4:5')).toBeCloseTo(4 / 5, 5);
    expect(frameAspectRatio('1:1')).toBe(1);
    expect(frameAspectRatio('1.91:1')).toBeCloseTo(1.91, 5);
  });

  it('FRAME_PADDING_PX / FRAME_CORNER_PX / FRAME_INSET_PX / FRAME_SHADOW match the brief', () => {
    expect(FRAME_PADDING_PX).toEqual({ none: 0, small: 16, medium: 32, large: 56 });
    expect(FRAME_CORNER_PX).toEqual({ square: 0, rounded: 12, veryRounded: 28 });
    expect(FRAME_INSET_PX).toEqual({ none: 0, small: 12, large: 24 });
    expect(FRAME_SHADOW.none).toBeNull();
    expect(FRAME_SHADOW.soft).toEqual({ dx: 0, dy: 4, blur: 12, alpha: 0.18 });
    expect(FRAME_SHADOW.strong).toEqual({ dx: 0, dy: 10, blur: 28, alpha: 0.32 });
  });

  it('FRAME_GRADIENT_PRESETS carries the six named lowercase-hex pairs', () => {
    expect(FRAME_GRADIENT_PRESETS).toEqual([
      { id: 'dawn', from: '#fde68a', to: '#f9a8d4' },
      { id: 'ocean', from: '#38bdf8', to: '#1e3a8a' },
      { id: 'forest', from: '#bbf7d0', to: '#166534' },
      { id: 'berry', from: '#f9a8d4', to: '#7e22ce' },
      { id: 'slate', from: '#e2e8f0', to: '#334155' },
      { id: 'sand', from: '#fef3c7', to: '#92400e' },
    ]);
  });

  it('no gradient preset refuses ANY default-palette colour — presets are checked against the palette at design time (session-92 lesson)', () => {
    for (const preset of FRAME_GRADIENT_PRESETS) {
      for (const hex of DEFAULT_PALETTE) {
        expect(judgeColorAgainst(hex, [preset.from, preset.to]).ok, `${preset.id} × ${hex}`).toBe(true);
      }
    }
  });

  it('frameBackdrops: inset on returns the card colours, regardless of background', () => {
    expect(frameBackdrops({ frameBackground: 'none', frameInset: 'small' })).toEqual([CARD_LIGHT, CARD_DARK]);
    expect(frameBackdrops({ frameBackground: { kind: 'solid', hex: '#ff0000' }, frameInset: 'large' })).toEqual([CARD_LIGHT, CARD_DARK]);
  });

  it('frameBackdrops: solid background with no inset returns its hex', () => {
    expect(frameBackdrops({ frameBackground: { kind: 'solid', hex: '#ff0000' }, frameInset: 'none' })).toEqual(['#ff0000']);
  });

  it('frameBackdrops: gradient background with no inset returns both ends', () => {
    expect(
      frameBackdrops({ frameBackground: { kind: 'gradient', from: '#fde68a', to: '#f472b6' }, frameInset: 'none' }),
    ).toEqual(['#fde68a', '#f472b6']);
  });

  it('frameBackdrops: none/image with no inset falls back to the card colours', () => {
    expect(frameBackdrops({ frameBackground: 'none', frameInset: 'none' })).toEqual([CARD_LIGHT, CARD_DARK]);
    expect(frameBackdrops({ frameBackground: { kind: 'image' }, frameInset: 'none' })).toEqual([CARD_LIGHT, CARD_DARK]);
  });

  it('isFramePristine is true only at the stock frame values', () => {
    expect(
      isFramePristine({
        frameBackground: 'none',
        framePadding: 'none',
        frameCorners: 'square',
        frameShadow: 'none',
        frameInset: 'none',
        frameAspect: 'auto',
      }),
    ).toBe(true);
    expect(
      isFramePristine({
        frameBackground: 'none',
        framePadding: 'small',
        frameCorners: 'square',
        frameShadow: 'none',
        frameInset: 'none',
        frameAspect: 'auto',
      }),
    ).toBe(false);
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

describe('markerVisible — the "ends" marker mode (ADR 042)', () => {
  const ends = { first: '2019JJ00', last: '2024JJ00' };
  it('all: every point; provisionalOnly: only provisional points', () => {
    expect(markerVisible('all', false, '2021JJ00', ends)).toBe(true);
    expect(markerVisible('provisionalOnly', false, '2024JJ00', ends)).toBe(false);
    expect(markerVisible('provisionalOnly', true, '2021JJ00', ends)).toBe(true);
  });
  it('ends: the first and last plotted point, every provisional point, nothing else', () => {
    expect(markerVisible('ends', false, '2019JJ00', ends)).toBe(true);
    expect(markerVisible('ends', false, '2024JJ00', ends)).toBe(true);
    expect(markerVisible('ends', false, '2021JJ00', ends)).toBe(false);
    expect(markerVisible('ends', true, '2021JJ00', ends)).toBe(true);
  });
  it('a provisional point is ALWAYS visible in every mode (R11), and ends without endpoints shows only provisional points', () => {
    for (const mode of ['all', 'ends', 'provisionalOnly'] as const) expect(markerVisible(mode, true, 'x', null)).toBe(true);
    expect(markerVisible('ends', false, '2019JJ00', null)).toBe(false);
  });
});

describe('chartHeightForWidth — the height follows the width, clamped (ADR 042)', () => {
  it('is 256 below ~455 px, 9:16 of the width between, 360 at 640 px and above; unmeasured is 256', () => {
    expect(chartHeightForWidth(0)).toBe(CHART_MIN_HEIGHT_PX);
    expect(chartHeightForWidth(-5)).toBe(256);
    expect(chartHeightForWidth(Number.NaN)).toBe(256);
    expect(chartHeightForWidth(320)).toBe(256);
    expect(chartHeightForWidth(455)).toBe(256);
    expect(chartHeightForWidth(560)).toBe(315);
    expect(chartHeightForWidth(640)).toBe(360);
    expect(chartHeightForWidth(1200)).toBe(CHART_MAX_HEIGHT_PX);
  });
});
