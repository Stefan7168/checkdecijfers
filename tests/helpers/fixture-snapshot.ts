// A build-once, restore-per-suite snapshot of the fully-ingested fixture
// database.
//
// THE PROBLEM, measured 2026-07-25. Thirty-four test files call
// createIngestedDb(), and each one booted its own PGlite and re-ingested all
// 17 SEED_TABLES from scratch: **7.9 s and 10.7 s** for two consecutive cold
// builds on an unloaded machine, far worse under the suite's own parallel
// load. That is where the hookTimeout raises came from — 30 → 60 → 120 → 300 s
// across four separate sessions, each one treating the symptom.
//
// THE FIX. Ingest ONCE, dump the resulting PGlite data directory, and have each
// suite restore from that dump instead of replaying the ingest. Measured on the
// same machine: restore takes **1.16-1.39 s**, roughly a 7x saving per suite.
//
// WHY THIS DOES NOT BREAK ISOLATION — the requirement that killed the naive
// "one shared database" idea. Every suite still gets its OWN PGlite instance;
// only the expensive *construction* is shared, never the running database. A
// restored copy is a private in-memory Postgres, so a suite that mutates it
// cannot be seen by any other. This is the property that
// tests/answer/answer-first-region.test.ts and answer-first-period.test.ts
// depend on: they DELETE rows on purpose and put them back in a `finally`, and
// under a genuinely shared mutable database they would go order-dependent and
// flaky. Proven, not assumed: deleting all 98,672 observations from one
// restored copy left a sibling restore holding all 98,672.
//
// WHY NOT snapshot createTestDb() too: measured, and not worth it. Applying
// the migrations to an empty PGlite costs ~0.8 s, which a restore would not
// beat. The ingest is the whole cost.
//
// CACHE KEY. The snapshot is only valid for the inputs that produced it, so it
// is keyed by a hash over the migrations, the committed CBS fixtures and the
// seed registry. Change a fixture and the key changes, so a stale snapshot can
// never be silently reused — the failure mode a hand-managed cache would have.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { FixtureSource, loadFixtureDocsTree } from '../../src/cbs-adapter/fixture-source.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { warmTable } from '../../src/ingestion/warm-job.ts';
import { applyRegistryDefaults } from '../../src/registry/apply.ts';
import { applyMigrations, MIGRATIONS_DIR } from '../../src/db/migrate.ts';
import type { Db } from '../../src/db/types.ts';
import { wrapPGlite } from './pglite-db.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
// This file itself decides what the database holds (the two builds below), so
// it is part of the cache key too.
const THIS_FILE = fileURLToPath(import.meta.url);

/**
 * How the hermetic database stores the seed tables (ADR 065 step 6, design
 * D8; #358 item 2).
 *
 * - `slice` — THE DEFAULT since production converted its pinned CBS tables to
 *   slice storage (2026-09-30). It mirrors production: every seed table is
 *   registered in slice mode with its seed curation (pinned, cadence, declared
 *   scope, measure curation) and its scope filled by the warm job through
 *   bounded, validated slice requests — except the tables in
 *   WHOLE_TABLE_IN_PRODUCTION, which production does not slice-store and this
 *   build therefore keeps on the whole-table path.
 * - `full` — every seed table registerTables + one whole-scope syncTable: the
 *   whole-table storage path, kept selectable (`INGEST_FIXTURE_MODE=full`)
 *   while production still runs it for some tables, and pinned by the suites
 *   that test that path itself.
 * - `slice-all` — every seed table slice-stored, WHOLE_TABLE_IN_PRODUCTION
 *   included: the parity proof that those tables can be converted
 *   (tests/ingestion/slice-build-parity.test.ts).
 */
export type FixtureMode = 'full' | 'slice' | 'slice-all';

/** The one place the mode is read. An unknown value throws rather than falling
 * back to a default: a typo must never run the suite in another mode. */
export function fixtureMode(): FixtureMode {
  const raw = process.env.INGEST_FIXTURE_MODE;
  if (raw === undefined || raw === '' || raw === 'slice') return 'slice';
  if (raw === 'full' || raw === 'slice-all') return raw;
  throw new Error(`INGEST_FIXTURE_MODE must be "slice", "full" or "slice-all", not "${raw}"`);
}

/**
 * Seed tables production does NOT slice-store, with the reason. The default
 * (`slice`) build keeps exactly these on the whole-table path so the hermetic
 * database mirrors production; every other seed table is one of the pinned CBS
 * tables production converted (ADR 065 step 9, #358 item 1). When production
 * slice-stores one of these, delete its entry in the same change — the parity
 * test proves the slice build of it already (`slice-all`).
 */
