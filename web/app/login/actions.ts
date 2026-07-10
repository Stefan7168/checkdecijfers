// Magic-link sign-in (WP13, ADR 006 seam 1). Separate from web/app/actions.ts
// on purpose: that file is the chat's entry point into the audited backend
// pipeline; this one only ever talks to Supabase Auth.
'use server';

import { redirect } from 'next/navigation';
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

/** Google SSO (WP28, ADR 028): asks Supabase for the provider redirect URL and
 * sends the browser there. The OAuth round trip ends at the SAME
 * /auth/callback route the magic link uses (provider-agnostic code exchange).
 * Fail-soft: any error renders inline; the magic-link path is untouched. */
export async function signInWithGoogle(): Promise<SignInResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });
  if (error || !data?.url) {
    console.error('signInWithGoogle failed:', error);
    return { ok: false, error: 'Inloggen met Google is niet gelukt. Probeer het opnieuw of gebruik de inloglink.' };
  }
  redirect(data.url); // next/navigation — throws NEXT_REDIRECT, never returns
}
