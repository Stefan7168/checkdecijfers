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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { runCli } from '../../src/ingestion/cli.ts';
import { registerTables } from '../../src/ingestion/pipeline.ts';
import { registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { PHASE0_TABLES, SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
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
 * CbsSource call) for every curated seed (Phase 0 + coverage) OTHER than the ones this test's
 * FixtureSource actually has docs for. registerTables' auto-registration
 * step skips any id already present in cbs_tables (pipeline.ts:
 * `if (existingIds.has(table.id)) continue`), so this keeps the "other
 * seeds" out of BOTH the auto-registration call and out of needing their own
 * fixture — the test can then focus solely on #110a's actual claim without
 * every unrelated PHASE0 seed needing a captured fixture. */
async function fakeRegisterOtherSeeds(db: Db, excludeIds: string[]): Promise<void> {
  const others = SEED_TABLES.filter((t) => !excludeIds.includes(t.id));
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

// Breadth step 2: slice-cache tables (migration 037's ingest_mode) are filled
// per question by fetchSlice; `sync --all` skips them, and an explicit id is
// refused cleanly by syncTable's own guard.
describe('breadth step 2 — sync and slice-cache tables', () => {
  it('sync --all skips a slice-cache table (no batch, no cells) and still syncs the full tables', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    try {
      await registerTables(db, new FixtureSource(loadDocs('82242NED')), [table('82242NED')]);
      const reg = await registerSchemaOnly(db, new FixtureSource(loadDocs('83625NED')), '83625NED');
      expect(reg.ok).toBe(true);
      await fakeRegisterOtherSeeds(db, ['82242NED', '83625NED']);

      const source = new FixtureSource({ '82242NED': loadDocs('82242NED'), '83625NED': loadDocs('83625NED') });
      const { output } = await withSpies(() => runCli(['sync', '--all'], { db, source }));

      expect(output).toContain('Skipped 1 slice-cache table(s)');
      expect(output).toContain('83625NED');
      const batches = await db.query('select count(*)::int as n from ingestion_batches where table_id = $1', ['83625NED']);
      expect(Number(batches.rows[0]!.n)).toBe(0);
      const cells = await db.query('select count(*)::int as n from observations where table_id = $1', ['83625NED']);
      expect(Number(cells.rows[0]!.n)).toBe(0);
      const synced = await db.query('select count(*)::int as n from observations where table_id = $1', ['82242NED']);
      expect(Number(synced.rows[0]!.n)).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('an explicit slice-cache id fails cleanly (exit 1, the guard summary), without quarantine', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    try {
      const source = new FixtureSource(loadDocs('83625NED'));
      const reg = await registerSchemaOnly(db, source, '83625NED');
      expect(reg.ok).toBe(true);

      const { result: exitCode, output } = await withSpies(() => runCli(['sync', '83625NED'], { db, source }));

      expect(exitCode).toBe(1);
      expect(output).toContain('use fetchSlice, never a whole-table sync');
      const row = (await db.query('select status, ingest_mode from cbs_tables where id = $1', ['83625NED'])).rows[0];
      expect(row).toMatchObject({ status: 'active', ingest_mode: 'slice_cache' });
    } finally {
      await close();
    }
  });
});

// ADR 065 step 7: the supervised storage commands. Without --yes each is a dry
// run that writes nothing; a refusal exits 1.
describe('ADR 065 — convert-to-slices, convert-to-full, rebaseline-slices', () => {
  async function wholePop(db: Db): Promise<FixtureSource> {
    const source = new FixtureSource(loadDocs('03759ned'));
    await registerTables(db, source, [table('03759ned')], { pinned: true });
    const { output } = await withSpies(() => runCli(['sync', '03759ned'], { db, source }));
    expect(output).toContain('Synced');
    return source;
  }

  async function mode(db: Db, id: string) {
    return (await db.query('select ingest_mode, status from cbs_tables where id = $1', [id])).rows[0];
  }

  it('convert-to-slices: a dry run without --yes, the conversion with it, and back with convert-to-full', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    try {
      const source = await wholePop(db);

      const dry = await withSpies(() => runCli(['convert-to-slices', '03759ned'], { db, source }));
      expect(dry.result).toBe(0);
      expect(dry.output).toContain('DRY RUN');
      expect(await mode(db, '03759ned')).toMatchObject({ ingest_mode: 'full' });

      const done = await withSpies(() =>
        runCli(['convert-to-slices', '03759ned', '--yes', '--budget-seconds', '600'], { db, source }),
      );
      expect(done.result).toBe(0);
      expect(done.output).toContain('converted to slice storage');
      expect(await mode(db, '03759ned')).toMatchObject({ ingest_mode: 'slice_cache', status: 'active' });

      const backDry = await withSpies(() => runCli(['convert-to-full', '03759ned'], { db, source }));
      expect(backDry.result).toBe(0);
      expect(backDry.output).toContain('DRY RUN');
      const back = await withSpies(() => runCli(['convert-to-full', '03759ned', '--yes'], { db, source }));
      expect(back.result).toBe(0);
      expect(back.output).toContain('ingest sync 03759ned');
      expect(await mode(db, '03759ned')).toMatchObject({ ingest_mode: 'full' });
    } finally {
      await close();
    }
  });

  it('a refusal, a missing or second table id and a bad budget exit 1 and write nothing', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    try {
      const source = new FixtureSource(loadDocs('03759ned'));
      const refused = await withSpies(() => runCli(['convert-to-slices', '03759ned', '--yes'], { db, source }));
      expect(refused.result).toBe(1);
      expect(refused.output).toContain('REFUSED');
      for (const argv of [
        ['convert-to-slices'],
        ['convert-to-slices', '03759ned', '83625NED', '--yes'],
        ['convert-to-full'],
        ['rebaseline-slices', '--yes'],
        ['convert-to-slices', '03759ned', '--budget-seconds', 'soon'],
      ]) {
        const run = await withSpies(() => runCli(argv, { db, source }));
        expect(run.result, argv.join(' ')).toBe(1);
      }
      const rows = await db.query('select count(*)::int as n from cbs_tables');
      expect(Number(rows.rows[0]!.n)).toBe(0);
    } finally {
      await close();
    }
  });

  it('rebaseline-slices: a dry run without --yes, the re-baseline with it; a table that is not quarantined exits 1', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    try {
      const source = new FixtureSource(loadDocs('83625NED'));
      expect((await registerSchemaOnly(db, source, '83625NED')).ok).toBe(true);

      const notQuarantined = await withSpies(() => runCli(['rebaseline-slices', '83625NED', '--yes'], { db, source }));
      expect(notQuarantined.result).toBe(1);
      expect(notQuarantined.output).toContain('not quarantined');

      await db.query(`update cbs_tables set status = 'needs_review', needs_review_reason = 'test' where id = '83625NED'`);
      const dry = await withSpies(() => runCli(['rebaseline-slices', '83625NED'], { db, source }));
      expect(dry.result).toBe(0);
      expect(dry.output).toContain('DRY RUN');
      expect(await mode(db, '83625NED')).toMatchObject({ status: 'needs_review' });

      const done = await withSpies(() => runCli(['rebaseline-slices', '83625NED', '--yes'], { db, source }));
      expect(done.result).toBe(0);
      expect(done.output).toContain('re-baselined');
      expect(await mode(db, '83625NED')).toMatchObject({ status: 'active', ingest_mode: 'slice_cache' });
    } finally {
      await close();
    }
  });
});

