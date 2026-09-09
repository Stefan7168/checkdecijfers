// Story mode (session 92 design, docs/superpowers/specs/
// 2026-09-09-story-mode-and-embed-design.md Part A): the pure step builder.
//
// Honesty contract (docs/05 R1/R3/R6/R10/R11): a step's caption is a message
// TEMPLATE with spec strings filled in — `periodLabel`, `formattedValue`,
// `unit`, a series `label`, or `attribution.trendHeadline` — and nothing
// else. "Highest"/"lowest" are SELECTIONS over the values the spec already
// carries (like highlighting a series), never a computed number: the caption
// repeats the selected point's own `formattedValue`. Null points are skipped
// (they are drawn as honest gaps by the chart itself); a provisional point
// says so in words. Ties break towards the earliest period (spec order).
//
// No React, no Recharts: chart.tsx feeds this the DISPLAYED spec (already
// translated by translateSpecForDisplay for the chart language), so period
// labels and units arrive in the right language while periodCodes — the
// keys the chart marks points by — are untouched.
import type { ChartPoint, ChartSpec } from '../backend/chart/types.ts';
import { t, type Lang } from './i18n/messages.ts';

export type StoryStepKind = 'overview' | 'start' | 'high' | 'low' | 'latest' | 'series' | 'explore';

export interface StoryStep {
  /** Stable per chart: `${kind}-${seriesKey}-${periodCode}` or the kind alone. */
  id: string;
  kind: StoryStepKind;
  title: string;
  caption: string;
  /** The series key (`s<index>`, buildRows' positional key) to highlight
   * through the reducer's `setHighlight`, or null for "nothing highlighted". */
  highlight: string | null;
  /** The point to ring on the chart, or null. */
  point: { seriesKey: string; periodCode: string } | null;
}

/** Owner-facing cap: more series than this get no step of their own (the
 * overview says so, in words). */
export const STORY_MAX_SERIES_STEPS = 5;

type Plotted = ChartPoint & { value: number; formattedValue: string };

function plotted(points: ChartPoint[]): Plotted[] {
  return points.filter((p): p is Plotted => p.value !== null && p.formattedValue !== null);
}

function seriesKey(index: number): string {
  return `s${index}`;
}

function provisionalSuffix(point: ChartPoint, lang: Lang): string {
  return point.provisional ? t(lang, 'chart.story.provisional') : '';
}

function pointCaption(point: Plotted, unit: string, lang: Lang): string {
  return t(lang, 'chart.story.pointCaption', { period: point.periodLabel, value: point.formattedValue, unit }) + provisionalSuffix(point, lang);
}

/** The first plotted point with the maximum (or minimum) value — strict
 * comparison, so an equal later value never displaces an earlier one. */
function extreme(points: Plotted[], pick: 'max' | 'min'): Plotted {
  let best = points[0]!;
  for (const p of points) {
    if (pick === 'max' ? p.value > best.value : p.value < best.value) best = p;
  }
  return best;
}

function exploreStep(lang: Lang): StoryStep {
  return {
    id: 'explore',
    kind: 'explore',
    title: t(lang, 'chart.story.exploreTitle'),
    caption: t(lang, 'chart.story.exploreCaption'),
    highlight: null,
    point: null,
  };
}

function timeSeriesSteps(spec: ChartSpec, lang: Lang): StoryStep[] {
  const key = seriesKey(0);
  const points = plotted(spec.series[0]!.points);
  if (points.length < 2) return [];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const high = extreme(points, 'max');
  const low = extreme(points, 'min');
  const overviewCaption =
    spec.attribution.trendHeadline ?? t(lang, 'chart.story.overviewCaption', { from: first.periodLabel, to: last.periodLabel });
  const pointStep = (kind: StoryStepKind, titleKey: 'chart.story.startTitle' | 'chart.story.highTitle' | 'chart.story.lowTitle' | 'chart.story.latestTitle', p: Plotted): StoryStep => ({
    id: `${kind}-${key}-${p.periodCode}`,
    kind,
    title: t(lang, titleKey),
    caption: pointCaption(p, spec.unit, lang),
    highlight: null,
    point: { seriesKey: key, periodCode: p.periodCode },
  });
  const steps: StoryStep[] = [
    { id: 'overview', kind: 'overview', title: t(lang, 'chart.story.overviewTitle'), caption: overviewCaption, highlight: null, point: null },
    pointStep('start', 'chart.story.startTitle', first),
  ];
  // A highest/lowest that IS the start or the latest point would repeat a
  // step the story already tells — dropped, never told twice.
  if (high !== first && high !== last) steps.push(pointStep('high', 'chart.story.highTitle', high));
  if (low !== first && low !== last && low !== high) steps.push(pointStep('low', 'chart.story.lowTitle', low));
  steps.push(pointStep('latest', 'chart.story.latestTitle', last));
  steps.push(exploreStep(lang));
  return steps;
}

