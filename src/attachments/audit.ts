// "Eigen data" attachments tier — writeTurn: the R8-analog "stored before
// shown" guarantee (D9), including the delete-vs-write race fix found in
// the adversarial review (session 84). Reconstruction (byte-identical
// re-derivation of `text`/`chart` from a stored turn) lands alongside
// respond.ts's template function, which both depend on — not yet built.
import type { Db } from '../db/types.ts';
import { insertDatasetTurn, lockDatasetStatus, type InsertDatasetTurnParams } from './store.ts';
import type { DatasetStatus } from './types.ts';

export class DatasetNotReadyError extends Error {
  readonly status: DatasetStatus | null;

  constructor(status: DatasetStatus | null) {
    super(`dataset is not 'ready' (status: ${status ?? '<deleted>'}) — refusing to write a turn against it`);
    this.name = 'DatasetNotReadyError';
    this.status = status;
  }
}

export type WriteTurnResult =
  | { auditId: number; datasetGone: false }
  /** The delete-vs-write race (D9, fixed in review): the dataset was
   * deleted/redacted between the caller's own pre-check (askDataset step 1)
   * and this write. NO turn is written at all in this case — writing one
   * would risk persisting plain-text `question`/`final_text` the user just
   * asked to purge, since it would be created AFTER any redaction pass
   * already ran and therefore never swept by it. The caller refunds the
   * reserved credits and returns an honest "dataset is gone" refusal with
   * no new audit row. */
  | { auditId: null; datasetGone: true }
  /** A genuine write/DB failure (not a deleted dataset) — fail-closed
   * (`persistOrFailClosed`'s CBS-side rule): a best-effort SECOND insert of
   * the SAME turn is attempted once; `auditId: null` only if that also
   * fails, in which case nothing was recorded and the caller must still
   * withhold the chart and refund. */
  | { auditId: null; datasetGone: false };

/**
 * Stored-before-shown (D9): re-checks the dataset's status as the FIRST
 * statement of its own transaction (row-locked via `FOR UPDATE`, D9's fix
 * for the delete-vs-write race — a concurrent `deleteUserDatasets` call
 * serializes against this one instead of racing it) and only then inserts
 * the turn, in the same transaction. The action returns only after this
 * resolves; a chart is never shown before its row is committed.
 */
export async function writeTurn(db: Db, params: InsertDatasetTurnParams): Promise<WriteTurnResult> {
  try {
    const auditId = await db.withTransaction(async (tx) => {
      const status = await lockDatasetStatus(tx, params.datasetId);
      if (status !== 'ready') {
        throw new DatasetNotReadyError(status);
      }
      return insertDatasetTurn(tx, params);
    });
    return { auditId, datasetGone: false };
  } catch (error) {
    if (error instanceof DatasetNotReadyError) {
      return { auditId: null, datasetGone: true };
    }
    // A genuine failure (connection blip, constraint violation on a bug,
    // etc.) — NOT a deleted dataset, so a fallback insert of the SAME turn
    // is safe (nothing to avoid re-persisting; the dataset is still real).
    try {
      const fallbackId = await insertDatasetTurn(db, params);
      return { auditId: fallbackId, datasetGone: false };
    } catch {
      return { auditId: null, datasetGone: false };
    }
  }
}
