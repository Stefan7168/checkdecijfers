// WP28 (ADR 028): the Google SSO Server Action, hermetic — the Supabase
// client is stubbed at the module seam (lib/supabase-server.ts), but the
// redirect is the REAL next/navigation redirect(): the tests prove the action
// throws Next's NEXT_REDIRECT control-flow error carrying exactly the
// provider URL Supabase returned, rather than trusting a mocked redirect.
// The cross-pin test is the #113 lesson: the action's redirect target and the
// proxy's public-path allowlist (web/proxy.ts) broke the cron route at the
// WP16 go-live precisely because each side was only ever tested alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { isPublicPath } from '../../proxy.ts';
import { signInWithGoogle, signInWithMagicLink } from './actions.ts';

// Structural stand-in for the two auth calls the actions make — typed so a
// field-name drift in the mocked return shapes fails typecheck here instead
// of silently passing (the chat.test.tsx lesson).
const { signInWithOAuth, signInWithOtp } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn<
    (opts: { provider: string; options?: { redirectTo?: string } }) => Promise<{
      data: { provider: string; url: string | null } | null;
      error: { message: string } | null;
    }>
  >(),
  signInWithOtp: vi.fn<
    (opts: { email: string; options?: { emailRedirectTo?: string } }) => Promise<{
      error: { message: string } | null;
    }>
  >(),
}));

vi.mock('../../lib/supabase-server.ts', () => ({
  createClient: async () => ({ auth: { signInWithOAuth, signInWithOtp } }),
}));

/** Calls signInWithGoogle expecting the redirect throw; returns the
 * destination URL parsed from the NEXT_REDIRECT digest
 * (`NEXT_REDIRECT;{type};{url};{status};` — same slice the framework's own
 * isRedirectError uses). */
async function callExpectingRedirect(): Promise<string> {
  try {
    await signInWithGoogle();
  } catch (err) {
    expect(isRedirectError(err)).toBe(true);
    return (err as { digest: string }).digest.split(';').slice(2, -2).join(';');
  }
  throw new Error('signInWithGoogle returned instead of redirecting');
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://checkdecijfers.test';
});

afterEach(() => {
  signInWithOAuth.mockReset();
  signInWithOtp.mockReset();
  vi.restoreAllMocks();
});

describe('signInWithGoogle (WP28, ADR 028)', () => {
  it('redirects to exactly the provider URL Supabase returned', async () => {
    const providerUrl = 'https://qqq.supabase.co/auth/v1/authorize?provider=google&code_challenge=abc';
    signInWithOAuth.mockResolvedValue({
      data: { provider: 'google', url: providerUrl },
      error: null,
    });

    const destination = await callExpectingRedirect();

    expect(destination).toBe(providerUrl);
    expect(signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: 'google',
      options: { redirectTo: 'https://checkdecijfers.test/auth/callback' },
    });
  });

  it('fails soft with the Dutch copy on a Supabase error — and never redirects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    signInWithOAuth.mockResolvedValue({
      data: null,
      error: { message: 'provider is not enabled' },
    });

    const result = await signInWithGoogle();

    expect(result).toEqual({
      ok: false,
      error: 'Inloggen met Google is niet gelukt. Probeer het opnieuw of gebruik de inloglink.',
    });
  });

  it('fails soft when Supabase returns no error but also no URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    signInWithOAuth.mockResolvedValue({
      data: { provider: 'google', url: null },
      error: null,
    });

    const result = await signInWithGoogle();

    expect(result.ok).toBe(false);
  });

  it('independence pin: a broken Google provider leaves the magic link working', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    signInWithOAuth.mockRejectedValue(new Error('Google door is down'));
    signInWithOtp.mockResolvedValue({ error: null });

    await expect(signInWithGoogle()).rejects.toThrow('Google door is down');

    const formData = new FormData();
    formData.set('email', 'iemand@voorbeeld.nl');
    const result = await signInWithMagicLink(formData);

    expect(result).toEqual({ ok: true, error: null });
    expect(signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: 'iemand@voorbeeld.nl',
      options: { emailRedirectTo: 'https://checkdecijfers.test/auth/callback' },
    });
  });

  it('cross-pin (#113): the OAuth flow lands on /auth/callback AND the proxy allowlists it', async () => {
    signInWithOAuth.mockResolvedValue({
      data: { provider: 'google', url: 'https://qqq.supabase.co/auth/v1/authorize?provider=google' },
      error: null,
    });

    await callExpectingRedirect();

    const call = signInWithOAuth.mock.calls[0][0];
    const redirectTo = call.options?.redirectTo;
    expect(redirectTo).toBeDefined();
    // The pair that silently 307-broke the cron route at the WP16 go-live,
    // proven consistent in ONE test: the action's target path…
    expect(new URL(redirectTo!).pathname).toBe('/auth/callback');
    // …is a path the session proxy lets through without a session.
    expect(isPublicPath(new URL(redirectTo!).pathname)).toBe(true);
    expect(isPublicPath('/auth/callback')).toBe(true);
  });
});
