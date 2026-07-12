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
import { signOut } from '../app/actions.ts';
import { DeleteHistoryButton } from './delete-history-button.tsx';

const WORDMARK = 'Check de Cijfers';

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
      <header className="flex items-center border-b border-zinc-200 px-4 py-3">
        <Link href="/" className="text-base font-semibold text-zinc-900">
          {WORDMARK}
        </Link>
      </header>
    );
  }

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
      <Link href="/" className="text-base font-semibold text-zinc-900">
        {WORDMARK}
      </Link>
      <div className="flex items-center gap-3 text-sm">
        {/* ADR 006: the balance is read live and passed in — never a hardcoded
          * number. tabular-nums so digits align (the #91 FT/NRC convention). */}
        {balance !== undefined ? (
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs tabular-nums text-zinc-700">
            {balance} credits
          </span>
        ) : null}
        <Link href="/credits" className="text-zinc-600 hover:text-zinc-900">
          Credits kopen
        </Link>
        <Link href="/geschiedenis" className="text-zinc-600 hover:text-zinc-900">
          Geschiedenis
        </Link>
        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            Account
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-2 rounded border border-zinc-200 bg-white p-3 text-sm shadow-lg"
            >
              {/* The genuinely-new logout: a server action via a form so it
                * works without client JS wiring and can redirect server-side. */}
              <form action={signOut}>
                <button type="submit" className="text-left text-zinc-700 hover:text-zinc-900">
                  Log uit
                </button>
              </form>
              <div className="border-t border-zinc-200 pt-2">
                <DeleteHistoryButton />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
