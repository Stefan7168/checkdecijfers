// Insights (session 94 owner ask, replacing the old Story mode selection):
// the thin, i18n-aware DISPLAY layer over backend/chart/insights.ts's pure
// scoreFindings — attaches a translated title + the deterministic template
// caption (the R3 FLOOR, mirroring answer/compose/compose.ts's
// renderTemplateBody role) to each finding. chart-insights-actions.ts (the
// server action) re-derives scoreFindings independently server-side for the
// AI-phrasing payload — never from this module's output — so the two can
// never disagree about which points are interesting; only the CAPTION TEXT
// for a finding id is ever replaced, in place, once phrasing resolves (see
// chart.tsx). No React, no Recharts, no network — mirrors chart-story.ts.
import type { ChartSpec } from '../backend/chart/types.ts';
import { scoreFindings, type FindingKind, type ScoredFinding } from '../backend/chart/insights.ts';
import { t, type Lang } from './i18n/messages.ts';

export type { FindingKind };
export { INSIGHTS_MAX_FINDINGS } from '../backend/chart/insights.ts';

export interface Finding extends ScoredFinding {
  title: string;
  /** The deterministic template caption — see module doc's "R3 FLOOR". */
  caption: string;
  // `periodLabel` added here (audit pass 2, row 14, 2026-09-17) and
  // `seriesLabel` (audit pass 3, row 8, same day) alongside the pre-existing
  // seriesKey/periodCode — see `stepAccessibleName` below for why and how
  // the consuming components read them.
  point: { seriesKey: string; periodCode: string; periodLabel: string; seriesLabel: string };
}

const TITLE_KEY: Record<
  FindingKind,
  | 'chart.insights.recordHighTitle'
  | 'chart.insights.recordLowTitle'
  | 'chart.insights.aboveAverageTitle'
  | 'chart.insights.belowAverageTitle'
  | 'chart.insights.jumpUpTitle'
  | 'chart.insights.jumpDownTitle'
> = {
  recordHigh: 'chart.insights.recordHighTitle',
  recordLow: 'chart.insights.recordLowTitle',
  // Session 110 addendum (ADR 041): a non-extreme above/below-mean point —
  // never labelled as a record/outlier, see insights.ts's kind assignment.
  aboveAverage: 'chart.insights.aboveAverageTitle',
  belowAverage: 'chart.insights.belowAverageTitle',
  jumpUp: 'chart.insights.jumpUpTitle',
  jumpDown: 'chart.insights.jumpDownTitle',
};

function provisionalSuffix(finding: ScoredFinding, lang: Lang): string {
  return finding.provisional ? t(lang, 'chart.story.provisional') : '';
}

function seriesPrefix(finding: ScoredFinding, lang: Lang): string {
  return finding.multiSeries ? t(lang, 'chart.insights.seriesLabelPrefix', { series: finding.seriesLabel }) : '';
}

/** A bar chart has no period to state (one snapshot per region — the whole
 * chart's period is already shown elsewhere in the UI); a multi-series LINE
 * chart's record finding still needs one (WHEN the record happened is the
 * point), so it gets the series name prefixed onto the normal period
 * caption instead of the bar template. */
function buildCaption(finding: ScoredFinding, lang: Lang, specKind: ChartSpec['kind']): string {
  if (finding.kind === 'jumpUp' || finding.kind === 'jumpDown') {
    return (
      seriesPrefix(finding, lang) +
      t(lang, 'chart.story.seriesCaption', {
        fromPeriod: finding.fromPeriodLabel ?? '',
        fromValue: finding.fromFormattedValue ?? '',
        toPeriod: finding.periodLabel,
        toValue: finding.formattedValue,
        unit: finding.unit,
      }) +
      provisionalSuffix(finding, lang)
    );
  }
  if (specKind === 'bar') {
    return (
      t(lang, 'chart.story.barCaption', { label: finding.seriesLabel, value: finding.formattedValue, unit: finding.unit }) +
      provisionalSuffix(finding, lang)
    );
  }
  return (
    seriesPrefix(finding, lang) +
    t(lang, 'chart.story.pointCaption', { period: finding.periodLabel, value: finding.formattedValue, unit: finding.unit }) +
    provisionalSuffix(finding, lang)
  );
}

/** The top 3-5 findings for a chart, ready to display, or `[]` when there is
 * nothing to tell (the trigger is then not offered). The SELECTION is
 * scoreFindings' alone (R1/R6: every number here is a verbatim spec
 * projection); this function only translates it into title/caption text. */