export const WHOLE_TABLE_IN_PRODUCTION: Readonly<Record<string, string>> = {
  '70072ned':
    'not converted in production: the regional table is outside the 17 pinned CBS tables converted on 2026-09-30 ' +
    '(its production load waits for the 1 October plan part B, ADR 065); its slice storage is proven by slice-all',
};

/**
 * Seed tables the slice-mode build keeps on the whole-table path, with the
 * reason, used only when the slice store refuses them with
 * `no_machine_period_status`. EMPTY since #358 item 3 (2026-09-30): 70072ned,
 * whose statuses come from its reviewed period notes (ADR 061), was the one
 * entry — the slice store now reads those notes with the whole-table sync's own
 * reader, so every seed table is slice-stored in this build. Kept (empty) so a
 * future table that genuinely cannot be slice-stored is added here with its
 * reason, never skipped silently.
 */
export const SLICE_BUILD_FULL_FALLBACK: Readonly<Record<string, string>> = {};
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const CACHE_DIR = fileURLToPath(new URL('../../node_modules/.cache/cdc-fixture-db', import.meta.url));

/** Every file under `dir`, sorted, so the hash does not depend on readdir order. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Content hash of everything that decides what the ingested database contains.
 *
 * Contents, not mtimes: a fresh clone or a CI checkout has arbitrary mtimes and
 * would otherwise miss the cache (or, worse, hit a stale one).
 *
 * WHY THE WHOLE OF `src/`, and not a list of the files that feed the ingest.
 * A hand-picked list was the first version of this function and it was WRONG:
 * it named `registry-seed.ts` and `defaults.ts` and missed `parse-v4.ts`,
 * `pipeline.ts`, `periods.ts`, `fingerprint.ts`, `validate.ts` and
 * `registry/apply.ts` — every one of which changes what ends up in the
 * database. The failure that would have caused is the nastiest kind: fix a bug
 * in `parsePeriodCode`, run the suite, get a warm cache built BEFORE the fix,
 * and watch 34 suites pass against the old behaviour. An enumerated list also
 * rots the moment someone adds a file to the pipeline.
 *
 * So the key is over-broad on purpose. Hashing all 117 files of `src/` measures
 * at ~0.1 s, and the cost of being wrong is a 7 s rebuild after an unrelated
 * source edit — against re-ingesting 17 tables 34 times, which is what this
 * replaced. Cheap insurance against a silent lie. */
export function fixtureInputFiles(): string[] {
  return [...walkFiles(SRC_DIR), ...walkFiles(MIGRATIONS_DIR), ...walkFiles(FIXTURES_DIR), THIS_FILE];
}

