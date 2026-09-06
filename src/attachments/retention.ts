// "Eigen data" attachments tier — GDPR retention (ADR 037 D13). Both
// `user_datasets` and `dataset_turns` are personal data from their first
// commit (ADR 033's own rule), and uploaded files may contain THIRD
// PARTIES' personal data too (a journalist's spreadsheet of names).
//
// Deliberate deviation from the original design draft, recorded here
// rather than silently done: D13 said the dataset leg would run "in the
// same transaction" as the CBS-side `redactMatchingRows`
// (src/answer/audit/retention.ts). This module runs as its OWN, separate
// transaction instead — genericizing `redactMatchingRows` to accept this
// as a third kind of leg would mean changing the signature of an already
// heavily-tested, security-sensitive shared function with several existing
// callers, for a feature not yet live. The accepted trade-off: a crash
// between the CBS-side call and this one could leave one done and the
// other not — mitigated by both being idempotent (a retry/re-click
// completes whichever half didn't finish), and NOT a privacy hole (nothing
// is exposed either way, just not-yet-deleted). Revisit if/when this
// module's own call volume justifies the shared-transaction refactor.
import type { Db } from '../db/types.ts';
import { twoYearsBefore } from '../answer/audit/retention.ts';
import { redactedDatasetEnvelope, REDACTED_DATASET_TEXT, type DatasetProfile } from './types.ts';
import { FILE_BYTES_RETENTION_DAYS } from './limits.ts';

export const REDACTED_DISPLAY_NAME = 'Verwijderd bestand' as const;

/** Code-review finding, session 84: the redacted profile sentinel must be a
 * REAL, type-valid DatasetProfile ({columns: [], rowCount: 0}), never a
 * bare '{}' — a bare empty object is not assignable to DatasetProfile
 * (which requires both fields) and would throw the moment any future
 * reader touches `.columns`/`.rowCount` on a redacted dataset without
 * checking `status === 'redacted'` first. This value is both empty (no
 * real content survives) and safe to read structurally. */
const REDACTED_PROFILE: DatasetProfile = { columns: [], rowCount: 0 };

/** The two-year window for `cells`/`profile`/turns — the SAME #14 account
 * window CBS question history uses (ADR 037 §8 Q2), re-exported here so
 * callers (the purge job/CLI) don't need to import from the CBS retention
 * module just for a date helper. */
export { twoYearsBefore };

/** The shorter, 90-day window for raw `file_bytes` only (ADR 037 §8 Q2,
 * D13's "retention without purpose" reasoning: bytes serve
 * re-extraction/download, not the chart record itself). */
export function fileBytesCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - FILE_BYTES_RETENTION_DAYS);
  return cutoff;
}

interface RedactedCounts {
  datasets: number;
  turns: number;
}

/** Redacts every dataset_turns row for the given dataset ids, in the SAME
 * transaction as the caller. Fixed in review (D13): the original draft
 * named only the envelope sentinel; `question`/`final_text` are REAL
 * top-level columns (per migration 026) that need their own explicit
 * redaction, matching src/answer/audit/retention.ts's own `redactedResponse`
 * precedent of clearing every free-text column, not just one. */
async function redactTurnsForDatasets(tx: Db, datasetIds: number[]): Promise<number> {
  if (datasetIds.length === 0) return 0;
  const { rows } = await tx.query(
    `select id, kind from dataset_turns where dataset_id = any($1::bigint[])`,
    [datasetIds],
  );
  for (const row of rows) {
    const kind = (row as { kind: 'chart' | 'clarification' | 'refusal' }).kind;
    await tx.query(
      `update dataset_turns
       set question = $1, final_text = $1, envelope = $2::jsonb, instruction = null
       where id = $3`,
      [REDACTED_DATASET_TEXT, JSON.stringify(redactedDatasetEnvelope(kind)), (row as { id: number }).id],
    );
  }
  return rows.length;
}

/** Full redaction of one or more user_datasets rows (by id) — the D13
 * column list, unchanged: file_bytes/cells/profile/extraction nulled,
 * display_name/source_url replaced, status set to 'redacted'. Row KEPT
 * (never a hard delete) — the thread FK and quota history stay consistent,
 * matching src/answer/audit/retention.ts's redact-not-delete posture. */
async function redactDatasets(tx: Db, datasetIds: number[]): Promise<number> {
  if (datasetIds.length === 0) return 0;
  const { rows } = await tx.query(
    `update user_datasets
     set file_bytes = null, cells = '[]'::jsonb, profile = $1::jsonb, extraction = null,
         display_name = $2, source_url = null, status = 'redacted', redacted_at = now()
     where id = any($3::bigint[])
     returning id`,
    [JSON.stringify(REDACTED_PROFILE), REDACTED_DISPLAY_NAME, datasetIds],
  );
  return rows.length;
}

/**
 * Self-service deletion — every dataset belonging to THIS user (any age,
 * any status), plus every dataset_turns row that references them, in ONE
 * transaction. THE CRITICAL SECURITY SCOPE: bound by user_id as a
 * parameter, no dynamic SQL — no code path here can touch another user's
 * rows. Idempotent: redacting an already-redacted dataset is a harmless
 * no-op (same target values written again).
 */
