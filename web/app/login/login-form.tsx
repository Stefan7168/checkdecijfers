'use client';

import { useState } from 'react';
import { signInWithMagicLink } from './actions.ts';

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

  if (sent) {
    return <p className="text-sm text-zinc-700">Check je e-mail voor de inloglink.</p>;
  }

  return (
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
  );
}
