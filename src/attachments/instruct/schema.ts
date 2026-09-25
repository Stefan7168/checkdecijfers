// "Eigen data" attachments tier — the H1 boundary itself. This file is where
// the owner's hard constraint (H1: the LLM only ever emits a structured,
// checkable instruction; deterministic code alone renders the chart) is
// enforced. Mirrors src/catalog/rerank-schema.ts's shape exactly: the model
// picks from a supplied closed list, and code — never the JSON schema, which
// structured outputs allow neither per-request enums nor min/max for
// (rerank-schema.ts's own note) — enforces every allowlist/range check.
//
// Fixed in review (adversarial review, session 84, the LLM-allowlist and
// H1-boundary lenses): EVERY ColumnId-bearing field (x, each y, seriesBy,
// every filter's column, sort.by) is checked by ONE shared
// collectColumnRefs() pass, not five separate ad hoc checks — the precedent
// for why this matters is #203 (src/query/derivations.ts, fixed the same
// day this design was drafted): a guard that lived per-caller instead of in
// the checked function itself let a real bug through until a NEW caller
// exercised the unchecked dimension. ChartInstruction gains new
// ColumnId-bearing fields across WP202b-d; centralizing the collection once
// is what stops that from recurring here.
import { z } from 'zod';
import { DERIVED_OPS_WITH_B, type ChartInstruction, type ColumnProfile, type DatasetProfile, type FilterClause } from '../types.ts';
import { MAX_LIMIT, MAX_SERIES, MAX_Y_COLUMNS } from '../limits.ts';

export const CHART_INSTRUCTION_SCHEMA_VERSION = 2;

/**
 * Every reason `validateInstructionObject`/`validateCopilotOutput` can
 * refuse an instruction for — a stable code plus whatever numbers/ids the
 * message needs, never a pre-built sentence (#282: the Data panel used to
 * render this class's raw English `.message` straight to the screen, the
 * one place a non-spec, untranslated string with a digit reached the UI).
 * `describeValidationReason` below is the ONLY place that turns a reason
 * into English (for `.message`, kept for server logs/audit — never shown to
 * a reader); `web/lib/i18n/messages.ts` is the ONLY place that turns one
 * into reader-facing nl/en text. Neither copies the other's wording, so
 * they can't drift the way a hand-paraphrased second copy would.
 */
export type ValidationReasonCode =
  | 'invalid_json'
  | 'schema_violation'
  | 'unknown_column'
  | 'y_count_out_of_range'
  | 'y_column_wrong_type'
  | 'y_column_ambiguous'
  | 'line_x_wrong_type'
  | 'line_x_ambiguous'
  | 'series_no_distinct'
  | 'series_too_many'
  | 'filter_in_no_distinct'
  | 'filter_value_invalid'
  | 'filter_between_ambiguous'
  | 'filter_between_no_range'
  | 'filter_range_reversed'
  | 'filter_range_outside'
  | 'limit_out_of_range'
  | 'derived_needs_one_y'
  | 'derived_needs_b'
  | 'derived_no_b'
  | 'derived_b_wrong_type'
  | 'derived_b_ambiguous'
  | 'derived_with_count'
  | 'percent_change_x_wrong_type'
  | 'sort_illegal_with_aggregate'
  | 'confidence_out_of_range'
  | 'copilot_invalid_json'
  | 'copilot_schema_violation'
  | 'copilot_confidence_out_of_range';

export interface ValidationReason {
  readonly code: ValidationReasonCode;
  readonly params: Readonly<Record<string, string | number>>;
}

/** The reason's OWN English rendering. Used only for `InstructionValidationError.message`
 * (server logs, audit rows, `DatasetInstructFailure`'s message) — never
 * shown to a reader. Exported so the invariant tests can pin these strings
 * without duplicating them. */
