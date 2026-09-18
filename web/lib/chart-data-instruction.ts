// Co-pilot phase 2 (session 113, Task 6) — the Data panel's pure half. No
// React, no db, no LLM: a summary, a validator and a patch normaliser. Kept
// dependency-light on purpose, because the summary is also built SERVER-side
// (Task 8's `adjustDatasetChart` labels the co-pilot's own instruction with
// the very same function, so the two doorways can never drift apart).
import { CHART_INSTRUCTION_SUMMARY_MAX_LENGTH } from './chart-commands.ts';
import { t, type Lang, type MessageKey } from './i18n/messages.ts';
import { InstructionValidationError, validateInstructionObject } from '../backend/attachments/instruct/schema.ts';
import {
  DERIVED_OPS_WITH_B,
  reviveClientInstruction,
  type AggregateFn,
  type ClientChartInstruction,
  type ColumnId,
  type DatasetProfile,
  type DerivedOp,
} from '../backend/attachments/types.ts';

/** The `InstructionValidationError` message, verbatim — the reader sees the
 * server's OWN reason, never a second copy of the rules paraphrased here. */
export type ClientInstructionProblem = string;

export const AGGREGATE_KEYS: Record<AggregateFn, MessageKey> = {
  sum: 'chart.data.agg.sum',
  mean: 'chart.data.agg.mean',
  min: 'chart.data.agg.min',
  max: 'chart.data.agg.max',
  count: 'chart.data.agg.count',
};

export const DERIVED_KEYS: Record<DerivedOp, MessageKey> = {
  difference: 'chart.data.derived.difference',
  share_of_total: 'chart.data.derived.share_of_total',
  percent_change: 'chart.data.derived.percent_change',
  ratio: 'chart.data.derived.ratio',
};

/** Spelled-out numbers up to ten, so a limit never reads as a chart figure
 * (validateCommand refuses any summary containing a digit). */
const COUNT_KEYS: readonly MessageKey[] = [
  'chart.data.count.one',
  'chart.data.count.two',
  'chart.data.count.three',
  'chart.data.count.four',
  'chart.data.count.five',
  'chart.data.count.six',
  'chart.data.count.seven',
  'chart.data.count.eight',
  'chart.data.count.nine',
  'chart.data.count.ten',
];

/** A maximal digit run, as in src/attachments/copilot/text-guard.ts. */
const DIGIT_RUN = /[0-9][0-9.,]*/g;

/** Any reader-supplied string (a column header, a series label), with every
 * digit run taken out — the one place that rule lives, so the Data panel's
 * summaries and the chat's example chips strip identically. Empty when
 * nothing but digits was there. */