export function fixtureInputsHash(): string {
  const hash = createHash('sha256');
  // The PGlite version decides the on-disk format the dump is written in, so a
  // dependency bump must invalidate the snapshot.
  hash.update(
    readFileSync(
      fileURLToPath(new URL('../../node_modules/@electric-sql/pglite/package.json', import.meta.url)),
    ),
  );
  for (const file of fixtureInputFiles()) {
    // Repo-relative, so the digest does not depend on where the checkout lives
    // (and so two files cannot contribute an identical path component).
    hash.update(file.slice(REPO_ROOT.length));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex').slice(0, 16);
}

/** The snapshot key for one build mode: the inputs hash, with the mode folded
 * in for the slice builds so no two builds can ever share a snapshot. Still a
 * plain hex name, so pruneSnapshots bounds both kinds alike. */
export function fixtureSnapshotKey(mode: FixtureMode = fixtureMode()): string {
  const inputs = fixtureInputsHash();
  if (mode === 'full') return inputs;
  return createHash('sha256').update(`${inputs}:${mode}`).digest('hex').slice(0, 16);
}

function snapshotPathFor(key: string): string {
  return join(CACHE_DIR, `ingested-${key}.tar`);
}

/** How many snapshots the cache keeps. The key above hashes ALL of `src/`, so
 * every source edit mints a new ~160 MB snapshot — and until session 143
 * (2026-09-29) nothing ever deleted the old ones: 166 files, 24.5 GB, in four
 * days of editing, found only because the owner's disk ran low. Three covers
 * switching between a couple of branches without a rebuild; anything older is
 * a 7-second rebuild away. */
export const SNAPSHOTS_TO_KEEP = 3;

/** Deletes every `ingested-*.tar` in `dir` except the `keep` most recently
 * modified ones, plus any `.tmp` left behind by an interrupted write older than
 * an hour. Never throws: a failed prune leaves extra files, never a red suite.
 * Returns the paths it removed (for the test). */
export function pruneSnapshots(dir: string = CACHE_DIR, keep: number = SNAPSHOTS_TO_KEEP): string[] {
  const removed: string[] = [];
  try {
    if (!existsSync(dir)) return removed;
    const now = Date.now();
    const tars: { path: string; mtime: number }[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (/^ingested-[0-9a-f]+\.tar$/.test(name)) {
        tars.push({ path, mtime: statSync(path).mtimeMs });
      } else if (/\.tmp$/.test(name) && now - statSync(path).mtimeMs > 60 * 60 * 1000) {
        unlinkSync(path);
        removed.push(path);
      }
    }
    tars.sort((a, b) => b.mtime - a.mtime);
    for (const stale of tars.slice(Math.max(0, keep))) {
      unlinkSync(stale.path);
      removed.push(stale.path);
    }
  } catch (error) {
    console.warn('[fixture-db] snapshot prune skipped:', error instanceof Error ? error.message : error);
  }
  return removed;
}

/** Migrations applied to a fresh PGlite, plus the fixture source every build
 * reads — the part both builds share. */
async function freshDatabase(): Promise<{ client: PGlite; db: Db; source: FixtureSource }> {
  const client = new PGlite();
  const db = wrapPGlite(client);
  await applyMigrations(db);
  return { client, db, source: new FixtureSource(loadFixtureDocsTree(FIXTURES_DIR)) };
}

async function applyDefaultsOrThrow(db: Db): Promise<void> {
  const applied = await applyRegistryDefaults(db);
  if (applied.tablesMissing.length > 0) {
    throw new Error(
      `registry defaults reference unregistered table(s): ${applied.tablesMissing.join(', ')}`,
    );
  }
}

async function syncOrThrow(db: Db, source: FixtureSource, tableId: string): Promise<void> {
  const result = await syncTable(db, source, tableId);
  if (result.outcome !== 'succeeded') {
    throw new Error(`fixture sync of ${tableId} failed at ${result.failureStage}: ${result.failureSummary}`);
  }
}

/** The cold path, full mode: boot PGlite, migrate, register, sync all 17 seed
 * tables. This is what every suite used to do on its own. */
async function buildFullIngested(): Promise<PGlite> {
  const { client, db, source } = await freshDatabase();
  // #110(c): pinned, mirroring `ingest register` — the seed set is eviction-exempt.
  await registerTables(db, source, SEED_TABLES, { pinned: true });
  await applyDefaultsOrThrow(db);
  for (const table of SEED_TABLES) await syncOrThrow(db, source, table.id);
  return client;
}

/** The cold path, slice modes (ADR 065 step 6): the same seed tables, the same
 * registry defaults, but each table registered in slice mode with its seed
 * curation and its declared scope filled by the warm job. Any outcome other
 * than `complete` fails the build — a half-filled scope would make every
 * dependent suite test something other than what production would hold.
 * `keepWhole` tables (WHOLE_TABLE_IN_PRODUCTION in the default build) are
 * registered and synced the whole-table way without trying slice storage;
 * SLICE_BUILD_FULL_FALLBACK tables likewise, but only when the slice store
 * refuses them for exactly that reason. */
async function buildSliceIngested(keepWhole: ReadonlySet<string>): Promise<PGlite> {
  const { client, db, source } = await freshDatabase();
  for (const id of keepWhole) {
    // A stale entry naming a table the seed no longer has must not pass silently.
    if (!SEED_TABLES.some((t) => t.id === id)) throw new Error(`${id} is kept whole-table but is not a seed table`);
  }
  const wholeTable = new Set<string>();
  // Seed order, as the full build registers them.
  for (const table of SEED_TABLES) {
    if (keepWhole.has(table.id)) {
      await registerTables(db, source, [table], { pinned: true });
      wholeTable.add(table.id);
      continue;
    }
    const registered = await registerSchemaOnly(db, source, table.id, undefined, {
      pinned: true,
      updateCadence: table.updateCadence,
      slice: table.slice ?? null,
      excludeMeasures: table.excludeMeasures,
    });
    if (registered.ok) continue;
    if (registered.reason === 'no_machine_period_status' && Object.hasOwn(SLICE_BUILD_FULL_FALLBACK, table.id)) {
      await registerTables(db, source, [table], { pinned: true });
      wholeTable.add(table.id);
      continue;
    }
    throw new Error(`slice-mode registration of ${table.id} refused (${registered.reason}): ${registered.summary}`);
  }
  for (const id of Object.keys(SLICE_BUILD_FULL_FALLBACK)) {
    // A fallback the slice store no longer refuses is stale: say so, loudly.
    if (!wholeTable.has(id)) throw new Error(`${id} is listed as a whole-table fallback but was slice-registered`);
  }
  await applyDefaultsOrThrow(db);
  // Far enough that the deadline never decides a fixture build.
  const deadline = Date.now() + 24 * 60 * 60 * 1000;
  for (const table of SEED_TABLES) {
    if (wholeTable.has(table.id)) {
      await syncOrThrow(db, source, table.id);
      continue;
    }
    const warmed = await warmTable(db, source, table.id, { deadline });
    if (warmed.outcome !== 'complete') {
      const why = warmed.failure
        ? `${warmed.failure.stage}: ${warmed.failure.summary}`
        : (warmed.skippedReason ?? `${warmed.remaining} of ${warmed.planned} requests not done`);
      throw new Error(`fixture warm of ${table.id} ended ${warmed.outcome} (${why})`);
    }
  }
  return client;
}

/** The cold path for a mode (default: the INGEST_FIXTURE_MODE one). */
async function buildIngested(mode: FixtureMode = fixtureMode()): Promise<PGlite> {
  if (mode === 'full') return buildFullIngested();
  return buildSliceIngested(new Set(mode === 'slice' ? Object.keys(WHOLE_TABLE_IN_PRODUCTION) : []));
}

/**
 * Ensures a snapshot for the current inputs and mode exists on disk and returns
 * its path. Called once per `vitest run` from tests/global-setup.ts; a warm
 * cache makes it a stat() call, so a single-file run pays nothing.
 */
export async function ensureSnapshot(mode: FixtureMode = fixtureMode()): Promise<{ path: string; built: boolean }> {
  const path = snapshotPathFor(fixtureSnapshotKey(mode));
  if (existsSync(path) && statSync(path).size > 0) return { path, built: false };

  mkdirSync(CACHE_DIR, { recursive: true });
  const client = await buildIngested(mode);
  const blob = await client.dumpDataDir('none');
  await client.close();

  // Write-then-rename: rename is atomic within a filesystem, so a reader can
  // never observe a half-written snapshot even if two runs race here.
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, Buffer.from(await blob.arrayBuffer()));
  renameSync(temp, path);
  // The file just written is the newest by mtime, so it always survives.
  pruneSnapshots();
  return { path, built: true };
}

