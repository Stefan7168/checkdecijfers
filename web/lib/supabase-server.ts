// Supabase Auth server client (WP13, ADR 006 seam 1 / ADR 020) — the
// @supabase/ssr cookie-adapter contract, confirmed against the installed
// package's own types (web/node_modules/@supabase/ssr/dist/module/types.d.ts),
// not assumed from memory.
//
// Deliberately NOT memoized like web/lib/db.ts's pool singleton: this client
// carries one request's cookies/session, so caching it across requests would
// leak one user's session into another's under a warm serverless container.
// A fresh client per call is the correct, documented pattern here.
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot write cookies —
          // safe to ignore because proxy.ts refreshes the session on every
          // request regardless (Supabase's own documented pattern).
        }
      },
    },
  });
}
