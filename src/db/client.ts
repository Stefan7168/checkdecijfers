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
  // Fail closed (WP12 review): an empty or garbled DATABASE_CA_CERT must fall
  // back to the committed pinned CA, never silently weaken TLS verification.
  const fromEnv = process.env.DATABASE_CA_CERT;
  if (fromEnv && fromEnv.includes('-----BEGIN CERTIFICATE-----')) {
    return fromEnv;
  }
  return readFileSync(CA_URL, 'utf8');
}

// One process — a warm serverless instance, a CI job, a laptop script — may
// hold at most this many pooler sessions.
//
// Measured 2026-07-25 (open-questions #173, RUNBOOK "Supabase free tier: 15
// SESSION-MODE connections"): Supabase's free tier caps session-mode pooling
// at **15 clients for the whole project**, and every process here opens its
// own pool — each deployed function instance one, plus any `--env-file=.env`
// script a laptop runs. Five deploys inside an hour stacked enough instances
// to hit `(EMAXCONNSESSION) max clients reached in session mode`; production
// degraded honestly for ~6 minutes (`/llms.txt` 503, Ontdek section omitted)
// before self-healing. At the old ceiling of 4, FOUR busy processes could
// alone exhaust the project. At 2 it takes eight — the same burst now fits.
//
// Two is not a throughput regression here because nothing in this codebase
// needs two clients at once to make progress: `withTransaction` holds exactly
// one client for its whole callback, every callback uses only the `tx` it is
// given, and no transaction nests (verified across all 14 call sites). So a
// small pool can only ever *queue* independent work, never deadlock it. The
// widest fan-out on the request path is the four curated Ontdek charts
// (`chart/curated.ts`), which run behind a 30-minute cache with in-flight
// coalescing — it rebuilds in two lanes instead of four, at most twice an
// hour, on a page that already tolerates the charts being absent.
//
// Deliberately NOT set here: `connectionTimeoutMillis`. node-pg's default (0)
// waits indefinitely for a free client; a bounded wait would turn pool
// contention into a thrown error, and one place that error could land is
// between a committed credit debit and its compensating refund
// (`billing/gate.ts`). Changing a money-path failure mode is a supervised
// change, not a capacity tweak — tracked in #173.
const MAX_POOL_CLIENTS_PER_PROCESS = 2;

export function createPool(databaseUrl: string): pg.Pool {
  const url = new URL(databaseUrl);
  url.search = '';
  return new pg.Pool({
    connectionString: url.toString(),
    ssl: { ca: loadCaCert() },
    max: MAX_POOL_CLIENTS_PER_PROCESS,
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
