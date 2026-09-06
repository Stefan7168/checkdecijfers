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
import type { ChartInstruction, ColumnProfile, DatasetProfile, FilterClause } from '../types.ts';
import { MAX_LIMIT, MAX_SERIES, MAX_Y_COLUMNS } from '../limits.ts';

export const CHART_INSTRUCTION_SCHEMA_VERSION = 1;

export class InstructionValidationError extends Error {
  readonly outputText: string;

  constructor(message: string, outputText: string) {
    super(message);
    this.name = 'InstructionValidationError';
    this.outputText = outputText;
  }
}

const filterClauseSchema = z.union([
  z.strictObject({ column: z.string(), op: z.literal('in'), values: z.array(z.string()) }),
  z.strictObject({ column: z.string(), op: z.literal('between'), from: z.number(), to: z.number() }),
]);

const chartInstructionSchema = z.strictObject({
  version: z.literal(CHART_INSTRUCTION_SCHEMA_VERSION),
  kind: z.enum(['line', 'bar']),
  x: z.string(),
  y: z.array(z.string()),
  seriesBy: z.string().nullable(),
  filters: z.array(filterClauseSchema),
  sort: z.strictObject({ by: z.string(), direction: z.enum(['asc', 'desc']) }).nullable(),
  limit: z.number().nullable(),
  confidence: z.number(),
  reading: z.string(),
  unsupported: z
    .strictObject({
      reason: z.enum(['aggregation', 'computation', 'compare_with_cbs', 'not_chartable', 'other']),
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
  if (data.sort !== null && data.sort.by !== 'x') refs.push(data.sort.by);
  return refs;
}

function fail(message: string, outputText: string): never {
  throw new InstructionValidationError(message, outputText);
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
    fail(`instruction output is not valid JSON: ${(error as Error).message}`, outputText);
  }

  const result = chartInstructionSchema.safeParse(parsed);
  if (!result.success) {
    fail(`instruction output violates the schema: ${result.error.message}`, outputText);
  }
  const data = result.data;

  const columnsById = new Map<string, ColumnProfile>(profile.columns.map((c) => [c.id, c]));

  // The hard allowlist: every column id referenced anywhere must be a real
  // profile column — a single pass over ALL ColumnId-bearing fields.
  for (const ref of collectColumnRefs(data)) {
    if (!columnsById.has(ref)) {
      fail(`instruction references column id '${ref}' which is NOT in the dataset's profile`, outputText);
    }
  }

  if (data.y.length < 1 || data.y.length > MAX_Y_COLUMNS) {
    fail(`instruction has ${data.y.length} y column(s), outside the allowed 1..${MAX_Y_COLUMNS}`, outputText);
  }
  for (const yId of data.y) {
    const column = columnsById.get(yId)!;
    if (column.type !== 'number' && column.type !== 'year') {
      fail(`y column '${yId}' has type '${column.type}', not 'number' or 'year'`, outputText);
    }
    // Fixed in review: a 'number' column whose numberFormat is still
    // 'ambiguous' (D5) must never be plotted — it blocks charting until
    // the user answers the profile card's disambiguation, on this
    // column specifically. Checked here, not just left to profile.ts
    // omitting min/max, so this reads as an explicit rule rather than a
    // side-effect of a different check.
    if (column.numberFormat === 'ambiguous') {
      fail(`y column '${yId}' has an unresolved ambiguous number format — ask the user to disambiguate first`, outputText);
    }
  }

  if (data.kind === 'line') {
    const xColumn = columnsById.get(data.x)!;
    if (xColumn.type !== 'year' && xColumn.type !== 'date' && xColumn.type !== 'number') {
      fail(`line chart x column '${data.x}' has type '${xColumn.type}', which has no natural order`, outputText);
    }
    if (xColumn.numberFormat === 'ambiguous') {
      fail(`line chart x column '${data.x}' has an unresolved ambiguous number format`, outputText);
    }
  }

  if (data.seriesBy !== null) {
    const seriesColumn = columnsById.get(data.seriesBy)!;
    if (seriesColumn.distinct === undefined) {
      fail(`seriesBy column '${data.seriesBy}' has no distinct value list to split series on`, outputText);
    }
    // Fixed in review: exceeding the cap is a validation THROW (routed to a
    // clarification), never a silently-truncated legend — the "never
    // silent omission" rule extended from the points cap (D7) to this one.
    if (seriesColumn.distinct.length > MAX_SERIES) {
      fail(
        `seriesBy column '${data.seriesBy}' has ${seriesColumn.distinct.length} distinct values, ` +
          `more than the ${MAX_SERIES} series cap — ask the user to filter first`,
        outputText,
      );
    }
  }

  for (const filter of data.filters) {
    validateFilter(filter, columnsById, outputText);
  }

  if (data.limit !== null) {
    if (!Number.isInteger(data.limit) || data.limit < 1 || data.limit > MAX_LIMIT) {
      fail(`instruction limit ${data.limit} is outside the allowed 1..${MAX_LIMIT}`, outputText);
    }
  }

  if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    fail(`instruction confidence ${data.confidence} is outside 0..1`, outputText);
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
      fail(`filter on column '${filter.column}' uses 'in' but that column has no distinct value list`, outputText);
    }
    const allowed = new Set(column.distinct);
    for (const value of filter.values) {
      if (!allowed.has(value)) {
        fail(`filter value '${value}' on column '${filter.column}' is NOT one of its real values`, outputText);
      }
    }
    return;
  }
  // op === 'between'
  if (column.numberFormat === 'ambiguous') {
    fail(`filter on column '${filter.column}' has an unresolved ambiguous number format`, outputText);
  }
  if (column.min === undefined || column.max === undefined) {
    fail(`filter on column '${filter.column}' uses 'between' but that column has no min/max range`, outputText);
  }
  if (filter.from > filter.to) {
    fail(`filter on column '${filter.column}' has from (${filter.from}) greater than to (${filter.to})`, outputText);
  }
  if (filter.from < column.min || filter.to > column.max) {
    fail(
      `filter on column '${filter.column}' range [${filter.from}, ${filter.to}] falls outside ` +
        `the column's real range [${column.min}, ${column.max}]`,
      outputText,
    );
  }
}
