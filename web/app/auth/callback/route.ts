// Magic-link callback (WP13, ADR 006 seam 1): exchanges the code Supabase
// Auth put in the emailed link for a real session, then redirects into the
// app. A Route Handler, not a Server Action — it must handle a plain GET
// request from an email client, which cannot invoke a Server Action.
import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase-server.ts';
import { safeRedirectUrl } from '../../../lib/safe-redirect.ts';

export async function GET(request: Request): Promise<Response> {
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
  }
  return NextResponse.redirect(new URL('/login?error=auth', origin));
}
