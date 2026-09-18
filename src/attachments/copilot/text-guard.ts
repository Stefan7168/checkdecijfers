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

/**
 * Everything a reader can already see, as DIGIT RUNS. The same extraction is
 * applied to every string on the chart — formatted values, raw source text, x
 * labels and column headers alike (fix, review round 1: matching a point's
 * value as a WHOLE string made '-24', '€ 1.234' or '12%' unrecognisable, so
 * a title quoting the number the reader is looking at was refused as
 * fabricated). The guard's job is "is this NUMBER on the chart", and a
 * number's sign, currency symbol and percent sign are not part of the digits.
 */
function plottedNumbers(chart: UserChartSpec): Set<string> {
  const allowed = new Set<string>();
  const add = (value: string | null): void => {
    if (value === null) return;
    for (const run of value.match(DIGIT_RUN) ?? []) {
      allowed.add(run);
      allowed.add(trimTrailing(run));
    }
  };
  for (const series of chart.series) {
    for (const point of series.points) {
      add(point.formattedValue);
      add(point.sourceText);
      add(point.xLabel);
    }
  }
  for (const header of [chart.xHeader, ...chart.yHeaders]) add(header);
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

/**
 * `text` with every digit run replaced by a space (whitespace collapsed,
 * trimmed) — the same transform web/lib/chart-data-instruction.ts's
 * `digitFree` applies to a reader's column header, reproduced here because
 * src/ cannot import web/lib/* (src/threads/replay.ts's layering rule).
 *
 * Used for the model's own refusal text (final review, session 113): that
 * string reaches the screen too, and unlike a title/caption/note there is
 * nothing to refuse — dropping the refusal would hide from the reader that
 * their request was declined. So the number comes out and the sentence
 * stays.
 */
export function stripDigits(text: string): string {
  return text.replace(DIGIT_RUN, ' ').replace(/\s+/g, ' ').trim();
}
