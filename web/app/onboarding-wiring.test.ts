// WP16 sub-part 2 (ADR 026, design §2) wiring pins — the honest cheap layer
// for the 'use server' askQuestion orchestration the jsdom suite cannot
// exercise (it needs DB/auth/LLM mocks in a server context). Same recorded
// judgment as purchase-wiring.test.ts: these pin WIRING PRESENCE, not behavior
// (triggerOnboarding's behavior is covered by tests/ingestion/
// onboarding-trigger.test.ts; the finder's routing by tests/answer/
// onboarding-flow.test.ts). A silent regression on a live money-flow trigger
// is judged worse than a brittle-but-honest source scan.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf-8');

describe('WP16 sub-part 2 onboarding-trigger wiring (source pins)', () => {
  const source = read('actions.ts');

  it('injects the table finder into askQuestion (only)', () => {
    // The finder must be constructed and threaded into the answer options.
    expect(source).toContain('tableFinder: buildOnboardingFinder(');
    // Guard: it must appear inside askQuestion's answerQuestionAudited call,
    // NOT inside replyToClarification (a reply-turn trigger is unmade). We pin
    // this by asserting there is exactly ONE finder injection.
    const occurrences = source.split('tableFinder: buildOnboardingFinder(').length - 1;
    expect(occurrences).toBe(1);
  });

  it('gates the finder on ONBOARDING_ENABLED so dormant is mechanical (session-27 review)', () => {
    // Until the RUNBOOK supervised live step (migrations 012+013, env vars)
    // flips this on, production must behave byte-identically pre-WP16: no
    // finder, no per-question rerank spend, no path touching the
    // not-yet-migrated tables. The gate must guard the SAME expression the
    // injection pin above asserts (the conditional spread reads before it).
    const gateIdx = source.indexOf("process.env.ONBOARDING_ENABLED === '1'");
    const finderIdx = source.indexOf('tableFinder: buildOnboardingFinder(');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(finderIdx);
  });

  it('gates the dashboard history read on the SAME master switch (session-27 incident pin)', () => {
    // The ungated merge 500'd the production dashboard while migration 012
    // was (correctly) not yet applied — the read path must ride the same
    // ONBOARDING_ENABLED switch as the finder injection.
    const page = read('page.tsx');
    expect(page).toContain(
      "getQuestionHistory(db, userId, { includeOnboarding: process.env.ONBOARDING_ENABLED === '1' })",
    );
  });

  it('runs the money orchestration after chargeAndRun, only on onboarding_pending', () => {
    expect(source).toContain('maybeTriggerOnboarding(');
    expect(source).toContain("response.reason !== 'onboarding_pending'");
    expect(source).toContain('triggerOnboarding(getDb()');
  });

  it('maps the three trigger results to the pinned gated shapes/costs', () => {
    // started → 100-credit caption; insufficient → the existing UI shape with
    // required 100; duplicate → net 0.
    expect(source).toContain("case 'started'");
    expect(source).toContain('netCost: await onboardingPrice(getDb())');
    expect(source).toContain("case 'insufficient'");
    expect(source).toContain("kind: 'insufficient_credits'");
    expect(source).toContain("case 'duplicate'");
    expect(source).toContain('netCost: 0');
  });
});
