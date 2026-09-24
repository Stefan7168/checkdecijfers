// Coverage for the session-refresh proxy's public-path allowlist
// (web/proxy.ts isPublicPath). This is the layer the route-handler tests
// CANNOT see: an unauthenticated request to a self-authenticating API route
// must be allowed through to its handler, not 307'd to /login. The WP16
// go-live (session 28) hit exactly this — /api/onboarding-cron was missing
// from PUBLIC_PATH_PREFIXES, so the Vercel cron caller and the app's own kick
// (web/lib/onboarding-kick.ts) were redirected and the job would never run,
// while the route-handler + job tests all stayed green. isPublicPath is the
// pure decision the proxy makes; pinning it here fails that regression loudly.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  applyEmbedRequestHeaders,
  applySourceRouteHeader,
  embedRequestHeaders,
  INTERNAL_APP_PATH,
  isInternalAppPath,
  isPublicPath,
  proxy,
  sourceRouteHeaders,
} from './proxy.ts';

// Row 2 (session 110 UX audit, #P1): a malformed/truncated sb-*-auth-token
// cookie makes the real supabase-js `getClaims()` THROW (e.g. it JSON.parses
// the cookie value) rather than resolve to "no session". Stubbed at the
// `@supabase/ssr` module seam — proxy() is the one function in this file
// that needs a real NextRequest + Supabase client, so it can't be unit-tested
// as a pure function the way isPublicPath/embedRequestHeaders are.
const { getClaims } = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims } }),
}));

