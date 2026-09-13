# Pro Subscription Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real, paid recurring Pro subscription (€19.99/month, 1000 credits/month that
reset unused, unlimited Live chart embeds), flag-gated off (`PRO_SUBSCRIPTIONS_ENABLED`), replacing
nothing that exists today — `PRO_ACCOUNT_EMAILS` stays as an owner-testing override.

**Architecture:** A new, fully isolated `pro_bucket_ledger` table (append-only, idempotent,
structurally identical in *shape* to `credit_transactions` but a separate table) tracks the
monthly allowance so the existing, heavily-tested `credit_transactions` schema needs **zero**
constraint changes. Every existing debit function keeps its exact signature and SQL; a new
`splitDebit`/`compensateSplit` layer in `ledger.ts` calls into the bucket ledger FIRST (capped at
what's available) and only calls the untouched existing debit functions for any remainder — for a
non-Pro user the bucket is always empty, so this collapses to exactly today's single ledger insert
(the regression pin every task below tests for).

**Tech Stack:** TypeScript, PGlite (hermetic Postgres, ADR 009), Stripe SDK (already a dependency),
Vitest, Next.js Server Actions.

**Spec:** [docs/superpowers/specs/2026-09-13-pro-subscription-tier-design.md](../specs/2026-09-13-pro-subscription-tier-design.md)
— read it first; this plan implements it and refines §2/§3's mechanism (see Task 1's note).

## Global Constraints

- Price: €19.99/month, 1000 credits/period (config-table-editable later per ADR 006 — hardcode as
  a named constant for this build, not a magic number).
- Reset: unused bucket credits are lost at renewal — implemented as "stop counting the old
  `grant_id`," never a clawback debit against `credit_transactions` (spec §2/owner decision 5).
- Cancellation/failed payment: access continues to `current_period_end` (owner decision 4) — no
  extra code needed, this falls out of reading Stripe's own `status`/`current_period_end` fields
  directly.
- Every existing `credit_transactions`-touching test must keep passing UNMODIFIED — the
  non-Pro/zero-bucket path must be byte-identical to pre-this-plan behavior in every task.
- `PRO_SUBSCRIPTIONS_ENABLED` gates every user-facing behavior change; absent/not `'1'` = today's
  exact behavior (same pattern as `ONBOARDING_ENABLED`, `web/app/actions.ts:333`).
- No real Stripe Price object, no real webhook subscription, no real charge — this plan produces
  code and hermetic tests only. Live wiring is a separate, owner-supervised RUNBOOK step (Task 12).

---

## Task 1: Migration 030 — `pro_subscriptions` and `pro_bucket_ledger`

**Refines spec §1/§2:** the spec sketched tagging `credit_transactions` rows with a nullable
`pro_grant_id` column. Building the exact idempotency keys revealed a real conflict: a split debit
needs up to two physical rows sharing one `(user_id, request_id)` pair, which collides with all
four existing per-reason unique indexes (`credit_transactions_one_debit_per_request` and its
onboarding/websearch/dataset siblings) unless every one of them is altered. A separate,
structurally-identical-but-isolated `pro_bucket_ledger` table avoids touching
`credit_transactions`'s schema at all — lower blast radius on the most heavily tested code in the
product, at the cost of one new (small, simple) table. This is the refinement to build against.

**Files:**
- Create: `migrations/030_pro_subscriptions.sql`
- Test: `tests/db/migrations.test.ts` (existing file — add this migration to whatever list/count
  assertion it already keeps; read the file first, follow its existing pattern exactly)

**Interfaces:**
- Produces: table `pro_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status,
  current_period_end, current_period_grant_id, created_at, updated_at)` — one row per Pro user.
- Produces: table `pro_bucket_ledger (id, created_at, user_id, grant_id, delta, reason, request_id,
  related_entry_id, stripe_invoice_id, note)` — append-only, mirrors `credit_transactions`'s own
  invariant shape (delta-sign CHECK, request_id-scope CHECK, idempotent unique indexes).

- [ ] **Step 1: Write the migration file**

```sql
-- 030 — Pro subscription tier (open-questions #205, ADR 006/020 revision
-- pending — docs/superpowers/specs/2026-09-13-pro-subscription-tier-design.md).
-- Two tables. `pro_subscriptions` is the Stripe-subscription mirror (one row
-- per Pro user, upserted from webhook events). `pro_bucket_ledger` is a
-- SEPARATE, isolated append-only ledger for the monthly credit allowance —
-- deliberately NOT a column/tag on `credit_transactions`: an earlier design
-- tried tagging existing rows, but a split debit (part bucket, part
-- permanent ledger) needs two physical rows sharing one (user_id,
-- request_id) idempotency key, which collides with every existing per-reason
-- unique index on that table (credit_transactions_one_debit_per_request and
-- its onboarding/websearch/dataset siblings). This table is structurally
-- identical in spirit (append-only, delta-sign CHECK, idempotent unique
-- indexes) but fully isolated, so `credit_transactions` needs ZERO schema
-- changes for this feature.

create table pro_subscriptions (
  user_id uuid primary key,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  status text not null,
  current_period_end timestamptz not null,
  current_period_grant_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Guarded FK to auth.users, conditional on the auth schema existing —
-- migration 026's exact pattern (itself migration 019's/005's). No `on
-- delete cascade`: redact-not-delete posture, same as every other user_id
-- table in this codebase.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table pro_subscriptions add constraint pro_subscriptions_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;

create table pro_bucket_ledger (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null,
  grant_id uuid not null,
  -- positive = granted or refunded back, negative = spent
  delta integer not null,
  reason text not null check (reason in ('grant', 'debit', 'compensation')),
  -- required for 'debit' (the caller's client-generated idempotency key,
  -- same contract as credit_transactions.request_id); null otherwise.
  request_id uuid,
  -- compensation -> the debit it reverses.
  related_entry_id bigint references pro_bucket_ledger(id),
  -- required for 'grant' — the Stripe invoice ID, so a retried invoice.paid
  -- webhook delivery never double-grants.
  stripe_invoice_id text,
  note text not null,

  constraint pro_bucket_ledger_delta_sign check (
    (reason = 'debit' and delta < 0) or
    (reason in ('grant', 'compensation') and delta > 0)
  ),
  constraint pro_bucket_ledger_request_id_scope check (
    (reason = 'debit') = (request_id is not null)
  ),
  constraint pro_bucket_ledger_invoice_scope check (
    (reason = 'grant') = (stripe_invoice_id is not null)
  ),
  constraint pro_bucket_ledger_related_scope check (
    (reason = 'compensation') = (related_entry_id is not null)
  )
);

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table pro_bucket_ledger add constraint pro_bucket_ledger_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;

create index pro_bucket_ledger_by_user_grant on pro_bucket_ledger (user_id, grant_id);
-- One grant per Stripe invoice — a retried invoice.paid delivery is a no-op.
create unique index pro_bucket_ledger_one_grant_per_invoice
  on pro_bucket_ledger (stripe_invoice_id) where reason = 'grant';
-- One debit per (user, client request) — mirrors
-- credit_transactions_one_debit_per_request exactly, in this table's own
-- namespace (no collision risk with the main ledger's indexes, since this
-- is a different table).
create unique index pro_bucket_ledger_one_debit_per_request
  on pro_bucket_ledger (user_id, request_id) where reason = 'debit';
-- One compensation per debit — mirrors credit_transactions_one_compensation_per_debit.
create unique index pro_bucket_ledger_one_compensation_per_debit
  on pro_bucket_ledger (related_entry_id) where reason = 'compensation';

-- Append-only, same structural enforcement as credit_transactions (migration
-- 005) — a financial trail, never mutated after the fact.
create function pro_bucket_ledger_no_mutation() returns trigger as $$
begin
  raise exception 'pro_bucket_ledger is append-only';
end;
$$ language plpgsql;

create trigger pro_bucket_ledger_no_mutation_trigger
  before update or delete on pro_bucket_ledger
  for each row execute function pro_bucket_ledger_no_mutation();
```

- [ ] **Step 2: Read `migrations/005_credit_ledger.sql`'s own append-only trigger** (the section
  right after the unique indexes, before "Append-only, enforced structurally") to confirm the
  trigger function/trigger syntax above matches this codebase's exact existing convention
  (function name, trigger name, language) — copy its precise shape rather than the sketch above if
  they differ in any naming or clause.

- [ ] **Step 3: Read `tests/db/migrations.test.ts` in full**, find where it asserts something about
  "all migrations apply cleanly" or enumerates migration files/count, and add `030` to whatever
  that assertion covers, following the file's own existing pattern exactly (do not guess the
  assertion shape — read it first).

- [ ] **Step 4: Apply and verify**

Run: `npx vitest run tests/db`
Expected: PASS, including the updated migration-count/list assertion.

- [ ] **Step 5: Commit**

```bash
git add migrations/030_pro_subscriptions.sql tests/db/migrations.test.ts
git commit -m "db: migration 030 — pro_subscriptions + pro_bucket_ledger (#205)"
```

---

## Task 2: `src/billing/pro-bucket.ts` — bucket ledger primitives

Pure DB primitives over `pro_bucket_ledger`, no wiring into `gate.ts`/`ledger.ts` yet — fully
testable in isolation, mirrors `ledger.ts`'s own primitive style (idempotent inserts via
`on conflict ... do nothing returning id`, never a caught unique-violation).

**Files:**
- Create: `src/billing/pro-bucket.ts`
- Test: `tests/billing/pro-bucket.test.ts`

