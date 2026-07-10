'use client';

import { useState } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { signInWithGoogle, signInWithMagicLink, type SignInResult } from './actions.ts';

export function LoginForm() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signInWithMagicLink(new FormData(e.currentTarget));
    setBusy(false);
    if (result.ok) {
      setSent(true);
    } else {
      setError(result.error);
    }
  }

  // Google SSO (WP28, ADR 028 D3): a second, independent door — its failure
  // renders in the same error slot and never touches the magic-link path.
  // Shares the single `busy` state so the two methods cannot double-submit.
  async function handleGoogleClick() {
    setBusy(true);
    setError(null);
    try {
      // On success the action redirect()s and yields no result — the browser
      // navigates away, so `busy` deliberately stays true. Only the fail-soft
      // error path returns a value.
      const result: SignInResult | undefined = await signInWithGoogle();
      if (result && !result.ok) {
        setBusy(false);
        setError(result.error);
      }
    } catch (err) {
      // next/navigation control-flow throws (NEXT_REDIRECT) must reach Next's
      // own handler, never the inline error slot — unstable_rethrow is the
      // documented pattern (node_modules/next/dist/docs, unstable_rethrow.md).
      unstable_rethrow(err);
      setBusy(false);
      setError('Inloggen met Google is niet gelukt. Probeer het opnieuw of gebruik de inloglink.');
    }
  }

  if (sent) {
    return <p className="text-sm text-zinc-700">Check je e-mail voor de inloglink.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          name="email"
          required
          placeholder="jij@voorbeeld.nl"
          disabled={busy}
          className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Stuur inloglink
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
      <div className="flex items-center gap-3 text-xs text-zinc-400" aria-hidden="true">
        <span className="h-px flex-1 bg-zinc-200" />
        of
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={handleGoogleClick}
        className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
      >
        Doorgaan met Google
      </button>
    </div>
  );
}
