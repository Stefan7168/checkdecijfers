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

/** A maximal digit run with an optional ASCII minus directly before its
 * first digit. Whether that minus is a SIGN is decided by the caller from
 * the character before it: "-5" after a space is negative five, while the
 * "-" in "2020-2022" follows a digit and is a range dash. Ported verbatim
 * from src/chart/copilot/text-guard.ts's own goalLineValueInMessage (this
 * tier's own wiring of the CBS co-pilot phase 6 primitive) — see that
 * file's TSDoc for the full reasoning; the logic below is identical because
 * neither it nor its helpers ever reference a chart type. */
const SIGNED_DIGIT_RUN = /(-?)([0-9][0-9.,]*)/g;

/** The integer part of a spelled number under one reading, as bare
 * digits: plain digits, or a first group of one to three digits (not
 * starting with 0) followed by `grouping`-separated groups of exactly
 * three — so "1,5" has no point-decimal reading and "900,000" has one. */
function readInteger(text: string, grouping: '.' | ','): string | null {
  if (/^[0-9]+$/.test(text)) return text;
  const grouped = grouping === '.' ? /^[1-9][0-9]{0,2}(?:\.[0-9]{3})+$/ : /^[1-9][0-9]{0,2}(?:,[0-9]{3})+$/;
  if (!grouped.test(text)) return null;
  return text.replace(grouping === '.' ? /\./g : /,/g, '');
}

/**
 * `run` read with `decimal` as its decimal mark and the other separator
 * as its thousands mark — null when the spelling is not well-formed under
 * that reading. Both readings exist because the reader's locale is not
 * known here: "1.234,5" is the Dutch spelling and "1,234.5" the English
 * one, and each is well-formed under exactly one of the two.
 */
function readRun(run: string, decimal: '.' | ','): number | null {
  const parts = run.split(decimal);
  if (parts.length > 2) return null;
  const integer = readInteger(parts[0] ?? '', decimal === '.' ? ',' : '.');
  if (integer === null) return null;
  const fraction = parts[1];
  if (fraction !== undefined && !/^[0-9]+$/.test(fraction)) return null;
  return Number(fraction === undefined ? integer : `${integer}.${fraction}`);
}

/**
 * True when `value` EQUALS, numerically, a number the reader spelled in
 * `message`. A goal line's value is the one field on this tier that is a
 * bare NUMBER, not guarded text — so unlike a title/caption/note (checked
 * against the CHART's own numbers via unplottedDigits), it is checked
 * against what the READER actually typed: a legitimate goal line names a
 * target that is deliberately NOT one of the chart's own plotted values,
 * so plottedNumbers() is the wrong reference set here.
 *
 * Each maximal digit run in the message — with an ASCII minus directly
 * before it as its sign, unless that minus itself follows a digit or a
 * separator and is a range dash — is read both ways a Dutch or an English
 * reader could have written it ('.' as decimal with ',' grouping, and ','
 * as decimal with '.' grouping; a grouping mark must be followed by
 * exactly three digits), and the value must equal one reading exactly.
 * Reusing the reader's digits with a moved decimal or a different sign
 * ("25" for 2.5, "1,5" for 15, "-5" for 5) is therefore refused: the CBS
 * tier's first version of this guard compared separator-stripped digit
 * STRINGS and let exactly those through. A spelling that is well-formed
 * under both readings ("900,000": 900000 in English, 900 in Dutch) is
 * accepted under either, because the reader's locale is not known here. A
 * value that equals no reading is, by construction, one the model
 * invented — principle (c)'s worst bug — so it is refused, never guessed.
 *
 * Deliberate, accepted false-accept (mirrors the CBS tier's own
 * documented limitation): this guard checks only whether `value` appears
 * SOMEWHERE in the message, not that it names the goal — so a bare year
 * mentioned for another reason makes that year pass too. Narrowing this
 * would need real-model confirmation this tier has not spent yet; the
 * guard's actual job — refusing a value the reader never typed at all —
 * still holds.
 */
export function goalLineValueInMessage(value: number, message: string): boolean {
  if (!Number.isFinite(value)) return false;
  for (const match of message.matchAll(SIGNED_DIGIT_RUN)) {
    const run = trimTrailing(match[2] ?? '');
    if (run.length === 0) continue;
    const index = match.index ?? 0;
    const before = index > 0 ? message.charAt(index - 1) : '';
    const negative = match[1] === '-' && !/[0-9.,]/.test(before);
    for (const decimal of ['.', ','] as const) {
      const reading = readRun(run, decimal);
      if (reading !== null && (negative ? -reading : reading) === value) return true;
    }
  }
  return false;
}