**Interfaces:**
- Consumes: `Db` from `../db/types.ts` (existing).
- Produces: `getBucketBalance(db, userId, grantId): Promise<number>`,
  `grantBucket(db, userId, grantId, credits, stripeInvoiceId): Promise<{id:number}|null>`,
  `debitBucket(db, userId, grantId, requestId, credits, note): Promise<{id:number}|null>`,
  `compensateBucket(db, userId, debitEntryId, credits): Promise<{id:number}|null>` — all consumed
  by Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/billing/pro-bucket.test.ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compensateBucket,
  debitBucket,
  getBucketBalance,
  grantBucket,
} from '../../src/billing/pro-bucket.ts';
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

describe('pro-bucket ledger', () => {
  it('a fresh grant balance is 0 before any grant', async () => {
    await withDb(async (db) => {
      expect(await getBucketBalance(db, randomUUID(), randomUUID())).toBe(0);
    });
  });

  it('grantBucket credits the balance; a repeated stripeInvoiceId is a no-op', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      const invoiceId = `in_${randomUUID()}`;
      const first = await grantBucket(db, userId, grantId, 1000, invoiceId);
      expect(first).not.toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
      const second = await grantBucket(db, userId, grantId, 1000, invoiceId);
      expect(second).toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
    });
  });

  it('debitBucket debits the balance; a repeated requestId is a no-op', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const requestId = randomUUID();
      const first = await debitBucket(db, userId, grantId, requestId, 300, 'test debit');
      expect(first).not.toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(700);
      const second = await debitBucket(db, userId, grantId, requestId, 300, 'test debit');
      expect(second).toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(700);
    });
  });

  it('a debit against a DIFFERENT grantId than the current one still writes (caller decides which grant is current) but does not affect the other grant\'s balance', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantA = randomUUID();
      const grantB = randomUUID();
      await grantBucket(db, userId, grantA, 1000, `in_${randomUUID()}`);
      await grantBucket(db, userId, grantB, 1000, `in_${randomUUID()}`);
      await debitBucket(db, userId, grantA, randomUUID(), 400, 'test');
      expect(await getBucketBalance(db, userId, grantA)).toBe(600);
      expect(await getBucketBalance(db, userId, grantB)).toBe(1000);
    });
  });

  it('compensateBucket refunds credits tied to the original debit; a repeated call for the same debit is a no-op', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const debit = await debitBucket(db, userId, grantId, randomUUID(), 400, 'test');
      const first = await compensateBucket(db, userId, debit!.id, 400);
      expect(first).not.toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
      const second = await compensateBucket(db, userId, debit!.id, 400);
      expect(second).toBeNull();
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
    });
  });

  it('the append-only trigger rejects an UPDATE against a real row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      const entry = await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      await expect(
        db.query('update pro_bucket_ledger set delta = 0 where id = $1', [entry!.id]),
      ).rejects.toThrow(/append-only/);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/pro-bucket.test.ts`
Expected: FAIL — `src/billing/pro-bucket.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/billing/pro-bucket.ts
// The Pro monthly-allowance bucket ledger (migration 030, open-questions
// #205) — append-only, structurally isolated from credit_transactions (see
// migration 030's own header comment for why). Balance for a given grant =
// SUM(delta) WHERE user_id AND grant_id match; there is no mutable counter.
import type { Db } from '../db/types.ts';

export interface BucketLedgerEntry {
  id: number;
}

export async function getBucketBalance(db: Db, userId: string, grantId: string): Promise<number> {
  const { rows } = await db.query(
    'select coalesce(sum(delta), 0) as balance from pro_bucket_ledger where user_id = $1 and grant_id = $2',
    [userId, grantId],
  );
  return Number(rows[0]!.balance);
}

/** Idempotent per stripeInvoiceId — a retried invoice.paid webhook delivery
 * is a no-op, never a double grant. */
