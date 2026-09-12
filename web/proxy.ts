// Session-refresh proxy (WP13, ADR 006 seam 1 / ADR 020). Named `proxy.ts`
// with an exported `proxy` function, NOT `middleware.ts` — Next.js 16
// renamed the file convention (confirmed by reading
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md;
// the functionality is unchanged, only the name).
//
// Per Next's own data-security guidance, this proxy is an OPTIMISTIC check
// (redirect unauthenticated visits away from the main chat) — it is not the
// authorization boundary. web/app/actions.ts verifies the session again
// itself before ever touching the billing gate/ledger, since a Proxy
// matcher change could silently stop covering a Server Action without
// anyone noticing.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isLang } from './lib/i18n/messages.ts';

// Paths reachable WITHOUT a Supabase session. Each entry here authenticates
// itself (or needs no auth): /login + /auth/callback are the auth flow;
// /api/stripe/webhook verifies Stripe's signature; /api/onboarding-cron
// verifies its own CRON_SECRET Bearer (503 unset / 401 wrong) — it is called
// by Vercel Cron and by the app's own kick (web/lib/onboarding-kick.ts), NEITHER
// of which carries a user session cookie, so the session-redirect must NOT
// swallow it (a redirect would 307 the cron caller to /login and the job would
// silently never run — caught live at the WP16 go-live, session 28).
/** Routes that authenticate themselves (or need no auth) and must match
 * EXACTLY — no sibling under the same name inherits the exemption.
 * /api/health (#114) is auth-free BY DESIGN: it exists so the CI post-deploy
 * smoke can exercise the signed-in dashboard's real DB reads without holding
 * a test-user credential — it takes no input, reads a synthetic user id that
 * matches no rows, and returns only check names, never data or error text. */
const PUBLIC_EXACT_PATHS = [
  '/api/stripe/webhook',
  '/api/onboarding-cron',
  '/api/gdpr-purge-cron',
  '/api/health',
  // The public, noindexed architecture reference page — no DB reads, no
  // account needed, reachable via the footer's gear icon by design.
  '/systeemoverzicht',
  // The two trust pages (journey programme R6, ADR 045): public by nature —
  // a privacy policy behind a login is no policy. Static catalogue copy,
  // no DB reads. Exact match, like the system map (found in the session-97
  // browser pass: the pages 307'd to /login until listed here).
  '/werkwijze',
  '/privacy',
  // #237/ADR 046: the public gallery of curated chart stories — same
  // posture as the two trust pages above (session-97 lesson: a new public
  // route 307's to /login until it's listed here). No AI spend, no server
  // actions, only the deterministic curated-chart feed (web/lib/ontdek.ts).
  '/galerij',
];

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/auth/callback',
  // #170(2): the registry-generated self-description for LLMs/crawlers —
  // public by nature (it exists to be fetched anonymously), read-only, and
  // it exposes only what the public product already shows on every answer
  // (table ids, titles, sync dates).
  '/llms.txt',
  // Fix round (Task 5 review, Piece 1 — CRITICAL): the public, no-auth
  // /embed/[token] route (web/app/embed/[token]/page.tsx) was built and
  // shipped WITHOUT ever being added here — every anonymous third-party
  // reader of an embedded chart was silently 307'd to /login instead of
  // seeing the chart, making the entire feature unreachable by the public
  // it exists for. Invisible to every route test, which calls EmbedPage()
  // directly in jsdom and never goes through this proxy at all. Same class
  // of reasoning as /login and /llms.txt above: the SIGNED TOKEN in the URL
  // (verifyEmbedToken, Task 1) is this route's own authorization — there is
  // no "current user" here to check a session against. Prefix, not exact,
  // and deliberately WITH the trailing slash: unlike the EXACT-match API
  // routes above (where a bare `startsWith` risked an unintended sibling
  // inheriting the exemption, e.g. `/api/health-debug`), a stray path under
  // `/embed/` that names no real token just 404s inside the route itself
  // (verifyEmbedToken/loadAuditRecord both fail closed) — there is nothing
  // under this prefix for an accidental sibling to expose.
  '/embed/',
];

/** True when `pathname` may be reached without a Supabase session. Exported so
 * the allowlist decision — the layer the route-handler tests can't see — is
 * unit-tested directly (proxy.test.ts); the WP16 go-live regression was a
 * missing entry here, not a bug in the redirect wiring below. */
