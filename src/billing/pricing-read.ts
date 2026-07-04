// Reads action_class_prices / credit_packs (migration 006) back for display
// and checkout — the live table is the runtime source of truth (editable by
// a plain UPDATE, per ADR 006), not the src/billing/pricing-defaults.ts
// constants, which only seed it.
import type { Db } from '../db/types.ts';
import type { CreditPack } from './types.ts';

function toPack(row: Record<string, unknown>): CreditPack {
  return {
    id: row.id as string,
    label: row.label as string,
    priceCents: Number(row.price_cents),
    currency: row.currency as string,
    credits: Number(row.credits),
  };
}

export async function getActivePacks(db: Db): Promise<CreditPack[]> {
  const { rows } = await db.query(
    'select id, label, price_cents, currency, credits from credit_packs where active = true order by price_cents',
  );
  return rows.map(toPack);
}

export async function getPack(db: Db, packId: string): Promise<CreditPack | null> {
  const { rows } = await db.query(
    'select id, label, price_cents, currency, credits from credit_packs where id = $1 and active = true',
    [packId],
  );
  const row = rows[0];
  return row === undefined ? null : toPack(row);
}

/** The signup-grant amount, read from the live singleton (migration 005) --
 * the same row public.grant_signup_credits() itself reads, so what the
 * dashboard's credits explainer says a new account receives (WP19,
 * open-questions #76) can never drift from what the trigger actually grants.
 * Never the SIGNUP_GRANT_CREDITS seed constant (ADR 006: the live table is
 * the runtime source of truth, editable by a plain UPDATE). */
export async function getSignupGrantCredits(db: Db): Promise<number> {
  const { rows } = await db.query('select credits from signup_grant_config');
  const row = rows[0];
  if (row === undefined) {
    throw new Error('signup_grant_config is empty -- migration 005 seeds exactly one row');
  }
  return Number(row.credits);
}
