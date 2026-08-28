// Bulk-refresh the local CBS catalog mirror (cbs_catalog) from CbsSource
// (WP16 sub-part 1). Scheduled, off the request path (principle b): fetch the
// whole catalog, upsert every row, and prune rows CBS no longer lists so the
// mirror stays faithful. Metadata only — no observation cells. This is NOT the
// heavyweight 5-stage observations validation (there is no data to validate
// yet); a catalog row only becomes answerable when a specific candidate is
// later fetched through the existing register/sync pipeline (sub-part 2+).
import type { CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { resolveSourceForTable } from '../sources/registry.ts';
import type { TableStatusFlip } from '../answer/audit/alerts.ts';

export interface CatalogIngestResult {
  /** Rows returned by CBS. */
  fetched: number;
  /** Rows inserted or updated (= fetched, on a successful refresh). */
  upserted: number;
  /** Stale rows removed (present before, absent from this refresh). */
  pruned: number;
  /** #108: REGISTERED tables (cbs_tables) whose catalog status flipped from
   * current to non-current this refresh (or vanished from the catalog
   * fetch entirely) — detection only, the caller decides whether to alert. */
  flips: TableStatusFlip[];
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
    return { fetched: 0, upserted: 0, pruned: 0, flips: [] };
  }
  return db.withTransaction(async (tx) => {
    // #108: capture each REGISTERED table's status BEFORE this refresh
    // touches cbs_catalog — the only way to detect a flip rather than just
    // the after-state. cbs_tables is small (registered tables only), so this
    // is a cheap join, not a full-catalog scan.
    const { rows: registeredRows } = await tx.query(
      `select t.id as table_id, c.status as old_status
       from cbs_tables t
       left join cbs_catalog c on c.table_id = t.id`,
    );
    const oldStatusByTableId = new Map(
      (registeredRows as { table_id: string; old_status: string | null }[]).map((r) => [
        r.table_id,
        r.old_status,
      ]),
    );

    // One DB-side timestamp for the whole batch: every upserted row gets it as
    // refreshed_at, so rows left with an older refreshed_at are exactly the
    // ones this refresh did not see and can be pruned.
    const { rows: tsRows } = await tx.query('select now() as ts');
    const batchTs = (tsRows[0] as { ts: unknown }).ts;

    const newStatusByTableId = new Map<string, string | null>();
    for (const e of entries) {
      newStatusByTableId.set(e.tableId, e.status);
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

    // #108: a REGISTERED table that WAS current (per its own source's
    // currentCatalogStatuses) and is no longer — either its status changed
    // (e.g. CBS 'Gediscontinueerd'/'Vervallen') or it vanished from this
    // fetch entirely (pruned, or CBS simply stopped listing it — both read
    // as newStatus === null here, since a pruned id is also absent from
    // newStatusByTableId). Detection only; never touches cbs_tables itself.
    const flips: TableStatusFlip[] = [];
    for (const [tableId, oldStatus] of oldStatusByTableId) {
      const wasCurrent =
        oldStatus !== null && resolveSourceForTable(tableId).currentCatalogStatuses.includes(oldStatus);
      if (!wasCurrent) continue;
      const newStatus = newStatusByTableId.get(tableId) ?? null;
      const nowCurrent =
        newStatus !== null && resolveSourceForTable(tableId).currentCatalogStatuses.includes(newStatus);
      if (!nowCurrent) flips.push({ tableId, oldStatus, newStatus });
    }

    return { fetched: entries.length, upserted: entries.length, pruned: prunedRows.length, flips };
  });
}
