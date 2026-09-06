// "Eigen data" attachments tier — SQL for user_datasets / dataset_turns
// (migration 026). Every function binds user_id as a query PARAMETER, never
// string-interpolated — the cross-user isolation discipline
// src/threads/index.ts already established for this codebase, applied here
// (adversarial review, GDPR/cross-user lens: this is exactly the class of
// mistake that lens hunted for).
import type { Db } from '../db/types.ts';
import type { DatasetProfile, DatasetStatus, SourceKind, UserDataset } from './types.ts';

interface UserDatasetRow {
  id: string | number;
  user_id: string;
  source_kind: SourceKind;
  display_name: string;
  source_url: string | null;
  cells: string[][];
  profile: DatasetProfile;
  status: DatasetStatus;
  content_sha256: string;
  created_at: string;
}

function rowToDataset(row: UserDatasetRow): UserDataset {
  return {
    id: Number(row.id),
    userId: row.user_id,
    sourceKind: row.source_kind,
    displayName: row.display_name,
    sourceUrl: row.source_url,
    cells: row.cells,
    profile: row.profile,
    status: row.status,
    contentSha256: row.content_sha256,
    createdAt: row.created_at,
  };
}

export interface InsertDatasetParams {
  userId: string;
  sourceKind: SourceKind;
  displayName: string;
  sourceUrl: string | null;
  mimeSniffed: string;
  byteSize: number;
  contentSha256: string;
  requestId: string | null;
  fileBytes: Uint8Array | null;
  cells: string[][];
  profile: DatasetProfile;
  status: DatasetStatus;
}

/** Inserts a new dataset row. `fileBytes` goes through `FileStore.put`
 * separately (D4) — the caller wires both; this function only ever writes
 * columns that live directly on `user_datasets`, so a `bytea` write can be
 * swapped for a different `FileStore` implementation without touching this
 * function's signature. */
export async function insertDataset(db: Db, params: InsertDatasetParams): Promise<UserDataset> {
  const { rows } = await db.query(
    `insert into user_datasets
       (user_id, source_kind, display_name, source_url, mime_sniffed, byte_size,
        content_sha256, request_id, file_bytes, cells, profile, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
     returning id, user_id, source_kind, display_name, source_url, cells, profile,
               status, content_sha256, created_at`,
    [
      params.userId,
      params.sourceKind,
      params.displayName,
      params.sourceUrl,
      params.mimeSniffed,
      params.byteSize,
      params.contentSha256,
      params.requestId,
      // Code-review finding, session 84: Buffer.from(), matching
      // file-store.ts's put() exactly — the pg/PGlite driver's bytea
      // parameter handling specifically recognizes Node Buffer instances;
      // a plain Uint8Array risked silent mis-encoding on this code path,
      // which no existing test exercised with non-null bytes.
      params.fileBytes === null ? null : Buffer.from(params.fileBytes),
      JSON.stringify(params.cells),
      JSON.stringify(params.profile),
      params.status,
    ],
  );
  return rowToDataset(rows[0] as unknown as UserDatasetRow);
}

/** Ownership-bound read — the ONLY way any caller should ever fetch a
 * dataset. Returns null (never throws) for "doesn't exist" AND "exists but
 * belongs to someone else" — indistinguishable on purpose, so a caller
 * can't leak existence of another user's data via a different error path. */
export async function getDataset(db: Db, userId: string, datasetId: number): Promise<UserDataset | null> {
  const { rows } = await db.query(
    `select id, user_id, source_kind, display_name, source_url, cells, profile,
            status, content_sha256, created_at
     from user_datasets
     where id = $1 and user_id = $2`,
    [datasetId, userId],
  );
  return rows[0] ? rowToDataset(rows[0] as unknown as UserDatasetRow) : null;
}

/**
 * Resolves a `needs_decision` dataset (a numeric-format or sheet-choice
 * disambiguation, D5) into `ready` — the ONE allowed mutation window U12
 * describes ("immutable once status FIRST becomes 'ready'"): this function
 * must never be called on a dataset that is already `ready`. Bound by both
 * user_id AND the current `needs_decision` status, so a caller can't
 * resolve someone else's dataset, and can't accidentally re-mutate an
 * already-ready one (the WHERE simply matches zero rows instead).
 */
