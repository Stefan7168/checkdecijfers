// Module-scope DB pool singleton for the chat UI's Server Actions.
//
// Reuses connectFromEnv() unchanged (ADR 018 decision 4) — the same code
// path the CLI scripts and CI already exercise, session-mode pooler and
// all. In production a plain top-level singleton already survives for the
// life of a warm serverless container (the module is evaluated once); the
// globalThis cache below exists only to survive `next dev`'s HMR, which
// would otherwise re-evaluate this module (and open a fresh pool) on every
// file save.
//
// The `CDC_PGLITE_HARNESS` arm (session 110, perf6) extends that same
// globalThis seam to a real `next build` + `next start` run of
// scripts/dev-harness — Turbopack's production build inlines
// `process.env.NODE_ENV` to the literal string 'production' (confirmed:
// setting NODE_ENV=development in the shell that runs `next start` alone
// has no effect, because the check was already dead-code-eliminated at
// build time), so the plain NODE_ENV branch below can never reach a
// harness-preloaded db under `next start`. CDC_PGLITE_HARNESS is an
// ordinary runtime env var (never inlined) and is only ever set by
// scripts/dev-harness/env.sh / run-next-dev.mjs — unset in every real
// deploy, so production behaviour (the `cached` branch) is unchanged.
import { connectFromEnv } from '../backend/db/client.ts';
import type { Db } from '../backend/db/types.ts';

let cached: Db | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __checkdecijfersDb: Db | undefined;
}

export function getDb(): Db {
  if (process.env.NODE_ENV !== 'production' || process.env.CDC_PGLITE_HARNESS === '1') {
    if (!global.__checkdecijfersDb) {
      global.__checkdecijfersDb = connectFromEnv().db;
    }
    return global.__checkdecijfersDb;
  }
  if (!cached) {
    cached = connectFromEnv().db;
  }
  return cached;
}