function multiSeriesSteps(spec: ChartSpec, lang: Lang): StoryStep[] {
  const narrated = spec.series
    .map((series, index) => ({ series, index, points: plotted(series.points) }))
    .filter((entry) => entry.points.length >= 1);
  if (narrated.length < 2) return [];
  const capped = narrated.slice(0, STORY_MAX_SERIES_STEPS);
  const overviewCaption =
    t(lang, 'chart.story.overviewSeriesCaption') + (narrated.length > capped.length ? ` ${t(lang, 'chart.story.moreSeries')}` : '');
  const steps: StoryStep[] = [
    { id: 'overview', kind: 'overview', title: t(lang, 'chart.story.overviewTitle'), caption: overviewCaption, highlight: null, point: null },
  ];
  for (const { series, index, points } of capped) {
    const key = seriesKey(index);
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const caption =
      points.length === 1
        ? pointCaption(first, spec.unit, lang)
        : t(lang, 'chart.story.seriesCaption', {
            fromPeriod: first.periodLabel,
            fromValue: first.formattedValue,
            toPeriod: last.periodLabel,
            toValue: last.formattedValue,
            unit: spec.unit,
          }) + provisionalSuffix(last, lang);
    steps.push({
      id: `series-${key}`,
      kind: 'series',
      title: series.label,
      caption,
      highlight: key,
      point: { seriesKey: key, periodCode: last.periodCode },
    });
  }
  steps.push(exploreStep(lang));
  return steps;
}

function comparisonSteps(spec: ChartSpec, lang: Lang): StoryStep[] {
  const bars = spec.series
    .map((series, index) => ({ series, index, point: plotted(series.points)[0] }))
    .filter((entry): entry is { series: ChartSpec['series'][number]; index: number; point: Plotted } => entry.point !== undefined);
  if (bars.length < 2) return [];
  let high = bars[0]!;
  let low = bars[0]!;
  for (const bar of bars) {
    if (bar.point.value > high.point.value) high = bar;
    if (bar.point.value < low.point.value) low = bar;
  }
  const barStep = (kind: 'high' | 'low', titleKey: 'chart.story.highTitle' | 'chart.story.lowTitle', bar: typeof high): StoryStep => ({
    id: `${kind}-${seriesKey(bar.index)}`,
    kind,
    title: t(lang, titleKey),
    caption:
      t(lang, 'chart.story.barCaption', { label: bar.series.label, value: bar.point.formattedValue, unit: spec.unit }) +
      provisionalSuffix(bar.point, lang),
    highlight: seriesKey(bar.index),
    point: null,
  });
  return [
    { id: 'overview', kind: 'overview', title: t(lang, 'chart.story.overviewTitle'), caption: t(lang, 'chart.story.compareCaption'), highlight: null, point: null },
    barStep('high', 'chart.story.highTitle', high),
    barStep('low', 'chart.story.lowTitle', low),
    exploreStep(lang),
  ];
}

/** The story for a chart, or `[]` when there is nothing to tell (the
 * trigger is then not offered). Pure and deterministic. */
export function buildStorySteps(spec: ChartSpec, lang: Lang): StoryStep[] {
  if (spec.series.length === 0) return [];
  if (spec.kind === 'bar') return comparisonSteps(spec, lang);
  if (spec.series.length === 1) return timeSeriesSteps(spec, lang);
  return multiSeriesSteps(spec, lang);
}
