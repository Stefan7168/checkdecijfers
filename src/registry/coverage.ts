// #170(2) "make the guarantee visible": the coverage enumerator behind the
// public llms.txt. Reads what the product can ACTUALLY answer from the live
// registry (cbs_tables + canonical_measures) so the published coverage list
// is generated, never hand-maintained — a hand-written list would be the
// stale-doc bug as a public surface. Read-only; no LLM anywhere near it.
//
// Honesty rules encoded here rather than in the renderer:
//  - `lastSyncAt` is the MEASURED `cbs_tables.last_sync_at` (null when a
//    table was registered but never synced) — never a cadence promise.
//  - a `needs_review` (quarantined) table is reported with its status so the
//    renderer can EXCLUDE it from the served-coverage list: the value path
//    refuses those tables, so listing them as coverage would over-claim.
import type { Db } from '../db/types.ts';

export interface CoverageMeasure {
  key: string;
  /** The Dutch label a reader recognizes: definition_label when curated,
   * else the CBS measure title, else the bare canonical key. */
  label: string;
}

export interface CoverageTable {
  id: string;
  title: string;
  status: 'active' | 'needs_review';
  /** ISO timestamp of our last successful sync, or null if never synced. */
  lastSyncAt: string | null;
  measures: CoverageMeasure[];
}

export interface CoverageReport {
  tables: CoverageTable[];
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Enumerate the registered tables and their canonical measures, ordered
 * stably (tables by id, measures by key) so repeated renders are
 * byte-identical for unchanged registry state. */
export async function buildCoverageReport(db: Db): Promise<CoverageReport> {
  const tables = await db.query(
    `select id, title, status, last_sync_at
       from cbs_tables
      order by id`,
  );
  const measures = await db.query(
    `select key, table_id, definition_label, measure_title
       from canonical_measures
      order by key`,
  );

  const measuresByTable = new Map<string, CoverageMeasure[]>();
  for (const row of measures.rows) {
    const tableId = row.table_id as string;
    const list = measuresByTable.get(tableId) ?? [];
    list.push({
      key: row.key as string,
      label:
        (row.definition_label as string | null) ??
        (row.measure_title as string | null) ??
        (row.key as string),
    });
    measuresByTable.set(tableId, list);
  }

  return {
    tables: tables.rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      status: row.status as 'active' | 'needs_review',
      lastSyncAt: isoOrNull(row.last_sync_at),
      measures: measuresByTable.get(row.id as string) ?? [],
    })),
  };
}
