// Shared reset helper for the "boot the DB once per file, TRUNCATE-reset per
// test" pattern (#245 Action 3, session 110 — generalizes the ledger.test.ts /
// ingestion.test.ts fix from Action 1; see
// docs/session-briefs/2026-09-13-build-performance-diagnosis.md).
//
// Measured in that diagnosis: booting a fresh PGlite instance costs
// 2.4-3.7s regardless of migration-replay cost, while TRUNCATE-resetting an
// already-booted instance costs 32-44ms -- a 60-100x difference. Any file
// that used to call createTestDb() once per test (via a literal beforeEach,
// or a per-test `withDb`/`withPricedDb`-style helper invoked from every
// it()) pays the boot cost N times; this helper pays it once per file
// (beforeAll) and resets between tests instead.
//
// Reset strategy: TRUNCATE every user table in the public schema except
// schema_migrations (derived once per db instance via pg_tables, cached),
// then re-insert the rows migrations themselves seed as part of table
// creation -- NOT test fixtures -- so a reset reproduces a freshly-migrated
// database exactly, the same starting state a brand-new createTestDb() per
// test would have given. A file whose tests need OTHER pre-seeded state
// (e.g. via registerTables()/ingestCatalog()/applyPricingDefaults()) must
// redo that setup in its own beforeEach, exactly as it already had to when
// getting a truly fresh createTestDb() per test -- resetTestDb() only
// guarantees "as empty as a fresh migration", not "as populated as your
// fixture".
import type { Db } from '../../src/db/types.ts';

/** Rows migrations insert as part of table creation (schema, not test data)
 * that a TRUNCATE must restore to keep "freshly reset" equivalent to
 * "freshly migrated". Keyed by table name.
 *  - signup_grant_config (migration 005): singleton, credits=100.
 *  - trial_pot_config (migration 020): singleton, remaining_questions=0, cap=0. */
const MIGRATION_SEED_ROWS: Record<string, string> = {
  signup_grant_config: 'insert into signup_grant_config (credits) values (100)',
  trial_pot_config: 'insert into trial_pot_config (remaining_questions, cap) values (0, 0)',
};

// Keyed by db instance (not global) so different files' PGlite instances --
// possibly with different migration sets applied, e.g. a partial-migration
// test -- never share a cached table list.
const tableListCache = new WeakMap<Db, string[]>();

async function userTables(db: Db): Promise<string[]> {
  const cached = tableListCache.get(db);
  if (cached) return cached;
  const { rows } = await db.query(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`,
  );
  const tables = rows.map((row) => row.tablename as string);
  tableListCache.set(db, tables);
  return tables;
}

/**
 * TRUNCATEs the given db's tables (every user table by default) back to the
 * state a fresh createTestDb() would be in: empty, identity sequences
 * restarted, migration-seeded singleton rows re-inserted. Safe against the
 * append-only trigger on credit_transactions (BEFORE UPDATE OR DELETE,
 * migration 005) -- TRUNCATE bypasses row-level triggers by design.
 *
 * Pass `tables` to restrict the reset to a subset -- only when a file
 * deliberately wants to preserve some cross-test state (rare); prefer the
 * default (every table) so a reset is indistinguishable from a fresh boot.
 */
export async function resetTestDb(db: Db, opts?: { tables?: string[] }): Promise<void> {
  const tables = opts?.tables ?? (await userTables(db));
  if (tables.length === 0) return;
  await db.query(`truncate table ${tables.map((t) => `"${t}"`).join(', ')} restart identity cascade`);
  for (const table of tables) {
    const seed = MIGRATION_SEED_ROWS[table];
    if (seed) await db.query(seed);
  }
}
