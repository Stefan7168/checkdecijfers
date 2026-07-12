// WP19 (open-questions #68): the one client boundary that owns the DISPLAYED
// credit balance, so it can move without a page reload. The server-rendered
// balance is only the starting point; every chat outcome then adjusts it
// client-side from numbers the server ALREADY returned -- never a client-side
// recomputation of what something should cost:
//   - 'ok'                   -> decrement by the gate's own netCost (the #68
//                               decision verbatim; no extra DB read),
//   - 'insufficient_credits' -> sync to the balance the refusal itself
//                               reports (same no-extra-read principle: showing
//                               a stale higher number next to a "niet genoeg
//                               credits" message would be a visible lie).
// QuestionHistory stays a Server Component, passed through as children.
'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { GatedResponse } from '../backend/billing/index.ts';
import { AccountPanel } from './account-panel.tsx';
import { Chat } from './chat.tsx';

export function Dashboard({
  initialBalance,
  simplePrice,
  clarificationPrice,
  signupGrantCredits,
  history,
  purchaseSuccess = false,
  websearch,
}: {
  initialBalance: number;
  simplePrice: number;
  /** WP20 #82: the live 'clarification' price, for the pre-send hint. */
  clarificationPrice: number;
  signupGrantCredits: number;
  history: ReactNode;
  /** WP22 #95: true when the page loaded from Stripe's success redirect
   * (?purchase=success) — shows the dismissible confirmation banner. */
  purchaseSuccess?: boolean;
  /** WP129+130 (#129/#130, ADR 032): present ONLY when WEBSEARCH_ENABLED='1'
   * (page.tsx reads the add-on price behind the flag). Threaded into Chat's
   * `pricing` prop — its presence is what renders the source chips + the
   * "Internet" chip; absent ⇒ the chat is byte-identical to today. */
  websearch?: { enabled: true; addonPrice: number };
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [showPurchaseBanner, setShowPurchaseBanner] = useState(purchaseSuccess);

  // WP22 (#95): dismissing also strips the query flag, so a reload doesn't
  // resurrect a banner the user already closed.
  function dismissPurchaseBanner(): void {
    setShowPurchaseBanner(false);
    window.history.replaceState(null, '', window.location.pathname);
  }

  const handleOutcome = useCallback((gated: GatedResponse) => {
    if (gated.kind === 'ok') {
      setBalance((b) => b - gated.netCost);
    } else if (gated.kind === 'insufficient_credits') {
      setBalance(gated.balance);
    }
    // 'unauthenticated' / 'duplicate_request': nothing was charged and no
    // balance was reported -- the display stays as-is.
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      {showPurchaseBanner ? (
        <div className="flex items-start justify-between gap-3 rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {/* Honest copy (#95): the webhook credits the ledger, not this
            * redirect — never promise a fixed time, and say a reload is what
            * shows the new balance (the #68 live updates move on question
            * outcomes, not on webhook credits). */}
          <p>
            Betaling gelukt — je credits worden bijgeschreven zodra Stripe de betaling bevestigt
            (meestal een paar seconden). Ververs daarna de pagina om je nieuwe saldo te zien.
          </p>
          <button
            type="button"
            onClick={dismissPurchaseBanner}
            className="shrink-0 text-xs text-green-700 underline"
          >
            Sluiten
          </button>
        </div>
      ) : null}
      <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-6">
        <Chat
          onOutcome={handleOutcome}
          pricing={{
            simple: simplePrice,
            clarification: clarificationPrice,
            balance,
            // WP129+130: the add-on price + enabled flag ride the pricing prop
            // (its existing shape), so Chat gets one prop; absent ⇒ no chips.
            ...(websearch ? { websearch } : {}),
          }}
        />
        {history}
      </div>
      <AccountPanel balance={balance} simplePrice={simplePrice} signupGrantCredits={signupGrantCredits} />
      </div>
    </div>
  );
}
