// Migration-number collision guard (docs/open-questions.md #263).
//
// WHY THIS EXISTS (found session 107, 2026-09-16/17, merging the WP30c E1
// Eurostat branch to main): this project's schema changes are numbered,
// committed migration files (migrations/NNN_description.sql, applied in
// order — CLAUDE.md "Database schema changes"). Two independently-developed
// branches each minted a new migration numbered `031` under DIFFERENT
// filenames (`031_source_doi.sql` on the long-unmerged Eurostat branch;
// `031_chart_headlines.sql` merged to main first) — git's own merge never
// flags this (different filenames never conflict), so the collision was
// invisible until the full backend suite ran post-merge and every
// applyMigrations/createIngestedDb()-dependent suite failed with Postgres's
// "duplicate key value violates unique constraint schema_migrations_pkey".
// Fixed by renumbering the never-applied side (032/033); full account in
// ADR 048's As-built addendum and lessons-learned.md's session-107 entry.
//
// This script is mitigation (a) from #263: a cheap, deterministic check that
// would have caught the collision the moment either branch's PR/push ran CI,
// instead of waiting for the merged suite to fail on a Postgres constraint.
// No DB connection, no network, no LLM — pure filesystem + string parsing.
//
//   npm run migrations:check-numbers
//
// Wired into .github/workflows/ci.yml (backend job, shard 1) so it runs on
// every push and pull request, same as the other gate steps.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** migrations/ convention: a zero-padded leading number, an underscore, a
 * description, and `.sql` — e.g. `031_chart_headlines.sql`. Anything else in
 * the directory (a stray README, a dotfile) is not this check's concern. */
export const MIGRATION_FILENAME = /^(\d+)_.+\.sql$/;

export interface MigrationCollision {
  number: string;
  files: string[];
}

/** Pure check: given the filenames actually present in migrations/ (any
 * order, non-migration entries allowed and ignored), return every leading
 * number claimed by more than one file. Takes a plain string array rather
 * than a directory path so this can be pinned against fixture collisions
 * without touching the filesystem or the real migrations/ directory. */
export function findMigrationNumberCollisions(filenames: string[]): MigrationCollision[] {
  const byNumber = new Map<string, string[]>();
  for (const name of filenames) {
    const match = MIGRATION_FILENAME.exec(name);
    if (!match) continue;
    const [, number] = match;
    const existing = byNumber.get(number);
    if (existing) existing.push(name);
    else byNumber.set(number, [name]);
  }
  return [...byNumber.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([number, files]) => ({ number, files: [...files].sort() }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

export function describeCollisions(collisions: MigrationCollision[]): string {
  return collisions
    .map(
      (c) =>
        `  ${c.number}: ${c.files.join(', ')} — two migrations share leading number ${c.number}. ` +
        'Renumber one of them (whichever side has not shipped to main yet) to the next free number.',
    )
    .join('\n');
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

function main(): void {
  const filenames = readdirSync(MIGRATIONS_DIR);
  const collisions = findMigrationNumberCollisions(filenames);
  if (collisions.length > 0) {
    console.error(
      `Migration number collision: ${collisions.length} number(s) claimed by more than one file ` +
        `in migrations/:\n${describeCollisions(collisions)}\n\nSee docs/open-questions.md #263.`,
    );
    process.exitCode = 1;
    return;
  }
  const count = filenames.filter((name) => MIGRATION_FILENAME.test(name)).length;
  console.log(`OK — ${count} migration file(s) in migrations/, no leading-number collisions.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