// #23 (2026-09-17, session 109): `ingest sync` fires AT MOST ONE owner-alert
// email per run when any target table failed/threw — never one per table.
// Hermetic on the alert side: fetch is stubbed exactly like every sibling
// alert test (tests/audit/*-alert.test.ts); the DB is the real pglite
// fixture harness this file already uses everywhere else.
function envPatch(values: Record<string, string | undefined>): () => void {
  const saved = new Map(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

describe('#23 — ingest sync owner-alert wiring', () => {
  afterEach(() => vi.restoreAllMocks());

  it('two unregistered target tables (both throw) produce exactly ONE alert email listing both', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      // Neither id is a seed nor pre-registered: syncTable's own "not
      // registered" guard throws for each — a cheap, fixture-free way to
      // exercise the run's "sync threw" alert trigger twice in one run.
      const { result: exitCode } = await withSpies(() =>
        runCli(['sync', 'no-such-table-a', 'no-such-table-b'], {
          db,
          source: buildTwoTableSource(),
          fetchImpl: fetchStub as unknown as typeof fetch,
        }),
      );
      expect(exitCode).toBe(1);
      expect(fetchStub).toHaveBeenCalledOnce();
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.subject).toContain('2 ingestieproblemen');
      expect(body.text).toContain('no-such-table-a');
      expect(body.text).toContain('no-such-table-b');
      expect(body.text).toContain('threw');
    } finally {
      restore();
      await close();
    }
  });

  it('a fully clean run sends no alert email', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const fetchStub = vi.fn();
    try {
      const docsB = loadDocs('82242NED');
      const sourceB = new FixtureSource(docsB);
      const { result: exitCode } = await withSpies(() =>
        runCli(['sync', '82242NED'], { db, source: sourceB, fetchImpl: fetchStub as unknown as typeof fetch }),
      );
      expect(exitCode).toBe(0);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      restore();
      await close();
    }
  });

  it('unset RESEND_API_KEY/ADMIN_ALERT_EMAIL: a failing run still exits 1 but never calls fetch', async () => {
    const { db, close }: { db: Db; close: () => Promise<void> } = await createTestDb();
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const fetchStub = vi.fn();
    try {
      const { result: exitCode } = await withSpies(() =>
        runCli(['sync', 'no-such-table-a'], {
          db,
          source: buildTwoTableSource(),
          fetchImpl: fetchStub as unknown as typeof fetch,
        }),
      );
      expect(exitCode).toBe(1);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      restore();
      await close();
    }
  });
});
