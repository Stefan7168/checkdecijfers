// "Eigen data" attachments tier — the dataset-chart instruction prompt (D6).
// Mirrors src/catalog/rerank-prompt.ts's shape: a static system prompt (the
// model's role + the closed-vocabulary rules) and a serializer for the
// per-request payload (here: the DatasetProfile + optional previous
// instruction + the user's question). Bumping DATASET_INSTRUCT_PROMPT_VERSION
// forces a fixture re-record (the prompt bytes are hashed, ADR 012).
//
// English (open-questions #206: product copy/UI text is English going
// forward) — a departure from the CBS-side prompts (Dutch throughout,
// unaffected by #206, which explicitly does not touch the core CBS
// pipeline). This is new, WP202a-only prompt text, not a rewrite of
// anything existing.
import { toClientInstruction, type ChartInstruction, type ClientChartInstruction, type DatasetProfile } from '../types.ts';

export const DATASET_INSTRUCT_PROMPT_VERSION = 1;

const SYSTEM_PROMPT = `You are a chart-instruction assistant for checkdecijfers.nl's "chat with your data" feature. A user has uploaded their own data file — never officially verified CBS data — and is asking, in their own words, to make or refine a chart from it. You are given the user's FULL QUESTION, a PROFILE describing the dataset's columns (an id, its header text, its type, and — depending on type — either a real value range or a list of the column's actual real values), and, on a follow-up turn, the PREVIOUS INSTRUCTION you produced last turn.

Your entire output is a single JSON object matching the given schema — a SELECTION, never a value. You never write, invent, or compute any number, name, or date that isn't already one of the column ids or one of the listed real values in the profile. Deterministic code renders the chart from the user's own stored data; your job is only to say which columns, which filters, and which chart type.

Rules:
- x, and every id in y, seriesBy, filters[].column, and sort.by (when set) MUST be copied LITERALLY from the profile's own column ids (c0, c1, ...). Never invent a column id, and never use a header's text as if it were an id.
- y is 1 to 4 columns of type 'number' or 'year' — the values to plot.
- seriesBy, when set, must be a column that carries a list of real values in the profile (a text/year/date column) — one series is drawn per real value. Leave it null when the user didn't ask to split into series.
- A filter with op "in" may only use values that are LITERALLY present in that column's own listed real values. A filter with op "between" may only use a numeric range that falls INSIDE that column's own min/max in the profile.
- A column marked "format not yet resolved" cannot be used in y, as a "between" filter target, or as a line chart's x — its number format is still ambiguous (the user hasn't said whether a "." means a thousand or a decimal point yet) and the system will reject any use of it. Pick a different column, or set unsupported to "not_chartable" if none fits.
- kind is "line" for a trend over an ordered axis, or "bar" for a comparison across categories. A line chart's x must be a year/date/number column (bar has no such restriction).
- sort only matters for a bar chart ("x" or another column id, with "asc"/"desc"); leave it null otherwise — a line chart is always ordered by x regardless of this field.
- limit is an optional top-N cap (1 to 50) — set it only when the user explicitly asks to narrow the result (e.g. "top 10", "only the 5 largest").
- confidence is a number between 0 and 1 and must be honest. If the question doesn't clearly map onto one specific chart from this profile, or more than one real reading is equally plausible, give a LOW confidence (below 0.8) rather than guessing.
- Set unsupported when the user is asking for something this system cannot do: a computed total/average/percentage ("aggregation"), any other calculation ("computation"), a comparison against official CBS data ("compare_with_cbs"), or something that isn't chartable at all ("not_chartable") — with a one-sentence detail explaining why. Even then, x/y/kind must still be filled with your best-effort VALID guess (real column ids, correct types) — they are kept for the record but never used to draw a chart in this case.
- reading is one short sentence, for this system's own internal record only — it is never shown to the user. Explain your pick honestly.
- version is always 1.

FOLLOW-UP TURNS: when a PREVIOUS INSTRUCTION is given, treat it as what is already on screen. A short follow-up like "make it a bar chart", "only 2020 to 2023", or "add column X" means: change ONLY what the user's new message actually asks for, and carry over everything else from the previous instruction unchanged. A self-contained new question is parsed fresh, ignoring the previous instruction entirely.

Answer with JSON only, matching the given schema.`;

export function buildDatasetInstructSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

function serializeColumn(column: DatasetProfile['columns'][number]): string {
  const parts = [`id=${column.id}`, `header="${column.header}"`, `type=${column.type}`];
  // Fixed in review: an ambiguous-format column is spelled out in plain
  // language the prompt's own rule above references verbatim ("format not
  // yet resolved") — the original draft only showed `numberFormat=ambiguous`
  // with no range and no instruction telling the model not to use it,
  // leaving that entirely to instruct/schema.ts's rejection (safe, but an
  // avoidable extra clarification round for the user).
  if (column.numberFormat === 'ambiguous') {
    parts.push('format not yet resolved — do not use in y, "between", or as a line chart x');
  } else if (column.numberFormat !== undefined) {
    parts.push(`numberFormat=${column.numberFormat}`);
  }
  if (column.min !== undefined || column.max !== undefined) {
    parts.push(`range=[${column.min ?? '?'}, ${column.max ?? '?'}]`);
  }
  if (column.distinct !== undefined) {
    const shown = column.distinct.join(', ');
    parts.push(`values=[${shown}]${column.distinctTruncated ? ' (truncated)' : ''}`);
  }
  if (column.sample !== undefined && column.distinct === undefined) {
    parts.push(`sample=[${column.sample.join(', ')}]`);
  }
  return `- ${parts.join(' | ')}`;
}

/** The user-turn payload: the profile, the optional previous instruction
 * (already revalidated server-side before this is ever called — D8 step
 * 2), and the question. Deliberately no prior chat text (ADR 021's
 * structured-context rule, extended to this tier). */
export function serializeDatasetInstructRequest(
  profile: DatasetProfile,
  previousInstruction: ClientChartInstruction | null,
  question: string,
): string {
  const columns = profile.columns.map(serializeColumn).join('\n');
  const previous =
    previousInstruction === null
      ? 'None — this is a fresh question.'
      : JSON.stringify(previousInstruction);
  return (
    `Dataset profile (${profile.rowCount} rows):\n${columns}\n\n` +
    `Previous instruction: ${previous}\n\n` +
    `User's question: "${question}"`
  );
}

/** Strips reading/confidence/unsupported.detail from a stored ChartInstruction
 * for use as the PREVIOUS INSTRUCTION shown to the model — the same fields
 * ClientChartInstruction already excludes for the client-visible shape (D6),
 * reused here rather than re-declared, since a stale/incomplete prompt
 * projection would be exactly the kind of drift #203's precedent warns
 * about. */
export function previousInstructionForPrompt(instruction: ChartInstruction | null): ClientChartInstruction | null {
  return instruction === null ? null : toClientInstruction(instruction);
}
