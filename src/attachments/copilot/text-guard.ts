// The co-pilot's digit guard (session 113, co-pilot phase 2). PURE.
//
// The model may write a title, a caption or a note — the only free text
// this tier ever stores from it. H1 says deterministic code computes every
// number, so a number in that text that is NOT on the chart is by
// definition one the model produced itself: a fabricated number, principle
// (c)'s worst bug. This function finds them; copilot/map.ts refuses the
// command outright when it does (never strips the number and keeps the
// text — a silently edited sentence is its own honesty problem).
import type { UserChartSpec } from '../types.ts';

/** A maximal run starting with a digit, continuing over digits, '.' and ','
 * — so '1.234,5' is ONE run, not three. */
const DIGIT_RUN = /[0-9][0-9.,]*/g;

/** Trailing '.'/',' belong to the sentence, not the number ('in 2021.'). */
function trimTrailing(run: string): string {
  return run.replace(/[.,]+$/, '');
}

/** Everything a reader can already see: every point's formatted value, its
 * raw source text and its x label, plus every digit run inside the chart's
 * own column headers (a unit like 'x 1.000 euro' is quotable). */
function plottedNumbers(chart: UserChartSpec): Set<string> {
  const allowed = new Set<string>();
  const add = (value: string | null): void => {
    if (value === null) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    allowed.add(trimmed);
    allowed.add(trimTrailing(trimmed));
  };
  for (const series of chart.series) {
    for (const point of series.points) {
      add(point.formattedValue);
      add(point.sourceText);
      add(point.xLabel);
    }
  }
  for (const header of [chart.xHeader, ...chart.yHeaders]) {
    for (const run of header.match(DIGIT_RUN) ?? []) add(run);
  }
  return allowed;
}

/**
 * Every number in `text` that is not visible on `chart`, in order of first
 * appearance, without duplicates. An empty array means the text is clean.
 */
export function unplottedDigits(text: string, chart: UserChartSpec): string[] {
  const allowed = plottedNumbers(chart);
  const offenders: string[] = [];
  for (const raw of text.match(DIGIT_RUN) ?? []) {
    const run = trimTrailing(raw);
    if (run.length === 0 || allowed.has(run) || offenders.includes(run)) continue;
    offenders.push(run);
  }
  return offenders;
}
