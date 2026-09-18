// "Eigen data" attachments tier — the ZERO-LLM render path (co-pilot phase 2,
// session 113). A reader's panel/canvas edit changes WHICH columns, aggregate
// and derived reading the chart draws; that is a pure re-run of the existing
// validate → execute → build pipeline over the same stored cells, so it costs
// no model call and no credit (the D12 CSV-ingest precedent).
//
// Pure and db-free on purpose: the Server Action (web/app/dataset-actions.ts)
// owns auth/ownership and hands the already-loaded dataset here, so this file
// is testable at root without a database.
import { buildUserChartSpec } from './chart.ts';
import { NoRowsError, TooManyPointsError } from './execute.ts';
import { InstructionValidationError, validateInstructionObject } from './instruct/schema.ts';
import { upgradeInstruction, type UserChartSpec, type UserDataset } from './types.ts';

/** Why a render could not be drawn. Every member is a REACHABLE reader
 * outcome the card shows as one inline, digit-free line — never a thrown
 * error, and never a partial chart. */
export type RenderInstructionFailure = 'validation' | 'zero_rows' | 'too_many_points';

export type RenderInstructionOutcome = { kind: 'ok'; chart: UserChartSpec } | { kind: 'invalid'; reason: RenderInstructionFailure };

/** The client only ever holds a `ClientChartInstruction` (no `reading`, no
 * `confidence`, no `unsupported.detail` — types.ts's H1/U3 narrowing), while
 * the validator's schema is strict and requires all three. Same placeholders
 * `reviveClientInstruction` fills, but TOTAL over unknown input: a malformed
 * value must fall through to the schema's own refusal, never throw here. */
function toServerShape(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const o = raw as Record<string, unknown>;
  const unsupported = o.unsupported;
  return {
    ...o,
    confidence: 1,
    reading: '',
    ...(unsupported !== null && typeof unsupported === 'object'
      ? { unsupported: { ...(unsupported as Record<string, unknown>), detail: '' } }
      : {}),
  };
}

/**
 * Validate an instruction against THIS dataset's own closed vocabulary (the
 * same allowlist the model-facing path runs — never a second, drifting copy)
 * and build the chart. Unexpected throws propagate: only the three outcomes
 * above are real reader states.
 */
export function renderInstructionForDataset(dataset: UserDataset, rawInstruction: unknown): RenderInstructionOutcome {
  let instruction;
  try {
    instruction = validateInstructionObject(toServerShape(upgradeInstruction(rawInstruction)), dataset.profile);
  } catch (error) {
    if (error instanceof InstructionValidationError) return { kind: 'invalid', reason: 'validation' };
    throw error;
  }
  try {
    return { kind: 'ok', chart: buildUserChartSpec(dataset, instruction) };
  } catch (error) {
    if (error instanceof NoRowsError) return { kind: 'invalid', reason: 'zero_rows' };
    if (error instanceof TooManyPointsError) return { kind: 'invalid', reason: 'too_many_points' };
    throw error;
  }
}
