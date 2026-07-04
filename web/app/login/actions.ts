// Magic-link sign-in (WP13, ADR 006 seam 1). Separate from web/app/actions.ts
// on purpose: that file is the chat's entry point into the audited backend
// pipeline; this one only ever talks to Supabase Auth.
'use server';

import { createClient } from '../../lib/supabase-server.ts';

export interface SignInResult {
  ok: boolean;
  error: string | null;
}

export async function signInWithMagicLink(formData: FormData): Promise<SignInResult> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) {
    return { ok: false, error: 'E-mailadres is verplicht.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });

  if (error) {
    console.error('signInWithMagicLink failed:', error);
    return { ok: false, error: 'Er ging iets mis bij het versturen van de inloglink. Probeer het opnieuw.' };
  }
  return { ok: true, error: null };
}