export function describeValidationReason(reason: ValidationReason): string {
  const p = reason.params;
  switch (reason.code) {
    case 'invalid_json':
      return `instruction output is not valid JSON: ${p.detail}`;
    case 'schema_violation':
      return `instruction output violates the schema: ${p.detail}`;
    case 'unknown_column':
      return `instruction references column id '${p.column}' which is NOT in the dataset's profile`;
    case 'y_count_out_of_range':
      return `instruction has ${p.count} y column(s), outside the allowed 1..${p.max}`;
    case 'y_column_wrong_type':
      return `y column '${p.column}' has type '${p.type}', not 'number' or 'year'`;
    case 'y_column_ambiguous':
      return `y column '${p.column}' has an unresolved ambiguous number format — ask the user to disambiguate first`;
    case 'line_x_wrong_type':
      return `line chart x column '${p.column}' has type '${p.type}', which has no natural order`;
    case 'line_x_ambiguous':
      return `line chart x column '${p.column}' has an unresolved ambiguous number format`;
    case 'series_no_distinct':
      return `seriesBy column '${p.column}' has no distinct value list to split series on`;
    case 'series_too_many':
      return `seriesBy column '${p.column}' has ${p.count} distinct values, more than the ${p.max} series cap — ask the user to filter first`;
    case 'filter_in_no_distinct':
      return `filter on column '${p.column}' uses 'in' but that column has no distinct value list`;
    case 'filter_value_invalid':
      return `filter value '${p.value}' on column '${p.column}' is NOT one of its real values`;
    case 'filter_between_ambiguous':
      return `filter on column '${p.column}' has an unresolved ambiguous number format`;
    case 'filter_between_no_range':
      return `filter on column '${p.column}' uses 'between' but that column has no min/max range`;
    case 'filter_range_reversed':
      return `filter on column '${p.column}' has from (${p.from}) greater than to (${p.to})`;
    case 'filter_range_outside':
      return `filter on column '${p.column}' range [${p.from}, ${p.to}] falls outside the column's real range [${p.min}, ${p.max}]`;
    case 'limit_out_of_range':
      return `instruction limit ${p.limit} is outside the allowed 1..${p.max}`;
    case 'derived_needs_one_y':
      return `derived '${p.op}' needs exactly one y column`;
    case 'derived_needs_b':
      return `derived '${p.op}' needs a second column b`;
    case 'derived_no_b':
      return `derived '${p.op}' takes no second column`;
    case 'derived_b_wrong_type':
      return `derived column b '${p.column}' has type '${p.type}', not 'number' or 'year'`;
    case 'derived_b_ambiguous':
      return `derived column b '${p.column}' has an unresolved ambiguous number format`;
    case 'derived_with_count':
      return `derived '${p.op}' cannot be combined with aggregate 'count'`;
    case 'percent_change_x_wrong_type':
      return `derived 'percent_change' x column '${p.column}' has type '${p.type}', which has no natural order`;
    case 'sort_illegal_with_aggregate':
      return `with aggregate/derived, sort by 'x' or 'value' only (got '${p.by}')`;
    case 'confidence_out_of_range':
      return `instruction confidence ${p.confidence} is outside 0..1`;
    case 'copilot_invalid_json':
      return `co-pilot output is not valid JSON: ${p.detail}`;
    case 'copilot_schema_violation':
      return `co-pilot output violates the schema: ${p.detail}`;
    case 'copilot_confidence_out_of_range':
      return `co-pilot confidence ${p.confidence} is outside 0..1`;
    default: {
      const _exhaustive: never = reason.code;
      throw new Error(`internal: unhandled validation reason code ${String(_exhaustive)}`);
    }
  }
}

export class InstructionValidationError extends Error {
  readonly outputText: string;
  readonly reason: ValidationReason;

  constructor(reason: ValidationReason, outputText: string) {
    super(describeValidationReason(reason));
    this.name = 'InstructionValidationError';
    this.reason = reason;
    this.outputText = outputText;
  }
}

const filterClauseSchema = z.union([
  z.strictObject({ column: z.string(), op: z.literal('in'), values: z.array(z.string()) }),
  z.strictObject({ column: z.string(), op: z.literal('between'), from: z.number(), to: z.number() }),
]);

const aggregateSchema = z.strictObject({ fn: z.enum(['sum', 'mean', 'min', 'max', 'count']) }).nullable();
const derivedSchema = z
  .strictObject({ op: z.enum(['difference', 'share_of_total', 'percent_change', 'ratio']), b: z.string().nullable() })
  .nullable();

export const chartInstructionSchema = z.strictObject({
  version: z.literal(CHART_INSTRUCTION_SCHEMA_VERSION),
  kind: z.enum(['line', 'bar']),
  x: z.string(),
  y: z.array(z.string()),
  seriesBy: z.string().nullable(),
  filters: z.array(filterClauseSchema),
  sort: z.strictObject({ by: z.string(), direction: z.enum(['asc', 'desc']) }).nullable(),
  limit: z.number().nullable(),
  aggregate: aggregateSchema,
  derived: derivedSchema,
  confidence: z.number(),
  reading: z.string(),
  unsupported: z
    .strictObject({
      reason: z.enum(['compare_with_cbs', 'not_chartable', 'other']),
      detail: z.string(),
    })
    .nullable(),
});