export async function grantBucket(
  db: Db,
  userId: string,
  grantId: string,
  credits: number,
  stripeInvoiceId: string,
): Promise<BucketLedgerEntry | null> {
  const { rows } = await db.query(
    `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, stripe_invoice_id, note)
     values ($1, $2, $3, 'grant', $4, 'pro monthly allowance grant')
     on conflict (stripe_invoice_id) where reason = 'grant' do nothing
     returning id`,
    [userId, grantId, credits, stripeInvoiceId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

/** Idempotent per (userId, requestId) — a repeated client request is a
 * no-op, mirroring credit_transactions' debit functions exactly. Does NOT
 * check balance itself (mirrors debitQuestion's own contract) — see
 * ledger.ts's splitDebit, which reads getBucketBalance first. */
export async function debitBucket(
  db: Db,
  userId: string,
  grantId: string,
  requestId: string,
  credits: number,
  note: string,
): Promise<BucketLedgerEntry | null> {
  const { rows } = await db.query(
    `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, request_id, note)
     values ($1, $2, $3, 'debit', $4, $5)
     on conflict (user_id, request_id) where reason = 'debit' do nothing
     returning id`,
    [userId, grantId, -credits, requestId, note],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

/** Idempotent per debitEntryId — a repeated compensation call for the same
 * debit is a no-op, mirroring credit_transactions.compensate() exactly.
 * Looks up the debit's own grant_id so the refund lands back in the SAME
 * grant it was taken from, even if a different grant is current by now. */
export async function compensateBucket(
  db: Db,
  userId: string,
  debitEntryId: number,
  credits: number,
): Promise<BucketLedgerEntry | null> {
  const { rows } = await db.query(
    `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, related_entry_id, note)
     select user_id, grant_id, $2, 'compensation', id, 'pro allowance refund'
     from pro_bucket_ledger where id = $1 and user_id = $3
     on conflict (related_entry_id) where reason = 'compensation' do nothing
     returning id`,
    [debitEntryId, credits, userId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/pro-bucket.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/billing/pro-bucket.ts tests/billing/pro-bucket.test.ts
git commit -m "billing: pro-bucket ledger primitives (#205)"
```

---

## Task 3: `splitDebit`/`compensateSplit` in `ledger.ts`

The layer that decides how much of a charge comes from the bucket vs. the permanent ledger. Calls
the EXISTING debit functions unchanged for the ledger portion — this is the piece that guarantees
a non-Pro user's behavior is byte-identical to today.

**Files:**
- Modify: `src/billing/ledger.ts`
- Test: `tests/billing/ledger-split.test.ts` (new file — keeps this addition separate from
  `ledger.test.ts`'s existing 58 tests, which stay untouched by this task)

**Interfaces:**
- Consumes: `getBucketBalance`, `debitBucket`, `compensateBucket` from `./pro-bucket.ts` (Task 2);
  `getCurrentGrantId` (new, this task, reads `pro_subscriptions.current_period_grant_id` — `null`
  if no row or `hasProPlan`-equivalent check fails, but this function only reads the DB row, the
  `hasProPlan` allowlist check happens one layer up in Task 4+).
- Produces: `getCurrentGrantId(db, userId): Promise<string|null>`,
  `getSpendableBalance(db, userId): Promise<number>` (permanent + current bucket, for display),
  `SplitDebitResult` type and `splitDebit(tx, userId, requestId, credits, debitFn, note):
  Promise<SplitDebitResult>`, `compensateSplit(db, userId, split: SplitDebitResult, refundCredits,
  auditAnswerId): Promise<void>` — consumed by Tasks 4-6.
  **AS BUILT (Task 4 fix rounds 1-2, 2026-09-14):** `splitDebit`'s `debitFn` parameter became a
  `debit: LedgerDebit` descriptor — `splitDebit(tx, userId, requestId, credits, debit, note,
  grantId?)`. A `LedgerDebit` is `{ reason, write }`: the debit primitive bound to the
  `credit_transactions` reason it writes. `ledger.ts` exports one per action type —
  `QUESTION_DEBIT`, `ONBOARDING_DEBIT`, `WEBSEARCH_DEBIT`, `DATASET_DEBIT` — so pass the
  descriptor, never the bare function. The reason is what scopes the new cross-ledger idempotency
  check on `credit_transactions` (each table's own `on conflict` is blind to a retry that lands on
  the OTHER table), and binding it to the primitive makes it structurally impossible for the reason
  checked and the reason written to drift apart. Task 6's snippets below are updated to match.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/billing/ledger-split.test.ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { debitQuestion, getBalance } from '../../src/billing/ledger.ts';
import { splitDebit, compensateSplit, getCurrentGrantId, getSpendableBalance } from '../../src/billing/ledger.ts';
import { grantBucket, getBucketBalance } from '../../src/billing/pro-bucket.ts';
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

async function seedSignup(db: Db, userId: string, credits: number): Promise<void> {
  await db.query(
    `insert into credit_transactions (user_id, delta, reason, note) values ($1, $2, 'signup_grant', 'test seed')`,
    [userId, credits],
  );
}

describe('splitDebit — non-Pro user (no grant row)', () => {
  it('is byte-identical to a plain debitQuestion call: one ledger row, bucket untouched', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await seedSignup(db, userId, 100);
      const requestId = randomUUID();
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, requestId, 20, debitQuestion, 'question debit'),
      );
      expect(split.fromBucket).toBe(0);
      expect(split.fromLedger).toBe(20);
      expect(split.bucketEntry).toBeNull();
      expect(split.ledgerEntry).not.toBeNull();
      expect(await getBalance(db, userId)).toBe(80);
    });
  });
});

describe('splitDebit — Pro user with an active bucket', () => {
  it('debits the bucket FIRST, only the remainder from the ledger', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, randomUUID(), 20, debitQuestion, 'question debit', grantId),
      );
      expect(split.fromBucket).toBe(15);
      expect(split.fromLedger).toBe(5);
      expect(await getBucketBalance(db, userId, grantId)).toBe(0);
      expect(await getBalance(db, userId)).toBe(95); // 100 - 5
    });
  });

  it('debits ONLY the bucket when it fully covers the charge — zero credit_transactions rows written', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, randomUUID(), 20, debitQuestion, 'question debit', grantId),
      );
      expect(split.fromBucket).toBe(20);
      expect(split.fromLedger).toBe(0);
      expect(split.ledgerEntry).toBeNull();
      expect(await getBalance(db, userId)).toBe(100); // untouched
      expect(await getBucketBalance(db, userId, grantId)).toBe(980);
    });
  });

  it('getSpendableBalance sums permanent balance + current bucket', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      expect(await getSpendableBalance(db, userId, grantId)).toBe(1100);
      expect(await getSpendableBalance(db, userId, null)).toBe(100);
    });
  });
});

describe('compensateSplit', () => {
  it('a full refund reverses both the bucket and the ledger portion, in the same proportion as the original charge', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, randomUUID(), 20, debitQuestion, 'question debit', grantId),
      );
      await compensateSplit(db, userId, split, 20, null);
      expect(await getBalance(db, userId)).toBe(100);
      expect(await getBucketBalance(db, userId, grantId)).toBe(15);
    });
  });

  it('a partial refund reverses the bucket portion first, then the ledger', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const grantId = randomUUID();
      await seedSignup(db, userId, 100);
      await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
      const split = await db.withTransaction((tx) =>
        splitDebit(tx, userId, randomUUID(), 20, debitQuestion, 'question debit', grantId),
      ); // fromBucket=15, fromLedger=5, balances now: ledger=95, bucket=0
      await compensateSplit(db, userId, split, 10, null); // refund 10: 10 back to bucket (capped at fromBucket=15), 0 to ledger
      expect(await getBucketBalance(db, userId, grantId)).toBe(10);
      expect(await getBalance(db, userId)).toBe(95);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/ledger-split.test.ts`
Expected: FAIL — `splitDebit`, `compensateSplit`, `getCurrentGrantId`, `getSpendableBalance` are
not exported from `ledger.ts` yet.

- [ ] **Step 3: Add to `src/billing/ledger.ts`** (append near the top, after `getBalance`, and near
  the bottom, after `compensate`; do not reorder or touch any existing function):

```ts
// Below getBalance():
import { compensateBucket, debitBucket, getBucketBalance } from './pro-bucket.ts';

/** null if the user has no active Pro subscription row, or it has lapsed
 * (current_period_end in the past) — the SAME condition src/billing/pro.ts's
 * hasProPlan checks for the subscription-row half of its OR (Task 4/7 wires
 * hasProPlan itself; this is the lower-level DB read splitDebit needs). */
export async function getCurrentGrantId(db: Db, userId: string): Promise<string | null> {
  const { rows } = await db.query(
    `select current_period_grant_id from pro_subscriptions
     where user_id = $1 and status in ('active', 'trialing', 'past_due') and current_period_end > now()`,
    [userId],
  );
  const row = rows[0];
  return row === undefined ? null : String(row.current_period_grant_id);
}

export async function getSpendableBalance(db: Db, userId: string, grantId: string | null): Promise<number> {
  const permanent = await getBalance(db, userId);
  const bucket = grantId === null ? 0 : await getBucketBalance(db, userId, grantId);
  return permanent + bucket;
}

// Below compensate(), a new section:

export interface SplitDebitResult {
  fromBucket: number;
  fromLedger: number;
  bucketEntry: { id: number } | null;
  ledgerEntry: LedgerEntry | null;
}

type DebitFn = (db: Db, userId: string, requestId: string, credits: number) => Promise<LedgerEntry | null>;

/** Splits one logical charge between the Pro bucket (spent first) and the
 * permanent ledger (the remainder). MUST be called inside the same
 * advisory-locked transaction as the caller's existing balance check
 * (reserveDebit's pattern) — never as a separate statement, or it
 * reintroduces the exact race pg_advisory_xact_lock exists to close.
 * `debitFn` is the existing, UNCHANGED debit primitive for this action type
 * (debitQuestion, debitOnboarding, debitWebSearch, or debitDataset) — called
 * with ONLY the ledger portion, so a fully-bucket-funded charge writes zero
 * credit_transactions rows (the byte-identical-for-non-Pro guarantee: when
 * grantId is null or the bucket is empty, fromBucket is always 0 and this
 * collapses to exactly today's single debitFn call with the full amount). */
export async function splitDebit(
  tx: Db,
  userId: string,
  requestId: string,
  credits: number,
  debitFn: DebitFn,
  note: string,
  grantId: string | null = null,
): Promise<SplitDebitResult> {
  const bucketBalance = grantId === null ? 0 : await getBucketBalance(tx, userId, grantId);
  const fromBucket = Math.min(credits, bucketBalance);
  const fromLedger = credits - fromBucket;
  const bucketEntry = fromBucket > 0 ? await debitBucket(tx, userId, grantId!, requestId, fromBucket, note) : null;
  const ledgerEntry = fromLedger > 0 ? await debitFn(tx, userId, requestId, fromLedger) : null;
  return { fromBucket, fromLedger, bucketEntry, ledgerEntry };
}

/** Refunds a split debit, bucket portion first (capped at what was actually
 * taken from it), then the ledger portion — the exact inverse order of
 * splitDebit's consumption, so a full refund (refundCredits === the
 * original `credits`) exactly undoes it, and a partial refund (the
 * clarification-price case) always tops up the bucket before the ledger. */
export async function compensateSplit(
  db: Db,
  userId: string,
  split: SplitDebitResult,
  refundCredits: number,
  auditAnswerId: number | null,
): Promise<void> {
  let remaining = refundCredits;
  if (split.bucketEntry !== null && remaining > 0) {
    const amount = Math.min(remaining, split.fromBucket);
    await compensateBucket(userId ? db : db, userId, split.bucketEntry.id, amount);
    remaining -= amount;
  }
  if (split.ledgerEntry !== null && remaining > 0) {
    const amount = Math.min(remaining, split.fromLedger);
    await compensate(db, userId, split.ledgerEntry.id, amount, auditAnswerId);
    remaining -= amount;
  }
}
```

(The `userId ? db : db` in `compensateSplit` is a typo to fix while implementing — it should just
be `db`; left visible here as a deliberate reminder to read code back before committing, not copy
it blindly.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/ledger-split.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Run the FULL existing billing suite to confirm zero regression**

Run: `npx vitest run tests/billing`
Expected: PASS — every one of `ledger.test.ts`'s existing 58 tests unchanged, plus the two new
files.

- [ ] **Step 6: Commit**

```bash
git add src/billing/ledger.ts tests/billing/ledger-split.test.ts
git commit -m "billing: splitDebit/compensateSplit — bucket-first spend order (#205)"
```

---

## Task 4: Wire into `reserveDebit`/`chargeAndRun` (the hot path)

**Files:**
- Modify: `src/billing/ledger.ts` (`reserveDebit`'s body only)
- Modify: `src/billing/gate.ts` (`chargeAndRun`'s body only)
- Test: `tests/billing/ledger.test.ts` (existing `reserveDebit` tests — add Pro-bucket cases
  alongside, do not remove or rewrite any existing test)
- Test: `tests/billing/gate.test.ts` (existing file — same treatment)

**Interfaces:**
- Consumes: `splitDebit`, `compensateSplit`, `getCurrentGrantId`, `getSpendableBalance` (Task 3).
- Produces: `ReserveDebitResult`'s `'debited'` variant now carries `split: SplitDebitResult`
  instead of bare `entry: LedgerEntry` — **this is a breaking change to the type**, so `gate.ts`
  (the only caller) must be updated in the same commit.

- [ ] **Step 1: Read `tests/billing/ledger.test.ts`'s existing `reserveDebit` describe block and
  `tests/billing/gate.test.ts` in full** — this task modifies a type other tests depend on; know
  exactly what asserts on `reservation.entry.id` today before changing its shape.

- [ ] **Step 2: Write the new failing tests** (add to `tests/billing/ledger.test.ts`, inside or
  near the existing `reserveDebit` describe block):

```ts
describe('reserveDebit — Pro bucket integration', () => {
  it('a Pro user with bucket balance spends from the bucket, not the ledger', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(`insert into credit_transactions (user_id, delta, reason, note) values ($1, 100, 'signup_grant', 'seed')`, [userId]);
      const grantId = randomUUID();
      await db.query(
        `insert into pro_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_x', 'sub_x', 'active', now() + interval '20 days', $2)`,
        [userId, grantId],
      );
      const { grantBucket, getBucketBalance } = await import('../../src/billing/pro-bucket.ts');
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const result = await reserveDebit(db, userId, randomUUID(), 20);
      expect(result.kind).toBe('debited');
      expect(await getBalance(db, userId)).toBe(100); // permanent balance untouched
      expect(await getBucketBalance(db, userId, grantId)).toBe(980);
    });
  });

  it('a non-Pro user (no pro_subscriptions row) behaves exactly as before this task', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(`insert into credit_transactions (user_id, delta, reason, note) values ($1, 100, 'signup_grant', 'seed')`, [userId]);
      const result = await reserveDebit(db, userId, randomUUID(), 20);
      expect(result.kind).toBe('debited');
      expect(await getBalance(db, userId)).toBe(80);
    });
  });

  it('insufficient-credits check counts bucket + ledger together', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(`insert into credit_transactions (user_id, delta, reason, note) values ($1, 5, 'signup_grant', 'seed')`, [userId]);
      const grantId = randomUUID();
      await db.query(
        `insert into pro_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_x', 'sub_x', 'active', now() + interval '20 days', $2)`,
        [userId, grantId],
      );
      const { grantBucket } = await import('../../src/billing/pro-bucket.ts');
      await grantBucket(db, userId, grantId, 10, `in_${randomUUID()}`);
      // 5 ledger + 10 bucket = 15 spendable, need 20 -> insufficient
      const result = await reserveDebit(db, userId, randomUUID(), 20);
      expect(result.kind).toBe('insufficient');
    });
  });

  it('a LAPSED subscription (current_period_end in the past) is treated as non-Pro', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(`insert into credit_transactions (user_id, delta, reason, note) values ($1, 100, 'signup_grant', 'seed')`, [userId]);
      const grantId = randomUUID();
      await db.query(
        `insert into pro_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
         values ($1, 'cus_x', 'sub_x', 'canceled', now() - interval '1 day', $2)`,
        [userId, grantId],
      );
      const { grantBucket, getBucketBalance } = await import('../../src/billing/pro-bucket.ts');
      await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
      const result = await reserveDebit(db, userId, randomUUID(), 20);
      expect(result.kind).toBe('debited');
      expect(await getBalance(db, userId)).toBe(80); // spent from the ledger, bucket ignored
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000); // untouched
    });
  });
});
```

- [ ] **Step 3: Run to verify these fail**

Run: `npx vitest run tests/billing/ledger.test.ts -t "Pro bucket integration"`
Expected: FAIL (type errors / `reservation.entry` shape mismatch once Step 4 lands, or logic
failures before it).

- [ ] **Step 4: Modify `reserveDebit`**

```ts
export type ReserveDebitResult =
  | { kind: 'debited'; split: SplitDebitResult }
  | { kind: 'insufficient'; balance: number }
  | { kind: 'duplicate' };

