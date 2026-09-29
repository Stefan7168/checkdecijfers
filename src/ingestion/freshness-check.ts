// Step 1 of the release-day procedure as ONE shared, read-only scan (#355): for every served,
// bulk-synced CBS table, CBS's own `Modified` date next to our `last_sync_at`. Used by the
// owner-run report (scripts/freshness-report.ts) AND the daily cron's new-data alert
// (web/app/api/onboarding-cron/route.ts), so both read the same rows the same way.
//
// Read-only on both sides: one SELECT on cbs_tables, and CBS Properties/Dimensions fetches
// through the adapter. No write, no AI call, no schema change.
import type { Db } from '../db/types.ts';
import type { SourceAdapter } from '../sources/adapters.ts';
import { CBS_SOURCE_KEY, sourceKeyForTableId } from '../sources/registry.ts';
import type { FreshnessInputRow } from './freshness.ts';

export interface RegisteredTableState {
  /** cbs_tables.slice, parsed (null = whole table). */
  slice: unknown;
  /** cbs_tables.schema_fingerprint, or null if the table never recorded one. */
  fingerprint: string | null;
}

export interface FreshnessScan {
  inputs: FreshnessInputRow[];
  /** Served tables this scan does not cover (non-CBS sources, e.g. Eurostat). */
  notChecked: string[];
  registered: Map<string, RegisteredTableState>;
}

/** `onReadError` fires when CBS's date for one table could not be read; that table still lands
 * in `inputs` with `cbsModifiedAt: null`, which `assessFreshness` reports as 'unknown' — never
 * as current (principle (c)). */
export async function scanFreshness(
  db: Db,
  source: SourceAdapter,
  onReadError: (tableId: string, error: unknown) => void = () => {},
): Promise<FreshnessScan> {
  const tables = await db.query(
    `select id, last_sync_at, slice, schema_fingerprint from cbs_tables
      where status = 'active' and ingest_mode = 'full' order by id`,
  );
  const inputs: FreshnessInputRow[] = [];
  const notChecked: string[] = [];
  const registered = new Map<string, RegisteredTableState>();
  for (const t of tables.rows) {
    const tableId = t.id as string;
    if (sourceKeyForTableId(tableId) !== CBS_SOURCE_KEY) {
      notChecked.push(tableId);
      continue;
    }
    registered.set(tableId, {
      slice: typeof t.slice === 'string' ? JSON.parse(t.slice) : (t.slice ?? null),
      fingerprint: (t.schema_fingerprint as string | null) ?? null,
    });
    let cbsModifiedAt: string | null = null;
    try {
      cbsModifiedAt = (await source.fetchTableSchema(tableId)).modified ?? null;
    } catch (err) {
      onReadError(tableId, err);
    }
    inputs.push({
      tableId,
      lastSyncAt: t.last_sync_at == null ? null : new Date(t.last_sync_at as string | Date).toISOString(),
      cbsModifiedAt,
    });
  }
  return { inputs, notChecked, registered };
}
