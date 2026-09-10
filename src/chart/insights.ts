// Insights (session 94 owner ask, replacing the old Story mode selection):
// the deterministic top-3-to-5 "most interesting findings" a journalist
// could report on — real statistical outliers (level + period-over-period
// jumps), never just chronological start/high/low/latest. Pure, sync, no
// LLM, no i18n: this module ONLY selects among the spec's own already-
// formatted values (principle a — the LLM never computes or picks what's
// interesting; R1/R6 — every finding is a verbatim projection of one or two
// spec cells). Lives in the BACKEND (unlike chart-story.ts, its web/lib
// precedent) because it has two independent callers that must never
// disagree on which points are interesting: web/lib/chart-insights.ts (the
// client's instant synchronous render) and insights-phrase.ts (the server
// action's LLM payload, which re-derives from the SAME spec rather than
// trusting client-sent finding data in a prompt — prompt.ts's own R2
// discipline, "keep user-typed text out of the phrasing prompt").
import type { ChartPoint, ChartSpec } from './types.ts';

export type FindingKind = 'recordHigh' | 'recordLow' | 'jumpUp' | 'jumpDown';

export interface ScoredFinding {
  /** Stable per chart: `${kind}-${seriesKey}-${periodCode}`. */
  id: string;
  kind: FindingKind;
  /** R1 traceability — the primary point's source cell. */
  resultId: string;
  seriesKey: string;
  seriesLabel: string;
  periodCode: string;
  periodLabel: string;
  formattedValue: string;
  unit: string;
  provisional: boolean;
  /** Set only for jumpUp/jumpDown — the period the move started from. */
  fromPeriodLabel?: string;
  fromFormattedValue?: string;
  /** True on a genuinely multi-series chart — the only case a caption or
   * prompt needs to name WHICH series a finding is about (a single-series
   * chart's own measure name would just be redundant noise). */
  multiSeries: boolean;
}

export const INSIGHTS_MAX_FINDINGS = 5;

type Plotted = ChartPoint & { value: number; formattedValue: string };
type Scored = ScoredFinding & { score: number };

function plotted(points: ChartPoint[]): Plotted[] {
  return points.filter((p): p is Plotted => p.value !== null && p.formattedValue !== null);
}

function seriesKeyOf(index: number): string {
  return `s${index}`;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdev(values: number[], mean: number): number {
  return Math.sqrt(average(values.map((v) => (v - mean) ** 2)));
}

/** Score + build every candidate finding for one plotted series: a level
 * z-score per point (how far from the series' own mean) and a jump z-score
 * per period-over-period step (how big a single move is relative to the
 * series' own spread) — both normalized by the SAME stdev so they rank on
 * one scale. A degenerate (zero-variance) series still surfaces a genuine
 * non-zero jump (scored 1) rather than silently finding nothing. No score
 * floor here: rankAndCap below decides how many are worth telling — mirrors
 * the old buildStorySteps' time-series branch, which always told SOMETHING
 * for any 2+-point series regardless of how flat it was. */
function candidatesForSeries(seriesLabel: string, index: number, points: Plotted[], unit: string, multiSeries: boolean): Scored[] {
  if (points.length < 2) return [];
  const key = seriesKeyOf(index);
  const values = points.map((p) => p.value);
  const mean = average(values);
  const sd = stdev(values, mean);
  const high = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]!);
  const low = points.reduce((best, p) => (p.value < best.value ? p : best), points[0]!);

  const out: Scored[] = [];
  for (const p of points) {
    const z = sd > 0 ? Math.abs(p.value - mean) / sd : 0;
    // A genuine record always ranks at least on par with a real jump, even
    // in a low-variance series where its raw z-score would stay tiny.
    const isRecord = p === high || p === low;
    const score = isRecord ? Math.max(z, 1) : z;
    // Above/below the series' OWN mean, not "is this literally the record"
    // — a non-extreme point that still ranks (a real but non-record
    // z-score) needs a kind too, and "high"/"low" framing is honest for
    // either: it reads as "the record" only when it IS one (isRecord/score
    // already guarantee a record always outranks a merely-elevated point).
    const kind: FindingKind = p.value >= mean ? 'recordHigh' : 'recordLow';
    out.push({
      id: `${kind}-${key}-${p.periodCode}`,
      kind,
      resultId: p.resultId,
      seriesKey: key,
      seriesLabel,
      periodCode: p.periodCode,
      periodLabel: p.periodLabel,
      formattedValue: p.formattedValue,
      unit,
      provisional: p.provisional,
      multiSeries,
      score,
    });
  }
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const delta = to.value - from.value;
    if (delta === 0) continue;
    const jumpScore = sd > 0 ? Math.abs(delta) / sd : 1;
    const kind: FindingKind = delta > 0 ? 'jumpUp' : 'jumpDown';
    out.push({
      id: `${kind}-${key}-${to.periodCode}`,
      kind,
      resultId: to.resultId,
      seriesKey: key,
      seriesLabel,
      periodCode: to.periodCode,
      periodLabel: to.periodLabel,
      formattedValue: to.formattedValue,
      unit,
      provisional: to.provisional,
      fromPeriodLabel: from.periodLabel,
      fromFormattedValue: from.formattedValue,
      multiSeries,
      score: jumpScore,
    });
  }
  return out;
}

