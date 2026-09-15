// Story mode (session 92 design, docs/superpowers/specs/
// 2026-09-09-story-mode-and-embed-design.md Part A): the shared step shape.
//
// Superseded 2026-09-10 (session 94, owner ask): chart.tsx no longer calls
// this file's own step builder — the panel's SELECTION now comes from
// chart-insights.ts's buildFindings (real outlier findings, optionally
// AI-phrased) instead of the chronological Start/High/Low/Latest this file
// used to compute. StoryStepKind/StoryStep stay here because
// ChartStoryPanel/chart.tsx and chart-insights.ts both still build against
// them (widened below to also accept FindingKind); the step-BUILDING
// functions themselves were removed (open-questions.md #230, session 102) —
// see git history for `buildStorySteps`/`timeSeriesSteps`/`multiSeriesSteps`/
// `comparisonSteps`/`exploreStep`/`STORY_MAX_SERIES_STEPS` if ever needed.
import type { FindingKind } from './chart-insights.ts';

export type StoryStepKind = 'overview' | 'start' | 'high' | 'low' | 'latest' | 'series' | 'explore' | FindingKind;

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