describe('proxy isPublicPath allowlist', () => {
  it('allows the self-authenticating API routes (Bearer / signature, no session cookie)', () => {
    // THE go-live regression pin: the cron route MUST be public — it is called
    // by Vercel Cron and the app's own kick, neither of which carries a session.
    expect(isPublicPath('/api/onboarding-cron')).toBe(true);
    // #189: the retention-purge cron, same class. Left out, its 307 to /login
    // returns 200 to the cron dashboard — so the purge would read as scheduled
    // and healthy while never running once. The failure is invisible by
    // construction, which is why it gets its own pin rather than trusting the
    // reviewer of the next route to remember this file exists.
    expect(isPublicPath('/api/gdpr-purge-cron')).toBe(true);
    // The existing exemption that lets real Stripe purchases land — guard it too.
    expect(isPublicPath('/api/stripe/webhook')).toBe(true);
    // #114: the health route is auth-free BY DESIGN — the CI post-deploy smoke
    // exercises the signed-in dashboard's real DB reads through it, and CI
    // holds no test-user credential. Left out of the allowlist, its 307 to
    // /login would return 200 to a redirect-following caller — the app reads
    // as healthy while the check never ran once (the exact cron-route failure
    // shape above). The smoke deliberately does NOT follow redirects, so THIS
    // pin and that curl fail together or not at all.
    expect(isPublicPath('/api/health')).toBe(true);
    // The architecture reference page — no DB reads, no account, reachable
    // via the footer's gear icon by design.
    expect(isPublicPath('/systeemoverzicht')).toBe(true);
    // Journey programme R6 (ADR 045): the trust pages are public, exact-match.
    expect(isPublicPath('/werkwijze')).toBe(true);
    expect(isPublicPath('/privacy')).toBe(true);
    expect(isPublicPath('/privacy/details')).toBe(false);
    // EXACT, not prefix: a future sibling under an existing cron's name must
    // NOT inherit the session exemption (review finding — `startsWith` alone
    // would have shipped it public by accident).
    expect(isPublicPath('/api/gdpr-purge-cron-status')).toBe(false);
    expect(isPublicPath('/api/onboarding-cron-debug')).toBe(false);
    expect(isPublicPath('/api/stripe/webhook/replay')).toBe(false);
    expect(isPublicPath('/api/health-debug')).toBe(false);
    expect(isPublicPath('/api/health/details')).toBe(false);
    expect(isPublicPath('/systeemoverzicht-debug')).toBe(false);
    expect(isPublicPath('/systeemoverzicht/details')).toBe(false);
    // #237/ADR 046: the public gallery — exact match, like the pages above.
    expect(isPublicPath('/galerij')).toBe(true);
    expect(isPublicPath('/galerij-debug')).toBe(false);
    expect(isPublicPath('/galerij/anything')).toBe(false);
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

  // Fix round (Task 5 review, Piece 1 — CRITICAL): the public, no-auth
  // /embed/[token] route was shipped without ever being added to this
  // allowlist, so an anonymous third-party reader of an embedded chart was
  // silently 307'd to /login instead of seeing the chart — invisible to
  // every existing test because the route's own tests call EmbedPage()
  // directly in jsdom, never through this proxy. Pinned here the same way
  // the WP16 go-live regression (the comment at the top of this file) is.
  it('#5(1): /embed/[token] is public — the signed token IS the authorization, not a session', () => {
    expect(isPublicPath('/embed/42.abc123')).toBe(true);
    // A second token, to prove this is a genuine prefix match (ANY token
    // string after the slash), not a fluke of this one fixture value.
    expect(isPublicPath('/embed/999.deadbeef')).toBe(true);
  });

  // ADR 057 (session 127), Task 5: /embed/own/[publicId] — the own-data
  // twin of /embed/[token] — is a `/embed/`-prefixed path too, so it's
  // already covered by the SAME prefix entry above without any change to
  // PUBLIC_PATH_PREFIXES: the authorization there is a saved publication row
  // (checked inside the route itself, not a session), the same "no current
  // user to check a session against" reasoning as the CBS route's own entry.
  it('#5(1) / ADR 057 Task 5: /embed/own/[publicId] is public too — same prefix, own-data\'s saved-row authorization', () => {
    expect(isPublicPath('/embed/own/AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
  });

  it('#5(1): the bare prefix with nothing after it is also public (lenient by design)', () => {
    // No real token names anything under `/embed/` alone — the route itself
    // 404s on a missing/invalid token (verifyEmbedToken fails closed) — so
    // there is no harm in the proxy being lenient here rather than trying to
    // shape-validate the token in TWO places. Documented explicitly (not an
    // oversight) since every other prefix entry in PUBLIC_PATH_PREFIXES
    // happens to also be meaningful on its own.
    expect(isPublicPath('/embed/')).toBe(true);
  });

  it('#5(1): a sibling path that only STARTS WITH "/embed" (no slash) stays private', () => {
    // Guards the trailing-slash discipline itself: without it, a future
    // route like `/embedded-surveys` would inherit this exemption by
    // accident — the exact class of mistake `/api/health-debug` guards
    // against above, for the same PUBLIC_PATH_PREFIXES mechanism.
    expect(isPublicPath('/embedded-surveys')).toBe(false);
  });

  // Fix round (Task 5 review, Piece 1 — CRITICAL): re-asserted here, right
  // next to the new /embed/ entry, as a direct spot-check that widening
  // PUBLIC_PATH_PREFIXES didn't also widen anything else — not a
  // replacement for the "keeps protected paths private" block above, which
  // stays the general regression pin.
  it('#5(1): existing protected routes are unaffected by the new /embed/ prefix', () => {
    expect(isPublicPath('/credits')).toBe(false);
    expect(isPublicPath('/geschiedenis')).toBe(false);
  });
});

// Fix round (Task 5 review, Piece 2): the pure request-header decision behind
// the embed page's clean, chart-only layout (web/app/layout.tsx skips
// SiteFooter, and prefers this <html lang> over getLang()'s cookie/
// Accept-Language chain) when it's present — proxy() itself needs a real
// NextRequest/Supabase client to exercise end to end, but this decision does
// not, the same reason isPublicPath is unit-tested directly above rather than
// only indirectly through proxy().
describe('embedRequestHeaders (fix round, Piece 2)', () => {
  it('sets x-embed-route for an /embed/ path with no ?lang=', () => {
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams())).toEqual({ 'x-embed-route': '1' });
  });

  it('adds x-embed-lang when ?lang= is a real, valid Lang', () => {
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams('lang=en'))).toEqual({
      'x-embed-route': '1',
      'x-embed-lang': 'en',
    });
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams('lang=nl'))).toEqual({
      'x-embed-route': '1',
      'x-embed-lang': 'nl',
    });
  });

  it('ignores an unrecognised ?lang= value — no x-embed-lang key at all, so layout.tsx falls through to getLang()', () => {
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams('lang=fr'))).toEqual({ 'x-embed-route': '1' });
  });

  it('returns no headers at all for a non-embed path, even with a lang param', () => {
    expect(embedRequestHeaders('/credits', new URLSearchParams('lang=en'))).toEqual({});
    expect(embedRequestHeaders('/', new URLSearchParams())).toEqual({});
  });

  // Final review (Fix 2): `?theme=` -> `x-embed-theme`, validated down to
  // EXACTLY 'light'/'dark'. 'auto' is the dialog's third option but
  // deliberately sets no header at all — it means "follow the reader's own
  // system preference", which is next-themes' own default with nothing to
  // override, so there is nothing for layout.tsx's forcedTheme to force.
  it('adds x-embed-theme when ?theme= is exactly "light" or "dark"', () => {
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams('theme=dark'))).toEqual({
      'x-embed-route': '1',
      'x-embed-theme': 'dark',
    });
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams('theme=light'))).toEqual({
      'x-embed-route': '1',
      'x-embed-theme': 'light',
    });
  });

  it('sets no x-embed-theme key at all for ?theme=auto, absent, or an invalid value', () => {
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams('theme=auto'))).toEqual({
      'x-embed-route': '1',
    });
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams())).toEqual({ 'x-embed-route': '1' });
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams('theme=blue'))).toEqual({
      'x-embed-route': '1',
    });
    // Case sensitivity: 'Dark'/'DARK' are not the validated values either —
    // same discipline as isLang's own exact-match convention elsewhere.
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams('theme=Dark'))).toEqual({
      'x-embed-route': '1',
    });
  });

  it('combines x-embed-lang and x-embed-theme when both ?lang= and ?theme= are valid', () => {
    expect(embedRequestHeaders('/embed/42.sig', new URLSearchParams('lang=en&theme=dark'))).toEqual({
      'x-embed-route': '1',
      'x-embed-lang': 'en',
      'x-embed-theme': 'dark',
    });
  });

  // ADR 057, Task 5: embedRequestHeaders matches on the PATHNAME PREFIX
  // ('/embed/'), not a specific route — so /embed/own/[publicId] gets the
  // exact same header treatment as /embed/[token] with zero changes to this
  // function. Pinned directly (rather than trusted by inference from the
  // prefix-match tests above) since this task's own brief calls it out by
  // name.
  it('ADR 057 Task 5: /embed/own/[publicId] gets the same headers as /embed/[token], unchanged', () => {
    expect(embedRequestHeaders('/embed/own/x', new URLSearchParams('lang=en&theme=dark'))).toEqual({
      'x-embed-route': '1',
      'x-embed-lang': 'en',
      'x-embed-theme': 'dark',
    });
  });
});