export function isPublicPath(pathname: string): boolean {
  // '/' is public since session 51 (owner decision: the homepage is the
  // product's public face — logged-out visitors see the landing, page.tsx
  // renders the dashboard only for a session). EXACT match only: a
  // startsWith('/') entry would open every route.
  if (pathname === '/') return true;
  // EXACT match for the self-authenticating API routes, prefix match only for
  // the genuinely-prefixed ones. `startsWith` alone meant a future sibling under
  // an existing name — `/api/gdpr-purge-cron-status` — would ship session-exempt
  // by accident (review finding); `/` already had exact-match discipline for the
  // same reason, one line up.
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Fix round (Task 5 review, Piece 2; final review Fix 2 adds the third key):
 * the extra request headers this proxy adds for an /embed/[token] request, so
 * web/app/layout.tsx (via next/headers' headers()) can render a clean,
 * chart-only page for it (spec Part B3 — no site header/footer) without a
 * second root layout / route group. `x-embed-lang` carries the route's OWN
 * resolved `?lang=` — validated with the real isLang guard, never trusted
 * raw — so <html lang> can match it even when it disagrees with the
 * visitor's cookie/Accept-Language (an anonymous third-party reader has no
 * checkdecijfers.nl cookie of their own for that resolution to mean anything
 * either). `x-embed-theme` carries the route's OWN `?theme=`, validated down
 * to exactly 'light'/'dark' — 'auto' deliberately gets NO header at all
 * (that option means "follow the reader's own system preference", which is
 * next-themes' own default behaviour with nothing to override), and neither
 * does an absent or unrecognised value. layout.tsx passes this straight
 * through as next-themes' `forcedTheme` prop — see that file for why this
 * closes the bug the old `?theme=` handling had (a per-route wrapper `<div
 * className="dark">` could not stop next-themes' own unconditional
 * `<ThemeProvider>` from reading the READER's OS/browser preference, so
 * `?theme=light` — the embed dialog's own DEFAULT option — silently did
 * nothing on a dark-mode reader). A non-embed path or an absent/invalid
 * `?lang=`/`?theme=` gets no corresponding key, leaving layout.tsx's existing
 * behaviour (SiteFooter shown, getLang()'s cookie/Accept-Language chain, no
 * forced theme) unchanged. Exported and unit-tested directly, same reason as
 * isPublicPath above: this pure decision is one layer proxy()'s own
 * route-handler tests can't see, and proxy() itself needs a real
 * NextRequest/Supabase client to exercise, which this doesn't. */
export function embedRequestHeaders(pathname: string, searchParams: URLSearchParams): Record<string, string> {
  if (!pathname.startsWith('/embed/')) return {};
  const headers: Record<string, string> = { 'x-embed-route': '1' };
  const lang = searchParams.get('lang');
  if (isLang(lang)) headers['x-embed-lang'] = lang;
  const theme = searchParams.get('theme');
  if (theme === 'light' || theme === 'dark') headers['x-embed-theme'] = theme;
  return headers;
}

/** The complete set of keys `embedRequestHeaders` ever sets — the ONE place
 * that list is written, so `applyEmbedRequestHeaders` below can never fall
 * out of sync with it (a fourth key added to one and not the other would
 * silently reopen the exact spoofing gap this closes). */
const TRUSTED_EMBED_HEADER_KEYS = ['x-embed-route', 'x-embed-lang', 'x-embed-theme'] as const;

/** Bundle A (final review): `embedRequestHeaders` above only ever ADDS these
 * keys for a genuine `/embed/`-prefixed path — it never stripped a
 * client-supplied value under the same names first, on any OTHER path. A
 * request to a non-embed route carrying a hand-set `x-embed-route: 1` (or
 * `x-embed-lang`/`x-embed-theme`) header would previously pass straight
 * through unmodified, since `request.headers.set(...)` below only ever ran
 * for the keys `embedRequestHeaders` actually returned — never a `.delete()`
 * for the ones it didn't. Harmless in practice today (open-questions #225 /
 * ADR 041 Consequences: nothing security-relevant reads these headers, and
 * no response is cached keyed on them — see those docs for what a forged
 * value CAN actually do, corrected in the same commit as this fix), but a
 * real trusted-header-injection hygiene gap worth closing on general
 * principle: mutates `headers` in place, unconditionally deleting all three
 * keys FIRST, then re-applying whatever `embedRequestHeaders` decides for
 * THIS request — so a spoofed value can never survive on any path,
 * regardless of what `embedRequestHeaders` itself returns. Takes a plain
 * `Headers` instance (not a `NextRequest`) so it is unit-tested directly,
 * same reason `isPublicPath`/`embedRequestHeaders` are: `proxy()` itself
 * needs a real `NextRequest`/Supabase client to exercise, which this mutation
 * does not. */
export function applyEmbedRequestHeaders(headers: Headers, pathname: string, searchParams: URLSearchParams): void {
  for (const key of TRUSTED_EMBED_HEADER_KEYS) headers.delete(key);
  for (const [key, value] of Object.entries(embedRequestHeaders(pathname, searchParams))) {
    headers.set(key, value);
  }
}

export async function proxy(request: NextRequest) {
  // Computed once, right here, and applied by MUTATING the one shared
  // `request.headers` Headers instance — not by cloning it into a second
  // object reused at both `NextResponse.next({ request })` call sites below.
  // The second call site (inside Supabase's `setAll`) deliberately rebuilds
  // its response from `request` AFTER `request.cookies.set(...)` has run, so
  // a just-refreshed session cookie reaches this SAME request's downstream
  // render; a static Headers clone taken once up top and handed to both
  // call sites would freeze that snapshot BEFORE the refresh and silently
  // drop it there on the very requests where it matters most. Confirmed
  // against NextResponse.next's own implementation
  // (node_modules/next/dist/server/web/spec-extension/response.js): it reads
  // `init.request.headers` with a live `for...of` at call time, so both call
  // sites below automatically pick up this mutation the moment it happens,
  // with no snapshot to go stale.
  //
  // Bundle A (final review): `applyEmbedRequestHeaders` deletes all three
  // trusted keys BEFORE conditionally re-setting them, so a client-supplied
  // spoofed value under any of these names can never survive on any path —
  // see that function's own comment above.
  applyEmbedRequestHeaders(request.headers, request.nextUrl.pathname, request.nextUrl.searchParams);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // getClaims() validates the JWT (locally via WebCrypto, or against the
  // Auth server) rather than trusting an unverified session cookie.
  const { data } = await supabase.auth.getClaims();
  const isPublic = isPublicPath(request.nextUrl.pathname);

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
