// Module-scope DB pool singleton for the chat UI's Server Actions.
//
// Reuses connectFromEnv() unchanged (ADR 018 decision 4) — the same code
// path the CLI scripts and CI already exercise, session-mode pooler and
// all. In production a plain top-level singleton already survives for the
// life of a warm serverless container (the module is evaluated once); the
// globalThis cache below exists only to survive `next dev`'s HMR, which
// would otherwise re-evaluate this module (and open a fresh pool) on every
// file save.
import { connectFromEnv } from '../../src/db/client.ts';
import type { Db } from '../../src/db/types.ts';

let cached: Db | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __checkdecijfersDb: Db | undefined;
}

export function getDb(): Db {
  if (process.env.NODE_ENV !== 'production') {
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