// Bundle A (final review): the trusted-header-stripping hygiene fix.
// embedRequestHeaders above only ever ADDS x-embed-route/x-embed-lang/
// x-embed-theme for a genuine /embed/ path; applyEmbedRequestHeaders is the
// function that ALSO strips any client-supplied value under those same
// names first, on every path, before conditionally re-setting them — takes
// a plain Headers instance so it's exercised directly, the same reason
// isPublicPath/embedRequestHeaders are unit-tested without a real
// NextRequest/Supabase client.
describe('applyEmbedRequestHeaders (Bundle A, final review)', () => {
  it('strips a spoofed x-embed-route/x-embed-lang/x-embed-theme header on a NON-embed path — none survive', () => {
    const headers = new Headers({
      'x-embed-route': '1',
      'x-embed-lang': 'en',
      'x-embed-theme': 'dark',
    });
    applyEmbedRequestHeaders(headers, '/credits', new URLSearchParams());
    expect(headers.get('x-embed-route')).toBeNull();
    expect(headers.get('x-embed-lang')).toBeNull();
    expect(headers.get('x-embed-theme')).toBeNull();
  });

  it('strips a spoofed value on the homepage too', () => {
    const headers = new Headers({ 'x-embed-route': '1' });
    applyEmbedRequestHeaders(headers, '/', new URLSearchParams());
    expect(headers.get('x-embed-route')).toBeNull();
  });

  it('on a genuine /embed/ path, a pre-existing (spoofed) value is replaced by the real resolved one, never merged with it', () => {
    const headers = new Headers({ 'x-embed-lang': 'fr', 'x-embed-theme': 'dark' });
    applyEmbedRequestHeaders(headers, '/embed/42.sig', new URLSearchParams('lang=en&theme=light'));
    expect(headers.get('x-embed-route')).toBe('1');
    expect(headers.get('x-embed-lang')).toBe('en');
    expect(headers.get('x-embed-theme')).toBe('light');
  });

  it('on a genuine /embed/ path with no ?lang=/?theme=, a spoofed prior value is removed and NOT reinstated', () => {
    const headers = new Headers({ 'x-embed-lang': 'fr', 'x-embed-theme': 'dark' });
    applyEmbedRequestHeaders(headers, '/embed/42.sig', new URLSearchParams());
    expect(headers.get('x-embed-route')).toBe('1');
    expect(headers.get('x-embed-lang')).toBeNull();
    expect(headers.get('x-embed-theme')).toBeNull();
  });

  it('leaves unrelated headers on the same Headers instance untouched', () => {
    const headers = new Headers({ 'x-embed-route': 'spoofed', cookie: 'session=abc', accept: 'text/html' });
    applyEmbedRequestHeaders(headers, '/credits', new URLSearchParams());
    expect(headers.get('cookie')).toBe('session=abc');
    expect(headers.get('accept')).toBe('text/html');
  });
});