export async function reserveDebit(
  db: Db,
  userId: string,
  requestId: string,
  required: number,
): Promise<ReserveDebitResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [userId]);
    const grantId = await getCurrentGrantId(tx, userId);
    const balance = await getSpendableBalance(tx, userId, grantId);
    if (balance < required) {
      return { kind: 'insufficient', balance };
    }
    const split = await splitDebit(tx, userId, requestId, required, debitQuestion, 'question debit', grantId);
    if (split.bucketEntry === null && split.ledgerEntry === null) {
      return { kind: 'duplicate' };
    }
    return { kind: 'debited', split };
  });
}
```

Note the duplicate-detection change: previously a single `entry === null` check; now a split can
have EITHER half be a no-op-retry independently in theory, but in practice both halves share one
`requestId` and are written in the same transaction on the first call, so on a genuine retry BOTH
`debitBucket` and `debitFn` return `null` together (their own idempotent `on conflict` fires for
both) — `bucketEntry === null && ledgerEntry === null` is the correct "this exact request was
already fully processed" signal. A partial-null case (e.g. `fromBucket` was 0 this call because
the retry recomputed a different split) cannot happen: `requestId` uniqueness means a genuine retry
recomputes `fromBucket`/`fromLedger` identically only if nothing about the account changed between
calls — if it DID change (e.g. a renewal landed between the original call and the retry), the retry
correctly gets treated as a new debit with the currently-correct split, which is desired, not a bug.

- [ ] **Step 5: Modify `chargeAndRun` in `gate.ts`**

```ts
export async function chargeAndRun(
  db: Db,
  userId: string,
  requestId: string,
  run: () => Promise<AuditedResponse>,
): Promise<GatedResponse> {
  const required = await getActionClassPrice(db, 'simple');
  const reservation = await reserveDebit(db, userId, requestId, required);
  if (reservation.kind === 'insufficient') {
    return { kind: 'insufficient_credits', balance: reservation.balance, required };
  }
  if (reservation.kind === 'duplicate') {
    return { kind: 'duplicate_request' };
  }
  const split = reservation.split;

  try {
    const result = await run();
    let netCost = required;
    if (result.response.kind === 'clarification') {
      const clarifyPrice = await getActionClassPrice(db, 'clarification');
      const refund = required - clarifyPrice;
      if (refund > 0) {
        await compensateSplit(db, userId, split, refund, result.auditId);
        netCost = clarifyPrice;
      }
    } else if (result.response.kind !== 'answer') {
      await compensateSplit(db, userId, split, required, result.auditId);
      netCost = 0;
    }
    return { kind: 'ok', ...result, netCost };
  } catch (error) {
    await compensateSplit(db, userId, split, required, null);
    throw error;
  }
}
```

Import `compensateSplit` alongside the existing `compensate, getActionClassPrice, reserveDebit`
import at the top of `gate.ts` (drop the now-unused `compensate` import if nothing else in the
file uses it directly — check before removing).

- [ ] **Step 6: Run to verify everything passes**

Run: `npx vitest run tests/billing`
Expected: PASS — every existing test in `ledger.test.ts` and `gate.test.ts` plus the new Pro-bucket
cases.

- [ ] **Step 7: Run the FULL backend suite** (this task touches the hottest path in the product —
  confirm nothing elsewhere silently depended on `ReserveDebitResult`'s old `entry` field)

Run: `npx vitest run` (full backend suite, ~148 files)
Expected: PASS. If anything outside `tests/billing`/`tests/audit` fails referencing
`reservation.entry`, grep the whole repo for `.entry.id` / `reservation.entry` and fix every call
site found — this step exists specifically to catch a caller this plan's author didn't find.

Run: `grep -rn "reservation.entry\|\.entry\.id" src/ web/ --include="*.ts" --include="*.tsx"`

- [ ] **Step 8: Commit**

```bash
git add src/billing/ledger.ts src/billing/gate.ts tests/billing/ledger.test.ts
git commit -m "billing: wire bucket-first spend into reserveDebit/chargeAndRun (#205)"
```

---

## Task 5: Onboarding stays permanent-ledger-only — a deliberate exclusion, documented

**Scope change from the original task list, found while designing this task in detail:**
`pending_table_requests.debit_transaction_id` (migration 012) is `not null`, and
`src/ingestion/onboarding.ts:142`'s refund path reads it back directly:
`await compensate(db, row.userId, row.debitTransactionId, amount, auditAnswerId)`. Making
onboarding bucket-eligible would need a second nullable FK column on `pending_table_requests`
(for a bucket-funded debit's id) AND a split-aware refund rewrite in `onboarding.ts` — real schema
and persistence-layer growth for a debit type that's rare, heavy (100 credits — a large fraction
of any realistic bucket), and one-off in a way routine Q&A isn't. **Decision: onboarding debits
never draw from the Pro bucket.** `reserveOnboardingDebit` and `triggerOnboarding` are NOT
modified by this plan at all — they keep calling `getBalance` (not `getSpendableBalance`) and stay
byte-identical to their pre-this-plan behavior for every user, Pro or not. The Pro monthly
allowance is a routine-usage perk; a new CBS table onboarding always spends permanent credits,
same as today.

**Files:**
- Modify: `src/billing/ledger.ts` — add a one-line doc-comment note to `reserveOnboardingDebit`'s
  existing comment block recording this deliberate exclusion and pointing at this plan, so a future
  reader doesn't assume it was simply missed.

**Interfaces:** none — no behavior change, no new code.

- [ ] **Step 1: Read `reserveOnboardingDebit`'s existing doc comment** in `src/billing/ledger.ts`
  and append one sentence: *"Deliberately excluded from the Pro-bucket spend-first mechanic
  (open-questions #205) — see docs/superpowers/plans/2026-09-13-pro-subscription-tier.md Task 5:
  onboarding's 100-credit cost and its own refund path (pending_table_requests.debit_transaction_id,
  not-null) made bucket-eligibility real schema growth for a rare, heavy, one-off action; it always
  spends permanent credits."*

- [ ] **Step 2: Run the existing onboarding tests to confirm nothing changed**

Run: `npx vitest run tests/ingestion`
Expected: PASS, identical results to before this task (no code changed, only a comment).

- [ ] **Step 3: Commit**

```bash
git add src/billing/ledger.ts
git commit -m "docs: record onboarding's deliberate exclusion from the Pro bucket (#205)"
```

---

## Task 6: Wire into `reserveWebSearchDebit` + `reserveDatasetDebit`

Both structurally identical to `reserveDebit`/`chargeAndRun` (Task 4) — by this point the pattern
is proven, this task is the mechanical repeat. Call sites confirmed by reading the actual code:
`web/app/actions.ts` (web-search, two near-identical occurrences — inside `askQuestion` around
line 506 and inside `replyToClarification` around line 792, each with its own `webDebitHolder` +
`settleWebAddon` pairing) and `src/billing/dataset-gate.ts`'s `chargeAndRunDataset` (byte-for-byte
the same shape as `gate.ts`'s `chargeAndRun`, Task 4's already-solved case).

**Files:**
- Modify: `src/billing/ledger.ts` (`reserveWebSearchDebit`, `reserveDatasetDebit`)
- Modify: `src/billing/dataset-gate.ts` (`chargeAndRunDataset`)
- Modify: `web/app/actions.ts` (both `webDebitHolder`/`settleWebAddon` call sites)
- Test: `tests/billing/ledger.test.ts`, `tests/billing/dataset-gate.test.ts` (existing — read
  first), `web/app/actions.test.ts` or wherever the web-search closure is covered (read first)

**Interfaces:**
- Same as Task 4, applied to `ReserveWebSearchDebitResult` and `ReserveDatasetDebitResult`.

- [ ] **Step 1: Write the failing tests** — same four-test shape as Task 4, once for
  `reserveWebSearchDebit` (10-credit price) and once for `reserveDatasetDebit` (20-credit price,
  per `09-pricing.md`'s `dataset_turn` price) — 8 new tests total, in `tests/billing/ledger.test.ts`.
  **Plus one more, specifically for the landmine this task exists to avoid:** call `reserveDebit`
  for a question under some `requestId` (fully draining an active Pro bucket, so the debit lands
  in the bucket), then call `reserveWebSearchDebit` with that SAME base `requestId` for the add-on
  that rides alongside it — assert the add-on is NOT treated as a duplicate of the question's own
  debit (both succeed as independent debits; total credits removed = both amounts, not one).
  Without the internal `${requestId}:websearch` disambiguation this test fails exactly the way the
  Task 4 finding described. 9 new tests total.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Modify both functions in `ledger.ts`** — identical shape to Task 4 Step 4,
  substituting `WEBSEARCH_DEBIT`/`'websearch debit'` and `DATASET_DEBIT`/`'dataset debit'`
  respectively (those descriptors are Task 4 fix rounds 1-2's addition — see Task 3's AS BUILT
  note; they already exist and are exported, nothing to define):

```ts
export type ReserveWebSearchDebitResult =
  | { kind: 'debited'; split: SplitDebitResult }
  | { kind: 'insufficient'; balance: number }
  | { kind: 'duplicate' };

