import { describe, expect, it } from 'vitest';
import { signEmbedToken, verifyEmbedToken } from './embed-token.ts';

const SECRET = 'a-test-secret-value-that-is-long-enough';
const OTHER_SECRET = 'a-completely-different-secret-value';

describe('signEmbedToken / verifyEmbedToken', () => {
  it('round-trips a signed audit id back to the same number', () => {
    const token = signEmbedToken(42, SECRET);
    expect(verifyEmbedToken(token, SECRET)).toBe(42);
  });

  it('produces the documented {id}.{sig} shape (16-byte base64url signature)', () => {
    const token = signEmbedToken(42, SECRET);
    expect(token).toMatch(/^42\.[A-Za-z0-9_-]{22}$/);
  });

  it('rejects a token verified against the wrong secret', () => {
    const token = signEmbedToken(42, SECRET);
    expect(verifyEmbedToken(token, OTHER_SECRET)).toBeNull();
  });

  it('rejects an id-substitution tamper (swap the id, keep the old signature)', () => {
    const token = signEmbedToken(42, SECRET);
    const [, sig] = token.split('.');
    expect(verifyEmbedToken(`43.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a single flipped character in the signature', () => {
    const token = signEmbedToken(42, SECRET);
    const [id, sig] = token.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(verifyEmbedToken(`${id}.${flipped}`, SECRET)).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    for (const bad of ['', 'no-dot-here', '42', 'abc.sig', '0.sig', '-1.sig', '42.', '.sig']) {
      expect(verifyEmbedToken(bad, SECRET)).toBeNull();
    }
  });

  it('never throws on a signature of a different length than expected (timingSafeEqual guard)', () => {
    expect(() => verifyEmbedToken('42.short', SECRET)).not.toThrow();
    expect(verifyEmbedToken('42.short', SECRET)).toBeNull();
  });

  it('is deterministic — the same id and secret always sign to the same token', () => {
    expect(signEmbedToken(7, SECRET)).toBe(signEmbedToken(7, SECRET));
  });
});
