// WP135 (ADR 033): the chat workspace shell — the flag-on replacement for the
// Dashboard. Holds the live balance (the #68 pattern, lifted up from Dashboard),
// the active thread + thread list, and the derived dock visuals; lays out the
// site header, a collapsible thread sidebar, the chat column, and the right-pane
// visual dock (≥ lg AND ≥ 1 visual). The footer carries the #99 attribution copy
// (no privacy link until the #14(d) policy exists — no dead links).
'use client';

import { useCallback, useRef, useState } from 'react';
import { listMyThreads, loadMyThread } from '../app/actions.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import type { ThreadSummary } from '../backend/threads/index.ts';
import type { ChatMessage } from '../lib/chat-message.ts';
import type { DockVisual } from '../lib/dock-visuals.ts';
import { useMediaQuery } from '../lib/use-media-query.ts';
import { Chat } from './chat.tsx';
import { SiteHeader } from './site-header.tsx';
import { ThreadSidebar } from './thread-sidebar.tsx';
import { VisualDock } from './visual-dock.tsx';

/** The exact footer line (ADR 033 D6, byte-pinned in the tests; owner gives the
 * final look at PR review). NO privacy link until the #14(d) policy exists. The
 * "Over dit project" anchor links to the on-page section below. */
export const FOOTER_PREFIX =
  'Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel · ';
export const FOOTER_ABOUT_LABEL = 'Over dit project';

interface Handoff {
  messages: ChatMessage[];
  context: ConversationContext | null;
  threadId: number | null;
}

const EMPTY_HANDOFF: Handoff = { messages: [], context: null, threadId: null };