export function buildFindings(spec: ChartSpec, lang: Lang): Finding[] {
  return scoreFindings(spec).map((finding) => ({
    ...finding,
    title: t(lang, TITLE_KEY[finding.kind], finding.multiSeries ? { series: finding.seriesLabel } : {}),
    caption: buildCaption(finding, lang, spec.kind),
    point: {
      seriesKey: finding.seriesKey,
      periodCode: finding.periodCode,
      periodLabel: finding.periodLabel,
      seriesLabel: finding.seriesLabel,
    },
  }));
}

/** The accessible name for one "position" dot in the Insights carousel and
 * the Story stage. The VISIBLE label stays kind-only (the finding's title,
 * unchanged, still what a sighted reader sees under the caption); this
 * appends a disambiguator to the ACCESSIBLE name so two same-kind findings
 * on one chart are not two identical buttons to a screen-reader user.
 *
 * Audit pass 2, row 14 (2026-09-17) appended the finding's own PERIOD. Audit
 * pass 3, row 8 (same day) found that collapses again on a region
 * comparison, where every finding shares the chart's single period: the
 * stage read "Onder het gemiddelde — 2024" twice. So the disambiguator is
 * now whichever field actually VARIES across the steps of THIS chart:
 *
 *   • periods vary, one series (a trend line)      → "Onder het gemiddelde — 2021"
 *   • one period, series vary (a region set)       → "Onder het gemiddelde — Nieuwegein"
 *   • both vary (a multi-series line chart)        → "Hoogste punt — 2021 · Zeeland"
 *   • neither varies (nothing to tell apart)       → the period, as before
 *
 * `steps` is the full sibling list the caller is rendering; omitting it
 * names the step against itself, which is the "neither varies" case.
 *
 * `StoryStep.point` is declared in web/lib/chart-story.ts (out of this
 * fix's file scope) as `{ seriesKey, periodCode }` — no `periodLabel`, no
 * `seriesLabel`. `Finding.point` above attaches both on that same shape, and
 * chart.tsx's `storySteps` mapping (also out of scope, unedited) forwards
 * `point: f.point` BY REFERENCE, so the extra fields survive into every
 * `StoryStep` at runtime even though the shared type never declares them.
 * The parameter types here are deliberately their own minimal shapes (not an
 * import of `StoryStep`, which would need a type-only import back from
 * chart-story.ts) — any object with a `title` and an optional
 * `point.periodLabel`/`point.seriesLabel` satisfies them, `StoryStep`
 * included. A step whose point is missing a label simply never contributes
 * to that field's variation, and falls back to the other one.
 *
 * A step with no point at all (`overview`/`explore` — never duplicated by
 * kind) gets the title alone; nothing to disambiguate.
 *
 * The point type deliberately includes `periodCode` (not just the two
 * optional labels this function actually reads): a type with ONLY optional
 * properties is a TS "weak type", and `StoryStep`'s own point would then be
 * rejected outright for sharing no REQUIRED property with it, even though it
 * is otherwise perfectly compatible. `periodCode` is real on every point and
 * gives the two types a property in common, sidestepping that check without
 * importing `StoryStep` itself. */
interface NameablePoint {
  periodCode: string;
  periodLabel?: string;
  seriesLabel?: string;
}
interface NameableStep {
  title: string;
  point: NameablePoint | null;
}

export function stepAccessibleName(step: NameableStep, steps?: readonly NameableStep[]): string {
  const point = step.point;
  if (!point) return step.title;
  const points = (steps ?? [step]).map((s) => s.point).filter((p): p is NameablePoint => p !== null);
  const varies = (read: (p: NameablePoint) => string | undefined): boolean => new Set(points.map(read)).size > 1;
  const periodVaries = varies((p) => p.periodLabel);
  const seriesVaries = varies((p) => p.seriesLabel);
  const parts: string[] = [];
  // The period unless the series is the only thing that tells these steps
  // apart (`!seriesVaries` keeps the "neither varies" fallback on the period).
  if ((periodVaries || !seriesVaries) && point.periodLabel) parts.push(point.periodLabel);
  if (seriesVaries && point.seriesLabel) parts.push(point.seriesLabel);
  return parts.length > 0 ? `${step.title} — ${parts.join(' · ')}` : step.title;
}