/** One finding per POINT at most (a record-high point that's also the
 * biggest jump keeps only its higher-scoring finding) — never tells the same
 * point's story twice. */
function dedupeByPoint(candidates: Scored[]): Scored[] {
  const bestByPoint = new Map<string, Scored>();
  for (const c of candidates) {
    const pointId = `${c.seriesKey}-${c.periodCode}`;
    const existing = bestByPoint.get(pointId);
    if (!existing || c.score > existing.score) bestByPoint.set(pointId, c);
  }
  return [...bestByPoint.values()];
}

function rankAndCap(candidates: Scored[]): ScoredFinding[] {
  const ranked = dedupeByPoint(candidates).sort((a, b) => b.score - a.score);
  const capped = ranked.slice(0, INSIGHTS_MAX_FINDINGS);
  // Chronological order reads more naturally than score order once selected
  // (the score only decided WHICH points made the cut, not the telling
  // order) — mirrors the spec's own period-ascending order (R6).
  return capped
    .sort((a, b) => (a.periodCode < b.periodCode ? -1 : a.periodCode > b.periodCode ? 1 : 0))
    .map(({ score: _score, ...finding }) => finding);
}

function timeSeriesFindings(spec: ChartSpec): ScoredFinding[] {
  const points = plotted(spec.series[0]!.points);
  return rankAndCap(candidatesForSeries(spec.series[0]!.label, 0, points, spec.unit, false));
}

/** Multi-series: each series scored independently against its OWN mean/
 * spread (a flat series and a volatile one are not compared on one scale —
 * each tells whether ITS OWN movement is unusual), capped per series first
 * so one wild series cannot crowd out every other series, then re-ranked
 * together for the global cap. */
function multiSeriesFindings(spec: ChartSpec): ScoredFinding[] {
  const PER_SERIES_CAP = 2;
  const all: Scored[] = [];
  spec.series.forEach((series, index) => {
    const points = plotted(series.points);
    const seriesCandidates = dedupeByPoint(candidatesForSeries(series.label, index, points, spec.unit, true))
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_SERIES_CAP);
    all.push(...seriesCandidates);
  });
  return rankAndCap(all);
}

/** Comparison (bar): one point per series — ranked by deviation from the
 * cross-series mean, the direct bar-chart analog of the level z-score above.
 * `multiSeries` here means "name the region" (barCaption always does, via
 * its own {label}), which is every bar chart with >1 bar by construction. */
function comparisonFindings(spec: ChartSpec): ScoredFinding[] {
  const bars = spec.series
    .map((series, index) => ({ series, index, point: plotted(series.points)[0] }))
    .filter((entry): entry is { series: ChartSpec['series'][number]; index: number; point: Plotted } => entry.point !== undefined);
  if (bars.length < 2) return [];
  const values = bars.map((b) => b.point.value);
  const mean = average(values);
  const sd = stdev(values, mean);
  const high = bars.reduce((best, b) => (b.point.value > best.point.value ? b : best), bars[0]!);
  const low = bars.reduce((best, b) => (b.point.value < best.point.value ? b : best), bars[0]!);
  // Every bar equal: nothing stands out (mirrors the old comparisonSteps —
  // no story rather than the same bar told twice).
  if (high === low) return [];

  const candidates: Scored[] = bars.map((bar) => {
    const key = seriesKeyOf(bar.index);
    const z = sd > 0 ? Math.abs(bar.point.value - mean) / sd : 0;
    const isRecord = bar === high || bar === low;
    const score = isRecord ? Math.max(z, 1) : z;
    // Above/below the cross-series mean — see the identical reasoning above.
    const kind: FindingKind = bar.point.value >= mean ? 'recordHigh' : 'recordLow';
    return {
      id: `${kind}-${key}`,
      kind,
      resultId: bar.point.resultId,
      seriesKey: key,
      seriesLabel: bar.series.label,
      periodCode: bar.point.periodCode,
      periodLabel: bar.point.periodLabel,
      formattedValue: bar.point.formattedValue,
      unit: spec.unit,
      provisional: bar.point.provisional,
      multiSeries: true,
      score,
    };
  });
  return rankAndCap(candidates);
}

/** The top 3-5 findings for a chart, or `[]` when there is nothing to tell
 * (the trigger is then not offered). Pure and deterministic: every number/
 * period here is a verbatim projection of the spec's own values (R1/R6),
 * never computed or estimated by an LLM. */
export function scoreFindings(spec: ChartSpec): ScoredFinding[] {
  if (spec.series.length === 0) return [];
  if (spec.kind === 'bar') return comparisonFindings(spec);
  return spec.series.length === 1 ? timeSeriesFindings(spec) : multiSeriesFindings(spec);
}