export async function reserveWebSearchDebit(
  db: Db,
  userId: string,
  requestId: string,
  required: number,
): Promise<ReserveWebSearchDebitResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [userId]);
    const grantId = await getCurrentGrantId(tx, userId);
    const balance = await getSpendableBalance(tx, userId, grantId);
    if (balance < required) {
      return { kind: 'insufficient', balance };
    }
    // NOTE (Task 4 fix rounds 1-2): the id passed to splitDebit here MUST be distinct from the
    // question debit's own requestId. pro_bucket_ledger_one_debit_per_request is
    // `(user_id, request_id) where reason = 'debit'` with NO action-type scope, so on a shared
    // requestId the add-on's bucket debit reads as a duplicate of the question's and is silently
    // dropped. This is NOT limited to a lapsed subscription — it fires whenever the question debit
    // took anything from the bucket, on a perfectly active subscription, and the same-requestId
    // add-on that follows resolves to a bucket debit too. And since Task 4's fix, when the bucket
    // is drained by the time the add-on runs, the whole add-on debit short-circuits (ledger leg
    // included) rather than falling back to the ledger — so the under-charge is total, not partial.
    // Disambiguated HERE, once, so every caller of reserveWebSearchDebit keeps passing the same
    // requestId it already uses everywhere else (the audit trail, the question's own reserveDebit
    // call) with zero caller-side changes — the add-on's OWN distinct id never leaks out of this
    // function.
    const addonRequestId = `${requestId}:websearch`;
    const split = await splitDebit(tx, userId, addonRequestId, required, WEBSEARCH_DEBIT, 'websearch debit', grantId);
    if (split.bucketEntry === null && split.ledgerEntry === null) {
      return { kind: 'duplicate' };
    }
    return { kind: 'debited', split };
  });
}
```

(`reserveDatasetDebit` is the identical shape, substituting `DATASET_DEBIT`/`'dataset debit'`, its
own `ReserveDatasetDebitResult` type, and its own `${requestId}:dataset` disambiguated id in place
of `websearch`.)

- [ ] **Step 4: Modify `chargeAndRunDataset` in `dataset-gate.ts`** — apply Task 4 Step 5's exact
  transformation (replace every `debit.id` with `split`, every `compensate(db, userId, debit.id,
  amount, null)` with `compensateSplit(db, userId, split, amount, null)`) to this function, which
  is otherwise byte-identical in shape to `chargeAndRun`. Import `compensateSplit` alongside the
  existing `compensate, getActionClassPrice, reserveDatasetDebit` import; drop `compensate` from
  the import if this file uses it nowhere else (check before removing).

- [ ] **Step 5: Fix `web/app/actions.ts`'s two web-search call sites.** Change both
  `webDebitHolder` declarations (around lines 463 and 757) from
  `{ entry: LedgerEntry | null }` to `{ split: SplitDebitResult | null }`; both assignments
  (`webDebitHolder.entry = reserved.entry` at lines 508/794) to `webDebitHolder.split =
  reserved.split`; both `webDebitHolder.entry !== null` catch-path checks (lines 564/814) to
  `webDebitHolder.split !== null`, and their `compensate(getDb(), userId, webDebitHolder.entry.id,
  webAddonPrice, null)` calls to `compensateSplit(getDb(), userId, webDebitHolder.split,
  webAddonPrice, null)`. Update `settleWebAddon`'s signature (around line 677) from `webDebit:
  LedgerEntry | null` to `webSplit: SplitDebitResult | null`, its `if (webDebit === null) return
  finalGated;` guard to match the renamed parameter, and its internal `compensate(getDb(), userId,
  webDebit.id, price, auditId)` to `compensateSplit(getDb(), userId, webSplit, price, auditId)`.
  Update both call sites of `settleWebAddon` (lines 555/806) to pass `webDebitHolder.split` instead
  of `webDebitHolder.entry`. Add `compensateSplit, getCurrentGrantId, getSpendableBalance,
  SplitDebitResult` to whatever import already brings in `reserveWebSearchDebit` from the billing
  barrel (`src/billing/index.ts` — add these to that barrel's export list too, alongside
  `reserveDebit`, if `actions.ts` imports from the barrel rather than `ledger.ts` directly; check
  which it does before adding exports nothing imports).

- [ ] **Step 6: Run to verify everything passes**

Run: `npx vitest run tests/billing && npm run web:typecheck && npm run web:test`
Expected: PASS.

- [ ] **Step 7: Run the full backend suite one more time** — this closes out all remaining debit
  paths (onboarding was deliberately excluded in Task 5); confirm the whole product is green
  before moving to Stripe wiring.

Run: `npx vitest run`
Expected: PASS, full suite.

- [ ] **Step 8: Commit**

```bash
git add src/billing/ledger.ts src/billing/dataset-gate.ts src/billing/index.ts web/app/actions.ts tests/billing/ledger.test.ts
git commit -m "billing: wire bucket-first spend into websearch/dataset debit paths (#205)"
```

---

## Task 7: `hasProPlan` — real subscription check

**Files:**
- Modify: `src/billing/pro.ts`
- Test: `tests/billing/pro.test.ts` (new file — check if one already exists first; if so, extend
  it instead of creating a duplicate)

**Interfaces:**
- Consumes: nothing new — reads `pro_subscriptions` directly (mirrors `getCurrentGrantId`'s query
  shape from Task 3, but `hasProPlan`'s existing signature takes `{id, email}`, not a `Db` — this
  needs a `Db` parameter added, which is a **breaking signature change**; find every caller.

- [ ] **Step 1: Grep every caller of `hasProPlan`**

Run: `grep -rn "hasProPlan" src/ web/ --include="*.ts" --include="*.tsx"` (the spec's own
investigation already found exactly two real call sites: `web/app/embed-actions.ts:48` and
`web/app/embed/[token]/page.tsx:237` — confirm this is still current and read both before
proceeding.)

- [ ] **Step 2: Write the failing tests**

```ts
// tests/billing/pro.test.ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hasProPlan } from '../../src/billing/pro.ts';
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

  it('true for past_due (still within Stripe\'s own retry grace)', async () => {
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
      const original = process.env.PRO_ACCOUNT_EMAILS;
      process.env.PRO_ACCOUNT_EMAILS = 'vip@example.com';
      try {
        expect(await hasProPlan(db, { id: randomUUID(), email: 'vip@example.com' })).toBe(true);
      } finally {
        process.env.PRO_ACCOUNT_EMAILS = original;
      }
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails.**

- [ ] **Step 4: Modify `src/billing/pro.ts`**

```ts
// ADR 041 / spec Part B4, extended for open-questions #205: "Pro" was a
// plain owner-set allowlist; now it's ALSO a real subscription row
// (pro_subscriptions, migration 030). The allowlist stays, as an owner
// testing override — either check passing is sufficient. Fails closed on
// every path: an unset env var, a caller with no email, no DB row, an
// expired period, or a canceled subscription are all "not Pro".
import type { Db } from '../db/types.ts';

export function hasProPlanAllowlist(user: { id: string; email: string | null }): boolean {
  const raw = process.env.PRO_ACCOUNT_EMAILS;
  if (!raw || user.email === null) return false;
  const allowed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(user.email.toLowerCase());
}

export async function hasProPlan(db: Db, user: { id: string; email: string | null }): Promise<boolean> {
  if (hasProPlanAllowlist(user)) return true;
  const { rows } = await db.query(
    `select 1 from pro_subscriptions
     where user_id = $1 and status in ('active', 'trialing', 'past_due') and current_period_end > now()`,
    [user.id],
  );
  return rows.length > 0;
}
```

- [ ] **Step 5: Fix both call sites from Step 1** — `hasProPlan` is now `async` and takes `db` as
  its first argument. `web/app/embed-actions.ts:48` and `web/app/embed/[token]/page.tsx:237` both
  already have a `db` in scope (read each to confirm the exact variable name) — add `await` and
  the `db` argument; both files' own test suites (`tests/billing/pro.test.ts` won't catch these,
  they're `web/`-side) need `npm run web:test` to confirm.

- [ ] **Step 6: Update `src/billing/index.ts`'s barrel export** — `hasProPlan`'s signature changed
  but its export line (`export { hasProPlan } from './pro.ts';`) is unaffected; add
  `hasProPlanAllowlist` to the same export line if anything needs the sync allowlist-only check
  directly (check whether Task 11's UI code needs it before adding an unused export).

- [ ] **Step 7: Run to verify everything passes**

Run: `npx vitest run tests/billing && npm run web:typecheck && npm run web:test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/billing/pro.ts src/billing/index.ts tests/billing/pro.test.ts web/app/embed-actions.ts "web/app/embed/[token]/page.tsx"
git commit -m "billing: hasProPlan reads a real subscription row, allowlist stays as override (#205)"
```

---

## Task 8: `buildProSubscriptionCheckoutParams`

**Files:**
- Modify: `src/billing/stripe-checkout.ts`
- Test: `tests/billing/stripe-checkout.test.ts` (existing file — extend it)

**Interfaces:**
- Produces: `buildProSubscriptionCheckoutParams(userId, priceId, successUrl, cancelUrl):
  Stripe.Checkout.SessionCreateParams` — a pure builder, no network call, hermetically testable
  (matches `buildCheckoutSessionParams`'s existing contract exactly).

- [ ] **Step 1: Read `tests/billing/stripe-checkout.test.ts` in full** to match its exact existing
  assertion style before adding to it.

- [ ] **Step 2: Write the failing test**

```ts
it('buildProSubscriptionCheckoutParams builds a real subscription-mode session', () => {
  const params = buildProSubscriptionCheckoutParams(
    'user-123',
    'price_pro_monthly_test',
    'https://example.com/success',
    'https://example.com/cancel',
  );
  expect(params.mode).toBe('subscription');
  expect(params.line_items).toEqual([{ price: 'price_pro_monthly_test', quantity: 1 }]);
  expect(params.success_url).toBe('https://example.com/success');
  expect(params.cancel_url).toBe('https://example.com/cancel');
  expect(params.metadata).toEqual({ userId: 'user-123' });
});
```

- [ ] **Step 3: Run to verify it fails.**

- [ ] **Step 4: Implement**

```ts
/** Subscription Checkout (open-questions #205) — `mode: 'subscription'`
 * referencing a real Stripe Price object (`priceId`, provisioned once in
 * the Dashboard or via a one-off script, per the design's §4 — subscriptions
 * cannot use one-time Checkout's inline `price_data`, unlike
 * buildCheckoutSessionParams above). `metadata.userId` is read back by the
 * customer.subscription.created webhook handler (Task 9) to link the new
 * Stripe customer/subscription to this app's user row — Stripe subscription
 * events don't otherwise carry an app-specific user id. */
export function buildProSubscriptionCheckoutParams(
  userId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId },
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/billing/stripe-checkout.test.ts`
Expected: PASS.

- [ ] **Step 6: Add to the `src/billing/index.ts` barrel**

```ts
export { buildCheckoutSessionParams, buildProSubscriptionCheckoutParams } from './stripe-checkout.ts';
```

- [ ] **Step 7: Commit**

```bash
git add src/billing/stripe-checkout.ts src/billing/index.ts tests/billing/stripe-checkout.test.ts
git commit -m "billing: buildProSubscriptionCheckoutParams (#205)"
```

---

## Task 9: Webhook — subscription lifecycle events

**Files:**
- Modify: `src/billing/stripe-webhook.ts`
- Test: `tests/billing/stripe-webhook.test.ts`

**Interfaces:**
- Extends `handleStripeEvent`'s existing `if (event.type === ...)` chain with three new branches.
  `StripeWebhookResult`'s shape is reused unchanged (`handled`, `alreadyProcessed`, `ledgerId` —
  `ledgerId` stays `null` for these events, they touch `pro_subscriptions`, not the ledger).

- [ ] **Step 1: Write the failing tests** (follow `checkoutEventPayload`'s exact helper-function
  pattern from the existing test file for the new fixture builders):

```ts
function subscriptionEventPayload(
  type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted',
  subscriptionId: string,
  customerId: string,
  userId: string,
  status: string,
  currentPeriodEnd: number, // unix seconds, matches Stripe's own field shape
): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type,
    data: {
      object: {
        id: subscriptionId,
        object: 'subscription',
        customer: customerId,
        status,
        current_period_end: currentPeriodEnd,
        metadata: { userId },
      },
    },
  });
}

describe('subscription lifecycle webhooks', () => {
  it('customer.subscription.created upserts a pro_subscriptions row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 20 * 86400;
      const payload = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      const result = await handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET);
      expect(result.handled).toBe(true);
      const { rows } = await db.query('select * from pro_subscriptions where user_id = $1', [userId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('active');
      expect(rows[0].stripe_subscription_id).toBe('sub_1');
    });
  });

  it('customer.subscription.updated updates status and current_period_end for an existing row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd1 = Math.floor(Date.now() / 1000) + 20 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd1);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const periodEnd2 = Math.floor(Date.now() / 1000) + 50 * 86400;
      const updated = subscriptionEventPayload('customer.subscription.updated', 'sub_1', 'cus_1', userId, 'past_due', periodEnd2);
      await handleStripeEvent(db, updated, sign(updated), WEBHOOK_SECRET);

      const { rows } = await db.query('select * from pro_subscriptions where user_id = $1', [userId]);
      expect(rows[0].status).toBe('past_due');
      expect(Math.floor(new Date(rows[0].current_period_end).getTime() / 1000)).toBe(periodEnd2);
    });
  });

  it('customer.subscription.deleted sets status to canceled', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 20 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const deleted = subscriptionEventPayload('customer.subscription.deleted', 'sub_1', 'cus_1', userId, 'canceled', periodEnd);
      await handleStripeEvent(db, deleted, sign(deleted), WEBHOOK_SECRET);

      const { rows } = await db.query('select * from pro_subscriptions where user_id = $1', [userId]);
      expect(rows[0].status).toBe('canceled');
    });
  });

  it('a subscription event missing metadata.userId throws (never silently dropped)', async () => {
    await withDb(async (db) => {
      const payload = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'active', current_period_end: 0, metadata: {} } },
      });
      await expect(handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET)).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run to verify these fail.**

- [ ] **Step 3: Implement** — add above `handleStripeEvent`'s final `return { handled: false, ... }`:

```ts
async function upsertProSubscription(db: Db, subscription: Stripe.Subscription): Promise<StripeWebhookResult> {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    throw new Error(`${subscription.id}: missing metadata.userId`);
  }
  // current_period_grant_id is only ever SET by invoice.paid (Task 10) —
  // on first insert it needs SOME value (the column is not-null), so a
  // fresh placeholder grant id is used; invoice.paid always fires for a
  // brand-new subscription's first payment too (Stripe invoices
  // immediately), so this placeholder is overwritten before anything could
  // ever read it as "the current grant."
  await db.query(
    `insert into pro_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
     values ($1, $2, $3, $4, to_timestamp($5), gen_random_uuid())
     on conflict (user_id) do update set
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       status = excluded.status,
       current_period_end = excluded.current_period_end,
       updated_at = now()`,
    [userId, subscription.customer as string, subscription.id, subscription.status, subscription.current_period_end],
  );
  return { handled: true, alreadyProcessed: false, ledgerId: null };
}
```

Add before the final `return { handled: false, alreadyProcessed: false, ledgerId: null };`:

```ts
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    return await upsertProSubscription(db, event.data.object as Stripe.Subscription);
  }
```

- [ ] **Step 4: Confirm `gen_random_uuid()` is available** — grep for it elsewhere in the codebase
  (`grep -rn "gen_random_uuid" migrations/`) to confirm `pgcrypto` (or Postgres 13+'s built-in) is
  already relied on; if not found anywhere, use `md5(random()::text || clock_timestamp()::text)::uuid`
  instead (PGlite-safe, no extension) and note why in a code comment.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/billing/stripe-webhook.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/billing/stripe-webhook.ts tests/billing/stripe-webhook.test.ts
git commit -m "billing: webhook — subscription lifecycle events upsert pro_subscriptions (#205)"
```

---

## Task 10: Webhook — `invoice.paid` (the renewal/grant trigger)

**Files:**
- Modify: `src/billing/stripe-webhook.ts`
- Test: `tests/billing/stripe-webhook.test.ts`

**Interfaces:**
- Consumes: `grantBucket` (Task 2).
- The renewal amount (1000 credits) becomes a named constant, exported for Task 12/reuse:
  `export const PRO_MONTHLY_CREDITS = 1000;` in `src/billing/pro.ts` (co-locate with the other Pro
  constant, `PRO_ACCOUNT_EMAILS` is an env var not a constant, so this is the first one there).

- [ ] **Step 1: Write the failing tests**

```ts
function invoicePaidPayload(invoiceId: string, subscriptionId: string, userId: string): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type: 'invoice.paid',
    data: {
      object: {
        id: invoiceId,
        object: 'invoice',
        subscription: subscriptionId,
        metadata: { userId },
      },
    },
  });
}

describe('invoice.paid — the renewal grant', () => {
  it('grants 1000 credits to a fresh bucket, rotating current_period_grant_id', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const invoice = invoicePaidPayload('in_1', 'sub_1', userId);
      const result = await handleStripeEvent(db, invoice, sign(invoice), WEBHOOK_SECRET);
      expect(result.handled).toBe(true);

      const { rows } = await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId]);
      const grantId = rows[0].current_period_grant_id;
      const { getBucketBalance } = await import('../../src/billing/pro-bucket.ts');
      expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
    });
  });

  it('a replayed invoice.paid delivery grants exactly once', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const invoice = invoicePaidPayload('in_1', 'sub_1', userId);
      await handleStripeEvent(db, invoice, sign(invoice), WEBHOOK_SECRET);
      const secondCall = await handleStripeEvent(db, invoice, sign(invoice), WEBHOOK_SECRET);
      expect(secondCall.alreadyProcessed).toBe(true);

      const { rows } = await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId]);
      const { getBucketBalance } = await import('../../src/billing/pro-bucket.ts');
      expect(await getBucketBalance(db, userId, rows[0].current_period_grant_id)).toBe(1000);
    });
  });

  it('a second renewal rotates the grant id — the old grant\'s leftover credits no longer count', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
      const created = subscriptionEventPayload('customer.subscription.created', 'sub_1', 'cus_1', userId, 'active', periodEnd);
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);

      const invoice1 = invoicePaidPayload('in_1', 'sub_1', userId);
      await handleStripeEvent(db, invoice1, sign(invoice1), WEBHOOK_SECRET);
      const before = (await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId])).rows[0].current_period_grant_id;

      const invoice2 = invoicePaidPayload('in_2', 'sub_1', userId);
      await handleStripeEvent(db, invoice2, sign(invoice2), WEBHOOK_SECRET);
      const after = (await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId])).rows[0].current_period_grant_id;

      expect(after).not.toBe(before);
      const { getBucketBalance } = await import('../../src/billing/pro-bucket.ts');
      expect(await getBucketBalance(db, userId, before)).toBe(1000); // old grant still shows its own history
      expect(await getBucketBalance(db, userId, after)).toBe(1000); // new grant has its own fresh 1000
      // getSpendableBalance / getCurrentGrantId only ever look at the CURRENT
      // grant id, so the old grant's 1000 is invisible to spend once rotated
      // — this is the "unused credits are lost" behavior, verified structurally.
    });
  });

  it('invoice.paid for an unknown subscription throws (never silently dropped)', async () => {
    await withDb(async (db) => {
      const payload = invoicePaidPayload('in_1', 'sub_unknown', randomUUID());
      await expect(handleStripeEvent(db, payload, sign(payload), WEBHOOK_SECRET)).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run to verify these fail.**

- [ ] **Step 3: Add the constant to `src/billing/pro.ts`**

```ts
export const PRO_MONTHLY_CREDITS = 1000;
```

- [ ] **Step 4: Implement in `stripe-webhook.ts`**

```ts
import { grantBucket } from './pro-bucket.ts';
import { PRO_MONTHLY_CREDITS } from './pro.ts';

async function grantMonthlyAllowance(db: Db, invoice: Stripe.Invoice): Promise<StripeWebhookResult> {
  const subscriptionId = invoice.subscription as string | null;
  if (!subscriptionId) {
    // Not a subscription invoice (e.g. a one-off invoice item) — nothing for this feature to do.
    return { handled: false, alreadyProcessed: false, ledgerId: null };
  }
  const { rows } = await db.query(
    'select user_id from pro_subscriptions where stripe_subscription_id = $1',
    [subscriptionId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`${invoice.id}: invoice.paid for unknown subscription ${subscriptionId} — expected customer.subscription.created to have arrived first`);
  }
  const userId = String(row.user_id);
  const newGrantId = crypto.randomUUID();
  const granted = await grantBucket(db, userId, newGrantId, PRO_MONTHLY_CREDITS, invoice.id);
  if (granted === null) {
    return { handled: true, alreadyProcessed: true, ledgerId: null };
  }
  await db.query('update pro_subscriptions set current_period_grant_id = $1, updated_at = now() where user_id = $2', [newGrantId, userId]);
  return { handled: true, alreadyProcessed: false, ledgerId: null };
}
```

Add before the final `return { handled: false, ... }`:

```ts
  if (event.type === 'invoice.paid') {
    return await grantMonthlyAllowance(db, event.data.object as Stripe.Invoice);
  }
```

Note the ORDER matters here: `grantBucket` is called BEFORE `pro_subscriptions.current_period_grant_id`
is updated, and if `grantBucket` returns `null` (a replay), the update is SKIPPED — this is what
makes the whole handler idempotent per invoice, not just the grant row.

`crypto.randomUUID()` — confirm this matches the codebase's existing convention (`ledger.ts`/other
files use `import { randomUUID } from 'node:crypto'`); use that same import style, not the global
`crypto` object, for consistency.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/billing/stripe-webhook.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite**

Run: `npx vitest run`
Expected: PASS — all Stripe/billing wiring is now complete.

- [ ] **Step 7: Commit**

```bash
git add src/billing/stripe-webhook.ts src/billing/pro.ts tests/billing/stripe-webhook.test.ts
git commit -m "billing: webhook — invoice.paid grants/rotates the monthly bucket (#205)"
```

---

## Task 11: `PRO_SUBSCRIPTIONS_ENABLED` flag + wire the Upgrade button

**Files:**
- Modify: `web/app/embed-actions.ts` (new server action)
- Modify: `web/components/chart-embed-dialog.tsx` (the Upgrade button's `onClick`)
- Test: `web/app/embed-actions.test.ts` (existing — read it first) or
  `web/components/chart-embed-dialog.test.tsx` (existing — read both, extend whichever already
  covers this button)

**Interfaces:**
- Produces: `startProSubscriptionCheckout(): Promise<{ ok: true; url: string } | { ok: false;
  reason: 'disabled' | 'not_signed_in' }>` (a new Server Action, `'use server'`).

- [ ] **Step 1: Read `web/app/embed-actions.ts` in full** to match its existing Server Action
  conventions exactly (how it reads the signed-in user, its error-shape pattern, whether it's
  `'use server'` at file-top or per-function).

- [ ] **Step 2: Write the failing test** (exact test-file target and helper functions depend on
  Step 1's findings — follow `createEmbedCode`'s own existing test as the template for mocking
  the signed-in user and asserting the returned shape):

```ts
it('startProSubscriptionCheckout returns disabled when PRO_SUBSCRIPTIONS_ENABLED is not set', async () => {
  const original = process.env.PRO_SUBSCRIPTIONS_ENABLED;
  delete process.env.PRO_SUBSCRIPTIONS_ENABLED;
  try {
    const result = await startProSubscriptionCheckout();
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  } finally {
    if (original !== undefined) process.env.PRO_SUBSCRIPTIONS_ENABLED = original;
  }
});
```

(Add a second test for the enabled+signed-in path once Step 1 shows how the existing tests mock
`currentUserId()`/an authenticated session — mirror that pattern exactly rather than inventing a
new mocking approach.)

- [ ] **Step 3: Run to verify it fails.**

- [ ] **Step 4a: Find and mirror the existing one-time-pack purchase's success/cancel redirect
  handling** — grep for wherever `buildCheckoutSessionParams` is called (the pack-purchase Server
  Action) and read its `success_url`/`cancel_url` construction and whatever page/banner reacts to
  those query params today (likely `/account` or the credits page showing a "purchase complete"
  confirmation). Reuse that SAME URL-building helper and land the subscription flow on the same
  page with its own query param pair (e.g. `?pro=success`/`?pro=cancelled`), and add the small
  amount of copy needed for that page to show a Pro-specific confirmation — follow the existing
  banner's exact component/i18n pattern (two new `chart.embed.pro*` or `account.pro*` message
  keys, `nl`+`en`, per CLAUDE.md's English-UI-copy convention) rather than inventing a new banner
  mechanism.

- [ ] **Step 4: Implement the Server Action** in `web/app/embed-actions.ts`:

```ts
import { buildProSubscriptionCheckoutParams } from '../backend/billing/index.ts';
// (Stripe client construction — mirror whatever existing Server Action
// already calls stripe.checkout.sessions.create for one-time packs; read
// that call site and copy its exact client-init pattern, env var names for
// STRIPE_SECRET_KEY, and base-URL construction for success/cancel URLs.)

export async function startProSubscriptionCheckout(): Promise<
  { ok: true; url: string } | { ok: false; reason: 'disabled' | 'not_signed_in' }
> {
  if (process.env.PRO_SUBSCRIPTIONS_ENABLED !== '1') {
    return { ok: false, reason: 'disabled' };
  }
  const userId = await currentUserId(); // match the exact existing helper name/import from Step 1
  if (userId === null) {
    return { ok: false, reason: 'not_signed_in' };
  }
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    throw new Error('PRO_SUBSCRIPTIONS_ENABLED is set but STRIPE_PRO_PRICE_ID is missing');
  }
  const params = buildProSubscriptionCheckoutParams(
    userId,
    priceId,
    successUrl, // see Step 4a — mirror whatever the existing one-time-pack purchase action uses
    cancelUrl,
  );
  const session = await stripe.checkout.sessions.create(params); // match the existing Stripe client instance
  if (!session.url) {
    throw new Error('Stripe did not return a Checkout URL for the subscription session');
  }
  return { ok: true, url: session.url };
}
```

- [ ] **Step 5: Update `chart-embed-dialog.tsx`'s Upgrade button.** `ChartEmbedDialog` takes only
  `auditId` as a prop (confirmed — it's a Client Component with no server-computed flag threaded
  in), so there's no prop to read: call `startProSubscriptionCheckout()` directly on click and
  branch on its result. Add a small `checkingOut` state so a slow redirect doesn't look like a
  dead click:

```tsx
const [checkingOut, setCheckingOut] = useState(false);
// ... inside the JSX, replacing the existing upgradeClicked Button:
<Button
  type="button"
  size="sm"
  variant="outline"
  disabled={checkingOut}
  onClick={async () => {
    setCheckingOut(true);
    const result = await startProSubscriptionCheckout();
    if (result.ok) {
      window.location.href = result.url;
      return; // navigating away; no need to reset checkingOut
    }
    // Flag off, or not signed in (shouldn't happen — this dialog only
    // mounts for a signed-in embed creator, but fail safe) — fall through
    // to the existing interest-tracking behavior, never leave the button
    // inert.
    setCheckingOut(false);
    trackChartStyleEvent('pro_upgrade_click');
    setUpgradeClicked(true);
  }}
