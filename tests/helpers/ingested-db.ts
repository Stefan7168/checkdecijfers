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
import { buildIngested, readSnapshot, restoreFromSnapshot } from './fixture-snapshot.ts';
import { wrapPGlite } from './pglite-db.ts';
import type { Db } from '../../src/db/types.ts';

export async function createIngestedDb(): Promise<{ db: Db; close(): Promise<void> }> {
  // Every snapshot failure is a SLOW path, never a wrong one: a cold cache, a
  // read-only filesystem, an unreadable or half-written file, or a runner that
  // skipped globalSetup all fall back to the original build. The helper's
  // contract to its 34 callers is unchanged either way.
  const snapshot = readSnapshot();
  const restored = snapshot === null ? null : await restoreFromSnapshot(snapshot);
  const client = restored ?? (await buildIngested());
  await client.waitReady;
  return { db: wrapPGlite(client), close: () => client.close() };
}
