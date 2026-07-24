// The pg pool's shape is a CAPACITY invariant, not a style preference
// (open-questions #173, measured 2026-07-25): Supabase's free tier caps
// session-mode pooling at 15 clients for the whole project, and every
// process — each warm serverless instance, each laptop script — opens its
// own pool from this one factory. A silent bump of `max` back to 4, or to
// node-pg's default of 10, would put a single busy process within reach of
// the project ceiling again, and the symptom (production degrading ~6
// minutes later, under load, after a deploy burst) is exactly the kind that
// never shows up in a test run.
//
// So: pin it. `new pg.Pool()` does NOT dial the database — it only records
// options — so this stays hermetic, no network, no DATABASE_URL.
import { describe, expect, it } from 'vitest';
import { createPool } from '../../src/db/client.ts';

const FAKE_URL = 'postgresql://user:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';

describe('createPool keeps a small per-process session footprint (#173)', () => {
  it('caps clients per process at 2', async () => {
    const pool = createPool(FAKE_URL);
    try {
      expect(pool.options.max).toBe(2);
    } finally {
      await pool.end();
    }
  });

  it('never leaves max at the node-pg default, whatever that default becomes', async () => {
    const pool = createPool(FAKE_URL);
    try {
      // Belt to the braces above: the number must be explicit AND small
      // enough that 7 concurrent processes still fit under the 15-session
      // free-tier ceiling.
      expect(typeof pool.options.max).toBe('number');
      expect(pool.options.max!).toBeGreaterThan(0);
      expect(pool.options.max! * 7).toBeLessThanOrEqual(15);
    } finally {
      await pool.end();
    }
  });

  it('strips URL query params so the explicit pinned-CA ssl config applies', async () => {
    const pool = createPool(`${FAKE_URL}?sslmode=require&application_name=x`);
    try {
      expect(pool.options.connectionString).toBe(FAKE_URL);
      const ssl = pool.options.ssl as { ca?: string } | undefined;
      expect(ssl?.ca).toContain('-----BEGIN CERTIFICATE-----');
    } finally {
      await pool.end();
    }
  });

  it('does not set connectionTimeoutMillis — an unbounded wait is the deliberate money-path choice', async () => {
    // Pinned as a decision, not as a preference: a bounded acquisition
    // timeout could throw between a committed debit and its compensating
    // refund (billing/gate.ts). Changing that is a supervised change; if a
    // later session sets this, it must come with that money-path reasoning
    // and this test's comment must move with it.
    const pool = createPool(FAKE_URL);
    try {
      expect(pool.options.connectionTimeoutMillis).toBeFalsy();
    } finally {
      await pool.end();
    }
  });
});
