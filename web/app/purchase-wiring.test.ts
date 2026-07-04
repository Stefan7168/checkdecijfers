// WP22 (#95) wiring pins — the honest cheap layer for two surfaces the
// jsdom suite cannot exercise (a 'use server' action needing Stripe/DB/auth
// mocks, and an async Server Component reading cookies): SOURCE-TEXT scans
// asserting the redirect chain stays wired through the one shared
// definition. These pin WIRING PRESENCE, not behavior — a deliberate,
// recorded judgment from the WP22 adversarial review (its executing lens
// proved both mutations below survive the behavioral suite green; a full
// server-context harness was judged not worth its cost for two lines,
// while silence on a live money-flow redirect was judged worse than a
// brittle-but-honest scan).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf-8');

describe('#95 purchase-redirect wiring (source pins)', () => {
  it('the checkout action builds its success URL through the shared builder', () => {
    const source = read('credits/actions.ts');
    expect(source).toContain('purchaseSuccessUrl(origin)');
    // The old literal must not sneak back in as the success target.
    expect(source).not.toContain('/credits?purchase=success');
  });

  it('the main page threads the success flag into the Dashboard', () => {
    const source = read('page.tsx');
    expect(source).toContain('purchaseSuccess={purchase === PURCHASE_SUCCESS_VALUE}');
    expect(source).toContain("from '../lib/purchase.ts'");
  });
});
