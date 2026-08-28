// #65 / WP25: migration 024 — the error_log table. One test per claim in the
// migration header: shape + defaults, nullable join columns, unchecked source
// (a future catch site must not need a migration), and jsonb context.
// Hermetic on PGlite (ADR 009) — createTestDb applies every migration incl.
// 024. The grants/RLS posture is migration 003's automatic mechanism (zero
// anon/authenticated grants), live-verified at the supervised apply — PGlite
// has no Supabase roles to assert against here.
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

describe('migration 024 — error_log', () => {
  it('accepts a minimal row and defaults id + occurred_at', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        `insert into error_log (source, message) values ('askQuestion', 'boom')
         returning id, occurred_at, request_id, user_id, stack, context`,
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.id)).toBeGreaterThan(0);
      expect(rows[0]!.occurred_at).toBeTruthy();
      // The join/context columns are all nullable — a log row must always be
      // writable with only what the catch site has.
      expect(rows[0]!.request_id).toBeNull();
      expect(rows[0]!.user_id).toBeNull();
      expect(rows[0]!.stack).toBeNull();
      expect(rows[0]!.context).toBeNull();
    });
  });

  it('source and message are required — a row must say where and what', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(`insert into error_log (message) values ('no source')`),
      ).rejects.toThrow(/null|source/i);
      await expect(
        db.query(`insert into error_log (source) values ('askQuestion')`),
      ).rejects.toThrow(/null|message/i);
    });
  });

  it('source is UNCHECKED text: a new catch site needs no migration', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        `insert into error_log (source, message) values ('some-future-catch-site', 'x') returning id`,
      );
      expect(rows).toHaveLength(1);
    });
  });

  it('request_id/user_id are uuid-typed (the joinability contract with migrations 005/010) and carry NO foreign key', async () => {
    await withDb(async (db) => {
      // uuid values that reference NOTHING must insert fine — no FK, by design
      // (an auth-callback failure has no user; the one write that explains an
      // incident must never fail on referential nicety).
      const { rows } = await db.query(
        `insert into error_log (source, request_id, user_id, message)
         values ('stripe-webhook', '11111111-1111-4111-8111-111111111111',
                 '22222222-2222-4222-8222-222222222222', 'x') returning id`,
      );
      expect(rows).toHaveLength(1);
      // And a non-uuid string is a type error — which is exactly why the app
      // guard (src/db/error-log.ts) validates before binding.
      await expect(
        db.query(`insert into error_log (source, request_id, message) values ('x', 'not-a-uuid', 'x')`),
      ).rejects.toThrow(/uuid|invalid/i);
    });
  });

  it('context is jsonb and round-trips structured extras', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into error_log (source, message, context)
         values ('health', 'x', '{"check":"balance-read"}'::jsonb)`,
      );
      const { rows } = await db.query(
        `select context->>'check' as c from error_log where source = 'health'`,
      );
      expect(rows[0]!.c).toBe('balance-read');
    });
  });
});