>
  {t(lang, 'chart.embed.proUpgradeCta')}
</Button>
```

Import `startProSubscriptionCheckout` from `../app/embed-actions.ts` (matching however
`createEmbedCode` is already imported into this same file — mirror that exact import path).

The exact `enabled` check's shape (a prop threaded from a Server Component parent vs. calling the
action and branching on its result) depends on how `ChartEmbedDialog` currently receives
server-side data — read the component's props and its parent (`ChartEmbedButton`) before writing
this; do not guess a prop name that doesn't exist.

- [ ] **Step 6: Run to verify everything passes**

Run: `npm run web:typecheck && npm run web:test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/app/embed-actions.ts web/components/chart-embed-dialog.tsx web/app/embed-actions.test.ts
git commit -m "billing: PRO_SUBSCRIPTIONS_ENABLED flag + real subscription checkout wiring (#205)"
```

---

## Task 12: ADR 006 + ADR 020 revision notes, RUNBOOK checklist

**Files:**
- Modify: `docs/decisions/006-auth-billing-seams.md`
- Modify: `docs/decisions/020-credit-ledger-and-billing-gate.md`
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/open-questions.md` (#205 row — mark built, flag-gated)
- Modify: `docs/09-pricing.md` (add the Pro tier's price alongside the existing action-class/pack
  tables)

**Interfaces:** none — documentation only, no code.

- [ ] **Step 1: Add a revision note to ADR 006**, near alternative 3's rejection ("Usage-based
  subscription... contradicts the decided model — rejected") — state plainly that this is now
  superseded for the Pro tier specifically (one-time credit packs remain the default; a real
  recurring subscription now also exists, flag-gated, per open-questions #205 and this
  implementation), pointing at the spec and this plan.

- [ ] **Step 2: Add a revision note to ADR 020**, near wherever it states Checkout is
  `mode: 'payment'`-only/never recurring — same treatment, pointing at
  `buildProSubscriptionCheckoutParams` (Task 8) as the as-built recurring counterpart.

- [ ] **Step 3: Add a RUNBOOK section** for the live-wiring checklist, mirroring the existing
  "Live embeds"/`EMBED_TOKEN_SECRET` section's format exactly: create the Stripe Price object
  (dashboard or script), set `STRIPE_PRO_PRICE_ID` and `PRO_SUBSCRIPTIONS_ENABLED=1` in Vercel,
  confirm the webhook destination is subscribed to `customer.subscription.*` and `invoice.paid` (a
  Dashboard step, not code — mirrors the existing async-payment-events RUNBOOK note), then the
  one-line smoke test (subscribe with a real test-mode card, confirm the bucket grants, confirm
  `hasProPlan` flips true).

- [ ] **Step 4: Update `docs/09-pricing.md`** — add a "Pro subscription" section alongside the
  existing action-classes/packs tables: €19.99/month, 1000 credits/period, resets unused (with a
  one-line pointer to the spec for why, so a future session doesn't wonder why THIS allowance
  differs from "credits never expire").

- [ ] **Step 5: Update `docs/open-questions.md` row #205** — mark built (this plan, flag-gated),
  point at the spec and this plan, note what's still owner-supervised (the live Stripe Price
  object + flag flip).

