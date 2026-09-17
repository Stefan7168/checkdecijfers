// Migration 030 (open-questions #205, ADR 006/020 revision pending): the Pro
// subscription tier's DB schema foundation. `pro_subscriptions` mirrors
// Stripe subscription state; `pro_bucket_ledger` is a separate, isolated
// append-only ledger for the monthly credit allowance — deliberately NOT a
// tag on `credit_transactions` (see the migration's own header for why).
// Verifies the constraint behavior the migration claims, not just "the file
// applies" — per CLAUDE.md's "structural, never pattern-based" standard,
// these must be enforced by the database itself. Mirrors migration-012/018/
// 027.test.ts's shape.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { applyMigrations, MIGRATIONS_DIR } from '../../src/db/migrate.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';

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

async function insertGrant(
  db: Db,
  opts: { userId: string; grantId: string; stripeInvoiceId: string },
): Promise<number> {
  const { rows } = await db.query(
    `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, stripe_invoice_id, note)
     values ($1, $2, 500, 'grant', $3, 'test grant')
     returning id`,
    [opts.userId, opts.grantId, opts.stripeInvoiceId],
  );
  return Number(rows[0]!.id);
}

async function insertDebit(
  db: Db,
  opts: { userId: string; grantId: string; requestId: string },
): Promise<number> {
  const { rows } = await db.query(
    `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, request_id, note)
     values ($1, $2, -10, 'debit', $3, 'test debit')
     returning id`,
    [opts.userId, opts.grantId, opts.requestId],
  );
  return Number(rows[0]!.id);
}

async function insertCompensation(
  db: Db,
  opts: { userId: string; grantId: string; relatedEntryId: number },
): Promise<number> {
  const { rows } = await db.query(
    `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, related_entry_id, note)
     values ($1, $2, 10, 'compensation', $3, 'test compensation')
     returning id`,
    [opts.userId, opts.grantId, opts.relatedEntryId],
  );
  return Number(rows[0]!.id);
}

describe('migration 030 is picked up by the migration scan', () => {
  it('applyMigrations records 030_pro_subscriptions.sql as applied', async () => {
    await withDb(async (db) => {
      const { rows } = await db.query(
        "select name from schema_migrations where name like '030_%' order by name",
      );
      expect(rows.map((r) => r.name)).toEqual(['030_pro_subscriptions.sql']);
    });
  });

  it('re-running applyMigrations against the same db is a no-op (idempotent scan)', async () => {
    await withDb(async (db) => {
      const applied = await applyMigrations(db, MIGRATIONS_DIR);
      expect(applied).toEqual([]);
    });
  });
});

