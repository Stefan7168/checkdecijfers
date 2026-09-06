// "Eigen data" attachments tier — deterministic reply templates (D8 step 5,
// the ADR 015 rule reused: zero LLM prose in this tier's reply text). Every
// string here is built from the profile's own real column headers/values or
// a fixed English sentence — never from anything the model wrote. English
// throughout (open-questions #206).
import type { ChartInstruction, ColumnProfile, DatasetProfile } from './types.ts';

export function chartReplyText(): string {
  return "Here's your chart.";
}

/** Suggestion chips for the profile card / a low-confidence clarification —
 * built entirely from the profile's own headers, never LLM text (the #75
 * fill-don't-send convention). Fixed in review: D8 requires clarifications
 * to offer "concrete, deterministic options" — the original draft could
 * return an empty array for a narrow dataset (e.g. only one numeric column
 * and no ordered axis), leaving a clarification with nothing to click. A
 * single-column fallback (naming each numeric/year column on its own,
 * without needing a natural x pairing) guarantees at least one option
 * whenever the dataset has ANY numeric or year column at all — the only
 * genuinely empty case left is a dataset with no numeric/year column,
 * which is a `not_chartable` refusal elsewhere in the flow, not a
 * clarification this function needs to serve. */
export function suggestionOptions(profile: DatasetProfile): string[] {
  const numeric = profile.columns.filter((c) => c.type === 'number' || c.type === 'year');
  const ordered = profile.columns.find((c) => c.type === 'year' || c.type === 'date');
  const options: string[] = [];
  for (const column of numeric.slice(0, 2)) {
    if (ordered && ordered.id !== column.id) {
      options.push(`Line chart of ${column.header} by ${ordered.header}`);
    }
  }
  const category = profile.columns.find((c) => c.type === 'text' && c.distinct !== undefined);
  if (category && numeric[0]) {
    options.push(`Bar chart of ${numeric[0].header} by ${category.header}`);
  }
  if (options.length === 0) {
    for (const column of numeric.slice(0, 3)) {
      options.push(`Show ${column.header}`);
    }
  }
  return options;
}

export function lowConfidenceClarificationText(): string {
  return "I'm not fully sure what chart you're looking for. Did you mean one of these?";
}

export function validationClarificationText(): string {
  return "I couldn't match that to a chart from your file. Did you mean one of these?";
}

/** The two-chip numeric-format disambiguation (D5) — profile-card level,
 * not a model call. `header` names the specific column so a multi-column
 * dataset's clarification is unambiguous about which one needs an answer. */
export function ambiguousFormatClarificationText(column: ColumnProfile): string {
  return `The numbers in "${column.header}" could be read two ways — is the "." a thousands separator or a decimal point?`;
}

export const AMBIGUOUS_FORMAT_OPTIONS = ['The "." groups thousands (e.g. 9.800 = 9800)', 'The "." is a decimal point (e.g. 9.800 = 9.8)'] as const;

export function zeroRowsClarificationText(): string {
  return 'No rows match that filter. Try a wider filter, or ask without one.';
}

const REFUSAL_TEXT: Record<
  'aggregation' | 'computation' | 'compare_with_cbs' | 'not_chartable' | 'other' | 'too_many_points' | 'export_hint' | 'empty_question' | 'internal',
  string
> = {
  aggregation:
    "I can't calculate totals, averages, or other summaries yet — only show values that are already in your file.",
  computation: "I can't do that calculation yet — only show values that are already in your file.",
  compare_with_cbs:
    "I can't combine your own data with official CBS figures in one chart. Ask the CBS chat separately for that comparison.",
  not_chartable: "I can't turn that into a chart from this file.",
  other: "I can't do that with your data right now.",
  too_many_points: 'That chart would have too many points to draw clearly — try filtering to a smaller set first.',
  export_hint: 'Use the download button under the chart to export it as an image or a table.',
  empty_question: 'Please type a question about your data.',
  internal: 'Something went wrong on our end. Please try again.',
};

export function refusalText(reason: keyof typeof REFUSAL_TEXT): string {
  return REFUSAL_TEXT[reason];
}

/**
 * Byte-identical re-derivation of a chart turn's `text` from its stored
 * `instruction` (D9 reconstruction) — a fixed sentence, since the chart
 * itself is the answer (D8) and this tier carries no LLM-written reply
 * prose (U3). Kept in this file, not duplicated in audit.ts, so
 * respond.ts and reconstruction can never drift apart (the #203 lesson).
 */
export function reconstructChartText(_instruction: ChartInstruction): string {
  return chartReplyText();
}
