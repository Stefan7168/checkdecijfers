// The dataset-chat billing gate (src/billing/dataset-gate.ts, WP202a / ADR
// 037) — chargeAndRun's pattern applied to askDataset turns. `run` is
// stubbed (same shallow-fake discipline as tests/billing/gate.test.ts:
// dataset-gate.ts only ever reads `envelope.kind`/`auditId`/`datasetGone`).
//
// dataset_turn/dataset_ingest are NOT in pricing-defaults.ts (the owner
// hasn't picked exact amounts yet, ADR 037 §8 Q1 — only the MECHANISM is
// decided) — this file seeds a test-only price directly rather than via
// applyPricingDefaults, which only seeds decided prices.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { chargeAndRunDataset } from '../../src/billing/dataset-gate.ts';
import { getBalance } from '../../src/billing/ledger.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import type { AuditedDatasetTurn } from '../../src/billing/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const DATASET_TURN_PRICE = 15;

function fakeTurn(
  kind: 'chart' | 'clarification' | 'refusal',
  auditId: number | null,
  datasetGone = false,
): AuditedDatasetTurn {
  return {
    envelope: { schemaVersion: 1, kind, question: 'test', text: 'test' } as unknown as AuditedDatasetTurn['envelope'],
    auditId,
    datasetGone,
  };
}

async function withPricedDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await applyPricingDefaults(db);
    // Test-only seed: the owner hasn't decided real dataset_turn/dataset_ingest
    // amounts yet (ADR 037 §8 Q1) — this stays out of pricing-defaults.ts.
    await db.query(
      `insert into action_class_prices (action_class, credits) values ('dataset_turn', $1)`,
      [DATASET_TURN_PRICE],
    );
    await fn(db);
  } finally {
    await close();
  }
}

describe('chargeAndRunDataset — insufficient balance', () => {
  it('never invokes run() when the balance is too low, and debits nothing', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      const run = vi.fn(async () => fakeTurn('chart', 1));
      const result = await chargeAndRunDataset(db, userId, randomUUID(), run);
      expect(result).toEqual({ kind: 'insufficient_credits', balance: 0, required: DATASET_TURN_PRICE });
      expect(run).not.toHaveBeenCalled();
      expect(await getBalance(db, userId)).toBe(0);
    });
  });
});

describe('chargeAndRunDataset — a real chart', () => {
  it('debits before running, keeps the full debit, and returns kind "ok"', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => fakeTurn('chart', 42));
      const result = await chargeAndRunDataset(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: DATASET_TURN_PRICE });
      expect(run).toHaveBeenCalledTimes(1);
      expect(await getBalance(db, userId)).toBe(100 - DATASET_TURN_PRICE);
    });
  });
});

describe('chargeAndRunDataset — a clarification compensates down to the flat clarification price', () => {
  it('refunds the difference between dataset_turn and clarification', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => fakeTurn('clarification', 7));
      const result = await chargeAndRunDataset(db, userId, randomUUID(), run);
      const clarifyPrice = 10; // docs/09-pricing.md reference value, matches gate.test.ts
      expect(result).toMatchObject({ kind: 'ok', netCost: clarifyPrice });
      expect(await getBalance(db, userId)).toBe(100 - clarifyPrice);
    });
  });
});

describe('chargeAndRunDataset — a refusal refunds in full', () => {
  it('nets to zero cost', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => fakeTurn('refusal', 3));
      const result = await chargeAndRunDataset(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: 0 });
      expect(await getBalance(db, userId)).toBe(100); // fully refunded
    });
  });
});

describe('chargeAndRunDataset — the dataset-gone race (D9) refunds in full, regardless of envelope.kind', () => {
  it('refunds fully when datasetGone is true, even if the envelope looks like a chart', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      // A chart-shaped envelope with datasetGone: true would never actually
      // happen from real audit.ts output (writeTurn returns auditId: null
      // when datasetGone), but this proves the gate checks datasetGone
      // FIRST, before ever looking at envelope.kind.
      const run = vi.fn(async () => fakeTurn('chart', null, true));
      const result = await chargeAndRunDataset(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: 0 });
      expect(await getBalance(db, userId)).toBe(100);
    });
  });
});

describe('chargeAndRunDataset — every compensate() call passes auditAnswerId: null', () => {
  it('a clarification\'s partial refund carries no audit_answer_id link (dataset turns are not audit_answers rows)', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => fakeTurn('clarification', 99));
      await chargeAndRunDataset(db, userId, randomUUID(), run);
      const { rows } = await db.query(
        `select audit_answer_id from credit_transactions where user_id = $1 and reason = 'compensation'`,
        [userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.audit_answer_id).toBeNull();
    });
  });
});

describe('chargeAndRunDataset — duplicate request', () => {
  it('never re-runs the turn for a repeated (userId, requestId)', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const requestId = randomUUID();
      const run = vi.fn(async () => fakeTurn('chart', 1));
      await chargeAndRunDataset(db, userId, requestId, run);
      const second = await chargeAndRunDataset(db, userId, requestId, run);
      expect(second).toEqual({ kind: 'duplicate_request' });
      expect(run).toHaveBeenCalledTimes(1);
    });
  });
});

describe('chargeAndRunDataset — a thrown error refunds in full', () => {
  it('compensates and rethrows', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => {
        throw new Error('boom');
      });
      await expect(chargeAndRunDataset(db, userId, randomUUID(), run)).rejects.toThrow('boom');
      expect(await getBalance(db, userId)).toBe(100); // fully refunded
    });
  });
});
