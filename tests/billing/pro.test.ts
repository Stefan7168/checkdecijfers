// Task 7 (#205): hasProPlan is now the allowlist OR a real pro_subscriptions
// row. This file used to live colocated at src/billing/pro.test.ts (from
// the earlier 2026-09-10-embed plan, when the allowlist was the only check)
// — moved here to match every other billing test's location AND because
// src/ is symlinked into web/backend (ADR 018): a colocated test file
// importing tests/helpers/pglite-db.ts (a path outside src/) resolves
// differently once tsc follows that symlink from web/'s own tsconfig,
// breaking `npm run web:typecheck` with "Cannot find module
// '../../tests/helpers/pglite-db.ts'". Living here avoids that entirely
// (web/tsconfig.json's include globs never reach outside web/, and nothing
// in web/ imports this file).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasProPlan, hasProPlanAllowlist } from '../../src/billing/pro.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';

afterEach(() => {
  delete process.env.PRO_ACCOUNT_EMAILS;
});

let sharedDb: Db;
let closeSharedDb: () => Promise<void>;

beforeAll(async () => {
  ({ db: sharedDb, close: closeSharedDb } = await createTestDb());
});

afterAll(async () => {
  await closeSharedDb();
});

beforeEach(async () => {
  await resetTestDb(sharedDb);
});

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  await fn(sharedDb);
}

// hasProPlanAllowlist: the sync, DB-free half — unchanged behavior from
// before Task 7, just renamed out of hasProPlan's own body.
describe('hasProPlanAllowlist', () => {
  it('is false for everyone when PRO_ACCOUNT_EMAILS is unset (fail closed)', () => {
    expect(hasProPlanAllowlist({ id: 'u1', email: 'owner@example.com' })).toBe(false);
  });

  it('is true for an email listed in PRO_ACCOUNT_EMAILS', () => {
    process.env.PRO_ACCOUNT_EMAILS = 'owner@example.com, demo@example.com';
    expect(hasProPlanAllowlist({ id: 'u1', email: 'owner@example.com' })).toBe(true);
    expect(hasProPlanAllowlist({ id: 'u2', email: 'demo@example.com' })).toBe(true);
  });

  it('is case-insensitive on the email', () => {
    process.env.PRO_ACCOUNT_EMAILS = 'Owner@Example.com';
    expect(hasProPlanAllowlist({ id: 'u1', email: 'owner@example.com' })).toBe(true);
  });

  it('is false for an email not in the list', () => {
    process.env.PRO_ACCOUNT_EMAILS = 'owner@example.com';
    expect(hasProPlanAllowlist({ id: 'u1', email: 'someone-else@example.com' })).toBe(false);
  });

  it('is false when the user has no email', () => {
    process.env.PRO_ACCOUNT_EMAILS = 'owner@example.com';
    expect(hasProPlanAllowlist({ id: 'u1', email: null })).toBe(false);
  });
});

// hasProPlan: Task 7 (#205) — the allowlist OR a real pro_subscriptions row.
describe('hasProPlan', () => {
  it('false for a user with no allowlist entry and no subscription row', async () => {
    await withDb(async (db) => {
      expect(await hasProPlan(db, { id: randomUUID(), email: 'nobody@example.com' })).toBe(false);
    });
  });

  it('true for an active subscription with a future current_period_end', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(
        `insert into pro_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_x', 'sub_x', 'active', now() + interval '20 days', $2)`,
        [userId, randomUUID()],
      );
      expect(await hasProPlan(db, { id: userId, email: 'someone@example.com' })).toBe(true);
    });
  });

  it("true for past_due (still within Stripe's own retry grace)", async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(
        `insert into pro_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_x', 'sub_x', 'past_due', now() + interval '5 days', $2)`,
        [userId, randomUUID()],
      );
      expect(await hasProPlan(db, { id: userId, email: 'someone@example.com' })).toBe(true);
    });
  });

  it('false once current_period_end has passed, even if status still says active', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(
        `insert into pro_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_x', 'sub_x', 'active', now() - interval '1 hour', $2)`,
        [userId, randomUUID()],
      );
      expect(await hasProPlan(db, { id: userId, email: 'someone@example.com' })).toBe(false);
    });
  });

  it('false for a canceled subscription', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(
        `insert into pro_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_x', 'sub_x', 'canceled', now() + interval '5 days', $2)`,
        [userId, randomUUID()],
      );
      expect(await hasProPlan(db, { id: userId, email: 'someone@example.com' })).toBe(false);
    });
  });

  it('the allowlist still works independent of any subscription row', async () => {
    await withDb(async (db) => {
      process.env.PRO_ACCOUNT_EMAILS = 'vip@example.com';
      expect(await hasProPlan(db, { id: randomUUID(), email: 'vip@example.com' })).toBe(true);
    });
  });

  it('is false for everyone when PRO_ACCOUNT_EMAILS is unset and there is no subscription row (fail closed)', async () => {
    await withDb(async (db) => {
      expect(await hasProPlan(db, { id: randomUUID(), email: 'owner@example.com' })).toBe(false);
    });
  });

  it('is false when the user has no email and has no subscription row', async () => {
    await withDb(async (db) => {
      process.env.PRO_ACCOUNT_EMAILS = 'owner@example.com';
      expect(await hasProPlan(db, { id: randomUUID(), email: null })).toBe(false);
    });
  });
});
