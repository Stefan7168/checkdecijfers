// WP16 sub-part 2 (ADR 026, design §2) wiring pins — the honest cheap layer
// for the 'use server' askQuestion orchestration the jsdom suite cannot
// exercise (it needs DB/auth/LLM mocks in a server context). Same recorded
// judgment as purchase-wiring.test.ts: these pin WIRING PRESENCE, not behavior
// (triggerOnboarding's behavior is covered by tests/ingestion/
// onboarding-trigger.test.ts; the finder's routing by tests/answer/
// onboarding-flow.test.ts; the token's sign/verify contract by
// src/ingestion/onboarding-offer-token.test.ts). A silent regression on a
// live money-flow trigger is judged worse than a brittle-but-honest source
// scan.
//
// ADR 026 addendum (session 101, #109's confirm-first reversal): the trigger
// used to fire directly from maybeTriggerOnboarding, inside askQuestion. It
// now fires from a SEPARATE exported action, confirmOnboardingFetch, only on
// an explicit confirm click — maybeTriggerOnboarding's own job shrank to
// minting a signed offer (or failing closed if the signing secret is unset).
// This file's pins were rewritten to follow that split, not just patched —
// several of the old assertions would have kept passing on the NEW source by
// coincidence (same literal substrings, moved to a different function),
// which would have left them pinning the wrong claim silently.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf-8');

describe('WP16 sub-part 2 onboarding-finder wiring (source pins)', () => {
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
    // Session 110 route split (ADR 033 D8): the signed-in dashboard branch
    // moved to the app/workspace segment proxy.ts rewrites `/` to.
    const page = read('workspace/page.tsx');
    expect(page).toContain(
      "getQuestionHistory(db, userId, { includeOnboarding: process.env.ONBOARDING_ENABLED === '1' })",
    );
  });
});

describe('ADR 026 addendum: maybeTriggerOnboarding mints an offer, it does not trigger (source pins)', () => {
  const source = read('actions.ts');

  it('runs after chargeAndRun, only on a confident onboarding_pending refusal', () => {
    expect(source).toContain('maybeTriggerOnboarding(');
    expect(source).toContain("response.reason !== 'onboarding_pending'");
  });

  it('does NOT call triggerOnboarding directly from maybeTriggerOnboarding — only confirmOnboardingFetch does', () => {
    // Slice the file at maybeTriggerOnboarding's own boundaries (up to the
    // next top-level function/type declaration) so this assertion cannot be
    // satisfied by triggerOnboarding living somewhere ELSE in the file —
    // exactly the coincidence this rewrite exists to stop pinning silently.
    const start = source.indexOf('async function maybeTriggerOnboarding(');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n// ADR 026 addendum (session 101): the result of an explicit confirm click', start);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).not.toContain('triggerOnboarding(getDb()');
    expect(body).toContain('signOnboardingOffer(');
  });

  it('WP27 stage B: hands the candidate chain from the envelope into the offer token', () => {
    // The web action is a CARRIER link of the candidate chain (brief § Stage
    // B: skipping one strands the data) — the envelope's candidateIds must
    // reach the signed token verbatim, since nothing else carries it forward
    // to the eventual trigger call now that it is deferred to a confirm click.
    expect(source).toContain('candidateIds: response.onboarding.candidateIds');
  });

  it('fails closed to the UNAVAILABLE text, never a silent auto-trigger, when the secret is unset', () => {
    const start = source.indexOf('async function maybeTriggerOnboarding(');
    const end = source.indexOf('\n// ADR 026 addendum (session 101): the result of an explicit confirm click', start);
    const body = source.slice(start, end);
    expect(body).toContain("process.env.ONBOARDING_OFFER_SECRET");
    expect(body).toContain('ONBOARDING_OFFER_UNAVAILABLE_TEXT');
  });
});