- [ ] **Step 6: Run `npm run test:docs`**

Expected: PASS (no live PR links, doc conventions intact).

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/006-auth-billing-seams.md docs/decisions/020-credit-ledger-and-billing-gate.md docs/RUNBOOK.md docs/09-pricing.md docs/open-questions.md
git commit -m "docs: ADR 006/020 revision, RUNBOOK live-wiring checklist, pricing doc (#205)"
```

---

## Deliberately out of scope for this plan

Found during self-review — real gaps, not oversights to silently paper over, but genuinely
separate follow-on work once this plan's mechanism is proven and the owner is ready to go further
than "flag-gated, mechanism works":

- **No account/billing UI shows Pro status or remaining bucket credits.** A subscribed user has no
  in-product way to see "you're Pro, 620 of 1000 credits left this period" — this plan proves the
  mechanism (webhooks, ledger split, gate) end-to-end via tests and the one Upgrade-button entry
  point, not a full self-service billing page.
- **No Stripe Customer Portal wiring** for self-service plan management/cancellation — a user who
  subscribes today would need to email support (or the owner would need to cancel from the Stripe
  Dashboard directly) to stop their subscription. Stripe's hosted Customer Portal
  (`stripe.billingPortal.sessions.create`) is the cheapest viable mechanism for this per CLAUDE.md's
  convention and should be the next follow-on task, not a custom-built cancel flow.

Both are real product gaps before a genuine public launch of this tier, but neither blocks proving
the mechanism works — flag-gated means no real user reaches either gap until the owner decides
they're ready for a fuller rollout.

## Task 13: End-to-end integration test

**Files:**
- Create: `tests/billing/pro-subscription-e2e.test.ts`

**Interfaces:** none new — exercises everything built above through its public surface only.

- [ ] **Step 1: Write the test**

```ts
// tests/billing/pro-subscription-e2e.test.ts
// One end-to-end walk through the whole Pro subscription lifecycle, through
// public surfaces only (webhook events in, ledger/bucket balances out) —
// the integration proof that every task above composes correctly.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { handleStripeEvent } from '../../src/billing/stripe-webhook.ts';
import { getBalance, reserveDebit } from '../../src/billing/ledger.ts';
import { getBucketBalance } from '../../src/billing/pro-bucket.ts';
import { hasProPlan } from '../../src/billing/pro.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const WEBHOOK_SECRET = 'whsec_test_fixture_secret';
function sign(payload: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

describe('Pro subscription — full lifecycle', () => {
  it('subscribe -> spend from bucket -> renew -> old grant is lost, permanent ledger never touched', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query(`insert into credit_transactions (user_id, delta, reason, note) values ($1, 100, 'signup_grant', 'seed')`, [userId]);

      // 1. Subscribe: subscription.created + first invoice.paid
      const periodEnd1 = Math.floor(Date.now() / 1000) + 30 * 86400;
      const created = JSON.stringify({ id: `evt_${randomUUID()}`, object: 'event', type: 'customer.subscription.created',
        data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'active', current_period_end: periodEnd1, metadata: { userId } } } });
      await handleStripeEvent(db, created, sign(created), WEBHOOK_SECRET);
      const invoice1 = JSON.stringify({ id: `evt_${randomUUID()}`, object: 'event', type: 'invoice.paid',
        data: { object: { id: 'in_1', object: 'invoice', subscription: 'sub_1', metadata: { userId } } } });
      await handleStripeEvent(db, invoice1, sign(invoice1), WEBHOOK_SECRET);

      expect(await hasProPlan(db, { id: userId, email: null })).toBe(true);
      const grant1 = (await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId])).rows[0].current_period_grant_id;
      expect(await getBucketBalance(db, userId, grant1)).toBe(1000);

      // 2. Spend 300 from the bucket via the real reserveDebit path
      const result = await reserveDebit(db, userId, randomUUID(), 300);
      expect(result.kind).toBe('debited');
      expect(await getBucketBalance(db, userId, grant1)).toBe(700);
      expect(await getBalance(db, userId)).toBe(100); // permanent ledger untouched

      // 3. Renew: a second invoice.paid rotates the grant
      const invoice2 = JSON.stringify({ id: `evt_${randomUUID()}`, object: 'event', type: 'invoice.paid',
        data: { object: { id: 'in_2', object: 'invoice', subscription: 'sub_1', metadata: { userId } } } });
      await handleStripeEvent(db, invoice2, sign(invoice2), WEBHOOK_SECRET);
      const grant2 = (await db.query('select current_period_grant_id from pro_subscriptions where user_id = $1', [userId])).rows[0].current_period_grant_id;

      expect(grant2).not.toBe(grant1);
      expect(await getBucketBalance(db, userId, grant2)).toBe(1000); // fresh allowance
      expect(await getBucketBalance(db, userId, grant1)).toBe(700); // old grant's history is still queryable, just no longer current

      // 4. The 700 leftover credits from grant1 are structurally invisible to new spend
      const secondSpend = await reserveDebit(db, userId, randomUUID(), 20);
      expect(secondSpend.kind).toBe('debited');
      expect(await getBucketBalance(db, userId, grant2)).toBe(980); // drawn from the NEW grant
      expect(await getBucketBalance(db, userId, grant1)).toBe(700); // untouched, permanently unreachable
      expect(await getBalance(db, userId)).toBe(100); // permanent ledger STILL untouched throughout

      // 5. Cancel: subscription.deleted, but current_period_end is still future — grace period holds
      const deleted = JSON.stringify({ id: `evt_${randomUUID()}`, object: 'event', type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'canceled', current_period_end: periodEnd1, metadata: { userId } } } });
      await handleStripeEvent(db, deleted, sign(deleted), WEBHOOK_SECRET);
      expect(await hasProPlan(db, { id: userId, email: null })).toBe(false); // status='canceled' is never Pro-eligible, even with a future period_end (Stripe's own convention: 'canceled' means immediately over; the grace period is expressed via 'active'+cancel_at_period_end staying 'active' until the boundary, never via a future-dated 'canceled')
    });
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run tests/billing/pro-subscription-e2e.test.ts`
Expected: PASS.

If it does NOT pass, this is the integration seam catching something the per-task unit tests
missed — debug from here, do not weaken the test to make it pass.

- [ ] **Step 3: Run the ENTIRE backend suite + benchmark one final time**

Run: `npm run typecheck && npx vitest run && npm run benchmark:run && npm run benchmark:score && npm run web:typecheck && npm run web:test`
Expected: PASS across the board — this is the full verification block CLAUDE.md requires before
any push.

- [ ] **Step 4: Run `/code-review` at LOW effort over the full branch diff** (CLAUDE.md's standing
  requirement before any code push) — fix or consciously dispatch every confirmed finding.

- [ ] **Step 5: Commit**

```bash
git add tests/billing/pro-subscription-e2e.test.ts
git commit -m "billing: Pro subscription end-to-end integration test (#205)"
```

- [ ] **Step 6: Open the PR** — this is money-path code (CLAUDE.md: branch + PR + explicit owner
  go, no exception for an owner-present session). Push the branch, open a PR summarizing all 13
  tasks, link the spec and this plan, and STOP — do not merge. The owner's explicit go on the
  merge itself is required, separate from having approved the design.

```bash
git push -u origin pro-subscription-tier
gh pr create --title "Pro subscription tier: real recurring billing, flag-gated (#205)" --body "..."
```
