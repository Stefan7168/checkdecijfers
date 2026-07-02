// Public contract of the ingestion pipeline — pinned so the pipeline, the CLI
// and the fixture tests are written against the same surface.
// Behavior spec: docs/05-data-rules.md (validation pipeline, five ordered
// checks; failures are loud, never silent; needs_review excludes a table from
// answering) and docs/07-phase0-table-set.md (slices, catalog quirks).
import type { CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import type { Phase0Table } from './registry-seed.ts';

export type FailureStage =
  | 'fetch'
  | 'schema_fingerprint'
  | 'row_plausibility'
  | 'period_parsing'
  | 'dimension_mapping'
  | 'unit_consistency';

export interface Correction {
  measure: string;
  region_code: string;
  period_code: string;
  dims: Record<string, string>;
  old_value: string | null;
  new_value: string | null;
  old_status: string;
  new_status: string;
}

export interface SyncResult {
  tableId: string;
  batchId: number;
  outcome: 'succeeded' | 'failed';
  /** Set when outcome is 'failed'. */
  failureStage?: FailureStage;
  /** Plain-language summary the owner can read; always set on failure. */
  failureSummary?: string;
  rowCount: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsMissing: number;
  /** Changed historical cells, named exactly (correction-diff log, docs/05). */
  corrections: Correction[];
  rebaselined: boolean;
}

export interface SyncOptions {
  /**
   * Reviewed acceptance of new dimension codes (e.g. municipal reorganisation):
   * new codes in fetched code lists are stored as labels instead of failing
   * the dimension-mapping check. Never the default.
   */
  acceptNewCodes?: boolean;
  /**
   * Reviewed re-baseline after a needs_review quarantine: re-measures
   * expected dimensions, units, labels and fingerprint from the live table,
   * clears needs_review, then syncs. Recorded on the batch. Never the default.
   */
  rebaseline?: boolean;
}

/**
 * Registers tables that are not yet in cbs_tables: measures schema + code
 * lists from the source (trust on first use), stores registry row + labels.
 * Idempotent: already-registered tables are left untouched.
 * Implemented in pipeline.ts as `registerTables`; returns newly registered ids.
 */
export type RegisterTablesFn = (
  db: Db,
  source: CbsSource,
  tables: Phase0Table[],
) => Promise<string[]>;

/**
 * One sync of one registered table: fetch, run the five ordered checks,
 * stage + upsert idempotently, diff corrections, record the batch.
 * On any check failure: no observation writes, batch recorded as failed with
 * stage + plain-language summary, table marked needs_review (excluded from
 * answering). Never throws on validation failure — returns the failed result;
 * throws only on infrastructure errors (db/network).
 * Implemented in pipeline.ts as `syncTable`.
 */
export type SyncTableFn = (
  db: Db,
  source: CbsSource,
  tableId: string,
  options?: SyncOptions,
) => Promise<SyncResult>;
