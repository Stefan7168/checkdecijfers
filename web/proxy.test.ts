// Coverage for the session-refresh proxy's public-path allowlist
// (web/proxy.ts isPublicPath). This is the layer the route-handler tests
// CANNOT see: an unauthenticated request to a self-authenticating API route
// must be allowed through to its handler, not 307'd to /login. The WP16
// go-live (session 28) hit exactly this — /api/onboarding-cron was missing
// from PUBLIC_PATH_PREFIXES, so the Vercel cron caller and the app's own kick
// (web/lib/onboarding-kick.ts) were redirected and the job would never run,
// while the route-handler + job tests all stayed green. isPublicPath is the
// pure decision the proxy makes; pinning it here fails that regression loudly.
import { describe, expect, it } from 'vitest';
import { isPublicPath } from './proxy.ts';

describe('proxy isPublicPath allowlist', () => {
  it('allows the self-authenticating API routes (Bearer / signature, no session cookie)', () => {
    // THE go-live regression pin: the cron route MUST be public — it is called
    // by Vercel Cron and the app's own kick, neither of which carries a session.
    expect(isPublicPath('/api/onboarding-cron')).toBe(true);
    // The existing exemption that lets real Stripe purchases land — guard it too.
    expect(isPublicPath('/api/stripe/webhook')).toBe(true);
  });

  it('allows the auth-flow paths', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/auth/callback')).toBe(true);
  });

  it('#170(2): llms.txt is public — it exists to be fetched anonymously', () => {
    expect(isPublicPath('/llms.txt')).toBe(true);
  });

  it('the homepage is public (session-51 owner decision: landing for logged-out visitors) — EXACT match only', () => {
    expect(isPublicPath('/')).toBe(true);
  });

  it('keeps protected paths private (the guard still guards)', () => {
    expect(isPublicPath('/credits')).toBe(false);
    expect(isPublicPath('/geschiedenis')).toBe(false);
    // A different API route is NOT blanket-public — only the explicit entries.
    expect(isPublicPath('/api/something-else')).toBe(false);
  });
});
