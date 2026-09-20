// ADR 043: chart templates v1 — named LOOKS, each a curated bundle of the
// presentation options that already exist (ADR 039's own seam: "named
// Partial<ChartPresentation> objects over the same overrides"). Pure: no
// React, no Recharts. A template never enters a ChartSpec or an audit row;
// applying one is chart.tsx's resetPresentation + setPresentation, and every
// honesty lock re-runs per render exactly as for a hand-picked override.
import type { MessageKey } from './i18n/messages.ts';
import {
  FRAME_GRADIENT_PRESETS,
  RECHARTS_PALETTE,
  STOCK_PRESENTATION,
  type ChartPresentation,
  type PresentationKey,
  type PresentationOverrides,
} from './chart-presentation.ts';

export type ChartTemplateId =
  | 'standard' | 'classic' | 'newsroom' | 'presentation' | 'social' | 'minimal' | 'warm' | 'earth'
  | 'salmon' | 'studio' | 'broadsheet' | 'autumn' | 'brutalist';

export interface ChartTemplate {
  id: ChartTemplateId;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  /** Partial<ChartPresentation>, sanitizeOverrides-safe (pinned); for standard the
   * explicit stock look (see STOCK_LOOK below), never `{}`. */
  overrides: PresentationOverrides;
}

const ocean = FRAME_GRADIENT_PRESETS.find((p) => p.id === 'ocean')!;
const dawn = FRAME_GRADIENT_PRESETS.find((p) => p.id === 'dawn')!;
const sand = FRAME_GRADIENT_PRESETS.find((p) => p.id === 'sand')!;

function template(id: ChartTemplateId, overrides: PresentationOverrides): ChartTemplate {
  return { id, nameKey: `chart.template.${id}` as MessageKey, descriptionKey: `chart.template.${id}Description` as MessageKey, overrides };
}

// ADR 043: Basis applies the designed default EXPLICITLY (not `{}`, which
// would merely reset to the resolver's base — a signed-in user's saved
// account default). Colours/font/language are left to the base.
const { seriesColors: _c, fontFamily: _f, language: _l, ...STOCK_LOOK } = STOCK_PRESENTATION;

