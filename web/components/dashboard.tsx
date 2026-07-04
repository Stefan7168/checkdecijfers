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
}: {
  initialBalance: number;
  simplePrice: number;
  /** WP20 #82: the live 'clarification' price, for the pre-send hint. */
  clarificationPrice: number;
  signupGrantCredits: number;
  history: ReactNode;
}) {
  const [balance, setBalance] = useState(initialBalance);

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
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 p-4 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-6">
        <Chat
          onOutcome={handleOutcome}
          pricing={{ simple: simplePrice, clarification: clarificationPrice, balance }}
        />
        {history}
      </div>
      <AccountPanel balance={balance} simplePrice={simplePrice} signupGrantCredits={signupGrantCredits} />
    </div>
  );
}
