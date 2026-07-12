// WP129+130 (#129/#130, ADR 032) wiring pins — the source-scan layer for the
// gate-PLACEMENT guarantees the behavioral suite (actions.test.ts) cannot see:
// that the feature is DORMANT behind WEBSEARCH_ENABLED by CONSTRUCTION. The
// onboarding-wiring.test.ts precedent: a silent regression that constructs the
// Anthropic web client — or reads the not-yet-seeded web_addon price — while
// the flag is off is a live money/deploy-order hazard, so it gets a
// brittle-but-honest source scan on top of the behavioral pins.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf-8');

describe('WP129+130 websearch gate-placement wiring (source pins)', () => {
  const actions = read('actions.ts');

  it('constructs the web client behind the WEBSEARCH_ENABLED flag (flag check precedes construction)', () => {
    // The dormancy guarantee: until the RUNBOOK go-live flips the flag, no path
    // constructs the Anthropic web client. Pin the flag check appears BEFORE the
    // client construction, exactly like the ONBOARDING_ENABLED finder gate.
    const flagIdx = actions.indexOf("process.env.WEBSEARCH_ENABLED === '1'");
    const clientIdx = actions.indexOf('new AnthropicWebSearchClient(');
    expect(flagIdx).toBeGreaterThan(-1);
    expect(clientIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeLessThan(clientIdx);
  });

  it('gates the client construction on BOTH the flag AND the Internet chip', () => {
    expect(actions).toContain("process.env.WEBSEARCH_ENABLED === '1' && selection?.web === true");
  });

  it('validateSelection forces the payload undefined while the flag is off', () => {
    // The server belt: the untrusted client payload can never reach the web path
    // while dormant, so `selection?.web === true` implies the flag is on.
    expect(actions).toContain("if (process.env.WEBSEARCH_ENABLED !== '1') return undefined;");
  });

  it('reserves the web debit before spend and settles on the final gated object', () => {
    expect(actions).toContain('reserveWebSearchDebit(getDb()');
    expect(actions).toContain('settleWebAddon(finalGated,');
    // The keep condition is the exact ⟨W3⟩/⟨W1⟩ triple.
    expect(actions).toContain("finalGated.response.webSection?.status === 'ok'");
    expect(actions).toContain('finalGated.auditId !== null');
  });

  it('compensates a taken web debit on the exception path (both actions)', () => {
    const occurrences = actions.split('await compensate(getDb(), userId, webDebitHolder.entry.id, webAddonPrice, null)').length - 1;
    // askQuestion + replyToClarification each have one catch-path compensation.
    expect(occurrences).toBe(2);
  });
});

describe('WP129+130 page.tsx price read is behind the flag (source pins)', () => {
  const page = read('page.tsx');

  it('reads the web_addon price ONLY behind WEBSEARCH_ENABLED (deploy-order-safe)', () => {
    // The web_addon action_class_prices row is seeded only in the supervised
    // go-live (migration 018 + pricing:apply). The flag check must precede the
    // getActionClassPrice('web_addon') read so it can never throw pre-seed.
    const flagIdx = page.indexOf("process.env.WEBSEARCH_ENABLED === '1'");
    const priceIdx = page.indexOf("getActionClassPrice(db, 'web_addon')");
    expect(flagIdx).toBeGreaterThan(-1);
    expect(priceIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeLessThan(priceIdx);
  });

  it('raises the Server Action time budget to 90s (⟨W2⟩ — pipeline + web stack)', () => {
    expect(page).toContain('export const maxDuration = 90;');
  });
});
