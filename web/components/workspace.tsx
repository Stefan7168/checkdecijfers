// WP135 (ADR 033): the chat workspace shell — the flag-on replacement for the
// Dashboard. Holds the live balance (the #68 pattern, lifted up from Dashboard),
// the active thread + thread list, and the derived dock visuals; lays out the
// site header, a collapsible thread sidebar, the chat column, and the right-pane
// visual dock (≥ lg AND ≥ 1 visual). The footer carries the #99 attribution copy
// (no privacy link until the #14(d) policy exists — no dead links).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteMyThread, listMyThreads, loadMyThread } from '../app/actions.ts';
import { ingestFile } from '../app/dataset-actions.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import type { DatasetChatMessage } from '../backend/attachments/replay.ts';
import type { RawDatasetState } from '../backend/attachments/respond.ts';
import type { DatasetProfile, DatasetStatus } from '../backend/attachments/types.ts';
import type { ThreadSummary } from '../backend/threads/index.ts';
import type { ChatMessage } from '../lib/chat-message.ts';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
import type { DockVisual } from '../lib/dock-visuals.ts';
import { useT } from '../lib/i18n/lang-provider.tsx';
import { useMediaQuery } from '../lib/use-media-query.ts';
import { Chat } from './chat.tsx';
import { DatasetChat } from './dataset-chat.tsx';
import { AnswerSkeleton } from './loading-skeletons.tsx';
import { SiteHeader } from './site-header.tsx';
import { ThemeToggle } from './theme-toggle.tsx';
import { ThreadSidebar } from './thread-sidebar.tsx';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable.tsx';
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
  attachments,
  chartStyle,
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
  /** ADR 037 D10/D14: present ONLY when ATTACHMENTS_ENABLED='1' — the same
   * dormancy pattern as `websearch` above. NOT wired from page.tsx yet (the
   * flag doesn't exist as of this commit, tracked as WP202a's own remaining
   * bullet); this prop and `handleUploadFile` below are built and tested
   * now so flipping the flag later is the only remaining step. */
  attachments?: { enabled: true };
  /** WP218 phase 2 (owner C): the signed-in account's saved chart-style
   * default, read server-side (page.tsx, `getUserChartStyle`) — raw and
   * unsanitised (a jsonb column value, or null on no default / a throw /
   * an absent table). `ChartStyleProvider` below sanitises it once, so an
   * `undefined` prop (a caller that hasn't been updated, or an old test)
   * behaves identically to an explicit null. Every render of Workspace
   * mounts the provider — its PRESENCE is what "signed in" means to every
   * ChartView underneath (useChartStyle()'s `signedIn`), never the value
   * itself, so an account with no saved style yet still gets offered the
   * "Bewaar als mijn standaard" row. */
  chartStyle?: unknown;
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
  const t = useT();
  // WP135 (blocker fix): the chat reports its in-flight state here so the
  // sidebar's thread-switch / nieuwe-chat controls are disabled while a submit
  // runs — a switch mid-flight would otherwise reset the chat and let the late
  // response land in the wrong thread (the chat's own generation guard is the
  // correctness backstop; this is the UX belt).
  const [chatBusy, setChatBusy] = useState(false);
  // #211 (chat interaction polish, session 88): true only for the span of a
  // clicked-thread load — false the rest of the time, including for the
  // "Nieuwe chat" reset (startNewChat sets no async work in flight).
  const [threadLoading, setThreadLoading] = useState(false);
  // Tracks the dock-visual count across reports so a NEW visual becomes active
  // (updated in handleVisualsChange, an event handler — never in an effect).
  const prevVisualCount = useRef(0);

  // The dock exists only at lg+ (client media query); below it, visuals render
  // inline in the message exactly as today (zero mobile regression).
  const isWide = useMediaQuery('(min-width: 1024px)');
  const showDock = isWide && visuals.length > 0;

  // #213 (found session 87): the sidebar itself had no responsive breakpoint
  // at all — a fixed w-64 squeezed the chat card to ~220px on a phone. Reuses
  // the EXISTING collapsed-sidebar UI (already built, already tested), no new
  // pattern: auto-collapse once on crossing into a narrow viewport, but the
  // user's own manual toggle afterward still wins (the effect only fires
  // again when isNarrow itself flips, not on every collapse/expand click).
  const isNarrow = useMediaQuery('(max-width: 767px)');
  useEffect(() => {
    if (isNarrow) setSidebarCollapsed(true);
  }, [isNarrow]);

  // #211 (chat interaction polish, session 88): the dock's width is
  // resizable within a session (minSize/maxSize on the Panel below) but
  // does NOT persist across visits — real-browser verification found
  // react-resizable-panels@4.12.4's own layout-restore path is broken: a
  // saved width comes back swapped/wrong on reload, even violating a
  // panel's own configured minSize. Owner decision: ship resize without
  // persistence rather than chase a bug in a very recent (alpha/rc-tagged
  // alongside `latest`) library release; revisit by checking whether a
  // different `react-resizable-panels` version fixes its own
  // `defaultLayout` restoration first.

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
      setThreadLoading(true);
      try {
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
      } finally {
        setThreadLoading(false);
      }
    },
    [refreshThreads],
  );

  // Session 90: the sidebar's per-row "Delete chat" (after its own inline
  // confirmation) lands here. The server action validates ownership and
  // redacts; on success, a deleted ACTIVE chat resets to a fresh chat (the
  // same explicit reset as "Nieuwe chat" — its messages are gone server-side
  // too, so leaving them on screen would misrepresent what still exists) and
  // the sidebar re-lists. Returns the outcome so the row can show its own
  // failure line instead of silently staying.
  const deleteThread = useCallback(
    async (threadId: number): Promise<boolean> => {
      const result = await deleteMyThread(threadId);
      if (!result.ok) return false;
      if (threadId === activeThreadId) startNewChat();
      await refreshThreads();
      return true;
    },
    [activeThreadId, refreshThreads, startNewChat],
  );

  // ADR 037 D10: Chat's "Bestand uploaden" button calls THIS (via the
  // `attachments` prop), never `ingestFile` directly — mirroring
  // `onThreadId`'s "report up, the parent acts" shape. Owns the whole
  // ingest→handoff flow: on success, switches straight to the new dataset
  // thread (no `loadMyThread` round trip needed — a fresh dataset has no
  // turns to replay yet) and refreshes the sidebar so it appears; Chat
  // never renders a success state itself because it is about to unmount.
  // On a refusal/auth failure, returns the message for Chat's own inline
  // display instead — the handoff is untouched.
  const handleUploadFile = useCallback(
    async (file: File): Promise<{ ok: boolean; message?: string }> => {
      const formData = new FormData();
      formData.set('file', file);
      const result = await ingestFile(formData);
      if (result.kind === 'unauthenticated') {
        return { ok: false, message: t('common.sessionExpired') };
      }
      if (result.kind === 'refused') {
        return { ok: false, message: result.message };
      }
      setActiveThreadId(result.threadId);
      setHandoff({
        kind: 'dataset',
        threadId: result.threadId,
        datasetId: result.datasetId,
        // The ACTUAL stored name (trimmed/capped server-side), never the
        // client's raw File.name — code-review finding: those can differ.
        displayName: result.displayName,
        status: result.status,
        profile: result.profile,
        messages: [],
        rawState: null,
      });
      setVisuals([]);
      setActiveVisualId(null);
      prevVisualCount.current = 0;
      setLoadNonce((nonce) => nonce + 1);
      void refreshThreads();
      return { ok: true };
    },
    [refreshThreads, t],
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

  // Session 87 visual redesign: the chat card's header bar names the thread
  // (or "Nieuwe chat" for a fresh one) — read-time thread titles from the
  // sidebar list, the dataset's display name for a dataset thread.
  const cardTitle =
    handoff.kind === 'dataset'
      ? handoff.displayName
      : (threads.find((thread) => thread.id === activeThreadId)?.title ?? t('workspace.newChatTitle'));

  const chatSection = (
    <section
      aria-label={t('workspace.chatSectionLabel')}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="truncate text-[13.5px] font-medium" title={cardTitle}>
          {cardTitle}
        </h1>
        <div className="flex-1" />
        <ThemeToggle />
      </div>
      {threadLoading ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <AnswerSkeleton />
          <div className="ml-auto w-2/3">
            <AnswerSkeleton />
          </div>
        </div>
      ) : handoff.kind === 'dataset' ? (
        // ADR 037 D10: dock wiring mirrors Chat's own below exactly —
        // same isWide-gated dockMode, same handleVisualsChange/
        // activateVisual handlers (visuals/activeVisualId are already
        // reset on every thread switch, so a dataset thread's dock starts
        // clean like a CBS one).
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
          dockMode={isWide}
          onVisualsChange={handleVisualsChange}
          activeVisualId={activeVisualId}
          onActivateVisual={activateVisual}
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
          {...(attachments ? { attachments: { enabled: true, onUploadFile: handleUploadFile } } : {})}
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
    </section>
  );

  return (
    // WP218 phase 2 (owner C): ALWAYS wraps the tree — the provider's own
    // presence is what "signed in" means to useChartStyle() (see the
    // `chartStyle` prop doc above), not the value it was mounted with, so
    // this stays unconditional even when `chartStyle` is null/undefined.
    <ChartStyleProvider initial={chartStyle ?? null}>
      {/* Session 87 visual redesign (mockup Option B, "Inset Cards"): the whole
          screen sits on the grey sidebar ground; the sidebar is borderless on it,
          and the chat column + the visual dock are two separate white cards, each
          with its own header bar. Fills the app-shell region app/layout.tsx
          provides (the footer stays below, always in view). */}
      <div className="flex h-full min-h-0 flex-1 flex-col bg-sidebar text-sidebar-foreground">
        <SiteHeader balance={balance} />
        {showPurchaseBanner ? (
          <div className="mx-2 mt-2 flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-success">
            <p>{t('workspace.purchaseSuccessMessage')}</p>
            <button
              type="button"
              onClick={dismissPurchaseBanner}
              className="shrink-0 text-xs text-success underline"
            >
              {t('workspace.purchaseSuccessDismiss')}
            </button>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 gap-2 p-2 pl-0">
          <div className={sidebarCollapsed ? 'w-12 shrink-0' : 'w-64 shrink-0'}>
            <ThreadSidebar
              threads={threads}
              activeThreadId={activeThreadId}
              collapsed={sidebarCollapsed}
              busy={chatBusy}
              onSelect={(id) => void selectThread(id)}
              onNewChat={startNewChat}
              onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
              onDelete={deleteThread}
            />
          </div>

          {/* #211 (chat interaction polish, session 88) code-review finding: the
              ResizablePanelGroup wrapper is ALWAYS rendered now, never swapped
              for a plain <div> based on showDock -- the chat-panel Panel around
              chatSection stays the same type at the same tree position in both
              cases, so Chat/DatasetChat never remounts (and loses its live,
              in-progress state) purely because a chart appeared for the first
              time or the viewport crossed the isWide breakpoint. Only the
              trailing handle + dock panel are conditionally added/removed as
              siblings, which doesn't affect the first child's identity. */}
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
            <ResizablePanel id="chat-panel" minSize="55">
              {chatSection}
            </ResizablePanel>
            {showDock ? (
              <>
                <ResizableHandle withHandle className="mx-1" />
                <ResizablePanel id="dock-panel" defaultSize="33" minSize="18" maxSize="40">
                  <VisualDock busy={chatBusy} visuals={visuals} activeVisualId={activeVisualId} onSelect={activateVisual} />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </div>
        {/* Session 87 visual redesign (owner decision): the "Over dit project"
            explainer that used to sit under the chat is gone from the logged-in
            screen — a bare LLM-chat layout. The logged-out Landing keeps its
            copy; the site footer (components/site-footer.tsx, mounted in
            app/layout.tsx) only links the anchor when that section exists. */}
      </div>
    </ChartStyleProvider>
  );
}
