import { describe, expect, it } from 'vitest';
import {
  LINE_WIDTH_PX,
  RECHARTS_PALETTE,
  STOCK_PRESENTATION,
  dotGeometry,
  resolvePresentation,
  sanitizeOverrides,
  seriesColor,
  xAxisHeight,
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
      ['axisLines', 'fontFamily', 'grid', 'lineWidth', 'markers', 'seriesColors', 'valueLabels', 'xLabels', 'zeroBaseline'].sort(),
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

  it('table form: only the font is applicable', () => {
    const r = resolvePresentation(tableCtx, { lineWidth: 'thick' });
    expect([...r.applicable]).toEqual(['fontFamily']);
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
});

describe('geometry helpers', () => {
  it('dotGeometry keeps the hollow ring legible at every width (r = max(4, px + 2), ring 2)', () => {
    expect(dotGeometry('thin')).toEqual({ r: 4, ring: 2 });
    expect(dotGeometry('normal')).toEqual({ r: 4, ring: 2 });
    expect(dotGeometry('thick')).toEqual({ r: 5, ring: 2 });
    expect(dotGeometry('extraThick')).toEqual({ r: 6, ring: 2 });
  });
  it('xAxisHeight reserves room only for tilted labels, capped', () => {
    expect(xAxisHeight('flat', '2021 1e kwartaal')).toBeUndefined();
    expect(xAxisHeight('tilted', '2021')).toBe(Math.ceil(4 * 6.5 * 0.71) + 20);
    expect(xAxisHeight('tilted', 'x'.repeat(200))).toBe(96);
  });
});