describe('pro_subscriptions — one row per Pro user', () => {
  it('accepts a well-formed row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await expect(
        db.query(
          `insert into pro_subscriptions
             (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
           values ($1, 'cus_test', 'sub_test', 'active', now(), $2)`,
          [userId, randomUUID()],
        ),
      ).resolves.toBeTruthy();
    });
  });

  it('rejects a second row for the same user (user_id is the primary key)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(
        `insert into pro_subscriptions
           (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_test', 'sub_test_1', 'active', now(), $2)`,
        [userId, randomUUID()],
      );
      await expect(
        db.query(
          `insert into pro_subscriptions
             (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
           values ($1, 'cus_test', 'sub_test_2', 'active', now(), $2)`,
          [userId, randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('last_event_at defaults to now() when not supplied (Task 9 review: NOT the same column as updated_at)', async () => {
    // Amended after Task 9 code review (#205): a dedicated column, separate
    // from `updated_at`, tracks the Stripe EVENT's own `created` timestamp
    // for the webhook handler's out-of-order-delivery guard — see
    // src/billing/stripe-webhook.ts's upsertProSubscription doc and this
    // migration's own comment. `default now()` keeps every existing direct
    // insert (this file's and every other test file's) working unchanged.
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(
        `insert into pro_subscriptions
           (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_test', 'sub_last_event_default', 'active', now(), $2)`,
        [userId, randomUUID()],
      );
      const { rows } = await db.query(
        'select last_event_at, updated_at from pro_subscriptions where user_id = $1',
        [userId],
      );
      expect(rows[0]!.last_event_at).not.toBeNull();
      expect(rows[0]!.updated_at).not.toBeNull();
    });
  });

  it('last_event_at can be set independently of updated_at (a stale-event guard needs its own timeline)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      // An event's `created` far in the past, but the DB write itself
      // happens "now" — exactly the shape the webhook handler relies on to
      // tell "when Stripe generated this event" apart from "when we wrote
      // it."
      const pastEventSeconds = Math.floor(Date.now() / 1000) - 86400;
      await db.query(
        `insert into pro_subscriptions
           (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id, last_event_at)
         values ($1, 'cus_test', 'sub_last_event_explicit', 'active', now(), $2, to_timestamp($3))`,
        [userId, randomUUID(), pastEventSeconds],
      );
      const { rows } = await db.query(
        'select extract(epoch from last_event_at) as last_event_epoch, extract(epoch from updated_at) as updated_epoch ' +
          'from pro_subscriptions where user_id = $1',
        [userId],
      );
      expect(Math.floor(Number(rows[0]!.last_event_epoch))).toBe(pastEventSeconds);
      // updated_at (the DB write time, default now()) stays well after the
      // old event timestamp — proving the two columns carry independent
      // values, not a repurposed shared one.
      expect(Number(rows[0]!.updated_epoch)).toBeGreaterThan(pastEventSeconds);
    });
  });

  it('rejects two users sharing the same stripe_subscription_id (unique)', async () => {
    await withDb(async (db) => {
      await db.query(
        `insert into pro_subscriptions
           (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_a', 'sub_shared', 'active', now(), $2)`,
        [randomUUID(), randomUUID()],
      );
      await expect(
        db.query(
          `insert into pro_subscriptions
             (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
           values ($1, 'cus_b', 'sub_shared', 'active', now(), $2)`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('pro_bucket_ledger — reason/delta-sign CHECK', () => {
  it('accepts a positive grant delta with a stripe_invoice_id', async () => {
    await withDb(async (db) => {
      await expect(
        insertGrant(db, { userId: randomUUID(), grantId: randomUUID(), stripeInvoiceId: `in_${randomUUID()}` }),
      ).resolves.toBeTypeOf('number');
    });
  });

  it('rejects a negative grant delta (delta-sign CHECK)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, stripe_invoice_id, note)
           values ($1, $2, -500, 'grant', $3, 'bad sign')`,
          [randomUUID(), randomUUID(), `in_${randomUUID()}`],
        ),
      ).rejects.toThrow();
    });
  });

  it('accepts a negative debit delta with a request_id', async () => {
    await withDb(async (db) => {
      await expect(
        insertDebit(db, { userId: randomUUID(), grantId: randomUUID(), requestId: randomUUID() }),
      ).resolves.toBeTypeOf('number');
    });
  });

  it('rejects a positive debit delta (delta-sign CHECK)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, request_id, note)
           values ($1, $2, 10, 'debit', $3, 'bad sign')`,
          [randomUUID(), randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects an unrelated bogus reason (the enum is closed)', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, note)
           values ($1, $2, 1, 'not_a_real_reason', 'bogus')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('pro_bucket_ledger — request_id_scope CHECK', () => {
  it('rejects a debit row with no request_id', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, note)
           values ($1, $2, -10, 'debit', 'missing request id')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a grant row that also carries a request_id', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, request_id, stripe_invoice_id, note)
           values ($1, $2, 500, 'grant', $3, $4, 'request_id should not be set here')`,
          [randomUUID(), randomUUID(), randomUUID(), `in_${randomUUID()}`],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('pro_bucket_ledger — invoice_scope CHECK', () => {
  it('rejects a grant row with no stripe_invoice_id', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, note)
           values ($1, $2, 500, 'grant', 'missing invoice id')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a debit row that also carries a stripe_invoice_id', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, request_id, stripe_invoice_id, note)
           values ($1, $2, -10, 'debit', $3, $4, 'stripe_invoice_id should not be set here')`,
          [randomUUID(), randomUUID(), randomUUID(), `in_${randomUUID()}`],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('pro_bucket_ledger — related_scope CHECK', () => {
  it('rejects a compensation row with no related_entry_id', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, note)
           values ($1, $2, 10, 'compensation', 'missing related entry')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects a debit row that also carries a related_entry_id', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      const priorId = await insertGrant(db, { userId, grantId, stripeInvoiceId: `in_${randomUUID()}` });
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, request_id, related_entry_id, note)
           values ($1, $2, -10, 'debit', $3, $4, 'related_entry_id should not be set here')`,
          [userId, grantId, randomUUID(), priorId],
        ),
      ).rejects.toThrow();
    });
  });

  it('requires related_entry_id to reference a real pro_bucket_ledger row', async () => {
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, related_entry_id, note)
           values ($1, $2, 10, 'compensation', 999999, 'dangling reference')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow();
    });
  });
});

describe('pro_bucket_ledger — one grant per Stripe invoice', () => {
  it('rejects a second grant row for the same stripe_invoice_id (a retried invoice.paid delivery is a no-op)', async () => {
    await withDb(async (db) => {
      const invoiceId = `in_${randomUUID()}`;
      await insertGrant(db, { userId: randomUUID(), grantId: randomUUID(), stripeInvoiceId: invoiceId });
      await expect(
        insertGrant(db, { userId: randomUUID(), grantId: randomUUID(), stripeInvoiceId: invoiceId }),
      ).rejects.toThrow();
    });
  });

  it('two different invoices for the same user are not a conflict', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await expect(
        insertGrant(db, { userId, grantId: randomUUID(), stripeInvoiceId: `in_${randomUUID()}` }),
      ).resolves.toBeTypeOf('number');
      await expect(
        insertGrant(db, { userId, grantId: randomUUID(), stripeInvoiceId: `in_${randomUUID()}` }),
      ).resolves.toBeTypeOf('number');
    });
  });
});

describe('pro_bucket_ledger — one debit per (user, request)', () => {
  it('rejects a second debit row for the same (user_id, request_id)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      await insertDebit(db, { userId, grantId: randomUUID(), requestId });
      await expect(
        insertDebit(db, { userId, grantId: randomUUID(), requestId }),
      ).rejects.toThrow();
    });
  });

  it('the same request_id for a different user is not a conflict', async () => {
    await withDb(async (db) => {
      const requestId = randomUUID();
      await expect(
        insertDebit(db, { userId: randomUUID(), grantId: randomUUID(), requestId }),
      ).resolves.toBeTypeOf('number');
      await expect(
        insertDebit(db, { userId: randomUUID(), grantId: randomUUID(), requestId }),
      ).resolves.toBeTypeOf('number');
    });
  });

  it('a request_id shared with a credit_transactions question_cost row is not a conflict (fully isolated tables)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const requestId = randomUUID();
      await db.query(
        `insert into credit_transactions (user_id, delta, reason, request_id, note)
         values ($1, -20, 'question_cost', $2, 'main ledger debit')`,
        [userId, requestId],
      );
      await expect(
        insertDebit(db, { userId, grantId: randomUUID(), requestId }),
      ).resolves.toBeTypeOf('number');
    });
  });
});

describe('pro_bucket_ledger — one compensation per debit', () => {
  it('rejects a second compensation row for the same related_entry_id', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      const debitId = await insertDebit(db, { userId, grantId, requestId: randomUUID() });
      await insertCompensation(db, { userId, grantId, relatedEntryId: debitId });
      await expect(
        insertCompensation(db, { userId, grantId, relatedEntryId: debitId }),
      ).rejects.toThrow();
    });
  });

  it('two different debits may each be compensated once', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      const debitA = await insertDebit(db, { userId, grantId, requestId: randomUUID() });
      const debitB = await insertDebit(db, { userId, grantId, requestId: randomUUID() });
      await expect(insertCompensation(db, { userId, grantId, relatedEntryId: debitA })).resolves.toBeTypeOf(
        'number',
      );
      await expect(insertCompensation(db, { userId, grantId, relatedEntryId: debitB })).resolves.toBeTypeOf(
        'number',
      );
    });
  });
});

describe('pro_bucket_ledger — append-only, structurally enforced', () => {
  it('rejects UPDATE against a real row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debitId = await insertDebit(db, { userId, grantId: randomUUID(), requestId: randomUUID() });
      await expect(
        db.query('update pro_bucket_ledger set delta = 0 where id = $1', [debitId]),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('rejects DELETE against a real row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debitId = await insertDebit(db, { userId, grantId: randomUUID(), requestId: randomUUID() });
      await expect(db.query('delete from pro_bucket_ledger where id = $1', [debitId])).rejects.toThrow(
        /append-only/,
      );
    });
  });
});
