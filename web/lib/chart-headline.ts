// Chart-card polish (2026-09-15): the headline figure — the one large number
// the chart card leads with. Pure, no React, no Recharts. This is a
// SELECTION over the spec, never a computation (R6): the last PLOTTED point
// of a single time series, exactly the rule `valueLabelPlan`'s end-of-line
// label already applies (chart.tsx). The value is the point's own
// `formattedValue`, verbatim, and the caller binds it to `resultId` via
// data-label-for like every other visible number (R1). Called with the
// DISPLAYED spec (zoomed + translated), so under a Vanaf/Tot window the
// figure is the window's own last point, labelled with its own period —
// honest by disclosure, like the end label.
//
// Deliberately null for: several series (no single subject to lead with),
// a comparison (bar kind — "the highest region" would be a selection over
// values of the kind open-questions #221 records as an assumption; not
// taken here), an empty or all-null series. A "net change since X" figure
// is NOT possible from a ChartSpec (it carries no derivation records) and
// must never be computed here — recorded as a follow-up in open-questions.
import type { ChartSpec } from '../backend/chart/types.ts';

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
  const points = spec.series[0]!.points;
  // Spec order is period-ascending (R6: the spec's order IS the render
  // order), so the last plotted point is the last non-null one.
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (p.value !== null && p.formattedValue !== null) {
      return { value: p.formattedValue, provisional: p.provisional, periodLabel: p.periodLabel, unit: spec.unit, resultId: p.resultId };
    }
  }
  return null;
}
