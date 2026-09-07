// WP135 (ADR 033 D6, WP24 absorbed): the site shell's top navigation on
// authenticated pages — wordmark → /, a LIVE balance chip (ADR 006: read live,
// never hardcoded), "Credits kopen" → /credits, "Geschiedenis" → /geschiedenis,
// and an account menu holding the genuinely-new "Log uit" server action plus the
// relocated delete-history button. `/login` uses the STRIPPED variant (wordmark
// only) — no balance, no menu, so it needs no auth. The per-page guard pattern
// stays (WP24 spec): each page decides whether to render this, gated by
// WORKSPACE_ENABLED; layout.tsx is untouched.
//
// Session 87 visual redesign: a slim, transparent bar with a hairline — it
// sits on whatever ground the page paints (the workspace's grey sidebar
// ground, the landing's white). Behavior and copy unchanged.
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { signOut } from '../app/actions.ts';
import { DeleteHistoryButton } from './delete-history-button.tsx';
import { Badge } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';

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
      className="text-left text-muted-foreground hover:text-foreground disabled:opacity-60"
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
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <Link href="/" className="text-sm font-semibold text-foreground">
          {WORDMARK}
        </Link>
      </header>
    );
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <Link href="/" className="text-sm font-semibold text-foreground">
        {WORDMARK}
      </Link>
      <div className="flex items-center gap-3 text-sm">
        {/* ADR 006: the balance is read live and passed in — never a hardcoded
          * number. .tnum so digits align (the #91 FT/NRC convention). */}
        {balance !== undefined ? (
          <Badge variant="secondary" className="tnum font-normal text-muted-foreground">
            {balance} credits
          </Badge>
        ) : null}
        <Link href="/credits" className="text-muted-foreground hover:text-foreground">
          Credits kopen
        </Link>
        <Link href="/geschiedenis" className="text-muted-foreground hover:text-foreground">
          Geschiedenis
        </Link>
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            Account
          </Button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md"
            >
              {/* The genuinely-new logout: a server action via a form so it
                * works without client JS wiring and can redirect server-side.
                * The submit lives in <LogoutButton/> so useFormStatus can show a
                * pending state during the round-trip (owner smoke-test finding). */}
              <form action={signOut}>
                <LogoutButton />
              </form>
              <div className="border-t border-border pt-2">
                <DeleteHistoryButton />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
