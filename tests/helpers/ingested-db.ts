// Fully-ingested hermetic database: register + registry defaults + sync every
// curated seed table (8 Phase 0 + the coverage-sprint set) from the committed
// fixtures into a fresh PGlite instance (ADR 009 — CI never touches Supabase).
// This is the query work package's stand-in for the live database; the
// benchmark-cell coverage of the fixtures is itself asserted by
// tests/query/benchmark-intents.test.ts.
//
// Since 2026-07-25 the ingest itself runs ONCE per `vitest run` and every
// caller restores that result instead of replaying it — measured 7.9-10.7 s
// cold versus 1.16-1.39 s restored. Each caller still receives its own private
// PGlite, so a suite that mutates its database is invisible to every other one
// (the isolation the answer-first suites depend on). The mechanism, the
// measurement and the proof of isolation live in fixture-snapshot.ts.
//
// The storage mode (whole-table vs slice-stored seed tables, ADR 065 step 6)
// comes from INGEST_FIXTURE_MODE via fixtureMode(). A suite that tests the
// whole-table storage mechanism itself passes `{ mode: 'full' }` so it keeps
// testing that mechanism whatever the run's mode is.
import {
  buildIngested,
  ensureSnapshot,
  fixtureMode,
  type FixtureMode,
  readSnapshot,
  restoreFromSnapshot,
} from './fixture-snapshot.ts';
import { wrapPGlite } from './pglite-db.ts';
import type { Db } from '../../src/db/types.ts';

export async function createIngestedDb(
  options: { mode?: FixtureMode } = {},
): Promise<{ db: Db; close(): Promise<void> }> {
  const mode = options.mode ?? fixtureMode();
  // globalSetup builds only the run's own mode; a suite pinned to the other
  // mode builds (and caches) that snapshot once instead of re-ingesting per call.
  if (mode !== fixtureMode()) await ensureSnapshot(mode).catch(() => undefined);
  // Every snapshot failure is a SLOW path, never a wrong one: a cold cache, a
  // read-only filesystem, an unreadable or half-written file, or a runner that
  // skipped globalSetup all fall back to the original build. The helper's
  // contract to its 34 callers is unchanged either way.
  const snapshot = readSnapshot(mode);
  const restored = snapshot === null ? null : await restoreFromSnapshot(snapshot);
  const client = restored ?? (await buildIngested(mode));
  await client.waitReady;
  return { db: wrapPGlite(client), close: () => client.close() };
}

/** Moves a table's data date back to `iso`, whichever way it is stored: a
 * whole-table table is dated by cbs_tables.last_sync_at, a slice-stored one by
 * the checked_at of the slices covering each cell (src/query/run.ts). Staleness
 * suites use this to force an old answer in either build mode; for a
 * whole-table table the slice_fetches update touches no row. */
export async function backdateTableSync(db: Db, tableId: string, iso: string): Promise<void> {
  await db.query('update cbs_tables set last_sync_at = $2 where id = $1', [tableId, iso]);
  await db.query('update slice_fetches set checked_at = $2 where table_id = $1', [tableId, iso]);
}

/** The registry's table for a canonical key — the lookup the #195/#196 race
 * and bump pins need (tests/query/eviction-race, last-queried). Throws when the
 * key is unknown so a wrong fixture fails loudly instead of yielding an
 * undefined table id. */
export async function tableIdForCanonicalKey(db: Db, key: string): Promise<string> {
  const { rows } = await db.query('select table_id from canonical_measures where key = $1', [key]);
  const tableId = rows[0]?.table_id as string | undefined;
  if (!tableId) throw new Error(`canonical key "${key}" not found in the registry`);
  return tableId;
}
