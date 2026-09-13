import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { signOnboardingOffer, verifyOnboardingOffer } from './onboarding-offer-token.ts';
import type { OnboardingOfferPayload } from './onboarding-offer-token.ts';

const SECRET = 'a-test-secret-value-that-is-long-enough';
const OTHER_SECRET = 'a-completely-different-secret-value';

function payload(overrides: Partial<OnboardingOfferPayload> = {}): OnboardingOfferPayload {
  return {
    userId: 'user-123',
    requestId: 'req-abc',
    tableId: '12345NED',
    topicTerm: 'zonnepanelen',
    confidence: 0.92,
    candidateIds: ['12345NED', '67890NED'],
    questionText: 'Hoeveel zonnepanelen zijn er?',
    ackAuditAnswerId: 7,
    ...overrides,
  };
}

describe('signOnboardingOffer / verifyOnboardingOffer', () => {
  it('round-trips every field back exactly', () => {
    const token = signOnboardingOffer(payload(), SECRET);
    expect(verifyOnboardingOffer(token, SECRET)).toEqual(payload());
  });

  it('round-trips a null ackAuditAnswerId (the offer turn\'s own audit write failed)', () => {
    const token = signOnboardingOffer(payload({ ackAuditAnswerId: null }), SECRET);
    expect(verifyOnboardingOffer(token, SECRET)).toEqual(payload({ ackAuditAnswerId: null }));
  });

  it('round-trips an empty candidateIds array', () => {
    const token = signOnboardingOffer(payload({ candidateIds: [] }), SECRET);
    expect(verifyOnboardingOffer(token, SECRET)).toEqual(payload({ candidateIds: [] }));
  });

  it('rejects a token verified against the wrong secret', () => {
    const token = signOnboardingOffer(payload(), SECRET);
    expect(verifyOnboardingOffer(token, OTHER_SECRET)).toBeNull();
  });

  it('rejects a tampered payload (userId swapped) even with the original signature', () => {
    const token = signOnboardingOffer(payload(), SECRET);
    const [encoded, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const forged = Buffer.from(JSON.stringify({ ...decoded, userId: 'someone-else' }), 'utf8').toString(
      'base64url',
    );
    expect(verifyOnboardingOffer(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a tampered payload (confidence bumped to bypass the confident-floor gate) even with the original signature', () => {
    const token = signOnboardingOffer(payload({ confidence: 0.3 }), SECRET);
    const [encoded, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const forged = Buffer.from(JSON.stringify({ ...decoded, confidence: 0.99 }), 'utf8').toString('base64url');
    expect(verifyOnboardingOffer(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a single flipped character in the signature', () => {
    const token = signOnboardingOffer(payload(), SECRET);
    const [encoded, sig] = token.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(verifyOnboardingOffer(`${encoded}.${flipped}`, SECRET)).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'no-dot-here', 'abc', '.sig', 'abc.', 'not-base64!!!.sig']) {
      expect(() => verifyOnboardingOffer(bad, SECRET)).not.toThrow();
      expect(verifyOnboardingOffer(bad, SECRET)).toBeNull();
    }
  });

  it('rejects a syntactically valid but non-payload-shaped JSON body (missing fields)', () => {
    const encoded = Buffer.from(JSON.stringify({ userId: 'user-123' }), 'utf8').toString('base64url');
    // Sign this malformed body with the real secret so it fails on SHAPE, not signature.
    const sig = createHmac('sha256', SECRET).update(encoded).digest().toString('base64url');
    expect(verifyOnboardingOffer(`${encoded}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects an expired offer (30-minute TTL)', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const token = signOnboardingOffer(payload(), SECRET);
      vi.setSystemTime(new Date('2026-01-01T00:29:00Z'));
      expect(verifyOnboardingOffer(token, SECRET)).toEqual(payload());
      vi.setSystemTime(new Date('2026-01-01T00:31:00Z'));
      expect(verifyOnboardingOffer(token, SECRET)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is deterministic in its signature (not its payload — expiresAt varies by mint time)', () => {
    const a = signOnboardingOffer(payload(), SECRET);
    const b = signOnboardingOffer(payload(), SECRET);
    // Both verify to the identical payload even though the two tokens differ
    // (each embeds its own mint-time expiresAt).
    expect(verifyOnboardingOffer(a, SECRET)).toEqual(payload());
    expect(verifyOnboardingOffer(b, SECRET)).toEqual(payload());
  });
});
