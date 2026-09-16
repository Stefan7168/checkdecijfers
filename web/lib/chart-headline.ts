// Chart-card polish (2026-09-15): the headline figure — the one large number
// the chart card leads with. Pure, no React, no Recharts. This is a
// SELECTION over the spec, never a computation (R6): the last PLOTTED point
// of a single time series, via the SAME lastPlottedPoint selection
// chart.tsx's valueLabelPlan uses for its end-of-line label (code-review fix,
// 2026-09-15 — this used to be an independent, hand-copied reverse scan,
// which risked the end-of-line label and this headline silently disagreeing
// about which point is "current" on the same card; see
// chart-plotted-point.ts). The value is the point's own `formattedValue`,
// verbatim, and the caller binds it to `resultId` via data-label-for like
// every other visible number (R1). Called with the DISPLAYED spec (zoomed +
// translated), so under a Vanaf/Tot window the figure is the window's own
// last point, labelled with its own period — honest by disclosure, like the
// end label.
//
// Deliberately null for: several series (no single subject to lead with),
// a comparison (bar kind — "the highest region" would be a selection over
// values of the kind open-questions #221 records as an assumption; not
// taken here), an empty or all-null series. A "net change since X" figure
// is NOT possible from a ChartSpec (it carries no derivation records) and
// must never be computed here — recorded as a follow-up in open-questions.
import type { ChartSpec } from '../backend/chart/types.ts';
import { lastPlottedPoint } from './chart-plotted-point.ts';

export interface HeadlineFigure {
  /** The point's own formattedValue, verbatim — never reformatted (R6). */
  value: string;
  provisional: boolean;
  periodLabel: string;
  unit: string;
  /** R1 traceability handle — rendered as data-label-for. */
  resultId: string;
}

export function headlineFigure(spec: Pick<ChartSpec, 'kind' | 'series' | 'unit'>): HeadlineFigure | null {
  if (spec.kind !== 'line' || spec.series.length !== 1) return null;
  const last = lastPlottedPoint(spec.series[0]!.points);
  if (!last) return null;
  return { value: last.formattedValue, provisional: last.provisional, periodLabel: last.periodLabel, unit: spec.unit, resultId: last.resultId };
}