export async function resolveDatasetDecision(
  db: Db,
  userId: string,
  datasetId: number,
  cells: string[][],
  profile: DatasetProfile,
): Promise<boolean> {
  const { rows } = await db.query(
    `update user_datasets
     set cells = $1::jsonb, profile = $2::jsonb, status = 'ready'
     where id = $3 and user_id = $4 and status = 'needs_decision'
     returning id`,
    [JSON.stringify(cells), JSON.stringify(profile), datasetId, userId],
  );
  return rows.length > 0;
}

/** Marks an ingest attempt as failed (a parse error, an over-cap file,
 * etc.) — status only, no further mutation, and `failed` is itself a
 * terminal, immutable-from-here-on status (never resolves into `ready`). */
export async function markDatasetFailed(db: Db, userId: string, datasetId: number): Promise<void> {
  await db.query(`update user_datasets set status = 'failed' where id = $1 and user_id = $2`, [
    datasetId,
    userId,
  ]);
}

/** Quota accounting (D12/§4: MAX_DATASETS_PER_USER, MAX_TOTAL_BYTES_PER_USER)
 * — counts/sums only non-redacted rows via the partial index migration 026
 * created for exactly this query. */
export async function activeDatasetUsage(
  db: Db,
  userId: string,
): Promise<{ count: number; totalBytes: number }> {
  const { rows } = await db.query(
    `select count(*)::int as count, coalesce(sum(byte_size), 0)::bigint as total_bytes
     from user_datasets
     where user_id = $1 and status <> 'redacted'`,
    [userId],
  );
  const row = rows[0] as { count: number; total_bytes: string | number } | undefined;
  return { count: Number(row?.count ?? 0), totalBytes: Number(row?.total_bytes ?? 0) };
}

export interface InsertDatasetTurnParams {
  userId: string;
  datasetId: number;
  threadId: number;
  requestId: string;
  kind: 'chart' | 'clarification' | 'refusal';
  question: string;
  envelope: unknown;
  finalText: string;
  instruction: unknown | null;
  chartEmitted: boolean;
  promptVersions: Record<string, number>;
  llmCalls: unknown[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** Raw insert only — no transaction/race-condition handling here (that's
 * audit.ts's job, calling this from inside its own `db.withTransaction`).
 * Kept separate so the SQL shape and the fail-closed orchestration around
 * it can be tested/reasoned about independently. */
export async function insertDatasetTurn(db: Db, params: InsertDatasetTurnParams): Promise<number> {
  const { rows } = await db.query(
    `insert into dataset_turns
       (user_id, dataset_id, thread_id, request_id, kind, question, envelope, final_text,
        instruction, chart_emitted, prompt_versions, llm_calls, input_tokens, output_tokens, latency_ms)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13, $14, $15)
     returning id`,
    [
      params.userId,
      params.datasetId,
      params.threadId,
      params.requestId,
      params.kind,
      params.question,
      JSON.stringify(params.envelope),
      params.finalText,
      params.instruction === null ? null : JSON.stringify(params.instruction),
      params.chartEmitted,
      JSON.stringify(params.promptVersions),
      JSON.stringify(params.llmCalls),
      params.inputTokens,
      params.outputTokens,
      params.latencyMs,
    ],
  );
  return Number((rows[0] as { id: string | number }).id);
}

/** The status re-check `writeTurn` (audit.ts) runs as the FIRST statement of
 * its own transaction, immediately followed by the insert above, both
 * inside the same `db.withTransaction` call — the delete-vs-write race fix
 * (D9, "fixed in review"). `FOR UPDATE` takes the row lock so a concurrent
 * delete transaction serializes against this one rather than racing it. */
export async function lockDatasetStatus(db: Db, datasetId: number): Promise<DatasetStatus | null> {
  const { rows } = await db.query(`select status from user_datasets where id = $1 for update`, [
    datasetId,
  ]);
  return rows[0] ? (rows[0] as { status: DatasetStatus }).status : null;
}
