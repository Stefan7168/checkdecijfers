// Bulk-refresh the local CBS catalog mirror (cbs_catalog) from CbsSource
// (WP16 sub-part 1). Scheduled, off the request path (principle b): fetch the
// whole catalog, upsert every row, and prune rows CBS no longer lists so the
// mirror stays faithful. Metadata only — no observation cells. This is NOT the
// heavyweight 5-stage observations validation (there is no data to validate
// yet); a catalog row only becomes answerable when a specific candidate is
// later fetched through the existing register/sync pipeline (sub-part 2+).
import type { CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';

export interface CatalogIngestResult {
  /** Rows returned by CBS. */
  fetched: number;
  /** Rows inserted or updated (= fetched, on a successful refresh). */
  upserted: number;
  /** Stale rows removed (present before, absent from this refresh). */
  pruned: number;
}

const UPSERT_SQL = `
  insert into cbs_catalog
    (table_id, title, summary, status, dataset_type, language, cbs_modified, refreshed_at)
  values ($1, $2, $3, $4, $5, $6, $7, $8)
  on conflict (table_id) do update set
    title = excluded.title,
    summary = excluded.summary,
    status = excluded.status,
    dataset_type = excluded.dataset_type,
    language = excluded.language,
    cbs_modified = excluded.cbs_modified,
    refreshed_at = excluded.refreshed_at
`;

/**
 * Refreshes cbs_catalog from `source.fetchCatalog()`. Idempotent: re-running
 * updates in place and removes rows no longer published. All-or-nothing in one
 * transaction. A fetch that returns zero rows is treated as suspect and never
 * prunes the mirror to empty (fetchCatalog throws on a real failure, so zero
 * would mean CBS genuinely listed nothing — we refuse to wipe on it).
 */
export async function ingestCatalog(db: Db, source: CbsSource): Promise<CatalogIngestResult> {
  const entries = await source.fetchCatalog();
  if (entries.length === 0) {
    return { fetched: 0, upserted: 0, pruned: 0 };
  }
  return db.withTransaction(async (tx) => {
    // One DB-side timestamp for the whole batch: every upserted row gets it as
    // refreshed_at, so rows left with an older refreshed_at are exactly the
    // ones this refresh did not see and can be pruned.
    const { rows: tsRows } = await tx.query('select now() as ts');
    const batchTs = (tsRows[0] as { ts: unknown }).ts;

    for (const e of entries) {
      await tx.query(UPSERT_SQL, [
        e.tableId,
        e.title,
        e.summary,
        e.status,
        e.datasetType,
        e.language,
        e.modified,
        batchTs,
      ]);
    }

    const { rows: prunedRows } = await tx.query(
      'delete from cbs_catalog where refreshed_at < $1 returning table_id',
      [batchTs],
    );

    return { fetched: entries.length, upserted: entries.length, pruned: prunedRows.length };
  });
}
