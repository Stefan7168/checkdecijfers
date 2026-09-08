'use client';

import { useState } from 'react';
import { useT } from '../../lib/i18n/lang-provider.tsx';
import { createCheckoutSession } from './actions.ts';

export function BuyButton({ packId }: { packId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  async function handleClick() {
    setBusy(true);
    setError(null);
    // A successful call redirects server-side (throws internally) and never
    // returns here — only a genuine failure produces a value to react to.
    const result = await createCheckoutSession(packId);
    if (result?.error) {
      setError(result.error);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={busy}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {t('credits.buy')}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
