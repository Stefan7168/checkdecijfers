// The CBS chart co-pilot's digit guard (session 114, co-pilot phase 3).
// PURE. Selection-only sibling of src/attachments/copilot/text-guard.ts,
// judged against a validated ChartSpec instead of a UserChartSpec.
//
// The model may write a title, a caption or a note — the only free text
// this tier ever stores from it. H1 says deterministic code computes every
// number, so a number in that text that is NOT on the chart is by
// definition one the model produced itself: a fabricated number, principle
// (c)'s worst bug. This function finds them; copilot/map.ts refuses the
// command outright when it does.
import type { ChartSpec } from '../types.ts';

/** A maximal run starting with a digit, continuing over digits, '.' and ','
 * — so '1.234,5' is ONE run, not three. Same regex as the own-data tier. */
const DIGIT_RUN = /[0-9][0-9.,]*/g;

/** Trailing '.'/',' belong to the sentence, not the number ('in 2021.'). */
function trimTrailing(run: string): string {
  return run.replace(/[.,]+$/, '');
}

/**
 * Everything a reader can already see, as DIGIT RUNS: every point's
 * formattedValue, periodLabel and periodCode, plus the spec's own title,
 * unit and attribution.coveredPeriods bounds. The guard's job is "is this
 * NUMBER on the chart", so a value's sign and unit symbol are not part of
 * the digits — matching them as digit runs (not whole strings) is what
 * lets a title quoting "-24" or "12%" pass.
 */
function plottedNumbers(spec: ChartSpec): Set<string> {
  const allowed = new Set<string>();
  const add = (value: string | null | undefined): void => {
    if (value === null || value === undefined) return;
    for (const run of value.match(DIGIT_RUN) ?? []) {
      allowed.add(run);
      allowed.add(trimTrailing(run));
    }
  };
  for (const series of spec.series) {
    for (const point of series.points) {
      add(point.formattedValue);
      add(point.periodLabel);
      add(point.periodCode);
    }
  }
  add(spec.title);
  add(spec.unit);
  add(spec.attribution.coveredPeriods.from);
  add(spec.attribution.coveredPeriods.to);
  return allowed;
}

/**
 * Every number in `text` that is not visible on `spec`, in order of first
 * appearance, without duplicates. An empty array means the text is clean.
 */
export function unplottedDigits(text: string, spec: ChartSpec): string[] {
  const allowed = plottedNumbers(spec);
  const offenders: string[] = [];
  for (const raw of text.match(DIGIT_RUN) ?? []) {
    const run = trimTrailing(raw);
    if (run.length === 0 || allowed.has(run) || offenders.includes(run)) continue;
    offenders.push(run);
  }
  return offenders;
}

/**
 * True when `value` appears as a digit run inside `message` (thousands/
 * decimal separators ignored on both sides, so "900000" and "900.000"
 * both match). A goal line's value is the one field on this tier that is
 * a bare NUMBER, not guarded text — so unlike a title/caption/note
 * (checked against the CHART's own numbers via unplottedDigits), it is
 * checked against what the READER actually typed: a legitimate goal line
 * names a target that is deliberately NOT one of the chart's own plotted
 * values, so plottedNumbers() is the wrong reference set here. A value
 * that does not appear in the message is, by construction, one the model
 * invented — principle (c)'s worst bug — so it is refused, never guessed.
 */
export function goalLineValueInMessage(value: number, message: string): boolean {
  if (!Number.isFinite(value)) return false;
  const normalize = (run: string): string => run.replace(/[.,]/g, '');
  const target = normalize(String(value));
  const runs = message.match(/[0-9][0-9.,]*/g) ?? [];
  return runs.some((run) => normalize(run.replace(/[.,]+$/, '')) === target);
}

/**
 * `text` with every digit run replaced by a space (whitespace collapsed,
 * trimmed) — used for the model's own refusal text, which reaches the
 * screen too: there is nothing to refuse, so the number comes out and the
 * sentence stays (same rule as the own-data tier's stripDigits).
 */
export function stripDigits(text: string): string {
  return text.replace(DIGIT_RUN, ' ').replace(/\s+/g, ' ').trim();
}