export function Workspace({
  initialBalance,
  simplePrice,
  clarificationPrice,
  initialThreads,
  purchaseSuccess = false,
  websearch,
}: {
  initialBalance: number;
  simplePrice: number;
  clarificationPrice: number;
  /** The user's threads, read SERVER-SIDE (page.tsx) like every other page read
   * — no client fetch-on-mount effect; refreshed client-side after a turn. */
  initialThreads: ThreadSummary[];
  purchaseSuccess?: boolean;
  /** WP129+130: present ONLY when WEBSEARCH_ENABLED='1' (page.tsx reads the
   * add-on price behind the flag). Threaded into Chat's pricing prop. */
  websearch?: { enabled: true; addonPrice: number };
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  const [handoff, setHandoff] = useState<Handoff>(EMPTY_HANDOFF);
  const [visuals, setVisuals] = useState<DockVisual[]>([]);
  const [activeVisualId, setActiveVisualId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showPurchaseBanner, setShowPurchaseBanner] = useState(purchaseSuccess);
  // Tracks the dock-visual count across reports so a NEW visual becomes active
  // (updated in handleVisualsChange, an event handler — never in an effect).
  const prevVisualCount = useRef(0);

  // The dock exists only at lg+ (client media query); below it, visuals render
  // inline in the message exactly as today (zero mobile regression).
  const isWide = useMediaQuery('(min-width: 1024px)');
  const showDock = isWide && visuals.length > 0;

  // Refresh the sidebar after a turn (an event, not a mount effect — the initial
  // list is server-rendered).
  const refreshThreads = useCallback(async () => {
    setThreads(await listMyThreads());
  }, []);

  // #68: move the displayed balance from the numbers the server already
  // returned — never a client-side recomputation of cost.
  const handleOutcome = useCallback((gated: GatedResponse) => {
    if (gated.kind === 'ok') setBalance((current) => current - gated.netCost);
    else if (gated.kind === 'insufficient_credits') setBalance(gated.balance);
  }, []);

  // ⟨A1⟩: the chat reports the thread it attached to (lazily created on the
  // first completed turn). Highlight it in the sidebar and refresh the list so
  // the new thread / bumped activity appears.
  const handleThreadId = useCallback(
    (threadId: number | null) => {
      setActiveThreadId(threadId);
      void refreshThreads();
    },
    [refreshThreads],
  );

  // "Nieuwe chat" = the ADR-021 explicit reset (messages [], context null,
  // pending null via the loadNonce bump); activeThreadId null (a fresh thread
  // is created lazily on the next completed question). selectedSources/
  // webSelected live in Chat and are NOT reset — they survive.
  const startNewChat = useCallback(() => {
    setActiveThreadId(null);
    setHandoff(EMPTY_HANDOFF);
    setVisuals([]);
    setActiveVisualId(null);
    prevVisualCount.current = 0;
    setLoadNonce((nonce) => nonce + 1);
  }, []);

  // Resume a thread: replay it server-side, hand the messages/context to Chat
  // via a loadNonce bump (⟨A6⟩: the bump clears any pending clarification). A
  // not-owned/empty result is a no-op (the thread was purged); refresh to drop
  // the stale entry.
  const selectThread = useCallback(
    async (threadId: number) => {
      const loaded = await loadMyThread(threadId);
      if (loaded.threadId === null) {
        void refreshThreads();
        return;
      }
      setActiveThreadId(loaded.threadId);
      setHandoff({ messages: loaded.messages, context: loaded.context, threadId: loaded.threadId });
      setVisuals([]);
      setActiveVisualId(null);
      prevVisualCount.current = 0;
      setLoadNonce((nonce) => nonce + 1);
    },
    [refreshThreads],
  );

  // The chat reports its dockable visuals here (an EVENT, not an effect): set the
  // dock's tabs and pick the active one — newest-active on growth (a new visual
  // arrived), otherwise keep the user's manual selection if it still exists, else
  // newest. A thread switch clears the set (startNewChat/selectThread) and resets
  // the counter, so the resumed thread's newest visual becomes active for free.
  const handleVisualsChange = useCallback((next: DockVisual[]) => {
    setVisuals(next);
    if (next.length === 0) {
      setActiveVisualId(null);
    } else if (next.length > prevVisualCount.current) {
      setActiveVisualId(next[next.length - 1]!.id);
    } else {
      setActiveVisualId((prev) =>
        prev !== null && next.some((visual) => visual.id === prev) ? prev : next[next.length - 1]!.id,
      );
    }
    prevVisualCount.current = next.length;
  }, []);

  const activateVisual = useCallback((visualId: string) => {
    setActiveVisualId(visualId);
  }, []);

  function dismissPurchaseBanner(): void {
    setShowPurchaseBanner(false);
    window.history.replaceState(null, '', window.location.pathname);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader balance={balance} />
      {showPurchaseBanner ? (
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
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

      <div className="flex min-h-0 flex-1">
        <div className={sidebarCollapsed ? 'w-12 shrink-0' : 'w-64 shrink-0'}>
          <ThreadSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            collapsed={sidebarCollapsed}
            onSelect={(id) => void selectThread(id)}
            onNewChat={startNewChat}
            onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
          />
        </div>

        <div className="min-w-0 flex-1 p-4">
          <Chat
            onOutcome={handleOutcome}
            pricing={{
              simple: simplePrice,
              clarification: clarificationPrice,
              balance,
              ...(websearch ? { websearch } : {}),
            }}
            dockMode={isWide}
            initialMessages={handoff.messages}
            initialContext={handoff.context}
            threadId={handoff.threadId}
            loadNonce={loadNonce}
            onThreadId={handleThreadId}
            onVisualsChange={handleVisualsChange}
            activeVisualId={activeVisualId}
            onActivateVisual={activateVisual}
          />
        </div>

        {showDock ? (
          <div className="w-96 shrink-0 p-4">
            <VisualDock visuals={visuals} activeVisualId={activeVisualId} onSelect={activateVisual} />
          </div>
        ) : null}
      </div>

      <section id="over-dit-project" className="mx-4 mt-6 max-w-2xl text-sm text-zinc-600">
        <h2 className="mb-1 font-semibold text-zinc-800">Over dit project</h2>
        <p>
          Check de Cijfers beantwoordt vragen over officiële cijfers van het CBS. Elk getal wordt
          door vaste, controleerbare code berekend en gecontroleerd; het taalmodel begrijpt alleen
          je vraag en formuleert het antwoord. Zo is elk getal herleidbaar tot een officiële
          CBS-tabel, met bron en datum erbij — en verzinnen we nooit een cijfer. Als data ontbreekt
          of onduidelijk is, vragen we door of zeggen we het eerlijk.
        </p>
      </section>

      <footer className="mx-4 mb-4 mt-6 border-t border-zinc-200 pt-3 text-xs text-zinc-400">
        {FOOTER_PREFIX}
        <a href="#over-dit-project" className="underline">
          {FOOTER_ABOUT_LABEL}
        </a>
      </footer>
    </div>
  );
}
