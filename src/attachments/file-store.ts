// "Eigen data" attachments tier — file bytes behind a swappable interface
// (ADR 037 D4). Postgres `bytea` is the only implementation in v1: it keeps
// the GDPR delete-in-one-transaction guarantee literally true and CI
// hermetic (PGlite supports bytea), at zero new operational surface. The
// revisit trigger (>100MB stored, a second real user, or files >4MB) is a
// SupabaseStorageFileStore implementing this same interface — nothing else
// in this module needs to change when that happens.
import type { Db } from '../db/types.ts';

export interface FileStore {
  put(userId: string, datasetId: number, bytes: Uint8Array): Promise<void>;
  /** Code-review finding, session 84: scoped by userId, identically to
   * `put` — the original design sketch threaded userId through `put` only,
   * which would have been a full-file IDOR the moment a "download the
   * original file" action existed. Returns null for "doesn't exist" AND
   * "exists but belongs to someone else", same indistinguishable-on-purpose
   * contract as `store.ts`'s `getDataset`. */
  get(userId: string, datasetId: number): Promise<Uint8Array | null>;
  delete(userId: string, datasetId: number): Promise<void>;
}

export class PostgresFileStore implements FileStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async put(userId: string, datasetId: number, bytes: Uint8Array): Promise<void> {
    await this.db.query(`update user_datasets set file_bytes = $1 where id = $2 and user_id = $3`, [
      Buffer.from(bytes),
      datasetId,
      userId,
    ]);
  }

  async get(userId: string, datasetId: number): Promise<Uint8Array | null> {
    const { rows } = await this.db.query(
      `select file_bytes from user_datasets where id = $1 and user_id = $2`,
      [datasetId, userId],
    );
    const value = (rows[0] as { file_bytes: Buffer | Uint8Array | null } | undefined)?.file_bytes;
    return value ? new Uint8Array(value) : null;
  }

  /** Nulls file_bytes only — leaves the dataset row itself alone (that's
   * store.ts's job). Used both by the 90-day file-bytes retention leg
   * (retention.ts) and as the file-only piece of a full dataset redaction. */
  async delete(userId: string, datasetId: number): Promise<void> {
    await this.db.query(`update user_datasets set file_bytes = null where id = $1 and user_id = $2`, [
      datasetId,
      userId,
    ]);
  }
}