export function digitFree(text: string): string {
  return text.replace(DIGIT_RUN, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A column's header, digit-free. The reader's own file supplies these
 * headers, and one like "Omzet 2024" would make the whole summary invalid
 * (the digit rule above) — so the digits come out of the LABEL, never out of
 * the numbers on the chart. A header that was nothing but digits falls back
 * to the generic word.
 *
 * Exported since Task 8: the chat doorway's example chips name a column too
 * ("Totaal per <header>") and owe the reader the SAME digit-free label.
 */
export function columnHeaderLabel(id: ColumnId | null, profile: DatasetProfile, lang: Lang): string {
  const column = id === null ? undefined : profile.columns.find((c) => c.id === id);
  const stripped = digitFree(column?.header ?? '');
  return stripped.length === 0 ? t(lang, 'chart.data.summary.column') : stripped;
}

function valuePart(i: ClientChartInstruction, profile: DatasetProfile, lang: Lang): string {
  const a = columnHeaderLabel(i.y[0] ?? null, profile, lang);
  if (i.derived !== null) {
    const b = columnHeaderLabel(i.derived.b, profile, lang);
    switch (i.derived.op) {
      case 'difference':
        return t(lang, 'chart.data.summary.difference', { a, b });
      case 'ratio':
        return t(lang, 'chart.data.summary.ratio', { a, b });
      case 'share_of_total':
        return t(lang, 'chart.data.summary.shareOfTotal', { a });
      case 'percent_change':
        return t(lang, 'chart.data.summary.percentChange', { a });
    }
  }
  if (i.aggregate !== null) {
    // `count` counts rows in the group — there is no single column left to
    // name (the labels.ts rule, in the reader's own language).
    if (i.aggregate.fn === 'count') return t(lang, AGGREGATE_KEYS.count);
    return t(lang, 'chart.data.summary.aggregate', { fn: t(lang, AGGREGATE_KEYS[i.aggregate.fn]), y: a });
  }
  return i.y.map((id) => columnHeaderLabel(id, profile, lang)).join(' + ');
}

function sortPart(i: ClientChartInstruction, profile: DatasetProfile, lang: Lang): string | null {
  if (i.sort === null) return null;
  if (i.sort.by === 'value') {
    return t(lang, i.sort.direction === 'desc' ? 'chart.data.summary.highestFirst' : 'chart.data.summary.lowestFirst');
  }
  const col = i.sort.by === 'x' ? columnHeaderLabel(i.x, profile, lang) : columnHeaderLabel(i.sort.by, profile, lang);
  return t(lang, i.sort.direction === 'asc' ? 'chart.data.summary.sortAsc' : 'chart.data.summary.sortDesc', { col });
}

function limitPart(limit: number | null, lang: Lang): string | null {
  if (limit === null) return null;
  const word = COUNT_KEYS[limit - 1];
  return word === undefined
    ? t(lang, 'chart.data.summary.limited')
    : t(lang, 'chart.data.summary.top', { n: t(lang, word) });
}

/**
 * The history menu's label for a `setInstruction` command: what this chart
 * now draws, in words. Deterministic, digit-free and capped — the three
 * things `validateCommand`'s `setInstruction` arm insists on.
 */
export function summarizeInstruction(i: ClientChartInstruction, profile: DatasetProfile, lang: Lang): string {
  const parts: string[] = [`${valuePart(i, profile, lang)} ${t(lang, 'chart.data.summary.by', { x: columnHeaderLabel(i.x, profile, lang) })}`];
  if (i.seriesBy !== null) parts.push(t(lang, 'chart.data.summary.splitBy', { s: columnHeaderLabel(i.seriesBy, profile, lang) }));
  if (i.filters.length > 0) {
    const cols = i.filters.map((f) => columnHeaderLabel(f.column, profile, lang)).join(' + ');
    parts.push(t(lang, 'chart.data.summary.filtered', { cols }));
  }
  const sort = sortPart(i, profile, lang);
  if (sort !== null) parts.push(sort);
  const limit = limitPart(i.limit, lang);
  if (limit !== null) parts.push(limit);
  const summary = parts.join(', ');
  if (summary.length <= CHART_INSTRUCTION_SUMMARY_MAX_LENGTH) return summary;
  return `${summary.slice(0, CHART_INSTRUCTION_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * The SERVER's own allowlist, run client-side before anything is dispatched
 * — never a second, drifting copy of those checks (the same reasoning
 * `validateCommand` records for its `setInstruction` arm). `null` means the
 * instruction is drawable; anything else is the reason it is not.
 */
export function validateClientInstruction(i: ClientChartInstruction, profile: DatasetProfile): ClientInstructionProblem | null {
  try {
    validateInstructionObject(reviveClientInstruction(i), profile);
    return null;
  } catch (error) {
    if (error instanceof InstructionValidationError) return error.message;
    return (error as Error).message;
  }
}

/**
 * A control change, normalised. A shallow merge plus the three couplings a
 * single control cannot express on its own — without them a reader who picks
 * "share of total" while two value columns are ticked gets the schema's
 * complaint about a combination they never asked for:
 *   1. an op that takes no second column loses its `b`;
 *   2. a derived reading needs exactly one value column, so `y` is trimmed;
 *   3. a sort NAMING a column is illegal once aggregate/derived is set, so
 *      it is dropped (the reader can pick x/value again).
 */
export function withPatch(i: ClientChartInstruction, patch: Partial<ClientChartInstruction>): ClientChartInstruction {
  const next: ClientChartInstruction = { ...i, ...patch };
  if (next.derived !== null) {
    const b = DERIVED_OPS_WITH_B.includes(next.derived.op) ? next.derived.b : null;
    next.derived = { op: next.derived.op, b };
    if (next.y.length > 1) next.y = next.y.slice(0, 1);
  }
  if (next.sort !== null && next.sort.by !== 'x' && next.sort.by !== 'value' && (next.aggregate !== null || next.derived !== null)) {
    next.sort = null;
  }
  return next;
}
