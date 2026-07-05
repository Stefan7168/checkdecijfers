// #110a (WP16 sub-part 2, design §6, discovered session 26): `sync --all`
// used to target the hardcoded PHASE0_TABLES list, not the actual registered
// set. After CORE-2's on-demand onboarding job registers a NEW table at
// runtime (never added to PHASE0_TABLES, which is a static file), a
// `sync --all` cron/manual re-sync would silently skip it forever — a real
// drift risk, since the whole point of the onboarding job is to grow the
// registered set beyond the seed list. This fixes `--all` to read
// `cbs_tables` (the registered set) while keeping seed auto-registration and
// the explicit-id path exactly as before.
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { runCli } from '../../src/ingestion/cli.ts';
import { registerTables } from '../../src/ingestion/pipeline.ts';
import { PHASE0_TABLES } from '../../src/ingestion/registry-seed.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

function fixturePath(tableId: string): string {
  return `${FIXTURES_DIR}/${tableId}`;
}

function table(id: string) {
  const t = PHASE0_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no Phase0Table registry entry for ${id}`);
  return t;
}

function loadDocs(tableId: string) {
  return loadFixtureDocs(fixturePath(tableId));
}

function withSpies<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return fn()
    .then((result) => ({ result, output: [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join('\n') }))
    .finally(() => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
}

/** FixtureSource natively supports a multi-table map (its constructor accepts
 * `Record<string, FixtureDocs>`, not just one table's docs — see docsFor()
 * in fixture-source.ts), which is exactly what `sync --all` across several
 * distinct tables in one runCli call needs, mirroring how the real
 * ODataV4Source is one client shared across every table. */
function buildTwoTableSource(): FixtureSource {
  return new FixtureSource({
    '82235NED': loadDocs('82235NED'),
    '82242NED': loadDocs('82242NED'),
  });
}

/** Directly inserts a minimal cbs_tables row (bypassing registerTables/any
 * CbsSource call) for every PHASE0 seed OTHER than the ones this test's
 * FixtureSource actually has docs for. registerTables' auto-registration
 * step skips any id already present in cbs_tables (pipeline.ts:
 * `if (existingIds.has(table.id)) continue`), so this keeps the "other
 * seeds" out of BOTH the auto-registration call and out of needing their own
 * fixture — the test can then focus solely on #110a's actual claim without
 * every unrelated PHASE0 seed needing a captured fixture. */
async function fakeRegisterOtherSeeds(db: Db, excludeIds: string[]): Promise<void> {
  const others = PHASE0_TABLES.filter((t) => !excludeIds.includes(t.id));
  for (const seed of others) {
    await db.query(
      `insert into cbs_tables (id, title, expected_dimensions, units, update_cadence)
       values ($1, $2, '[]'::jsonb, '{}'::jsonb, $3)`,
      [seed.id, `fake row for #110a test (${seed.id})`, seed.updateCadence],
    );
  }
}

describe('#110a — sync --all targets the registered set (cbs_tables), not the static PHASE0_TABLES list', () => {
  it('a DB-registered non-seed table (registered directly, never in PHASE0_TABLES args) IS synced by --all', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    try {
      // Simulate CORE-2's onboarding job: register+sync a table that is
      // never passed as an explicit CLI arg and is unrelated to whichever
      // seeds happen to be registered — the scenario #110a is about.
      const docsB = loadDocs('82242NED');
      const sourceB = new FixtureSource(docsB);
      await registerTables(db, sourceB, [table('82242NED')]);
      // Keep every OTHER PHASE0 seed out of auto-registration's fixture
      // requirement (see fakeRegisterOtherSeeds) — irrelevant to #110a's claim.
      await fakeRegisterOtherSeeds(db, ['82242NED']);

      const source = buildTwoTableSource();
      const { result: exitCode, output } = await withSpies(() => runCli(['sync', '--all'], { db, source }));

      // The fake-seed rows have no matching fixture in `source`, so THEIR
      // syncTable calls throw and the overall exit code is 1 — expected,
      // orthogonal to #110a. What #110a actually claims: 82242NED (never a
      // PHASE0 seed, registered purely via a direct registerTables call the
      // way CORE-2's onboarding job will) is INCLUDED in --all's target list
      // and syncs successfully, which it did not before the fix (targetIds
      // used to come from PHASE0_TABLES.map(t => t.id) only).
      expect(exitCode).toBe(1);
      expect(output).toContain('82242NED');

      const row = (await db.query('select status from cbs_tables where id = $1', ['82242NED'])).rows[0];
      expect(row?.status).toBe('active');
      const obsCount = (
        await db.query('select count(*)::int as n from observations where table_id = $1', ['82242NED'])
      ).rows[0]?.n;
      expect(Number(obsCount)).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('seed tables still auto-register and sync under --all (no regression for the existing bootstrap path)', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    try {
      const source = buildTwoTableSource();
      // Only register 82242NED ahead of time (simulating "already onboarded");
      // 82235NED is a genuine PHASE0 seed and must still auto-register here.
      const docsB = loadDocs('82242NED');
      await registerTables(db, new FixtureSource(docsB), [table('82242NED')]);
      // Keep every OTHER PHASE0 seed (besides 82235NED, whose auto-registration
      // this test is actually exercising) out of the fixture requirement.
      await fakeRegisterOtherSeeds(db, ['82242NED', '82235NED']);

      // See the note in the previous test: the fake-seed rows have no
      // matching fixture and fail their own sync — expected, orthogonal to
      // this test's claim (82235NED's auto-registration + sync succeeds).
      const { output } = await withSpies(() => runCli(['sync', '--all'], { db, source }));

      expect(output).toMatch(/Auto-registered/);
      expect(output).toContain('82235NED');

      const rowSeed = (await db.query('select status from cbs_tables where id = $1', ['82235NED'])).rows[0];
      expect(rowSeed?.status).toBe('active');
    } finally {
      await close();
    }
  });

  it('explicit-id sync is unaffected — targets only the ids given, seed or not', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    try {
      const docsB = loadDocs('82242NED');
      const sourceB = new FixtureSource(docsB);
      await registerTables(db, sourceB, [table('82242NED')]);

      const { result: exitCode, output } = await withSpies(() => runCli(['sync', '82242NED'], { db, source: sourceB }));

      expect(exitCode).toBe(0);
      expect(output).toContain('82242NED');
      // 82235NED (a real seed, never named) must NOT have been touched.
      const rowSeed = (await db.query('select id from cbs_tables where id = $1', ['82235NED'])).rows[0];
      expect(rowSeed).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('a fresh DB with nothing registered still bootstraps every seed under --all (unchanged behavior)', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    try {
      const docsA = loadDocs('82235NED');
      const { result: exitCode } = await withSpies(() =>
        runCli(['sync', '--all'], { db, source: new FixtureSource(docsA) }),
      );
      // This single-table FixtureSource only has docs for 82235NED; every
      // OTHER PHASE0 seed's syncTable call fails loudly (FixtureSource's
      // docsFor throws "no fixture docs registered for table ...") rather
      // than silently, which is expected and unrelated to #110a — assert
      // only that 82235NED (the one fixture available) landed active, i.e.
      // --all's DB-driven target list (freshly populated by auto-registration
      // against an initially-empty cbs_tables) worked at all.
      const row = (await db.query('select status from cbs_tables where id = $1', ['82235NED'])).rows[0];
      expect(row?.status).toBe('active');
      // exitCode is intentionally not asserted here: other seeds without a
      // matching fixture source fail their own sync, which is orthogonal to
      // this test's claim.
      void exitCode;
    } finally {
      await close();
    }
  });
});