export const CHART_TEMPLATES: readonly ChartTemplate[] = [
  // The designed default itself (ADR 043) — the full stock look, explicitly.
  template('standard', STOCK_LOOK),
  // The session-87 "basic Recharts" look, colours included — continuity.
  template('classic', {
    lineWidth: 'normal',
    markers: 'all',
    grid: 'both',
    axisLines: 'shown',
    areaFill: 'flat',
    seriesColors: Object.fromEntries(RECHARTS_PALETTE.map((hex, i) => [i, hex])),
  }),
  // The ICP's publish-ready look: a heavier line, no decoration but the
  // honesty ring, a landscape export.
  template('newsroom', {
    lineWidth: 'thick',
    markers: 'provisionalOnly',
    grid: 'horizontal',
    axisLines: 'hidden',
    valueLabels: 'shown',
    framePadding: 'small',
    frameAspect: '16:9',
  }),
  // A slide: the chart on its card over a dark slate gradient. The inset
  // card keeps the series legible on both themes and in the export (the
  // backdrops are the card colours — the contrast gate holds by construction).
  template('presentation', {
    lineWidth: 'thick',
    frameBackground: { kind: 'gradient', from: '#334155', to: '#0f172a' },
    frameInset: 'small',
    framePadding: 'medium',
    frameCorners: 'rounded',
    frameShadow: 'strong',
    frameAspect: '16:9',
  }),
  // A portrait social card on the ocean preset, same inset-card reasoning.
  template('social', {
    lineWidth: 'thick',
    valueLabels: 'shown',
    frameBackground: { kind: 'gradient', from: ocean.from, to: ocean.to },
    frameInset: 'small',
    framePadding: 'medium',
    frameCorners: 'veryRounded',
    frameShadow: 'soft',
    frameAspect: '4:5',
  }),
  // Nothing but the line, the labels and the honesty ring.
  template('minimal', { grid: 'none', axisLines: 'hidden', markers: 'provisionalOnly', valueLabels: 'shown' }),
  // A warm, editorial gradient card — same inset-card reasoning as
  // presentation/social (the contrast gate holds by construction).
  template('warm', {
    lineWidth: 'normal',
    markers: 'ends',
    grid: 'horizontal',
    axisLines: 'hidden',
    valueLabels: 'shown',
    frameBackground: { kind: 'gradient', from: dawn.from, to: dawn.to },
    frameInset: 'small',
    framePadding: 'medium',
    frameCorners: 'rounded',
    frameShadow: 'soft',
  }),
  // A bold square card on the sand preset — thicker line, end markers only,
  // no grid, for a poster-like single-glance read. (markers: 'ends', not
  // minimal's 'provisionalOnly' — earth's override set must stay distinct
  // from minimal's, not reproduce it value-for-value as a subset; 'ends'
  // fits the poster framing just as well, anchoring the first/last point.)
  template('earth', {
    lineWidth: 'thick',
    markers: 'ends',
    grid: 'none',
    axisLines: 'hidden',
    valueLabels: 'shown',
    frameBackground: { kind: 'gradient', from: sand.from, to: sand.to },
    frameInset: 'small',
    framePadding: 'medium',
    frameCorners: 'veryRounded',
    frameShadow: 'strong',
    frameAspect: '1:1',
  }),
  // Salmon Editorial — a warm peach paper with a rose/ochre/sage palette and a serif headline, session 120 (#275).
  template('salmon', {
    frameBackground: { kind: 'solid', hex: '#f4d6bf' },
    frameCorners: 'rounded',
    frameShadow: 'soft',
    framePadding: 'medium',
    grid: 'horizontal',
    axisLines: 'hidden',
    fontFamily: 'Playfair Display',
    seriesColors: { 0: '#a8455a', 1: '#8a5d1c', 2: '#56704b', 3: '#4d6d7d', 4: '#7a3d5f', 5: '#5a4a1a', 6: '#6b3a52', 7: '#3d5c40' },
  }),
  // Studio Grey — a quiet warm-grey card with one burnt-orange accent, session 120 (#275).
  template('studio', {
    frameBackground: { kind: 'solid', hex: '#eae7e2' },
    frameCorners: 'square',
    frameShadow: 'none',
    framePadding: 'small',
    grid: 'none',
    axisLines: 'hidden',
    lineWidth: 'thin',
    fontFamily: 'Lato',
    seriesColors: { 0: '#726f68', 1: '#d3652c', 2: '#6f6a62', 3: '#7c7871', 4: '#a8642e', 5: '#5f6a63', 6: '#8a6a3f', 7: '#4a4844' },
  }),
  // Broadsheet — near-white paper, ink-black bars, one masthead-red highlight, Georgia headline, session 120 (#275).
  template('broadsheet', {
    frameBackground: { kind: 'solid', hex: '#fafaf8' },
    frameCorners: 'square',
    frameShadow: 'none',
    framePadding: 'small',
    grid: 'horizontal',
    axisLines: 'hidden',
    fontFamily: 'Georgia',
    seriesColors: { 0: '#3a3a38', 1: '#b3211e', 2: '#5a5a56', 3: '#7a7a74', 4: '#8f2a26', 5: '#2a2a28', 6: '#6b1e1b', 7: '#4a4a46' },
  }),
  // Autumn Letter — cream paper in an autumn ramp, softly rounded corners, session 120 (#275).
  template('autumn', {
    frameBackground: { kind: 'solid', hex: '#fbeed9' },
    frameCorners: 'veryRounded',
    frameShadow: 'soft',
    framePadding: 'medium',
    grid: 'horizontal',
    axisLines: 'hidden',
    markers: 'ends',
    fontFamily: 'Open Sans',
    seriesColors: { 0: '#c1502e', 1: '#9a7a1f', 2: '#8a7d3a', 3: '#a8622f', 4: '#96701f', 5: '#6f6a2e', 6: '#9a4a28', 7: '#7a5a1f' },
  }),
  // Brutalist Ink — near-black paper, one acid-green accent, a heavy display headline, session 120 (#275).
  template('brutalist', {
    frameBackground: { kind: 'solid', hex: '#121212' },
    frameCorners: 'square',
    frameShadow: 'none',
    framePadding: 'small',
    grid: 'none',
    axisLines: 'shown',
    lineWidth: 'thick',
    fontFamily: 'Archivo Black',
    seriesColors: { 0: '#d9d9d9', 1: '#c6ff3d', 2: '#8f8f8f', 3: '#f2f2f2', 4: '#9fe23a', 5: '#bdbdbd', 6: '#e0e0e0', 7: '#7ac82e' },
  }),
];

export function templateById(id: ChartTemplateId): ChartTemplate {
  return CHART_TEMPLATES.find((t) => t.id === id)!;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The most specific template whose EVERY (non-form-locked) override equals
 * the effective value — a tweaked chart matches nothing (it is no longer
 * that look). 'standard' is just the template with the most keys (the full
 * stock look), so it wins on its own merits only when the chart wears it.
 *
 * `locks` (resolvePresentation's own return value) excludes a key from the
 * comparison when the chart's FORM forces it regardless of any template or
 * user choice — e.g. `zeroBaseline` is pinned to `'zero'` on bar/hbar/area
 * (a real R6-adjacent honesty rule, not a "look"). Without this, 'standard'
 * (whose overrides carry the STOCK default `zeroBaseline: 'auto'`) could
 * never match on those forms even immediately after being applied, since
 * the resolved value is always `'zero'` there. */
export function matchTemplate(
  values: ChartPresentation,
  locks: Partial<Record<PresentationKey, string>> = {},
): ChartTemplateId | null {
  let best: ChartTemplate | null = null;
  let bestCheckedKeys = 0;
  for (const t of CHART_TEMPLATES) {
    const keys = (Object.keys(t.overrides) as PresentationKey[]).filter((key) => !(key in locks));
    const wears = keys.every((key) => sameValue(values[key], t.overrides[key]));
    if (wears && (best === null || keys.length > bestCheckedKeys)) {
      best = t;
      bestCheckedKeys = keys.length;
    }
  }
  return best?.id ?? null;
}
