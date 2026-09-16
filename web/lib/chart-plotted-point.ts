// Chart-card polish (2026-09-15, code-review fix): the ONE "last plotted
// point of a series" selection rule, shared by chart.tsx's valueLabelPlan
// (the end-of-line label) and chart-headline.ts's headlineFigure (the
// headline number) — previously two independent, hand-copied reverse scans
// with no structural reason to stay in sync, risking the end-of-line label
// and the headline number silently disagreeing about which point is
// "current" on the same card. R6: the spec's order IS the render order, so
// the last plotted point is the last one whose value/formattedValue are both
// non-null.
import type { PlottablePoint } from '../components/chart.tsx';

/** A plotted point whose value/formattedValue are narrowed non-null, so
 * callers don't need their own `!` assertion after calling this. */
export type PlottedPoint = PlottablePoint & { value: number; formattedValue: string };

export function lastPlottedPoint(points: readonly PlottablePoint[]): PlottedPoint | undefined {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (p.value !== null && p.formattedValue !== null) return p as PlottedPoint;
  }
  return undefined;
}
