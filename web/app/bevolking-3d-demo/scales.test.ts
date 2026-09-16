import { MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { CARD_DARK, CARD_LIGHT, contrastRatio, DEFAULT_PALETTE } from '../../lib/chart-presentation.ts';
import { applyGrowthColor, formatGrowth, formatPopulation, GROWTH_DOMAIN, GROWTH_HIGH_HEX, GROWTH_LOW_HEX, GROWTH_MID_HEX, growthColor, heightFor, MAX_HEIGHT, MIN_HEIGHT, mixHex } from './scales.ts';

describe('growth colour scale — the house palette, never an invented one (ADR 049)', () => {
  it('its two ends ARE the first two designed-default palette colours', () => {
    expect(GROWTH_LOW_HEX).toBe(DEFAULT_PALETTE[1]);
    expect(GROWTH_HIGH_HEX).toBe(DEFAULT_PALETTE[0]);
  });
  it('both ends clear 3:1 against both cards (the ADR 042 pin, re-asserted here so the demo cannot drift from it)', () => {
    for (const hex of [GROWTH_LOW_HEX, GROWTH_HIGH_HEX]) {
      expect(contrastRatio(hex, CARD_LIGHT)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(hex, CARD_DARK)).toBeGreaterThanOrEqual(3);
    }
  });
  it('zero growth is the theme midpoint; the domain ends and beyond saturate; NaN is neutral', () => {
    expect(growthColor(0, 'light')).toBe(GROWTH_MID_HEX.light);
    expect(growthColor(0, 'dark')).toBe(GROWTH_MID_HEX.dark);
    expect(growthColor(GROWTH_DOMAIN, 'light')).toBe(GROWTH_HIGH_HEX);
    expect(growthColor(2, 'light')).toBe(GROWTH_HIGH_HEX);
    expect(growthColor(-GROWTH_DOMAIN, 'dark')).toBe(GROWTH_LOW_HEX);
    expect(growthColor(-9, 'dark')).toBe(GROWTH_LOW_HEX);
    expect(growthColor(Number.NaN, 'light')).toBe(GROWTH_MID_HEX.light);
  });
  it('mixHex interpolates per channel and clamps t', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 7)).toBe('#ffffff');
  });
});

describe('applyGrowthColor — the D1′ floor/column colour-sharing mechanism (ADR 049 v2)', () => {
  it('computes growthColor() exactly once and applies the identical hex to every material passed in, against real MeshLambertMaterial instances', () => {
    const floor = new MeshLambertMaterial();
    const column = new MeshLambertMaterial();
    const hex = applyGrowthColor([floor, column], -0.15, 'dark');
    expect(hex).toBe(growthColor(-0.15, 'dark'));
    expect(floor.color.getHexString()).toBe(column.color.getHexString());
    expect(`#${floor.color.getHexString()}`).toBe(hex);
  });
});

describe('heightFor — linear, floored so the smallest column is still pickable', () => {
  it('maps 0 → MIN, max → MAX, half → the midpoint; degenerate input → MIN', () => {
    expect(heightFor(0, 1000)).toBe(MIN_HEIGHT);
    expect(heightFor(1000, 1000)).toBe(MAX_HEIGHT);
    expect(heightFor(500, 1000)).toBeCloseTo((MIN_HEIGHT + MAX_HEIGHT) / 2, 6);
    expect(heightFor(5000, 1000)).toBe(MAX_HEIGHT);
    expect(heightFor(10, 0)).toBe(MIN_HEIGHT);
  });
});

describe('formatting', () => {
  it('population uses the locale thousands separator; growth is a signed one-decimal percentage', () => {
    expect(formatPopulation(1234567, 'nl')).toBe('1.234.567');
    expect(formatPopulation(1234567, 'en')).toBe('1,234,567');
    expect(formatGrowth(0.1234, 'nl')).toBe('+12,3 %');
    expect(formatGrowth(-0.05, 'en')).toBe('-5.0 %');
    expect(formatGrowth(0, 'nl')).toBe('0,0 %');
  });
});
