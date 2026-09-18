// "Eigen data" attachments tier — deterministic English labels for an
// aggregate/derived series (phase 2). Pure string formatting only: no
// arithmetic, no LLM, no db import. These are the axis/series labels
// buildUserChartSpec falls back to whenever instruction.aggregate or
// instruction.derived is set — a computed series is no longer just "the
// column header" (U9's verbatim-header rule applies to a RAW column only).
import type { AggregateFn, DerivedOp } from './types.ts';

const AGGREGATE_VERBS: Record<AggregateFn, string> = {
  sum: 'Sum of',
  mean: 'Average of',
  min: 'Lowest',
  max: 'Highest',
  count: 'Count of rows',
};

/** 'Sum of Omzet', 'Average of Omzet', 'Lowest Omzet', 'Highest Omzet',
 * 'Count of rows' (count ignores yHeader — there is no single column left
 * to name once every row in the group counts equally). */
export function aggregateLabel(fn: AggregateFn, yHeader: string): string {
  if (fn === 'count') return AGGREGATE_VERBS.count;
  return `${AGGREGATE_VERBS[fn]} ${yHeader}`;
}

/** 'Omzet − Kosten', 'Omzet ÷ Kosten', 'Omzet, share of total (%)',
 * 'Omzet, change vs previous (%)'. `bHeader` is only used by
 * difference/ratio (DERIVED_OPS_WITH_B); share_of_total/percent_change
 * never carry a `b` and ignore it. */
export function derivedLabel(op: DerivedOp, aHeader: string, bHeader: string | null): string {
  switch (op) {
    case 'difference':
      return `${aHeader} − ${bHeader}`;
    case 'ratio':
      return `${aHeader} ÷ ${bHeader}`;
    case 'share_of_total':
      return `${aHeader}, share of total (%)`;
    case 'percent_change':
      return `${aHeader}, change vs previous (%)`;
  }
}
