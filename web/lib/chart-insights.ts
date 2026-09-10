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
  point: { seriesKey: string; periodCode: string };
}

const TITLE_KEY: Record<FindingKind, 'chart.insights.recordHighTitle' | 'chart.insights.recordLowTitle' | 'chart.insights.jumpUpTitle' | 'chart.insights.jumpDownTitle'> = {
  recordHigh: 'chart.insights.recordHighTitle',
  recordLow: 'chart.insights.recordLowTitle',
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
    point: { seriesKey: finding.seriesKey, periodCode: finding.periodCode },
  }));
}
