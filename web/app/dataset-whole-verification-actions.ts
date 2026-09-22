'use server';
// Own-data analog of web/app/chart-whole-verification-actions.ts's
// requestWholeVerification (chart co-pilot phase 5b) — own-data's "verified
// whole" doorway (plan 2026-09-22, Task 4). Exported here as
// requestDatasetWholeVerification (M1, adversarial review, this task): the
// two files' own functions used to share one name, which collided badly
// enough to already need explanatory comments in the contract test's mocks
// to keep the two straight. CBS's version fetches an
// independently-PUBLISHED parent total from OUR database; own-data has no
// such registry, so this re-reads the reader's OWN currently-displayed chart
// instruction (never trusted as-is — resent and revalidated through the
// existing instruct/schema.ts allowlist, exactly like requestDatasetDerivation,
// the closest sibling this file mirrors) and checks a READER-DESIGNATED cell
// (`wholeRowRef`) against the reader-selected parts (`partRowRefs`) with the
// SAME pure arithmetic check (verifyPartsSumToWhole) CBS's tier trusts.
//
// Ownership: copied from renderDatasetInstruction/requestDatasetDerivation's
// EXACT pattern — getDataset(db, userId, datasetId) is itself the ownership-
// bound read (store.ts's own doc comment): null for "doesn't exist" AND
// "belongs to someone else", indistinguishable on purpose.
//
// No audit row: matches the difference/mean overlay precedent
// (dataset-derivation-actions.ts) — a view command re-deriving already-
// ingested cells, not a new answer, per principle (b)'s scope.
import { z } from 'zod';

import { verifyDatasetWhole } from '../backend/attachments/verify-whole.ts';
import { NoRowsError, TooManyPointsError } from '../backend/attachments/execute.ts';
import { InstructionValidationError, validateInstructionObject } from '../backend/attachments/instruct/schema.ts';
import { MAX_CHART_POINTS } from '../backend/attachments/limits.ts';
import { getDataset } from '../backend/attachments/store.ts';
import { upgradeInstruction } from '../backend/attachments/types.ts';
import type { VerifyOutcome } from '../backend/query/whole-verification.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

// Same belt every other own-data action wears (dataset-actions.ts,
// dataset-derivation-actions.ts): a Server Action argument's declared TS type
// is erased at runtime.
function guardPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`input rejected: ${name} must be a positive integer`);
  }
  return value;
}

const wholeRowRefSchema = z.string().min(1);
// Bounded by MAX_CHART_POINTS, same as dataset-derivation-actions.ts's own
// resultIdsSchema — an own-data "parts" list can legitimately span a chart's
// full point count. No `.min()`: every OTHER visible series can legitimately
// be zero (every series but the designated one hidden), and an empty roster
// is already a defined, graceful outcome (verifyPartsSumToWhole's own
// 'sum_mismatch' against a non-zero whole), never a request to refuse.
const partRowRefsSchema = z.array(z.string().min(1)).max(MAX_CHART_POINTS);

/** Mirrors dataset-derivation-actions.ts's own private toValidatableInstruction
 * verbatim (that file's own header comment explains why this is duplicated
 * rather than imported: render.ts's private toServerShape precedent — a
 * small, ten-line "fill the server-only ChartInstruction fields a
 * ClientChartInstruction never carries" step is cheaper to duplicate than to
 * grow an already-shipped file's exported surface for one more caller). TOTAL
 * over unknown input: a malformed value falls through to
 * validateInstructionObject's own schema refusal, never throws here. */
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

export type RequestWholeVerificationResponse = { ok: true; outcome: VerifyOutcome } | { ok: false; reason?: string };

/**
 * One on-demand "does the reader's designated total match these parts?"
 * check over an own-data chart's already-computed points. Deliberately not
 * gated: like requestDatasetDerivation/renderDatasetInstruction, there is no
 * model call and nothing here costs anything beyond re-running the
 * deterministic validate -> execute -> check pipeline over already-stored
 * cells (the D12 CSV-ingest precedent).
 */
export async function requestDatasetWholeVerification(
  datasetId: number,
  rawInstruction: unknown,
  rawWholeRowRef: unknown,
  rawPartRowRefs: unknown,
): Promise<RequestWholeVerificationResponse> {
  guardPositiveInteger(datasetId, 'datasetId');

  const userId = await currentUserId();
  if (userId === null) return { ok: false };

  const wholeRowRef = wholeRowRefSchema.safeParse(rawWholeRowRef);
  if (!wholeRowRef.success) return { ok: false, reason: 'invalid selection' };
  const partRowRefs = partRowRefsSchema.safeParse(rawPartRowRefs);
  if (!partRowRefs.success) return { ok: false, reason: 'invalid selection' };

  const dataset = await getDataset(getDb(), userId, datasetId);
  if (dataset === null || dataset.status !== 'ready') {
    return { ok: false, reason: 'this dataset is not available' };
  }

  let instruction;
  try {
    instruction = validateInstructionObject(toValidatableInstruction(upgradeInstruction(rawInstruction)), dataset.profile);
  } catch (error) {
    if (error instanceof InstructionValidationError) return { ok: false, reason: 'this chart could not be validated' };
    console.error('requestDatasetWholeVerification failed:', error);
    await reportError('requestDatasetWholeVerification', error, { userId });
    return { ok: false };
  }

  try {
    const outcome = verifyDatasetWhole(dataset, instruction, wholeRowRef.data, partRowRefs.data);
    return { ok: true, outcome };
  } catch (error) {
    // NoRowsError/TooManyPointsError (executeInstruction, reached via
    // allResolvedPoints) are REACHABLE reader outcomes, not bugs —
    // requestDatasetDerivation's own catch treats them identically: `instruction`
    // is REVALIDATED against the dataset's CURRENT state, not replayed from a
    // cached result, so the underlying rows can have changed since the chart
    // was first drawn. Never reported; only a genuinely unexpected error below is.
    if (error instanceof NoRowsError) return { ok: false, reason: 'this chart no longer has any matching rows' };
    if (error instanceof TooManyPointsError) return { ok: false, reason: 'this chart has too many points' };
    console.error('requestDatasetWholeVerification failed:', error);
    await reportError('requestDatasetWholeVerification', error, { userId });
    return { ok: false };
  }
}
