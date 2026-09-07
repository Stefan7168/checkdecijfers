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
import type { DatasetChatMessage } from '../backend/attachments/replay.ts';
import type { RawDatasetState } from '../backend/attachments/respond.ts';
import type { DatasetProfile, DatasetStatus } from '../backend/attachments/types.ts';
import type { ThreadSummary } from '../backend/threads/index.ts';
import type { ChatMessage } from '../lib/chat-message.ts';
import type { DockVisual } from '../lib/dock-visuals.ts';
import { useMediaQuery } from '../lib/use-media-query.ts';
import { Chat } from './chat.tsx';
import { DatasetChat } from './dataset-chat.tsx';
import { SiteHeader } from './site-header.tsx';
import { ThreadSidebar } from './thread-sidebar.tsx';
import { VisualDock } from './visual-dock.tsx';

// ADR 037 D10: a discriminated union, not a bypass — mounting DatasetChat
// instead of Chat needs a handoff shaped for whichever kind is active. The
// CBS variant's fields are unchanged from before this union existed; a CBS
// thread selected/created/resumed through Workspace while dataset threads
// also exist in the sidebar is an explicit invariant (workspace.test.tsx).
type Handoff =
  | { kind: 'cbs'; messages: ChatMessage[]; context: ConversationContext | null; threadId: number | null }
  | {
      kind: 'dataset';
      threadId: number;
      datasetId: number;
      displayName: string;
      status: DatasetStatus;
      profile: DatasetProfile;
      messages: DatasetChatMessage[];
      rawState: RawDatasetState | null;
    };

const EMPTY_HANDOFF: Handoff = { kind: 'cbs', messages: [], context: null, threadId: null };

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
  // WP135 (blocker fix): the chat reports its in-flight state here so the
  // sidebar's thread-switch / nieuwe-chat controls are disabled while a submit
  // runs — a switch mid-flight would otherwise reset the chat and let the late
  // response land in the wrong thread (the chat's own generation guard is the
  // correctness backstop; this is the UX belt).
  const [chatBusy, setChatBusy] = useState(false);
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
      if (loaded.kind === 'empty') {
        void refreshThreads();
        return;
      }
      setActiveThreadId(loaded.threadId);
      setHandoff(
        loaded.kind === 'dataset'
          ? {
              kind: 'dataset',
              threadId: loaded.threadId,
              datasetId: loaded.datasetId,
              displayName: loaded.displayName,
              status: loaded.status,
              profile: loaded.profile,
              messages: loaded.messages,
              rawState: loaded.rawState,
            }
          : { kind: 'cbs', messages: loaded.messages, context: loaded.context, threadId: loaded.threadId },
      );
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
        <div className="mx-4 mt-4 flex items-start justify-between gap-3 rounded border border-line-strong bg-paper-sunken px-4 py-3 text-sm text-ok">
          <p>
            Betaling gelukt — je credits worden bijgeschreven zodra Stripe de betaling bevestigt
            (meestal een paar seconden). Ververs daarna de pagina om je nieuwe saldo te zien.
          </p>
          <button
            type="button"
            onClick={dismissPurchaseBanner}
            className="shrink-0 text-xs text-ok underline"
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
            busy={chatBusy}
            onSelect={(id) => void selectThread(id)}
            onNewChat={startNewChat}
            onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
          />
        </div>

        <div className="min-w-0 flex-1 p-4">
          {handoff.kind === 'dataset' ? (
            // ADR 037 D10: v1 scope note (dataset-chat.tsx's own header) — no
            // dock support yet, so no onVisualsChange/activeVisualId wiring
            // here; a dataset thread's charts always render inline.
            <DatasetChat
              // React reuses the SAME DatasetChat instance across two dataset
              // threads (same element type, same tree position) unless keyed
              // apart — without this, switching from one dataset thread to
              // another would silently keep showing the FIRST thread's
              // messages/profile, since useState(initialMessages) etc. only
              // ever reads its argument on the instance's first mount. Chat
              // solves the analogous problem with a loadNonce-driven reset
              // effect (it has state worth preserving across a switch,
              // e.g. selectedSources/webSelected); DatasetChat has none, so a
              // full remount is the simpler, equally correct fix here.
              key={handoff.threadId}
              datasetId={handoff.datasetId}
              threadId={handoff.threadId}
              displayName={handoff.displayName}
              initialStatus={handoff.status}
              initialProfile={handoff.profile}
              initialMessages={handoff.messages}
              initialRawState={handoff.rawState}
              onThreadId={handleThreadId}
              onBusyChange={setChatBusy}
            />
          ) : (
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
              onBusyChange={setChatBusy}
            />
          )}
        </div>

        {showDock ? (
          <div className="w-96 shrink-0 p-4">
            <VisualDock visuals={visuals} activeVisualId={activeVisualId} onSelect={activateVisual} />
          </div>
        ) : null}
      </div>

      <section id="over-dit-project" className="mx-4 mt-6 max-w-2xl text-sm text-ink-soft">
        <h2 className="mb-1 font-semibold text-ink">Over dit project</h2>
        <p>
          Check de Cijfers beantwoordt vragen over officiële cijfers van het CBS. Elk getal wordt
          door vaste, controleerbare code berekend en gecontroleerd; het taalmodel begrijpt alleen
          je vraag en formuleert het antwoord. Zo is elk getal herleidbaar tot een officiële
          CBS-tabel, met bron en datum erbij — en verzinnen we nooit een cijfer. Als data ontbreekt
          of onduidelijk is, vragen we door of zeggen we het eerlijk.
        </p>
      </section>
      {/* The footer line (ADR 033 D6) is rendered ONCE, site-wide, by
          components/site-footer.tsx in app/layout.tsx — it carries the
          "Over dit project" anchor to the section above on this page. Until
          2026-09-03 a second copy lived here (two footer bars — owner report). */}
    </div>
  );
}
