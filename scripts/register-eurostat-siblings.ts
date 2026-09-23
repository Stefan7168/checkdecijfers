// E2a step 5 (owner step, docs/RUNBOOK.md "E2a step 5 — register the
// Eurostat sibling tables"): registers + syncs the three reviewed Eurostat
// sibling tables (src/sources/eurostat-siblings.ts's
// `EUROSTAT_SIBLING_REGISTRATIONS`) through the SAME source-agnostic
// `registerTables`/`syncTable` pipeline the first real Eurostat table
// (`eurostat:tipsbd30`) used — via `adapterFor('eurostat')`, mirroring
// docs/RUNBOOK.md's "WP30c E1" entry, this time as a COMMITTED, reusable
// script instead of a one-off.
//
// DRY RUN BY DEFAULT: prints what it would register (each table's slice and
// the EXACT request URL the adapter would send, from the same
// `buildRequestUrl` the adapter itself uses — never a hand-built second
// copy) and writes NOTHING: no `registerTables`/`syncTable` call, no
// database write, no network call. Pass `--apply` to actually register +
// sync every reviewed table that isn't registered yet. Idempotent: a table
// already in `cbs_tables` is reported (not re-registered) either way, dry
// run or --apply, matching `registerTables`'s own "already-registered rows
// are left untouched" contract.
//
// Registered PINNED (eviction-exempt), like the curated Phase-0 seed set
// (`docs/RUNBOOK.md`'s pinned-boolean note) — these are reviewed, permanent
// sibling pairs, not an on-demand-onboarding TTL cache entry.
//
// Usage:
//   node --env-file=.env scripts/register-eurostat-siblings.ts            (dry run)
//   node --env-file=.env scripts/register-eurostat-siblings.ts --apply    (writes)
import type { Db } from '../src/db/types.ts';
import type { CbsSource } from '../src/cbs-adapter/types.ts';
import { registerTables, syncTable } from '../src/ingestion/pipeline.ts';
import { buildRequestUrl } from '../src/eurostat-adapter/statistics-api.ts';
import { EUROSTAT_SIBLING_REGISTRATIONS } from '../src/sources/eurostat-siblings.ts';

/** D4's own first-colon rule (statistics-api.ts's `nativeIdFrom`), copied
 * locally rather than imported — the same "a local copy of the same
 * first-colon rule every other module in this source's family implements
 * independently" pattern that function's own doc comment describes. */
function nativeCodeFor(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
}

export interface RegisterEurostatSiblingsResult {
  applied: boolean;
  alreadyRegistered: string[];
  newlyRegistered: string[];
  synced: { tableId: string; outcome: 'succeeded' | 'failed'; rowCount: number; failureSummary?: string }[];
}

/**
 * Core logic, dependency-injected (`db`/`source`) so it can be exercised
 * hermetically — a stubbed `CbsSource` over a PGlite `db`, never the real
 * network or a live database (tests/eurostat-adapter/register-eurostat-
 * siblings.test.ts). The CLI entry below is the only caller that connects to
 * anything real.
 */
export async function registerEurostatSiblings(
  db: Db,
  source: CbsSource,
  options: { apply?: boolean; log?: (line: string) => void } = {},
): Promise<RegisterEurostatSiblingsResult> {
  const apply = options.apply === true;
  const log = options.log ?? console.log;

  const tableIds = EUROSTAT_SIBLING_REGISTRATIONS.map((r) => r.tableId);
  const existing = await db.query('select id from cbs_tables where id = any($1)', [tableIds]);
  const existingIds = new Set(existing.rows.map((r) => r.id as string));

  const alreadyRegistered = EUROSTAT_SIBLING_REGISTRATIONS.filter((r) => existingIds.has(r.tableId)).map(
    (r) => r.tableId,
  );
  const toRegister = EUROSTAT_SIBLING_REGISTRATIONS.filter((r) => !existingIds.has(r.tableId));

  for (const id of alreadyRegistered) {
    log(`${id}: already registered — skipped.`);
  }
  for (const reg of toRegister) {
    const url = buildRequestUrl(nativeCodeFor(reg.tableId), reg.slice);
    log(`${apply ? '' : '[dry run] '}${reg.tableId}: would request ${url}`);
  }

  if (!apply) {
    log(
      toRegister.length === 0
        ? 'Nothing to register (dry run) — every reviewed sibling table is already registered.'
        : `${toRegister.length} table(s) would be registered + synced. Re-run with --apply to actually write them.`,
    );
    return { applied: false, alreadyRegistered, newlyRegistered: [], synced: [] };
  }

  if (toRegister.length === 0) {
    return { applied: true, alreadyRegistered, newlyRegistered: [], synced: [] };
  }

  const newlyRegistered = await registerTables(
    db,
    source,
    toRegister.map((r) => ({ id: r.tableId, slice: r.slice, updateCadence: r.updateCadence, servesTasks: [] })),
    { pinned: true },
  );

  const synced: RegisterEurostatSiblingsResult['synced'] = [];
  for (const tableId of newlyRegistered) {
    const result = await syncTable(db, source, tableId);
    synced.push({
      tableId,
      outcome: result.outcome,
      rowCount: result.rowCount,
      ...(result.failureSummary !== undefined ? { failureSummary: result.failureSummary } : {}),
    });
    log(
      result.outcome === 'succeeded'
        ? `${tableId}: registered + synced, ${result.rowCount} row(s).`
        : `${tableId}: registered but sync FAILED — ${result.failureSummary}`,
    );
  }

  return { applied: true, alreadyRegistered, newlyRegistered, synced };
}

// CLI entry: node --env-file=.env scripts/register-eurostat-siblings.ts [--apply]
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const apply = process.argv.includes('--apply');
  const { connectFromEnv } = await import('../src/db/client.ts');
  const { adapterFor } = await import('../src/sources/adapters.ts');
  const { EUROSTAT_SOURCE_KEY } = await import('../src/sources/registry.ts');
  const { db, pool } = connectFromEnv();
  try {
    await registerEurostatSiblings(db, adapterFor(EUROSTAT_SOURCE_KEY), { apply });
  } finally {
    await pool.end();
  }
}
