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
// E2a step-5 fix round 2: `src/sources/registry.ts`'s own `nativeIdFrom` was
// exported that same round for the coverage-report fix — reused here instead
// of the local copy this file used to keep (a code-review finding: a THIRD
// private copy of the identical first-colon rule, alongside the adapter's
// own, was needless duplication once a public, pure-leaf export existed).
import { nativeIdFrom as nativeCodeFor } from '../src/sources/registry.ts';

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
  options: {
    apply?: boolean;
    log?: (line: string) => void;
    /** E2a step-5 fix round 1 (independent review finding #2): threaded
     * straight through to `registerTables`'s own `fetchImpl` — the
     * out-of-band DataCite DOI-verification call (ADR 048 D7(a)), NOT the
     * Eurostat fetch itself (that's `source`'s own injected fetch). Omitted
     * ⇒ `registerTables`'s default (the real global `fetch`) — correct for
     * the real CLI entry below; tests MUST pass a stub here (never the real
     * network, same discipline as every other registerTables call in this
     * repo). */
    fetchImpl?: typeof fetch;
  } = {},
): Promise<RegisterEurostatSiblingsResult> {
  const apply = options.apply === true;
  const log = options.log ?? console.log;

  // E2a step-5 fix round 1 (independent review finding #4): "registered" and
  // "synced at least once" are DIFFERENT facts. `last_sync_at` is set ONLY
  // by a successful `syncTable` run (src/ingestion/pipeline.ts, inside the
  // same transaction that writes observations) — an interrupted or failed
  // sync (process killed mid-run, a validation failure, a transient network
  // error) leaves the row registered but `last_sync_at` NULL forever. Before
  // this fix, a re-run saw the table already IN `cbs_tables` and skipped it
  // unconditionally — there was no recovery path short of deleting the row.
  const tableIds = EUROSTAT_SIBLING_REGISTRATIONS.map((r) => r.tableId);
  const existing = await db.query('select id, last_sync_at from cbs_tables where id = any($1)', [tableIds]);
  const registeredIds = new Set(existing.rows.map((r) => r.id as string));
  const syncedIds = new Set(existing.rows.filter((r) => r.last_sync_at !== null).map((r) => r.id as string));

  const alreadyRegistered = EUROSTAT_SIBLING_REGISTRATIONS.filter((r) => syncedIds.has(r.tableId)).map(
    (r) => r.tableId,
  );
  const needsSync = EUROSTAT_SIBLING_REGISTRATIONS.filter(
    (r) => registeredIds.has(r.tableId) && !syncedIds.has(r.tableId),
  );
  const toRegister = EUROSTAT_SIBLING_REGISTRATIONS.filter((r) => !registeredIds.has(r.tableId));

  for (const id of alreadyRegistered) {
    log(`${id}: already registered and synced — skipped.`);
  }
  for (const reg of needsSync) {
    log(`${reg.tableId}: registered but never synced successfully (last_sync_at is null) — will (re)sync.`);
  }
  for (const reg of toRegister) {
    const url = buildRequestUrl(nativeCodeFor(reg.tableId), reg.slice);
    log(`${apply ? '' : '[dry run] '}${reg.tableId}: would request ${url}`);
  }

  if (!apply) {
    const pending = toRegister.length + needsSync.length;
    log(
      pending === 0
        ? 'Nothing to register (dry run) — every reviewed sibling table is already registered and synced.'
        : `${pending} table(s) would be (re)registered/synced. Re-run with --apply to actually write them.`,
    );
    return { applied: false, alreadyRegistered, newlyRegistered: [], synced: [] };
  }

  const newlyRegistered =
    toRegister.length === 0
      ? []
      : await registerTables(
          db,
          source,
          toRegister.map((r) => ({ id: r.tableId, slice: r.slice, updateCadence: r.updateCadence, servesTasks: [] })),
          { pinned: true, fetchImpl: options.fetchImpl },
        );

  // Sync every newly-registered table AND every already-registered-but-
  // never-synced one — the recovery path finding #4 asks for.
  const tablesToSync = [...newlyRegistered, ...needsSync.map((r) => r.tableId)];
  const synced: RegisterEurostatSiblingsResult['synced'] = [];
  for (const tableId of tablesToSync) {
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
        : `${tableId}: sync FAILED — ${result.failureSummary}`,
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
