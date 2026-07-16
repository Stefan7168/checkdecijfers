// Fully-ingested hermetic database: register + registry defaults + sync every
// curated seed table (8 Phase 0 + the coverage-sprint set) from the committed
// fixtures into a fresh PGlite instance (ADR 009 — CI never touches Supabase).
// This is the query work package's stand-in for the live database; the
// benchmark-cell coverage of the fixtures is itself asserted by
// tests/query/benchmark-intents.test.ts.
import { fileURLToPath } from 'node:url';
import { FixtureSource, loadFixtureDocsTree } from '../../src/cbs-adapter/fixture-source.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { applyRegistryDefaults } from '../../src/registry/apply.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from './pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

export async function createIngestedDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const { db, close } = await createTestDb();
  const source = new FixtureSource(loadFixtureDocsTree(FIXTURES_DIR));
  await registerTables(db, source, SEED_TABLES);
  const applied = await applyRegistryDefaults(db);
  if (applied.tablesMissing.length > 0) {
    throw new Error(`registry defaults reference unregistered table(s): ${applied.tablesMissing.join(', ')}`);
  }
  for (const table of SEED_TABLES) {
    const result = await syncTable(db, source, table.id);
    if (result.outcome !== 'succeeded') {
      throw new Error(
        `fixture sync of ${table.id} failed at ${result.failureStage}: ${result.failureSummary}`,
      );
    }
  }
  return { db, close };
}