export function chartInstructionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(chartInstructionSchema) as Record<string, unknown>;
}

/** Every ColumnId-bearing field in one instruction, in one place — see the
 * file-header note on why this is a single shared pass, not per-field
 * checks scattered through validateInstruction. `sort.by === 'x'` is a
 * sentinel, not a real column id, and is excluded. */
function collectColumnRefs(data: z.infer<typeof chartInstructionSchema>): string[] {
  const refs = [data.x, ...data.y];
  if (data.seriesBy !== null) refs.push(data.seriesBy);
  for (const filter of data.filters) refs.push(filter.column);
  if (data.sort !== null && data.sort.by !== 'x' && data.sort.by !== 'value') refs.push(data.sort.by);
  if (data.derived !== null && data.derived.b !== null) refs.push(data.derived.b);
  return refs;
}

function fail(reason: ValidationReason, outputText: string): never {
  throw new InstructionValidationError(reason, outputText);
}

/**
 * Parses + validates the model's output against the dataset's own closed
 * vocabulary (its DatasetProfile — see ingest/profile.ts, the only producer
 * of that profile). Throws InstructionValidationError (never returns a
 * partial result) on invalid JSON, a schema violation, or ANY of the
 * allowlist/range/cap violations below — a throw is routed to a
 * clarification, never to a chart (D7): a validation failure can only cost
 * a turn, never produce a wrong picture.
 */
export function validateInstruction(outputText: string, profile: DatasetProfile): ChartInstruction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    fail({ code: 'invalid_json', params: { detail: (error as Error).message } }, outputText);
  }
  return validateInstructionObject(parsed, profile, outputText);
}

/** The same allowlist/range checks over an already-parsed object — the
 * entry the co-pilot (Task 7) and the client-side Data panel (Task 6, via
 * web/backend) use, which never have a raw model outputText string to
 * begin with. `outputText` is optional purely for the error's audit
 * payload; when omitted, the JSON-stringified object stands in for it. */
