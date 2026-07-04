// Magic-link callback (WP13, ADR 006 seam 1): exchanges the code Supabase
// Auth put in the emailed link for a real session, then redirects into the
// app. A Route Handler, not a Server Action — it must handle a plain GET
// request from an email client, which cannot invoke a Server Action.
import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase-server.ts';

export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error('exchangeCodeForSession failed:', error);
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