// Session 110 UX audit row 18 (ADR 048 addendum): the global footer's trust
// line is CBS-specific everywhere (#7/#207) except the one internal page
// that is entirely Eurostat data. Same shape as embedRequestHeaders/
// applyEmbedRequestHeaders above: a pure, exact-matched pathname -> header
// mapping, plus a strip-then-set applier so a client-supplied header can
// never survive on any path other than the real route.
describe('sourceRouteHeaders (pass-2 row 18)', () => {
  it('sets x-source-route: eurostat for the exact /eurostat-explorer path', () => {
    expect(sourceRouteHeaders('/eurostat-explorer')).toEqual({ 'x-source-route': 'eurostat' });
  });

  it('sets nothing for every other path, including a near-miss prefix', () => {
    expect(sourceRouteHeaders('/')).toEqual({});
    expect(sourceRouteHeaders('/chat')).toEqual({});
    expect(sourceRouteHeaders('/eurostat-explorer/sub')).toEqual({});
    expect(sourceRouteHeaders('/eurostat-explorer-legacy')).toEqual({});
  });
});

describe('applySourceRouteHeader (pass-2 row 18)', () => {
  it('sets x-source-route: eurostat on the real path', () => {
    const headers = new Headers();
    applySourceRouteHeader(headers, '/eurostat-explorer');
    expect(headers.get('x-source-route')).toBe('eurostat');
  });

  it('strips a client-supplied x-source-route header on every other path', () => {
    const headers = new Headers({ 'x-source-route': 'eurostat' });
    applySourceRouteHeader(headers, '/chat');
    expect(headers.get('x-source-route')).toBeNull();
  });

  it('strips a spoofed value on the homepage too', () => {
    const headers = new Headers({ 'x-source-route': 'eurostat' });
    applySourceRouteHeader(headers, '/');
    expect(headers.get('x-source-route')).toBeNull();
  });

  it('leaves unrelated headers untouched', () => {
    const headers = new Headers({ 'x-source-route': 'spoofed', cookie: 'session=abc' });
    applySourceRouteHeader(headers, '/credits');
    expect(headers.get('cookie')).toBe('session=abc');
  });
});

