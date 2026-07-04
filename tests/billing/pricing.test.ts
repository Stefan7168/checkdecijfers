// Pricing config (migration 006, ADR 006 seam 3): idempotent apply, mirroring
// tests/registry/registry.test.ts's pattern for src/registry/apply.ts.
import { describe, expect, it } from 'vitest';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import { ACTION_CLASS_PRICES, CREDIT_PACKS, SIGNUP_GRANT_CREDITS } from '../../src/billing/pricing-defaults.ts';
import { getActivePacks, getPack, getSignupGrantCredits } from '../../src/billing/pricing-read.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

describe('pricing defaults (ADR 006 seam 3)', () => {
  it('applies every action class price and credit pack', async () => {
    const { db, close } = await createTestDb();
    try {
      const result = await applyPricingDefaults(db);
      expect(result.actionClassesUpserted.sort()).toEqual(ACTION_CLASS_PRICES.map((a) => a.actionClass).sort());
      expect(result.packsUpserted.sort()).toEqual(CREDIT_PACKS.map((p) => p.id).sort());
      expect(result.signupGrantCredits).toBe(SIGNUP_GRANT_CREDITS);

      const prices = await db.query('select action_class, credits from action_class_prices order by action_class');
      expect(prices.rows).toHaveLength(ACTION_CLASS_PRICES.length);
      for (const entry of ACTION_CLASS_PRICES) {
        const row = prices.rows.find((r) => r.action_class === entry.actionClass);
        expect(row?.credits, entry.actionClass).toBe(entry.credits);
      }

      const packs = await db.query('select id, price_cents, credits, active from credit_packs order by id');
      expect(packs.rows).toHaveLength(CREDIT_PACKS.length);
      for (const pack of CREDIT_PACKS) {
        const row = packs.rows.find((r) => r.id === pack.id);
        expect(row?.price_cents, pack.id).toBe(pack.priceCents);
        expect(row?.credits, pack.id).toBe(pack.credits);
        expect(row?.active, pack.id).toBe(true);
      }

      const grant = await db.query('select credits from signup_grant_config');
      expect(Number(grant.rows[0]!.credits)).toBe(SIGNUP_GRANT_CREDITS);
    } finally {
      await close();
    }
  });

  it('is idempotent: applying twice yields the same rows, no duplicates', async () => {
    const { db, close } = await createTestDb();
    try {
      await applyPricingDefaults(db);
      const before = await db.query('select * from action_class_prices order by action_class');
      await applyPricingDefaults(db);
      const after = await db.query('select * from action_class_prices order by action_class');
      expect(after.rows).toEqual(before.rows);
    } finally {
      await close();
    }
  });

  it('every action class price is a positive integer', () => {
    for (const entry of ACTION_CLASS_PRICES) {
      expect(entry.credits).toBeGreaterThan(0);
      expect(Number.isInteger(entry.credits)).toBe(true);
    }
  });

  it('the clarification price never exceeds the simple price (open-questions #58)', () => {
    // Structural requirement, not just a convention: src/billing/gate.ts
    // refunds simple-minus-clarification down to the clarification price,
    // and credit_transactions' CHECK constraint (migration 005) forbids a
    // compensation row with a non-positive delta — a clarification price
    // above 'simple' would make every clarification throw.
    const simple = ACTION_CLASS_PRICES.find((a) => a.actionClass === 'simple')!;
    const clarification = ACTION_CLASS_PRICES.find((a) => a.actionClass === 'clarification')!;
    expect(clarification.credits).toBeLessThanOrEqual(simple.credits);
  });

  it('every credit pack has a positive price and credit amount', () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.priceCents).toBeGreaterThan(0);
      expect(pack.credits).toBeGreaterThan(0);
    }
  });
});

describe('pricing-read — the live table is the runtime source of truth', () => {
  it('getActivePacks returns every seeded pack, cheapest first', async () => {
    const { db, close } = await createTestDb();
    try {
      await applyPricingDefaults(db);
      const packs = await getActivePacks(db);
      expect(packs.map((p) => p.id)).toEqual([...CREDIT_PACKS].sort((a, b) => a.priceCents - b.priceCents).map((p) => p.id));
    } finally {
      await close();
    }
  });

  it('getPack finds a specific pack by id, null for an unknown id', async () => {
    const { db, close } = await createTestDb();
    try {
      await applyPricingDefaults(db);
      const known = CREDIT_PACKS[0]!;
      expect(await getPack(db, known.id)).toEqual(known);
      expect(await getPack(db, 'not_a_real_pack')).toBeNull();
    } finally {
      await close();
    }
  });

  it('a deactivated pack is excluded from getActivePacks and getPack', async () => {
    const { db, close } = await createTestDb();
    try {
      await applyPricingDefaults(db);
      const target = CREDIT_PACKS[0]!;
      await db.query('update credit_packs set active = false where id = $1', [target.id]);
      expect((await getActivePacks(db)).map((p) => p.id)).not.toContain(target.id);
      expect(await getPack(db, target.id)).toBeNull();
    } finally {
      await close();
    }
  });

  // WP19 (open-questions #76) — adversarial-review finding: the function had
  // zero direct coverage, and an executed probe showed a column-name typo in
  // its query would pass every suite. Both tests bind it to the LIVE table.
  it('getSignupGrantCredits reads the live singleton, tracking a plain UPDATE (ADR 006)', async () => {
    const { db, close } = await createTestDb();
    try {
      await applyPricingDefaults(db);
      expect(await getSignupGrantCredits(db)).toBe(SIGNUP_GRANT_CREDITS);
      // Not just the seeded constant: a manual UPDATE (the documented tuning
      // path) must be what the dashboard explainer then reports.
      await db.query('update signup_grant_config set credits = 250');
      expect(await getSignupGrantCredits(db)).toBe(250);
    } finally {
      await close();
    }
  });

  it('getSignupGrantCredits fails loud on an empty config table, never a silent default', async () => {
    const { db, close } = await createTestDb();
    try {
      await db.query('delete from signup_grant_config');
      await expect(getSignupGrantCredits(db)).rejects.toThrow(/signup_grant_config is empty/);
    } finally {
      await close();
    }
  });
});
