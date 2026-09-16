// ADR 049: the demo's colour/height scales. The growth scale runs between the
// first two DEFAULT_PALETTE colours (blue = growing, vermillion = shrinking)
// through a neutral midpoint — the house palette, not a new one. The two
// literal greys per theme exist because a WebGL canvas cannot read the CSS
// oklch tokens: they are the demo's sanctioned literal spot (docs/12-huisstijl.md rule 1).
import { DEFAULT_PALETTE } from '../../lib/chart-presentation.ts';
import type { Lang } from '../../lib/i18n/messages.ts';

export type Theme = 'light' | 'dark';

export const GROWTH_DOMAIN = 0.4;
export const GROWTH_LOW_HEX = DEFAULT_PALETTE[1]!;
export const GROWTH_HIGH_HEX = DEFAULT_PALETTE[0]!;
export const GROWTH_MID_HEX: Record<Theme, string> = { light: '#bfbfbf', dark: '#525252' };

export const MIN_HEIGHT = 0.4;
export const MAX_HEIGHT = 40;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mixHex(a: string, b: string, t: number): string {
  const k = clamp01(t);
  const ca = channels(a);
  const cb = channels(b);
  const out = ca.map((c, i) => Math.round(c + (cb[i]! - c) * k));
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function growthColor(growth: number, theme: Theme): string {
  const g = Number.isFinite(growth) ? Math.max(-GROWTH_DOMAIN, Math.min(GROWTH_DOMAIN, growth)) : 0;
  const mid = GROWTH_MID_HEX[theme];
  return g < 0 ? mixHex(mid, GROWTH_LOW_HEX, -g / GROWTH_DOMAIN) : mixHex(mid, GROWTH_HIGH_HEX, g / GROWTH_DOMAIN);
}

// v2 (D1′, session 104): the floor tile and the population column for the
// SAME municipality/year must never be able to visually disagree — the
// mechanism is structural, not a convention: growthColor() is computed
// exactly ONCE here and the identical hex is applied to every material
// passed in. columns.test.ts pins this against real MeshLambertMaterial
// instances (both meshes' rendered colour equal, and equal to a direct
// growthColor() call).
export interface Colorable { color: { set(value: string): unknown } }
export function applyGrowthColor(materials: readonly Colorable[], growth: number, theme: Theme): string {
  const hex = growthColor(growth, theme);
  for (const m of materials) m.color.set(hex);
  return hex;
}

export function heightFor(population: number, maxPopulation: number): number {
  if (!(maxPopulation > 0) || !(population > 0)) return MIN_HEIGHT;
  return MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * Math.min(1, population / maxPopulation);
}

const locale = (lang: Lang): string => (lang === 'nl' ? 'nl-NL' : 'en-GB');
export function formatPopulation(n: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(Math.round(n));
}
export function formatGrowth(g: number, lang: Lang): string {
  const pct = new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(g * 100);
  return `${pct} %`;
}