describe('proxy() — a malformed auth cookie must not 500 the whole app (row 2, #P1)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('on a public path, treats the throw as signed-out and clears the offending cookie instead of surfacing a 500', async () => {
    getClaims.mockRejectedValue(new SyntaxError('Unexpected token in JSON'));
    const request = new NextRequest('https://example.com/', {
      headers: { cookie: 'sb-abcproj-auth-token=not-valid-json' },
    });

    const response = await proxy(request);

    // No throw escaped proxy() to become an unhandled 500.
    expect(response.status).toBeLessThan(500);
    // '/' is public — no redirect to /login.
    expect(response.headers.get('location')).toBeNull();
    // The bad cookie is cleared on the response (empty value + immediate expiry).
    const cleared = response.cookies.get('sb-abcproj-auth-token');
    expect(cleared?.value).toBe('');
  });

  it('on a private path, redirects to /login (same as an ordinary signed-out visit) rather than throwing', async () => {
    getClaims.mockRejectedValue(new SyntaxError('Unexpected token in JSON'));
    const request = new NextRequest('https://example.com/credits', {
      headers: { cookie: 'sb-abcproj-auth-token=not-valid-json' },
    });

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });

  it('never logs the cookie value on the throw path', async () => {
    getClaims.mockRejectedValue(new SyntaxError('Unexpected token in JSON at position 0'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const request = new NextRequest('https://example.com/', {
      headers: { cookie: 'sb-abcproj-auth-token=super-secret-token-value' },
    });

    await proxy(request);

    const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');
    expect(logged).not.toContain('super-secret-token-value');
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// Session 110 route split (ADR 033 D8). `/` serves the public landing to
// everyone and is REWRITTEN to the internal signed-in segment when the request
// carries a JWT-validated session — same URL, separate client bundle (before
// the split every anonymous visitor downloaded the whole chat workspace:
// docs/session-briefs/2026-09-13-build-performance-diagnosis.md). Three things
// must hold, and only this file can see them: the rewrite happens for a
// session, it does NOT happen without one, and the internal path is not a URL
// anybody can ask for directly.
describe('isInternalAppPath (route split)', () => {
  it('matches the internal segment and anything nested under it', () => {
    expect(isInternalAppPath(INTERNAL_APP_PATH)).toBe(true);
    expect(isInternalAppPath(`${INTERNAL_APP_PATH}/anything`)).toBe(true);
  });

  it('does NOT swallow a sibling route that merely starts with the same letters', () => {
    // Same exact-match discipline PUBLIC_EXACT_PATHS uses: a future
    // /workspace-debug must not inherit this rule by accident.
    expect(isInternalAppPath(`${INTERNAL_APP_PATH}-debug`)).toBe(false);
    expect(isInternalAppPath('/')).toBe(false);
    expect(isInternalAppPath('/credits')).toBe(false);
  });

  it('is not public — it is never reached without a session in the first place', () => {
    expect(isPublicPath(INTERNAL_APP_PATH)).toBe(false);
  });
});

describe('proxy() — the route split keeps the URL at / (ADR 033 D8)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const signedIn = () => getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } });
  const signedOut = () => getClaims.mockResolvedValue({ data: null });

  it('rewrites / to the internal signed-in segment for a validated session', async () => {
    signedIn();
    const response = await proxy(new NextRequest('https://example.com/'));

    // A rewrite is internal: no 3xx, no Location — the visitor's address bar
    // still says `/`, which is what keeps bookmarks and the e2e tests valid.
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toContain(INTERNAL_APP_PATH);
  });

  it('keeps the query string on the rewrite (the Stripe /?purchase=success return)', async () => {
    signedIn();
    const response = await proxy(new NextRequest('https://example.com/?purchase=success'));
    expect(response.headers.get('x-middleware-rewrite')).toContain('purchase=success');
  });

  it('does NOT rewrite / without a session — an anonymous visitor gets the landing', async () => {
    signedOut();
    const response = await proxy(new NextRequest('https://example.com/'));
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  });

  it('does not rewrite any OTHER path, signed in or not', async () => {
    signedIn();
    for (const path of ['/credits', '/geschiedenis', '/galerij']) {
      const response = await proxy(new NextRequest(`https://example.com${path}`));
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    }
  });

  it('redirects a DIRECT request for the internal path back to / — with a session', async () => {
    signedIn();
    const response = await proxy(new NextRequest(`https://example.com${INTERNAL_APP_PATH}`));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://example.com/');
    // The redirect is unconditional, so the session is never even read for it.
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('redirects a direct request for the internal path back to / — without one', async () => {
    signedOut();
    const response = await proxy(new NextRequest(`https://example.com${INTERNAL_APP_PATH}/deep`));
    expect(response.status).toBe(307);
    // NOT /login: `/` is public, and from there an anonymous visitor sees the
    // landing while a signed-in one is rewritten straight back in.
    expect(response.headers.get('location')).toBe('https://example.com/');
  });

  it('strips a spoofed trusted header on the rewritten request too', async () => {
    // applyEmbedRequestHeaders/applySourceRouteHeader run BEFORE the rewrite
    // and the rewrite is built from that same mutated request, so a forged
    // header cannot ride the one path that gets rewritten.
    signedIn();
    const request = new NextRequest('https://example.com/', {
      headers: { 'x-embed-route': '1', 'x-source-route': 'eurostat' },
    });
    await proxy(request);
    expect(request.headers.get('x-embed-route')).toBeNull();
    expect(request.headers.get('x-source-route')).toBeNull();
  });
});
