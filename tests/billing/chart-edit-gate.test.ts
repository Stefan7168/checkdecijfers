// The CBS chart-edit billing gate (src/billing/chart-edit-gate.ts, co-pilot
// phase 3) — chargeAndRun's pattern, priced at the existing 'clarification'
// action class (no new action class, no migration; cheapest mechanism
// first — re-pricing is open-questions #285). `run` is stubbed, same
// shallow-fake discipline as tests/billing/gate.test.ts and
// tests/billing/dataset-gate.test.ts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeAndRunChartEdit } from '../../src/billing/chart-edit-gate.ts';
import { getBalance } from '../../src/billing/ledger.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import type { CbsCopilotReply } from '../../src/chart/copilot/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';

const CLARIFICATION_PRICE = 10; // docs/09-pricing.md reference value, matches gate.test.ts/dataset-gate.test.ts

function reply(kind: 'edit' | 'clarification' | 'refusal'): CbsCopilotReply {
  if (kind === 'edit') {
    return { kind: 'edit', text: 'Applied one change.', commands: [{ kind: 'setForm', form: 'bar' }], refused: [], dataRequest: false, llmCalls: [] };
  }
  if (kind === 'clarification') {
    return { kind: 'clarification', text: 'clarify', llmCalls: [] };
  }
  return { kind: 'refusal', reason: 'empty_message', text: 'empty', llmCalls: [] };
}

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

async function withPricedDb(fn: (db: Db) => Promise<void>): Promise<void> {
  await applyPricingDefaults(sharedDb);
  await fn(sharedDb);
}

describe('chargeAndRunChartEdit — an edit reply', () => {
  it('debits exactly the clarification price once, with reason question_cost', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => reply('edit'));
      const result = await chargeAndRunChartEdit(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: CLARIFICATION_PRICE });
      expect(await getBalance(db, userId)).toBe(100 - CLARIFICATION_PRICE);
      const { rows } = await db.query(
        `select count(*)::int as n from credit_transactions where user_id = $1 and reason = 'question_cost'`,
        [userId],
      );
      expect(rows[0]!.n).toBe(1);
    });
  });
});

describe('chargeAndRunChartEdit — a refusal reply', () => {
  it('ends at net 0 (one debit + one compensation)', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => reply('refusal'));
      const result = await chargeAndRunChartEdit(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: 0 });
      expect(await getBalance(db, userId)).toBe(100);
    });
  });
});

describe('chargeAndRunChartEdit — a clarification reply', () => {
  it('also ends at net 0 — the debit already equals the clarification price', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => reply('clarification'));
      const result = await chargeAndRunChartEdit(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: 0 });
      expect(await getBalance(db, userId)).toBe(100);
    });
  });
});

describe('chargeAndRunChartEdit — a thrown run', () => {
  it('compensates in full and rethrows', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => {
        throw new Error('boom');
      });
      await expect(chargeAndRunChartEdit(db, userId, randomUUID(), run)).rejects.toThrow('boom');
      expect(await getBalance(db, userId)).toBe(100);
    });
  });
});

describe('chargeAndRunChartEdit — a duplicate requestId', () => {
  it('returns duplicate_request and never calls run again', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const requestId = randomUUID();
      const run = vi.fn(async () => reply('edit'));
      await chargeAndRunChartEdit(db, userId, requestId, run);
      const second = await chargeAndRunChartEdit(db, userId, requestId, run);
      expect(second).toEqual({ kind: 'duplicate_request' });
      expect(run).toHaveBeenCalledTimes(1);
    });
  });
});

describe('chargeAndRunChartEdit — insufficient balance', () => {
  it('returns insufficient_credits without calling run', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      const run = vi.fn(async () => reply('edit'));
      const result = await chargeAndRunChartEdit(db, userId, randomUUID(), run);
      expect(result).toEqual({ kind: 'insufficient_credits', balance: 0, required: CLARIFICATION_PRICE });
      expect(run).not.toHaveBeenCalled();
    });
  });
});

describe('chargeAndRunChartEdit — compensation carries no audit_answer_id', () => {
  it('a refusal\'s full refund is not linked to any audit_answers row', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => reply('refusal'));
      await chargeAndRunChartEdit(db, userId, randomUUID(), run);
      const { rows } = await db.query(
        `select audit_answer_id from credit_transactions where user_id = $1 and reason = 'compensation'`,
        [userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.audit_answer_id).toBeNull();
    });
  });
});
