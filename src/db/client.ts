// Production Db implementation over node-postgres, for Supabase Postgres.
//
// Connection notes (measured 2026-07-02, see docs/RUNBOOK.md):
// - The direct db.<ref>.supabase.co host is IPv6-only; DATABASE_URL therefore
//   points at the IPv4 session pooler (aws-1-eu-central-1.pooler.supabase.com).
//   Session mode preserves temp tables, which the ingestion staging step uses.
// - TLS is verified strictly against Supabase's public root CA, committed at
//   config/supabase-prod-ca-2021.pem. The sslmode URL param is stripped so the
//   explicit ssl config (rejectUnauthorized: true + pinned CA) is what applies.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Db } from './types.ts';

const CA_URL = new URL('../../config/supabase-prod-ca-2021.pem', import.meta.url);

// The chat UI's bundled Node.js runtime (Turbopack, ADR 018) treats a
// literal `new URL('./relative', import.meta.url)` as a CLIENT-asset
// reference, not a server filesystem path: it rewrites the resolved URL to
// a `/_next/static/media/...` public path that doesn't exist as a real file
// from this process's cwd. There is no bundler-safe way to read a local
// file at runtime through that pattern. Since this is Supabase's *public*
// root CA (not a secret — already committed to the repo), the bundled web
// app instead gets it via DATABASE_CA_CERT, baked in at Next's build time
// from the same committed file (web/next.config.ts) — build time runs
// under plain Node, unaffected by the runtime bundling quirk. Unbundled
// contexts (CLI scripts, CI) keep reading the file directly, where
// import.meta.url resolution has always worked correctly.
function loadCaCert(): string {
  return process.env.DATABASE_CA_CERT ?? readFileSync(CA_URL, 'utf8');
}

export function createPool(databaseUrl: string): pg.Pool {
  const url = new URL(databaseUrl);
  url.search = '';
  return new pg.Pool({
    connectionString: url.toString(),
    ssl: { ca: loadCaCert() },
    max: 4,
  });
}

export function poolDb(pool: pg.Pool): Db {
  return {
    query: async (text, params) => {
      const r = await pool.query(text, params as unknown[] | undefined);
      return { rows: r.rows };
    },
    withTransaction: async (fn) => {
      const client = await pool.connect();
      const clientDb: Db = {
        query: async (text, params) => {
          const r = await client.query(text, params as unknown[] | undefined);
          return { rows: r.rows };
        },
        withTransaction: () => {
          throw new Error('nested transactions are not supported');
        },
      };
      try {
        await client.query('begin');
        const result = await fn(clientDb);
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export function connectFromEnv(): { db: Db; pool: pg.Pool } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Run with: node --env-file=.env <script> (see .env.example)',
    );
  }
  const pool = createPool(databaseUrl);
  return { db: poolDb(pool), pool };
}