export function validateInstructionObject(
  rawInput: unknown,
  profile: DatasetProfile,
  outputText?: string,
): ChartInstruction {
  const text = outputText ?? JSON.stringify(rawInput);
  const result = chartInstructionSchema.safeParse(rawInput);
  if (!result.success) {
    fail({ code: 'schema_violation', params: { detail: result.error.message } }, text);
  }
  const data = result.data;

  const columnsById = new Map<string, ColumnProfile>(profile.columns.map((c) => [c.id, c]));

  // The hard allowlist: every column id referenced anywhere must be a real
  // profile column — a single pass over ALL ColumnId-bearing fields.
  for (const ref of collectColumnRefs(data)) {
    if (!columnsById.has(ref)) {
      fail({ code: 'unknown_column', params: { column: ref } }, text);
    }
  }

  if (data.y.length < 1 || data.y.length > MAX_Y_COLUMNS) {
    fail({ code: 'y_count_out_of_range', params: { count: data.y.length, max: MAX_Y_COLUMNS } }, text);
  }
  for (const yId of data.y) {
    const column = columnsById.get(yId)!;
    if (column.type !== 'number' && column.type !== 'year') {
      fail({ code: 'y_column_wrong_type', params: { column: yId, type: column.type } }, text);
    }
    // Fixed in review: a 'number' column whose numberFormat is still
    // 'ambiguous' (D5) must never be plotted — it blocks charting until
    // the user answers the profile card's disambiguation, on this
    // column specifically. Checked here, not just left to profile.ts
    // omitting min/max, so this reads as an explicit rule rather than a
    // side-effect of a different check.
    if (column.numberFormat === 'ambiguous') {
      fail({ code: 'y_column_ambiguous', params: { column: yId } }, text);
    }
  }

  if (data.kind === 'line') {
    const xColumn = columnsById.get(data.x)!;
    if (xColumn.type !== 'year' && xColumn.type !== 'date' && xColumn.type !== 'number') {
      fail({ code: 'line_x_wrong_type', params: { column: data.x, type: xColumn.type } }, text);
    }
    if (xColumn.numberFormat === 'ambiguous') {
      fail({ code: 'line_x_ambiguous', params: { column: data.x } }, text);
    }
  }

  if (data.seriesBy !== null) {
    const seriesColumn = columnsById.get(data.seriesBy)!;
    if (seriesColumn.distinct === undefined) {
      fail({ code: 'series_no_distinct', params: { column: data.seriesBy } }, text);
    }
    // Fixed in review: exceeding the cap is a validation THROW (routed to a
    // clarification), never a silently-truncated legend — the "never
    // silent omission" rule extended from the points cap (D7) to this one.
    if (seriesColumn.distinct.length > MAX_SERIES) {
      fail(
        {
          code: 'series_too_many',
          params: { column: data.seriesBy, count: seriesColumn.distinct.length, max: MAX_SERIES },
        },
        text,
      );
    }
  }

  for (const filter of data.filters) {
    validateFilter(filter, columnsById, text);
  }

  if (data.limit !== null) {
    if (!Number.isInteger(data.limit) || data.limit < 1 || data.limit > MAX_LIMIT) {
      fail({ code: 'limit_out_of_range', params: { limit: data.limit, max: MAX_LIMIT } }, text);
    }
  }

  if (data.derived !== null) {
    if (data.y.length !== 1) fail({ code: 'derived_needs_one_y', params: { op: data.derived.op } }, text);
    const needsB = DERIVED_OPS_WITH_B.includes(data.derived.op);
    if (needsB && data.derived.b === null) fail({ code: 'derived_needs_b', params: { op: data.derived.op } }, text);
    if (!needsB && data.derived.b !== null) fail({ code: 'derived_no_b', params: { op: data.derived.op } }, text);
    if (data.derived.b !== null) {
      const b = columnsById.get(data.derived.b)!;
      if (b.type !== 'number' && b.type !== 'year') {
        fail({ code: 'derived_b_wrong_type', params: { column: data.derived.b, type: b.type } }, text);
      }
      if (b.numberFormat === 'ambiguous') {
        fail({ code: 'derived_b_ambiguous', params: { column: data.derived.b } }, text);
      }
    }
    // Final review (session 113): two combinations that validate field by
    // field but are nonsense on screen. A count aggregate makes both
    // operands the same row count, so the deterministic label would read
    // "Count of rows − Count of rows"; and percent_change compares each
    // point with the PREVIOUS one, which needs an ordered x — the same rule
    // (and message) the line chart's x already carries above.
    if (DERIVED_OPS_WITH_B.includes(data.derived.op) && data.aggregate?.fn === 'count') {
      fail({ code: 'derived_with_count', params: { op: data.derived.op } }, text);
    }
    if (data.derived.op === 'percent_change') {
      const xColumn = columnsById.get(data.x)!;
      if (xColumn.type === 'text') {
        fail({ code: 'percent_change_x_wrong_type', params: { column: data.x, type: xColumn.type } }, text);
      }
    }
  }
  if (data.sort !== null && data.sort.by !== 'x' && data.sort.by !== 'value' && (data.aggregate !== null || data.derived !== null)) {
    fail({ code: 'sort_illegal_with_aggregate', params: { by: data.sort.by } }, text);
  }

  if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    fail({ code: 'confidence_out_of_range', params: { confidence: data.confidence } }, text);
  }

  return data;
}

/** Fixed in review: the operator/column-type pairing is its own named
 * check, not left implicit. 'in' is ONLY legal on a column carrying a
 * `distinct` list (its values are checked against that exact list — never
 * a high-cardinality 'number' column, which carries no distinct list at
 * all); 'between' is ONLY legal on a column carrying min/max, with the
 * requested range required to fall inside the column's real range. */
function validateFilter(
  filter: FilterClause,
  columnsById: Map<string, ColumnProfile>,
  outputText: string,
): void {
  const column = columnsById.get(filter.column)!;
  if (filter.op === 'in') {
    if (column.distinct === undefined) {
      fail({ code: 'filter_in_no_distinct', params: { column: filter.column } }, outputText);
    }
    const allowed = new Set(column.distinct);
    for (const value of filter.values) {
      if (!allowed.has(value)) {
        fail({ code: 'filter_value_invalid', params: { value, column: filter.column } }, outputText);
      }
    }
    return;
  }
  // op === 'between'
  if (column.numberFormat === 'ambiguous') {
    fail({ code: 'filter_between_ambiguous', params: { column: filter.column } }, outputText);
  }
  if (column.min === undefined || column.max === undefined) {
    fail({ code: 'filter_between_no_range', params: { column: filter.column } }, outputText);
  }
  if (filter.from > filter.to) {
    fail({ code: 'filter_range_reversed', params: { column: filter.column, from: filter.from, to: filter.to } }, outputText);
  }
  if (filter.from < column.min || filter.to > column.max) {
    fail(
      {
        code: 'filter_range_outside',
        params: { column: filter.column, from: filter.from, to: filter.to, min: column.min, max: column.max },
      },
      outputText,
    );
  }
}
