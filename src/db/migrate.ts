// Numbered-migration runner (CLAUDE.md convention: schema changes only via
// committed migration files; a later session can rebuild the schema from the
// repo alone). Shared by the CLI (Supabase) and the test helper (PGlite).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './types.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Applies every migrations/NNN_*.sql not yet recorded; returns applied names. */
export async function applyMigrations(db: Db, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      applied_at timestamptz not null default now()
    )`);
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  const done = new Set(
    (await db.query('select name from schema_migrations')).rows.map((r) => r.name as string),
  );
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const version = Number(file.slice(0, 3));
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.withTransaction(async (tx) => {
      await tx.query(sql);
      await tx.query('insert into schema_migrations (version, name) values ($1, $2)', [
        version,
        file,
      ]);
    });
    applied.push(file);
  }
  return applied;
}

// CLI entry: node --env-file=.env src/db/migrate.ts
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { connectFromEnv } = await import('./client.ts');
  const { db, pool } = connectFromEnv();
  try {
    const applied = await applyMigrations(db);
    console.log(
      applied.length === 0
        ? 'Database schema is up to date — nothing to apply.'
        : `Applied ${applied.length} migration(s): ${applied.join(', ')}`,
    );
  } finally {
    await pool.end();
  }
}
