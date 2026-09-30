// Step 1 of the release-day procedure as ONE shared, read-only scan (#355): for every served,
// bulk-synced CBS table, CBS's own `Modified` date next to our `last_sync_at`. Used by the
// owner-run report (scripts/freshness-report.ts) AND the daily cron's new-data alert
// (web/app/api/onboarding-cron/route.ts), so both read the same rows the same way.
//
// Read-only on both sides: one SELECT on cbs_tables, and CBS Properties/Dimensions fetches
// through the adapter. No write, no AI call, no schema change.
import type { CbsCatalogEntry } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import type { SourceAdapter } from '../sources/adapters.ts';
import { CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../sources/registry.ts';
import type { EurostatFreshnessInput, FreshnessInputRow } from './freshness.ts';

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
  /** Only when a Eurostat catalogue supplier was given and it worked: one row per served Eurostat
   * table, for `assessEurostatFreshness`. Absent otherwise (those tables stay in `notChecked`). */
  eurostatInputs?: EurostatFreshnessInput[];
  /** Only when the supplier was given and failed: why. The CBS part of the scan is unaffected. */
  eurostatError?: string;
}

/** `onReadError` fires when CBS's date for one table could not be read; that table still lands
 * in `inputs` with `cbsModifiedAt: null`, which `assessFreshness` reports as 'unknown' — never
 * as current (principle (c)). */
export async function scanFreshness(
  db: Db,
  source: SourceAdapter,
  onReadError: (tableId: string, error: unknown) => void = () => {},
  /** Optional: returns Eurostat's catalogue (called at most once per scan). The daily cron does
   * not pass it — its e-mail alert stays CBS-only. */
  fetchEurostatCatalog?: () => Promise<CbsCatalogEntry[]>,
): Promise<FreshnessScan> {
  const tables = await db.query(
    `select id, last_sync_at, slice, schema_fingerprint from cbs_tables
      where status = 'active' and ingest_mode = 'full' order by id`,
  );
  const inputs: FreshnessInputRow[] = [];
  const notChecked: string[] = [];
  const registered = new Map<string, RegisteredTableState>();
  const otherSources: { tableId: string; lastSyncAt: string | null }[] = [];
  for (const t of tables.rows) {
    const tableId = t.id as string;
    if (sourceKeyForTableId(tableId) !== CBS_SOURCE_KEY) {
      const lastSyncAt = t.last_sync_at == null ? null : new Date(t.last_sync_at as string | Date).toISOString();
      otherSources.push({ tableId, lastSyncAt });
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
  const scan: FreshnessScan = { inputs, notChecked, registered };
  const eurostat = otherSources.filter((t) => sourceKeyForTableId(t.tableId) === EUROSTAT_SOURCE_KEY);
  const covered = new Set<string>();
  if (fetchEurostatCatalog !== undefined) {
    try {
      const byId = new Map<string, CbsCatalogEntry>();
      if (eurostat.length > 0) {
        for (const e of await fetchEurostatCatalog()) if (!byId.has(e.tableId)) byId.set(e.tableId, e);
      }
      scan.eurostatInputs = eurostat.map((t) => ({ ...t, entry: byId.get(t.tableId) ?? null }));
      for (const t of eurostat) covered.add(t.tableId);
    } catch (err) {
      scan.eurostatError = err instanceof Error ? err.message : String(err);
    }
  }
  for (const t of otherSources) if (!covered.has(t.tableId)) notChecked.push(t.tableId);
  return scan;
}
