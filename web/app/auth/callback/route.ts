// Magic-link callback (WP13, ADR 006 seam 1): exchanges the code Supabase
// Auth put in the emailed link for a real session, then redirects into the
// app. A Route Handler, not a Server Action — it must handle a plain GET
// request from an email client, which cannot invoke a Server Action.
import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase-server.ts';
import { safeRedirectUrl } from '../../../lib/safe-redirect.ts';
import { reportError } from '../../../lib/error-report.ts';

export async function GET(request: Request): Promise<Response> {
  // #65 / WP25: the whole handler is a catch site. A THROWN failure here
  // (createClient / the exchange call itself) previously produced only Next's
  // generic 500 + a short-retention log line; now it leaves a durable
  // error_log row first and rethrows, so the 500 the user sees is unchanged.
  try {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const next = searchParams.get('next') ?? '/';

    if (code) {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        // `next` is caller-controlled — resolve it to a guaranteed same-origin
        // URL so it can never redirect off-site after a successful login
        // (open-redirect hardening; see lib/safe-redirect.ts).
        return NextResponse.redirect(safeRedirectUrl(next, origin));
      }
      console.error('exchangeCodeForSession failed:', error);
      // Non-thrown failure result (expired/reused magic link, misconfigured
      // auth): durable copy too — this is the only signal a broken auth
      // config ever emits. Fail-open; the redirect below is unchanged. NOTE:
      // never log `code` (it is a credential) — the error object suffices.
      await reportError('auth-callback', error, {
        extra: { reason: 'exchangeCodeForSession failed' },
      });
    }
    return NextResponse.redirect(new URL('/login?error=auth', origin));
  } catch (error) {
    console.error('auth callback failed:', error);
    await reportError('auth-callback', error);
    throw error;
  }
}