const cachedBytes = new Map<FixtureMode, Buffer>();

/** The snapshot for the current inputs, or null when there is none to use.
 *
 * Null is not an error — the caller rebuilds the database the old way. Every
 * failure mode here (no file, unreadable file, permissions, a truncated file
 * from an interrupted CI cache restore) MUST come out as null rather than as a
 * throw: a broken cache is allowed to make the suite slow, and is never allowed
 * to make it red. Getting this wrong would hand all 34 dependent suites a
 * shared new way to fail. */
export function readSnapshot(mode: FixtureMode = fixtureMode()): Buffer | null {
  const cached = cachedBytes.get(mode);
  if (cached !== undefined) return cached;
  try {
    const path = snapshotPathFor(fixtureSnapshotKey(mode));
    if (!existsSync(path)) return null;
    const bytes = readFileSync(path);
    cachedBytes.set(mode, bytes);
    return bytes;
  } catch (error) {
    console.warn(
      '[fixture-db] snapshot unreadable, building the database instead:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** A private, fully-ingested PGlite restored from the snapshot, or null when
 * the bytes turn out not to be a usable data directory. Same rule as above:
 * degrade to the slow path, never throw. */
export async function restoreFromSnapshot(bytes: Buffer): Promise<PGlite | null> {
  let client: PGlite | null = null;
  try {
    // A copy per restore: PGlite consumes the blob, and sharing one Buffer's
    // memory across instances is exactly the aliasing this design avoids.
    client = new PGlite({ loadDataDir: new Blob([new Uint8Array(bytes)]) });
    // A corrupt data directory surfaces here, not at construction.
    await client.waitReady;
    return client;
  } catch (error) {
    console.warn(
      '[fixture-db] snapshot did not restore, building the database instead:',
      error instanceof Error ? error.message : error,
    );
    await client?.close().catch(() => undefined);
    return null;
  }
}

export { buildIngested };
