// ADR 041 revisit trigger "The Pro-owner-email lookup" / open-questions #224.
// lookupUserEmail must fail closed to null on every error shape (no `auth`
// schema, unknown id, malformed id) and never throw — PGlite's test database
// (tests/helpers/pglite-db.ts) has no `auth` schema at all by default, which
// stands in for both "schema absent" and, being the same class of SQL
// error, "privilege denied" (PGlite has no privilege model to simulate that
// distinctly, but both surface as a thrown query error this function must
// swallow identically).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lookupUserEmail } from '../../src/billing/creator-email.ts';
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

describe('lookupUserEmail', () => {
  it('returns null, never throws, when the auth schema does not exist', async () => {
    await withDb(async (db) => {
      await expect(lookupUserEmail(db, randomUUID())).resolves.toBeNull();
    });
  });

  it('returns null for a malformed (non-UUID) id without ever querying', async () => {
    await withDb(async (db) => {
      await expect(lookupUserEmail(db, 'not-a-uuid')).resolves.toBeNull();
      await expect(lookupUserEmail(db, '')).resolves.toBeNull();
      await expect(lookupUserEmail(db, '42')).resolves.toBeNull();
    });
  });

  it('returns the email for a known id, and null for an unknown one, once a stub auth.users exists', async () => {
    await withDb(async (db) => {
      await db.query('create schema auth');
      await db.query('create table auth.users (id uuid primary key, email text)');
      const knownId = randomUUID();
      await db.query('insert into auth.users (id, email) values ($1, $2)', [knownId, 'Owner@Example.com']);

      await expect(lookupUserEmail(db, knownId)).resolves.toBe('Owner@Example.com');
      await expect(lookupUserEmail(db, randomUUID())).resolves.toBeNull();
    });
  });

  it('returns null when the stored email is null or blank', async () => {
    await withDb(async (db) => {
      await db.query('create schema auth');
      await db.query('create table auth.users (id uuid primary key, email text)');
      const nullEmailId = randomUUID();
      const blankEmailId = randomUUID();
      await db.query('insert into auth.users (id, email) values ($1, null)', [nullEmailId]);
      await db.query('insert into auth.users (id, email) values ($1, $2)', [blankEmailId, '   ']);

      await expect(lookupUserEmail(db, nullEmailId)).resolves.toBeNull();
      await expect(lookupUserEmail(db, blankEmailId)).resolves.toBeNull();
    });
  });
});
