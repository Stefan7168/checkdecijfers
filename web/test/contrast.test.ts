// Session 110 a11y audit, row 1 (#Fix-now 1): pins the light-theme
// `--muted-foreground` / `--muted` and `--muted-foreground` / `--background`
// (and `--card`, same value) pairs at >= 4.5:1 — the WCAG AA threshold for
// normal text — by reading the REAL tokens out of app/globals.css rather
// than duplicating literals here, so an edit that reintroduces the old
// oklch(0.556 0 0) (measured 4.34:1 by the session-110 axe-core audit) fails
// this test instead of shipping.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatioOfOklchGrays, parseOklchGray, relativeLuminanceOfOklchGray } from './contrast.ts';

const css = readFileSync(path.join(import.meta.dirname, '../app/globals.css'), 'utf8');

/** Extracts `--name: oklch(...)` from a specific selector BLOCK (`:root` or
 * `.dark`) — a light regex scan, not a CSS parser, but globals.css's own
 * token layer is exactly this shape (see the file's header comment). */
function tokenFromBlock(blockSelectorRegex: RegExp, name: string): string {
  const blockMatch = blockSelectorRegex.exec(css);
  if (!blockMatch) throw new Error(`tokenFromBlock: selector not found in globals.css`);
  const blockStart = blockMatch.index + blockMatch[0].length;
  const blockEnd = css.indexOf('\n}', blockStart);
  const block = css.slice(blockStart, blockEnd);
  const tokenMatch = new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`).exec(block);
  if (!tokenMatch) throw new Error(`tokenFromBlock: --${name} not found in this block`);
  return tokenMatch[1];
}

const ROOT_BLOCK = /:root\s*\{/;
const DARK_BLOCK = /\n\.dark\s*\{/;

describe('contrast.ts converter (sanity)', () => {
  it('reproduces the session-110 audit\'s measured 4.34:1 for the OLD light-theme pair', () => {
    // Not a token read — this pins the converter itself against the
    // audit's own measured number for the value being replaced.
    expect(contrastRatioOfOklchGrays('oklch(0.556 0 0)', 'oklch(0.97 0 0)')).toBeCloseTo(4.34, 2);
  });

  it('white on white is 1:1 and white on black is 21:1', () => {
    expect(contrastRatioOfOklchGrays('oklch(1 0 0)', 'oklch(1 0 0)')).toBeCloseTo(1, 6);
    expect(contrastRatioOfOklchGrays('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 6);
  });
});

describe('light-theme --muted-foreground contrast (WCAG AA >= 4.5:1)', () => {
  const mutedForeground = tokenFromBlock(ROOT_BLOCK, 'muted-foreground');
  const muted = tokenFromBlock(ROOT_BLOCK, 'muted');
  const background = tokenFromBlock(ROOT_BLOCK, 'background');
  const card = tokenFromBlock(ROOT_BLOCK, 'card');

  it('is no longer the old, failing oklch(0.556 0 0)', () => {
    expect(parseOklchGray(mutedForeground)).toBeLessThan(0.556);
  });

  it('reaches >= 4.5:1 against --muted', () => {
    expect(contrastRatioOfOklchGrays(mutedForeground, muted)).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches >= 4.5:1 against --background', () => {
    expect(contrastRatioOfOklchGrays(mutedForeground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches >= 4.5:1 against --card', () => {
    expect(contrastRatioOfOklchGrays(mutedForeground, card)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('dark-theme --muted-foreground is untouched (ADR 042 colour tokens are deliberate)', () => {
  it('stays oklch(0.708 0 0) on oklch(0.269 0 0), already >= 4.5:1', () => {
    const mutedForeground = tokenFromBlock(DARK_BLOCK, 'muted-foreground');
    const muted = tokenFromBlock(DARK_BLOCK, 'muted');
    expect(parseOklchGray(mutedForeground)).toBeCloseTo(0.708, 6);
    expect(parseOklchGray(muted)).toBeCloseTo(0.269, 6);
    expect(contrastRatioOfOklchGrays(mutedForeground, muted)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('relativeLuminanceOfOklchGray', () => {
  it('is L^3 (grayscale OKLab -> linear-sRGB matrix rows sum to 1)', () => {
    expect(relativeLuminanceOfOklchGray(0.5)).toBeCloseTo(0.125, 6);
    expect(relativeLuminanceOfOklchGray(1)).toBeCloseTo(1, 6);
    expect(relativeLuminanceOfOklchGray(0)).toBeCloseTo(0, 6);
  });
});
