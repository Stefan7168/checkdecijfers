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

describe('#113 kick-on-trigger wiring (source pins)', () => {
  const source = read('actions.ts');

  it('imports after from next/server and kickOnboardingJob from the lib', () => {
    expect(source).toContain("import { after } from 'next/server';");
    expect(source).toContain("import { kickOnboardingJob } from '../lib/onboarding-kick.ts';");
  });

  // Slice the maybeTriggerOnboarding switch body by its case labels so each
  // assertion is scoped to exactly one case block — a bare source.toContain
  // could not tell 'started' from 'duplicate' from 'insufficient'.
  const sliceCase = (label: string, next: string | null): string => {
    const start = source.indexOf(`case '${label}':`);
    expect(start).toBeGreaterThan(-1);
    const end = next === null ? source.length : source.indexOf(`case '${next}':`, start);
    return source.slice(start, end === -1 ? source.length : end);
  };

  it("fires the kick inside BOTH the 'started' and 'duplicate' cases, POST-response", () => {
    expect(sliceCase('started', 'duplicate')).toContain('after(() => kickOnboardingJob());');
    expect(sliceCase('duplicate', 'insufficient')).toContain('after(() => kickOnboardingJob());');
  });

  it("does NOT fire the kick in the 'insufficient' case (nothing was queued)", () => {
    expect(sliceCase('insufficient', null)).not.toContain('kickOnboardingJob');
  });

  it('fires the kick(s) AFTER the triggerOnboarding commit (post-commit by construction)', () => {
    const commitIdx = source.indexOf('triggerOnboarding(getDb()');
    const firstKickIdx = source.indexOf('after(() => kickOnboardingJob());');
    expect(commitIdx).toBeGreaterThan(-1);
    expect(firstKickIdx).toBeGreaterThan(commitIdx);
  });

  it('fires the kick exactly twice (started + duplicate), never elsewhere', () => {
    const occurrences = source.split('kickOnboardingJob()').length - 1;
    expect(occurrences).toBe(2);
  });
});
