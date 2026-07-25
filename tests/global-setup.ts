// Vitest globalSetup: build the ingested-fixture snapshot ONCE per run, before
// any worker starts, so the 34 suites that call createIngestedDb() restore it
// instead of each replaying the 17-table ingest (see fixture-snapshot.ts for
// the measurement and the isolation argument).
//
// Doing it here rather than lazily in the helper avoids a thundering herd: the
// workers are separate processes, so a first-call-builds-it scheme would have
// every worker build its own copy simultaneously the first time — precisely
// today's cost, just relocated.
//
// On a warm cache this is a hash plus a stat(), so `vitest run <one-file>` pays
// effectively nothing. If it fails, it fails QUIETLY: the helper falls back to
// building the database the old way, so a broken cache slows the suite down but
// can never change a test result.
import { ensureSnapshot } from './helpers/fixture-snapshot.ts';

export async function setup(): Promise<void> {
  const started = Date.now();
  try {
    const { path, built } = await ensureSnapshot();
    if (built) {
      console.log(`[fixture-db] snapshot built in ${Date.now() - started} ms → ${path}`);
    }
  } catch (error) {
    console.warn(
      '[fixture-db] snapshot unavailable, suites will build their own database:',
      error instanceof Error ? error.message : error,
    );
  }
}
