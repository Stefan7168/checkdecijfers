// WP135 (ADR 033 D6, WP24 absorbed): the site shell's top navigation on
// authenticated pages — wordmark → /, a LIVE balance chip (ADR 006: read live,
// never hardcoded), "Credits kopen" → /credits, "Geschiedenis" → /geschiedenis,
// and an account menu holding the genuinely-new "Log uit" server action plus the
// relocated delete-history button. `/login` uses the STRIPPED variant (wordmark
// only) — no balance, no menu, so it needs no auth. The per-page guard pattern
// stays (WP24 spec): each page decides whether to render this, gated by
// WORKSPACE_ENABLED; layout.tsx is untouched.
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { signOut } from '../app/actions.ts';
import { DeleteHistoryButton } from './delete-history-button.tsx';

const WORDMARK = 'Check de Cijfers';

// The logout submit button, split out so useFormStatus can read the pending
// state of its parent <form action={signOut}> and give feedback during the
// sign-out round-trip. Without it the click shows nothing while Supabase signs
// out + redirects, so it feels like a no-op (owner smoke-test finding, WP135
// go-live). "Bezig…" + disabled:opacity-60 match the DeleteHistoryButton
// convention in this same menu.
function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="text-left text-ink-soft hover:text-ink disabled:opacity-60"
    >
      {pending ? 'Bezig…' : 'Log uit'}
    </button>
  );
}

export function SiteHeader({
  balance,
  stripped = false,
}: {
  /** The live balance for the chip. Omitted on the stripped variant. */
  balance?: number;
  /** `/login`: wordmark only, no balance, no account menu. */
  stripped?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  if (stripped) {
    return (
      <header className="flex items-center border-b border-line-strong px-4 py-3">
        <Link href="/" className="font-display text-base font-semibold text-ink">
          {WORDMARK}
        </Link>
      </header>
    );
  }

  return (
    <header className="flex items-center justify-between border-b border-line-strong px-4 py-3">
      <Link href="/" className="font-display text-base font-semibold text-ink">
        {WORDMARK}
      </Link>
      <div className="flex items-center gap-3 text-sm">
        {/* ADR 006: the balance is read live and passed in — never a hardcoded
          * number. .tnum so digits align (the #91 FT/NRC convention). */}
        {balance !== undefined ? (
          <span className="tnum rounded-full bg-paper-sunken px-3 py-1 text-xs text-ink-soft">
            {balance} credits
          </span>
        ) : null}
        <Link href="/credits" className="text-ink-muted hover:text-ink">
          Credits kopen
        </Link>
        <Link href="/geschiedenis" className="text-ink-muted hover:text-ink">
          Geschiedenis
        </Link>
        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded border border-line-strong px-3 py-1 text-xs text-ink-soft hover:bg-paper-sunken"
          >
            Account
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-2 rounded border border-line bg-paper-raised p-3 text-sm shadow-sm"
            >
              {/* The genuinely-new logout: a server action via a form so it
                * works without client JS wiring and can redirect server-side.
                * The submit lives in <LogoutButton/> so useFormStatus can show a
                * pending state during the round-trip (owner smoke-test finding). */}
              <form action={signOut}>
                <LogoutButton />
              </form>
              <div className="border-t border-line pt-2">
                <DeleteHistoryButton />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
