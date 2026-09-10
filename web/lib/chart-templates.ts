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
  type ChartPresentation,
  type PresentationKey,
  type PresentationOverrides,
} from './chart-presentation.ts';

export type ChartTemplateId = 'standard' | 'classic' | 'newsroom' | 'presentation' | 'social' | 'minimal';

export interface ChartTemplate {
  id: ChartTemplateId;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  /** Partial<ChartPresentation>, sanitizeOverrides-safe (pinned); `{}` for standard. */
  overrides: PresentationOverrides;
}

const ocean = FRAME_GRADIENT_PRESETS.find((p) => p.id === 'ocean')!;

function template(id: ChartTemplateId, overrides: PresentationOverrides): ChartTemplate {
  return { id, nameKey: `chart.template.${id}` as MessageKey, descriptionKey: `chart.template.${id}Description` as MessageKey, overrides };
}

export const CHART_TEMPLATES: readonly ChartTemplate[] = [
  // The designed default itself (ADR 042).
  template('standard', {}),
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
];

export function templateById(id: ChartTemplateId): ChartTemplate {
  return CHART_TEMPLATES.find((t) => t.id === id)!;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The most specific template whose EVERY override equals the effective
 * value — a tweaked chart matches nothing (it is no longer that look);
 * 'standard' only when the chart is pristine and nothing else matches. */
export function matchTemplate(values: ChartPresentation, pristine: boolean): ChartTemplateId | null {
  let best: ChartTemplate | null = null;
  for (const t of CHART_TEMPLATES) {
    if (t.id === 'standard') continue;
    const keys = Object.keys(t.overrides) as PresentationKey[];
    const wears = keys.every((key) => sameValue(values[key], t.overrides[key]));
    if (wears && (best === null || keys.length > Object.keys(best.overrides).length)) best = t;
  }
  if (best !== null) return best.id;
  return pristine ? 'standard' : null;
}