describe('ADR 026 addendum: confirmOnboardingFetch verifies before it ever calls triggerOnboarding (source pins)', () => {
  const source = read('actions.ts');
  const start = source.indexOf('export async function confirmOnboardingFetch(');
  const body = source.slice(start);

  it('is exported (chat.tsx imports it as a Server Action) and verifies the token before doing anything billing-shaped', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('verifyOnboardingOffer(token, secret)');
    // The verify call must precede the trigger call, not just both exist.
    const verifyIdx = body.indexOf('verifyOnboardingOffer(');
    const triggerIdx = body.indexOf('triggerOnboarding(getDb()');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(triggerIdx).toBeGreaterThan(verifyIdx);
  });

  it('cross-checks the token\'s userId against the REAL session user — never trusts the token alone for identity', () => {
    expect(body).toContain('payload.userId !== userId');
  });

  it('reuses the token\'s ORIGINAL requestId for the trigger call — never mints a fresh one', () => {
    expect(body).toContain('requestId: payload.requestId');
  });

  it('WP27 stage B: hands the candidate chain from the verified payload into the trigger', () => {
    expect(body).toContain('candidateIds: payload.candidateIds');
  });

  it('maps the three trigger results to the pinned outcome shapes', () => {
    expect(body).toContain("case 'started'");
    expect(body).toContain("kind: 'started'");
    expect(body).toContain('netCost: result.credits');
    expect(body).toContain("case 'duplicate'");
    expect(body).toContain("kind: 'duplicate'");
    expect(body).toContain("case 'insufficient'");
    expect(body).toContain("kind: 'insufficient_credits'");
  });
});

describe('#113 kick-on-trigger wiring (source pins)', () => {
  const source = read('actions.ts');

  it('imports after from next/server and kickOnboardingJob from the lib', () => {
    expect(source).toContain("import { after } from 'next/server';");
    expect(source).toContain("import { kickOnboardingJob } from '../lib/onboarding-kick.ts';");
  });

  // ADR 026 addendum: this switch now lives inside confirmOnboardingFetch,
  // not maybeTriggerOnboarding — scope every slice to ITS body so a stray
  // 'case' string elsewhere in the file can never be mistaken for it.
  const confirmStart = source.indexOf('export async function confirmOnboardingFetch(');
  const confirmBody = source.slice(confirmStart);
  const sliceCase = (label: string, next: string | null): string => {
    const start = confirmBody.indexOf(`case '${label}':`);
    expect(start).toBeGreaterThan(-1);
    const end = next === null ? confirmBody.length : confirmBody.indexOf(`case '${next}':`, start);
    return confirmBody.slice(start, end === -1 ? confirmBody.length : end);
  };

  it("fires the kick inside BOTH the 'started' and 'duplicate' cases, POST-response", () => {
    expect(sliceCase('started', 'duplicate')).toContain('after(() => kickOnboardingJob());');
    expect(sliceCase('duplicate', 'insufficient')).toContain('after(() => kickOnboardingJob());');
  });

  it("does NOT fire the kick in the 'insufficient' case (nothing was queued)", () => {
    expect(sliceCase('insufficient', null)).not.toContain('kickOnboardingJob');
  });

  it('fires the kick(s) AFTER the triggerOnboarding commit (post-commit by construction)', () => {
    const commitIdx = confirmBody.indexOf('triggerOnboarding(getDb()');
    const firstKickIdx = confirmBody.indexOf('after(() => kickOnboardingJob());');
    expect(commitIdx).toBeGreaterThan(-1);
    expect(firstKickIdx).toBeGreaterThan(commitIdx);
  });

  it('fires the kick exactly twice (started + duplicate) inside confirmOnboardingFetch, never elsewhere in the file', () => {
    // The import line reads `kickOnboardingJob` with no trailing `()` (it
    // imports the identifier, never calls it there), so it can never match
    // this pattern — both counts below should be exactly the two call sites.
    const totalOccurrences = source.split('kickOnboardingJob()').length - 1;
    const confirmOccurrences = confirmBody.split('kickOnboardingJob()').length - 1;
    expect(confirmOccurrences).toBe(2);
    expect(totalOccurrences).toBe(2);
  });
});
