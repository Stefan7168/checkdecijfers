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
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { FixtureSource, loadFixtureDocsTree } from '../../src/cbs-adapter/fixture-source.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { applyRegistryDefaults } from '../../src/registry/apply.ts';
import { applyMigrations, MIGRATIONS_DIR } from '../../src/db/migrate.ts';
import { wrapPGlite } from './pglite-db.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
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
  return [...walkFiles(SRC_DIR), ...walkFiles(MIGRATIONS_DIR), ...walkFiles(FIXTURES_DIR)];
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

function snapshotPathFor(hash: string): string {
  return join(CACHE_DIR, `ingested-${hash}.tar`);
}

/** The cold path: boot PGlite, migrate, register, sync all 17 seed tables.
 * This is what every suite used to do on its own. */
async function buildIngested(): Promise<PGlite> {
  const client = new PGlite();
  const db = wrapPGlite(client);
  await applyMigrations(db);
  const source = new FixtureSource(loadFixtureDocsTree(FIXTURES_DIR));
  // #110(c): pinned, mirroring `ingest register` — the seed set is eviction-exempt.
  await registerTables(db, source, SEED_TABLES, { pinned: true });
  const applied = await applyRegistryDefaults(db);
  if (applied.tablesMissing.length > 0) {
    throw new Error(
      `registry defaults reference unregistered table(s): ${applied.tablesMissing.join(', ')}`,
    );
  }
  for (const table of SEED_TABLES) {
    const result = await syncTable(db, source, table.id);
    if (result.outcome !== 'succeeded') {
      throw new Error(
        `fixture sync of ${table.id} failed at ${result.failureStage}: ${result.failureSummary}`,
      );
    }
  }
  return client;
}

/**
 * Ensures a snapshot for the current inputs exists on disk and returns its path.
 * Called once per `vitest run` from tests/global-setup.ts; a warm cache makes it
 * a stat() call, so a single-file run pays nothing.
 */
export async function ensureSnapshot(): Promise<{ path: string; built: boolean }> {
  const hash = fixtureInputsHash();
  const path = snapshotPathFor(hash);
  if (existsSync(path) && statSync(path).size > 0) return { path, built: false };

  mkdirSync(CACHE_DIR, { recursive: true });
  const client = await buildIngested();
  const blob = await client.dumpDataDir('none');
  await client.close();

  // Write-then-rename: rename is atomic within a filesystem, so a reader can
  // never observe a half-written snapshot even if two runs race here.
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, Buffer.from(await blob.arrayBuffer()));
  renameSync(temp, path);
  return { path, built: true };
}

let cachedBytes: Buffer | null = null;

/** The snapshot for the current inputs, or null when there is none to use.
 *
 * Null is not an error — the caller rebuilds the database the old way. Every
 * failure mode here (no file, unreadable file, permissions, a truncated file
 * from an interrupted CI cache restore) MUST come out as null rather than as a
 * throw: a broken cache is allowed to make the suite slow, and is never allowed
 * to make it red. Getting this wrong would hand all 34 dependent suites a
 * shared new way to fail. */
export function readSnapshot(): Buffer | null {
  if (cachedBytes !== null) return cachedBytes;
  try {
    const path = snapshotPathFor(fixtureInputsHash());
    if (!existsSync(path)) return null;
    cachedBytes = readFileSync(path);
    return cachedBytes;
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
