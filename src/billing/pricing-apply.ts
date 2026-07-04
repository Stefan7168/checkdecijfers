// Pricing work package: idempotently writes src/billing/pricing-defaults.ts
// into action_class_prices, credit_packs (migration 006) and
// signup_grant_config (migration 005). Safe to re-run — every write is a
// plain UPSERT/UPDATE keyed on a stable id, matching src/registry/apply.ts's
// idempotency stance exactly.
import type { Db } from '../db/types.ts';
import { ACTION_CLASS_PRICES, CREDIT_PACKS, SIGNUP_GRANT_CREDITS } from './pricing-defaults.ts';

export interface PricingApplyResult {
  actionClassesUpserted: string[];
  packsUpserted: string[];
  signupGrantCredits: number;
}

export async function applyPricingDefaults(db: Db): Promise<PricingApplyResult> {
  const actionClassesUpserted: string[] = [];
  for (const entry of ACTION_CLASS_PRICES) {
    await db.query(
      `insert into action_class_prices (action_class, credits)
       values ($1, $2)
       on conflict (action_class) do update set credits = excluded.credits`,
      [entry.actionClass, entry.credits],
    );
    actionClassesUpserted.push(entry.actionClass);
  }

  const packsUpserted: string[] = [];
  for (const pack of CREDIT_PACKS) {
    await db.query(
      `insert into credit_packs (id, label, price_cents, currency, credits, active)
       values ($1, $2, $3, $4, $5, true)
       on conflict (id) do update set
         label = excluded.label,
         price_cents = excluded.price_cents,
         currency = excluded.currency,
         credits = excluded.credits,
         active = true`,
      [pack.id, pack.label, pack.priceCents, pack.currency, pack.credits],
    );
    packsUpserted.push(pack.id);
  }

  await db.query('update signup_grant_config set credits = $1', [SIGNUP_GRANT_CREDITS]);

  return { actionClassesUpserted, packsUpserted, signupGrantCredits: SIGNUP_GRANT_CREDITS };
}

// CLI entry: node --env-file=.env src/billing/pricing-apply.ts
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { connectFromEnv } = await import('../db/client.ts');
  const { applyMigrations } = await import('../db/migrate.ts');
  const { db, pool } = connectFromEnv();
  try {
    await applyMigrations(db);
    const result = await applyPricingDefaults(db);
    console.log(
      `Upserted ${result.actionClassesUpserted.length} action class price(s): ${result.actionClassesUpserted.join(', ')}.`,
    );
    console.log(`Upserted ${result.packsUpserted.length} credit pack(s): ${result.packsUpserted.join(', ')}.`);
    console.log(`Signup grant set to ${result.signupGrantCredits} credits.`);
  } finally {
    await pool.end();
  }
}
