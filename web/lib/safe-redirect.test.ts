// Open-redirect hardening on the magic-link auth callback (session 44 security
// hunt). These pin BOTH sides: legitimate same-origin `next` values survive
// verbatim, and every known off-site trick — including the two that the old
// `${origin}${next}` concatenation actually let through (`@evil.com` →
// userinfo host, `.evil.com` → attacker subdomain) — collapses to the origin
// root. If a future edit reintroduces concatenation, the off-site cases fail.
import { describe, expect, it } from 'vitest';
import { safeRedirectUrl } from './safe-redirect.ts';

const ORIGIN = 'https://checkdecijfers.nl';

describe('safeRedirectUrl — same-origin values pass through', () => {
  it('keeps a plain relative path', () => {
    expect(safeRedirectUrl('/geschiedenis', ORIGIN).href).toBe(`${ORIGIN}/geschiedenis`);
  });
  it('keeps a relative path with query + hash', () => {
    expect(safeRedirectUrl('/credits?x=1#top', ORIGIN).href).toBe(`${ORIGIN}/credits?x=1#top`);
  });
  it('defaults an empty/root next to the origin root', () => {
    expect(safeRedirectUrl('/', ORIGIN).href).toBe(`${ORIGIN}/`);
  });
});

describe('safeRedirectUrl — off-site tricks collapse to the origin root', () => {
  // The exact payloads the pre-fix concatenation let through:
  it('neutralises the userinfo trick (@host)', () => {
    // `${ORIGIN}@evil.com` parsed to host evil.com before the fix.
    expect(safeRedirectUrl('@evil.com', ORIGIN).origin).toBe(ORIGIN);
    expect(safeRedirectUrl('@evil.com', ORIGIN).href).toBe(`${ORIGIN}/@evil.com`);
  });
  it('neutralises the subdomain-suffix trick (.host)', () => {
    // `${ORIGIN}.evil.com` parsed to host checkdecijfers.nl.evil.com before the fix.
    expect(safeRedirectUrl('.evil.com', ORIGIN).origin).toBe(ORIGIN);
  });
  it('rejects a protocol-relative //host', () => {
    expect(safeRedirectUrl('//evil.com', ORIGIN).href).toBe(`${ORIGIN}/`);
  });
  it('rejects an absolute foreign URL', () => {
    expect(safeRedirectUrl('https://evil.com/phish', ORIGIN).href).toBe(`${ORIGIN}/`);
  });
  it('rejects a backslash-normalisation trick', () => {
    // WHATWG normalises `\` to `/` for special schemes, so `/\evil.com`
    // resolves to //evil.com — the origin check catches it and falls to root.
    expect(safeRedirectUrl('/\\evil.com', ORIGIN).href).toBe(`${ORIGIN}/`);
  });
  it('rejects a non-http scheme (javascript:) without throwing', () => {
    expect(safeRedirectUrl('javascript:alert(1)', ORIGIN).href).toBe(`${ORIGIN}/`);
  });
});
