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

// Paths reachable WITHOUT a Supabase session. Each entry here authenticates
// itself (or needs no auth): /login + /auth/callback are the auth flow;
// /api/stripe/webhook verifies Stripe's signature; /api/onboarding-cron
// verifies its own CRON_SECRET Bearer (503 unset / 401 wrong) — it is called
// by Vercel Cron and by the app's own kick (web/lib/onboarding-kick.ts), NEITHER
// of which carries a user session cookie, so the session-redirect must NOT
// swallow it (a redirect would 307 the cron caller to /login and the job would
// silently never run — caught live at the WP16 go-live, session 28).
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/auth/callback',
  '/api/stripe/webhook',
  '/api/onboarding-cron',
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
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
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