export async function deleteUserDatasets(db: Db, userId: string): Promise<RedactedCounts> {
  return db.withTransaction(async (tx) => {
    const { rows } = await tx.query(`select id from user_datasets where user_id = $1 for update`, [
      userId,
    ]);
    const datasetIds = rows.map((r) => Number((r as { id: number | string }).id));
    const turns = await redactTurnsForDatasets(tx, datasetIds);
    const datasets = await redactDatasets(tx, datasetIds);
    return { datasets, turns };
  });
}

/**
 * Per-dataset deletion ("Verwijder dit bestand", ADR 037 §8 Q3, decided
 * yes for v1) — the same leg, scoped to ONE dataset AND bound by user_id,
 * so a caller cannot delete another user's dataset by id alone. Returns
 * false (no-op) if the dataset doesn't exist or belongs to someone else —
 * same indistinguishable-on-purpose contract as `store.ts`'s `getDataset`.
 */
export async function deleteOneDataset(db: Db, userId: string, datasetId: number): Promise<boolean> {
  return db.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `select id from user_datasets where id = $1 and user_id = $2 for update`,
      [datasetId, userId],
    );
    if (rows.length === 0) return false;
    await redactTurnsForDatasets(tx, [datasetId]);
    await redactDatasets(tx, [datasetId]);
    return true;
  });
}

export interface PurgeExpiredDatasetsSummary {
  /** Full redactions: datasets whose `created_at` is older than `cellsCutoff`. */
  datasets: number;
  turns: number;
  /** File-bytes-only clears: datasets NOT yet fully redacted above, but
   * older than `filesCutoff` (the shorter 90-day window). */
  fileBytesCleared: number;
}

/**
 * Age-based purge (the retention-job/CLI leg) — two separate cutoffs, per
 * ADR 037 §8 Q2: `cellsCutoff` (2 years, matching #14) fully redacts a
 * dataset and its turns; `filesCutoff` (90 days) clears ONLY `file_bytes`
 * on datasets not yet old enough for the full redaction. A dataset caught
 * by the 2-year cutoff is fully redacted (file_bytes included) via the
 * first leg — the second leg's `where` excludes anything the first leg
 * already touched, so the two counts never double-count the same row.
 * Both Dates are injected (never `new Date()` inside), matching this
 * codebase's reference-clock testing discipline.
 */
/** Code-review finding, session 84: thrown when the second (file-bytes-only)
 * leg fails AFTER the first leg's transaction already committed real work —
 * carries that already-committed `partial` summary so the caller (the
 * purge job/CLI) never loses visibility into what succeeded, matching
 * WP202a's own "carry-what-committed on partial failure" done-definition
 * criterion instead of just losing the counts when the error propagates. */
export class PartialPurgeError extends Error {
  readonly partial: PurgeExpiredDatasetsSummary;
  readonly cause: unknown;

  constructor(partial: Omit<PurgeExpiredDatasetsSummary, 'fileBytesCleared'>, cause: unknown) {
    super(
      `dataset purge: the full-redaction leg committed (${partial.datasets} dataset(s), ` +
        `${partial.turns} turn(s)) but the file-bytes-only leg failed: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'PartialPurgeError';
    this.partial = { ...partial, fileBytesCleared: 0 };
    this.cause = cause;
  }
}

export async function purgeExpiredDatasets(
  db: Db,
  cellsCutoff: Date,
  filesCutoff: Date,
): Promise<PurgeExpiredDatasetsSummary> {
  const cellsCutoffIso = cellsCutoff.toISOString();
  const filesCutoffIso = filesCutoff.toISOString();

  const { datasets, turns } = await db.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `select id from user_datasets
       where status <> 'redacted' and created_at < $1
       for update`,
      [cellsCutoffIso],
    );
    const expiredIds = rows.map((r) => Number((r as { id: number | string }).id));
    const turnCount = await redactTurnsForDatasets(tx, expiredIds);
    const datasetCount = await redactDatasets(tx, expiredIds);
    return { datasets: datasetCount, turns: turnCount };
  });

  try {
    const { rows: fileRows } = await db.query(
      `update user_datasets
       set file_bytes = null
       where status <> 'redacted' and file_bytes is not null and created_at < $1
       returning id`,
      [filesCutoffIso],
    );
    return { datasets, turns, fileBytesCleared: fileRows.length };
  } catch (error) {
    throw new PartialPurgeError({ datasets, turns }, error);
  }
}

/** ⟨F2⟩-style dry-run preview, counted from the EXACT same predicates the
 * purge itself uses, so a read-only preview can never drift from what
 * `--apply` actually does. */
export async function countPurgeableDatasets(
  db: Db,
  cellsCutoff: Date,
  filesCutoff: Date,
): Promise<{ datasets: number; fileBytesOnly: number }> {
  const { rows: full } = await db.query(
    `select count(*)::int as n from user_datasets where status <> 'redacted' and created_at < $1`,
    [cellsCutoff.toISOString()],
  );
  const { rows: files } = await db.query(
    `select count(*)::int as n from user_datasets
     where status <> 'redacted' and file_bytes is not null and created_at < $1`,
    [filesCutoff.toISOString()],
  );
  return {
    datasets: Number((full[0] as { n: number } | undefined)?.n ?? 0),
    fileBytesOnly: Number((files[0] as { n: number } | undefined)?.n ?? 0),
  };
}
