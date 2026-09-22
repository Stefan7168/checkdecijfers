'use server';
// Own-data analog of web/app/chart-derivation-actions.ts's
// requestChartDerivation (ADR 056 phases 4/6's addDerivedOverlay — "own-data
// wiring... remains a separate, unscheduled step" per
// docs/decisions/056-chart-copilot.md's phase-6 section). No CBS/audit-row
// equivalent to re-read here: own-data recomputation has none of principle
// (b)'s live-fetch restriction to work around, so — exactly like
// renderDatasetInstruction (dataset-actions.ts) already does for a
// panel/canvas chart edit — the reader's OWN currently-displayed chart
// instruction is resent and revalidated through the existing
// instruct/schema.ts allowlist, never trusted as-is.
//
// Ownership: copied from renderDatasetInstruction's EXACT pattern (the
// closest sibling — a zero-LLM, zero-billing, no-thread read+compute over an
// already-stored dataset), NOT from chart-derivation-actions.ts's own
// record.userId check, which suits CBS's differently-shaped audit-row
// lookup. getDataset(db, userId, datasetId) is itself the ownership-bound
// read for this tier (store.ts's own doc comment): null for "doesn't exist"
// AND "belongs to someone else", indistinguishable on purpose.
import { z } from 'zod';

import { deriveChartOverlay, OverlaySelectionError, type OverlaySelection } from '../backend/attachments/derive-overlay.ts';
import { NoRowsError, TooManyPointsError, type ComputedValue } from '../backend/attachments/execute.ts';
import { InstructionValidationError, validateInstructionObject } from '../backend/attachments/instruct/schema.ts';
import { MAX_CELL_CHARS } from '../backend/attachments/limits.ts';
import { getDataset } from '../backend/attachments/store.ts';
import { upgradeInstruction } from '../backend/attachments/types.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

// Same belt every other own-data action wears (dataset-actions.ts,
// dataset-copilot-actions.ts): a Server Action argument's declared TS type
// is erased at runtime. datasetId alone throws (a shape the real UI can
// never produce, matching those files' own guardPositiveInteger); the
// instruction/selection content below is validated softly instead, since a
// stale client-held chart state is a real, reachable outcome, not a bug.
function guardPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`input rejected: ${name} must be a positive integer`);
  }
  return value;
}

const labelSchema = z.string().min(1).max(MAX_CELL_CHARS);

const selectionSchema = z.union([
  z.strictObject({ calcKind: z.literal('mean'), seriesLabel: labelSchema }),
  z.strictObject({ calcKind: z.literal('difference'), seriesLabel: labelSchema, pointLabels: z.tuple([labelSchema, labelSchema]) }),
]);

/** Mirrors src/attachments/render.ts's own private toServerShape — not
 * exported there, and render.ts is out of this change's touched-files
 * scope, so the ten-line "fill the server-only ChartInstruction fields a
 * ClientChartInstruction never carries" step is duplicated rather than
 * imported. TOTAL over unknown input, same as the original: a malformed
 * value must fall through to validateInstructionObject's own schema
 * refusal, never throw here. */
function toValidatableInstruction(raw: unknown): unknown {
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

export type RequestDatasetDerivationResponse = { ok: true; result: ComputedValue } | { ok: false; reason?: string };

/**
 * One on-demand chart overlay (difference arrow / average line) over an
 * own-data chart's already-computed points. Deliberately not gated: like
 * renderDatasetInstruction, there is no model call and nothing here costs
 * anything beyond re-running the deterministic validate -> execute ->
 * derive pipeline over already-stored cells (the D12 CSV-ingest precedent).
 */
export async function requestDatasetDerivation(
  datasetId: number,
  rawInstruction: unknown,
  rawSelection: unknown,
): Promise<RequestDatasetDerivationResponse> {
  guardPositiveInteger(datasetId, 'datasetId');

  const userId = await currentUserId();
  if (userId === null) return { ok: false };

  const selection = selectionSchema.safeParse(rawSelection);
  if (!selection.success) return { ok: false, reason: 'invalid selection' };

  const dataset = await getDataset(getDb(), userId, datasetId);
  if (dataset === null || dataset.status !== 'ready') {
    return { ok: false, reason: 'this dataset is not available' };
  }

  let instruction;
  try {
    instruction = validateInstructionObject(toValidatableInstruction(upgradeInstruction(rawInstruction)), dataset.profile);
  } catch (error) {
    if (error instanceof InstructionValidationError) return { ok: false, reason: 'this chart could not be validated' };
    console.error('requestDatasetDerivation failed:', error);
    await reportError('requestDatasetDerivation', error, { userId });
    return { ok: false };
  }

  try {
    const result = deriveChartOverlay(dataset, instruction, selection.data as OverlaySelection);
    return { ok: true, result };
  } catch (error) {
    // OverlaySelectionError (derive-overlay.ts) and NoRowsError/
    // TooManyPointsError (executeInstruction, reachable here because
    // `instruction` is REVALIDATED against the dataset's current state, not
    // replayed from a cached result — the underlying rows can have changed
    // since the chart was first drawn) are REACHABLE reader outcomes, not
    // bugs — render.ts's own renderInstructionForDataset treats the latter
    // two identically ("Unexpected throws propagate: only the [named]
    // outcomes are real reader states"). Never reported; only a genuinely
    // unexpected error below is.
    if (error instanceof OverlaySelectionError) return { ok: false, reason: error.message };
    if (error instanceof NoRowsError) return { ok: false, reason: 'this chart no longer has any matching rows' };
    if (error instanceof TooManyPointsError) return { ok: false, reason: 'this chart has too many points' };
    console.error('requestDatasetDerivation failed:', error);
    await reportError('requestDatasetDerivation', error, { userId });
    return { ok: false };
  }
}
