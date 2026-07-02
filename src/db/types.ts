// Minimal database interface the ingestion pipeline is written against.
// Production: pg Pool (client.ts). Tests: PGlite (tests/helpers/pglite-db.ts) —
// CI is hermetic (no secrets, no network), so fixture tests never touch Supabase.

export interface QueryResultRow {
  [column: string]: unknown;
}

export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }>;
  /**
   * Runs fn inside a transaction; commits on resolve, rolls back on reject.
   * The Db passed to fn must be used for every statement in the transaction.
   */
  withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}
