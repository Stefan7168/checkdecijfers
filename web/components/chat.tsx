// The minimal Phase 0 chat UI (docs/03-mvp-scope.md: "one conversation, no
// history persistence beyond the session"; ugly is acceptable). Renders
// every response via its own pre-assembled `text` field — the single string
// ComposedResponse's own type comment says a chat UI should render — plus
// the chart when an answer carries one. Never re-derives or reformats a
// number itself.
//
// WP13 (ADR 020): every submit now carries a client-generated requestId (the
// billing gate's idempotency key) and gets back a GatedResponse, not a bare
// AuditedResponse — 'unauthenticated' / 'duplicate_request' /
// 'insufficient_credits' are normal RETURN VALUES, never exceptions, so they
// branch here explicitly and must never fall into the generic catch below.
'use client';

import { Check, Copy, Database, Download, Globe, PanelRight, Paperclip } from 'lucide-react';
import { unstable_isUnrecognizedActionError } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { askQuestion, replyToClarification } from '../app/actions.ts';
import type { AskOutcome } from '../app/actions.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import type { PendingClarification } from '../backend/answer/respond/types.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
// WP129+130 (#129/#130, ADR 032): the source registry drives the chips (one
// per registered source, label "<displayName> data"); WebSection is the
// unverified-web outcome the message renders below the CBS body. Both are
// imported from PURE LEAVES (registry.ts / websearch/types.ts) — never a
// barrel that pulls the Anthropic SDK into the client bundle.
import { SOURCES, sourceKeyForTableId } from '../backend/sources/registry.ts';
import type { WebSection } from '../backend/websearch/types.ts';
import { buildAnswerProof } from '../lib/answer-proof.ts';
import { buildCitation } from '../lib/citation.ts';
import { buildAnswerCopy, escapeHtml as escapeHtmlForCopy } from '../lib/copy-answer.ts';
import { buildAnswerCsv } from '../lib/csv.ts';
import type { AnswerCsv } from '../lib/csv.ts';
import { useT } from '../lib/i18n/lang-provider.tsx';
import type { MessageKey } from '../lib/i18n/messages.ts';
import { sourceTableUrl } from '../lib/statline.ts';
import { statCardData } from '../lib/stat-card-data.ts';
// WP135 (ADR 033 ⟨A3⟩): the ChatMessage/AnswerView shape and the meta/smalltalk
// kind reclassification live in a shared pure leaf so thread replay
// (web/lib/replay-assemble.ts, called from a Server Action) reconstructs the
// SAME messages this live path appends — byte-identity by construction.
import type { AnswerView, ChatMessage } from '../lib/chat-message.ts';
import { messageKind } from '../lib/chat-message.ts';
// WP135 (ADR 033 D4): the right-pane dock derives its tabs from these same
// messages; Chat renders an in-flow reference chip (instead of the inline
// visual) when the dock is active, using the SAME id scheme the dock does.
import type { DockVisual } from '../lib/dock-visuals.ts';
import { deriveVisuals, messageHasVisual, visualId } from '../lib/dock-visuals.ts';
import { AnswerProof } from './answer-proof.tsx';
import { ChartView } from './chart.tsx';
import { FeedbackButtons } from './feedback-buttons.tsx';
import { AnswerSkeleton } from './loading-skeletons.tsx';
import { SourceBadge } from './source-badge.tsx';
import { StatCard } from './stat-card.tsx';
import { Button } from './ui/button.tsx';
import { Card, CardContent, CardFooter } from './ui/card.tsx';
import { Input } from './ui/input.tsx';

// Session 87 visual redesign (owner decision, docs/superpowers/specs/
// 2026-09-07-chat-chart-visual-redesign-design.md): the #75 example-question
// chips and the "Stel een vraag … bijvoorbeeld" prompt are gone from the
// empty state — it is a bare composer now, like a blank LLM chat. The
// follow-up chips (#73) keep the identical fill-don't-send handler.

/** Session 87 (mockup Option B): the squared chips — source toggles and
 * attachment entry points. Their row sat UNDER the composer (owner amendment
 * 1) until session 90 moved it directly ABOVE the input (owner request). */
const CHIP_BASE = 'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium';
const CHIP_ON = `${CHIP_BASE} border-transparent bg-secondary text-foreground`;
const CHIP_OFF = `${CHIP_BASE} border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground`;
const CHIP_ACTION = `${CHIP_BASE} border-border bg-background text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60`;
const CHIP_SOON = `${CHIP_BASE} border-dashed border-border bg-background text-muted-foreground opacity-60 disabled:cursor-not-allowed`;
/** Follow-up chips (#73) and the docked-visual reference chip: pills under a message. */
const PILL = 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground';

/** WP20 #82: live pricing for the pre-send cost surfaces — read from the
 * pricing tables by the page (ADR 006), threaded via Dashboard. `balance` is
 * the live displayed balance (the #68 state), so the line moves with it. */
export interface ChatPricing {
  simple: number;
  clarification: number;
  balance: number;
  /** WP129+130 (#129/#130, ADR 032): present ONLY when WEBSEARCH_ENABLED='1'
   * (page.tsx reads addonPrice behind the flag, Dashboard threads it here).
   * Its PRESENCE is what renders the source chips + the "Internet" chip and
   * makes the selection ride every submit; absent ⇒ no chips, no selection
   * payload, byte-identical to today. addonPrice drives the ⟨W4⟩ cost line. */
  websearch?: { enabled: true; addonPrice: number };
}

/** ADR 037 D10: the same presence-driven contract as `ChatPricing.websearch`
 * — present ONLY when `ATTACHMENTS_ENABLED='1'` (threaded through `page.tsx`
 * since session 86, still unset in Vercel). Its PRESENCE is what enables the
 * "Bestand uploaden" button; absent ⇒ the button stays disabled exactly as
 * today, byte-identical. `onUploadFile` OWNS the actual `ingestFile` call
 * and, on success, the workspace-level handoff switch to the new dataset
 * thread (mirroring `onThreadId`'s "report up, the parent acts" shape) —
 * this component only needs to know whether to show an inline error.
 * "Link toevoegen" is independent of this prop (session 86): it opens a
 * demo-only URL-input preview regardless, since url_html ingest (WP202b)
 * has no backend at all yet either way — see that button's own comment
 * near its render. */
export interface ChatAttachments {
  enabled: true;
  onUploadFile: (file: File) => Promise<{ ok: boolean; message?: string }>;
}

/** Citation links render DOMAIN-ONLY (Q3): the hostname minus a leading
 * `www.`. The URL is already http(s)-filtered server-side (src/websearch/
 * client.ts); a parse failure falls back to the raw string rather than
 * throwing (defensive — the client should never emit a non-URL here). */
function citationDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** WP129+130 (#130, ADR 032): the unverified-web section, rendered strictly
 * SEPARATE from and BELOW the validated CBS body — the separation IS the
 * honesty model. Injection stance (ADR 032 decision 10): web-derived strings
 * are UNTRUSTED — they render as PLAIN, React-escaped text only (never
 * markdown/HTML), are length-capped server-side, and the only links come from
 * the API's own citation URLs (http/https filtered server-side), shown
 * domain-only with rel="noopener noreferrer". Web content structurally never
 * reaches any other prompt (single-shot call) — this block is its only surface. */
function WebSectionView({ section }: { section: WebSection }) {
  const t = useT();
  if (section.status === 'failed') {
    // One honest line; the settlement already refunded the add-on (⟨W4⟩/Q6).
    const line =
      section.code === 'insufficient_balance'
        ? t('chat.webSectionFailedInsufficientBalance')
        : t('chat.webSectionFailedGeneric');
    return <p className="mt-2 text-xs text-muted-foreground">{line}</p>;
  }
  return (
    <div className="mt-2 max-w-full rounded border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
      <p className="mb-1 font-medium text-muted-foreground">{t('chat.webSectionHeader')}</p>
      <ul className="space-y-1">
        {section.findings.slice(0, 4).map((finding, i) => (
          <li key={i}>
            {finding.text}
            {finding.citations.map((citation, j) => (
              <span key={j}>
                {' '}
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {citationDomain(citation.url)}
                </a>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** WP21 #52: downloads the pre-built CSV as a client-side Blob — no server
 * round-trip, nothing stored. Mirrors the stat card's failure honesty. */
function DownloadCsvButton({ csv }: { csv: AnswerCsv }) {
  const [failed, setFailed] = useState(false);
  const t = useT();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => {
          try {
            const url = URL.createObjectURL(
              new Blob([csv.content], { type: 'text/csv;charset=utf-8' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = csv.filename;
            link.click();
            URL.revokeObjectURL(url);
          } catch {
            setFailed(true);
          }
        }}
      >
        <Download aria-hidden className="size-3.5" />
        {t('chat.downloadCsv')}
      </Button>
      {failed ? (
        <span className="text-xs text-destructive">{t('chat.downloadCsvFailed')}</span>
      ) : null}
    </>
  );
}

/** WP20 #78: copies the citation; flips to a transient confirmation. Kept
 * for the deploy-window-skew fallback path below (a replayed answer too old
 * for a structural answerView — replay-assemble.ts's extractAnswerView
 * returns null then), which has no AnswerView to build the rich copy from. */
function CopyCitationButton({ citation }: { citation: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(citation);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard unavailable (permissions/insecure context): keep the
          // label so the user can retry; nothing else to break.
        }
      }}
    >
      <Copy aria-hidden className="size-3.5" />
      {copied ? t('chat.copyCitationCopied') : t('chat.copyCitation')}
    </Button>
  );
}

/** Task 2 (chat polish batch, owner ask): "Copy" now copies the WHOLE
 * answer — body, the structural disclosure lines, the R4 attribution
 * sentence (hyperlinked to the source deep link when one exists), and the
 * citation's own flags line (provisional/derived — a quote must keep them).
 * Tries the rich `ClipboardItem` write first (so a paste into a doc/email
 * keeps the clickable source link); falls back to `writeText` with the
 * plain-text flavor when `ClipboardItem` is unavailable (jsdom, some older
 * browsers) or the rich write throws. */
function CopyAnswerButton({
  view,
  sourceUrl,
  citation,
}: {
  view: AnswerView;
  sourceUrl: string | null;
  citation: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={async () => {
        const { text: bodyText, html: bodyHtml } = buildAnswerCopy(view, sourceUrl);
        const text = citation !== null ? `${bodyText}\n\n${citation}` : bodyText;
        const html = citation !== null ? `${bodyHtml}<p>${escapeHtmlForCopy(citation)}</p>` : bodyHtml;
        try {
          if (typeof ClipboardItem === 'undefined') throw new Error('no ClipboardItem');
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([text], { type: 'text/plain' }),
            }),
          ]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard unavailable (permissions/insecure context): keep the
            // label so the user can retry; nothing else to break.
          }
        }
      }}
    >
      <Copy aria-hidden className="size-3.5" />
      {copied ? t('chat.copyCitationCopied') : t('chat.copyCitation')}
    </Button>
  );
}

/** GatedResponse -> the plain string this chat renders for its non-'ok'
 * kinds. 'ok' is unwrapped by the caller (it carries the real answer). `t`
 * is passed in rather than called via the hook here — this is a plain
 * function, not a component, so it takes the caller's own `useT()` result. */
function gatedMessageText(
  result: Exclude<GatedResponse, { kind: 'ok' }>,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  switch (result.kind) {
    case 'unauthenticated':
      return t('chat.unauthenticated');
    case 'duplicate_request':
      return t('chat.duplicateRequest');
    case 'insufficient_credits':
      return t('chat.insufficientCredits', { balance: result.balance, required: result.required });
  }
}

// onOutcome (WP19, open-questions #68): reports every submit's GatedResponse
// to the parent so the dashboard can move the displayed balance without a
// reload. Pure notification -- the chat itself never derives balance state.
// pricing (WP20, #82): enables the pre-send cost surfaces; all three render
// only when provided, so prop-less call sites are unaffected.
export function Chat({
  onOutcome,
  pricing,
  attachments,
  // WP135 (ADR 033): workspace wiring. ALL optional — a prop-less / Dashboard
  // call site is byte-identical to today (no threadId ever leaves the client,
  // the dock never engages, the reset effect no-ops). `onThreadId`'s PRESENCE
  // is the "thread-aware" signal: only then does a submit carry the 5th
  // rawThreadId argument, so the Dashboard/test call sites keep their exact 3-
  // and 4-argument shapes.
  dockMode = false,
  initialMessages,
  initialContext = null,
  threadId: initialThreadId = null,
  loadNonce = 0,
  onThreadId,
  onVisualsChange,
  activeVisualId = null,
  onActivateVisual,
  onBusyChange,
}: {
  onOutcome?: (gated: GatedResponse) => void;
  pricing?: ChatPricing;
  attachments?: ChatAttachments;
  /** ≥ lg AND the workspace is active: visuals move to the right-pane dock and
   * render here as an in-flow reference chip instead (each visual exactly
   * once). Below lg / on the Dashboard this is false and visuals render inline
   * exactly as today. */
  dockMode?: boolean;
  /** Replay/reset seed for messages (a loaded thread, or [] for nieuwe chat). */
  initialMessages?: ChatMessage[];
  initialContext?: ConversationContext | null;
  /** The thread this chat starts in (null ⇒ a fresh chat; a real id ⇒ resumed). */
  threadId?: number | null;
  /** Bumped by the workspace on nieuwe-chat / thread-switch to (re)apply the
   * seed above and clear pending — selection chips deliberately survive. */
  loadNonce?: number;
  /** Reports the current thread id after a lazy create / resume (workspace
   * sidebar highlight + refresh). Its presence turns thread-awareness on. */
  onThreadId?: (threadId: number | null) => void;
  /** Reports the dockable visuals derived from the messages (the dock's tabs). */
  onVisualsChange?: (visuals: DockVisual[]) => void;
  /** The dock tab currently active (styles the matching reference chip). */
  activeVisualId?: string | null;
  /** A reference chip click activates its dock tab. */
  onActivateVisual?: (visualId: string) => void;
  /** WP135 (blocker fix): reports the in-flight state up so the workspace can
   * disable the sidebar's thread-switch / nieuwe-chat controls while a submit
   * is running — the UX belt that keeps a switch from racing an in-flight
   * response (the generation guard below is the correctness backstop). */
  onBusyChange?: (busy: boolean) => void;
} = {}) {
  const threadAware = onThreadId !== undefined;
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [pending, setPending] = useState<PendingClarification | null>(null);
  // WP135 (ADR 033 D1): the thread this chat is currently in — seeded from the
  // prop, updated to the server's attached thread id after a completed turn,
  // and sent as askQuestion's 5th argument (only when thread-aware).
  const [threadId, setThreadId] = useState<number | null>(initialThreadId ?? null);
  // ⟨A6⟩ addendum (#73 v2 follow-up, session 76): a reply used to attach to a
  // separately CAPTURED threadId (taken alongside `pending`, or alongside a
  // message's carrier) rather than the live `threadId` state, because the
  // sidebar's active thread could otherwise race ahead of an open
  // clarification round. The round-2 live-thread-fallback fix (below) proved
  // that captured value is ALWAYS either the live `threadId` or null at send
  // time (never a third value) — `threadId` is set from the very same
  // `outcome.threadId` a capture would have stored, and a thread switch clears
  // `pending`/every carrier together with resetting `threadId` itself, so a
  // surviving capture can never point at a thread other than the current live
  // one. That made the separate capture provably redundant, so this follow-up
  // dropped it (and the carrier's own per-message threadId field —
  // web/lib/chat-message.ts) and sends the live `threadId` directly on both
  // the typed-reply and chip-take paths (see handleSubmit) — same observed
  // behavior, one fewer piece of state to keep in sync. Pinned in
  // chat.test.tsx's two thread-attach-failed cases.
  // WP15 (ADR 021): the structured referent carried between turns. Held
  // exactly like `pending` (client-held React state, sent back verbatim on
  // the next submit) but updated only on an 'ok' outcome that itself
  // produced a context — any other outcome (a gated non-'ok' kind, or an
  // 'ok' response with no honest referent, e.g. a clarification) leaves the
  // held context untouched, so a smalltalk/refusal detour never erases it.
  const [context, setContext] = useState<ConversationContext | null>(initialContext ?? null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // WP22 (#96a): a fresh deploy invalidates Server Action ids in already-open
  // tabs -- the first submit then fails with Next's UnrecognizedActionError
  // (live-observed 2026-07-05, Vercel logs: POST / 404 "Failed to find Server
  // Action"). That case gets its own honest message + refresh affordance
  // instead of the misleading generic error.
  const [staleDeploy, setStaleDeploy] = useState(false);
  // WP129+130 (#129, ADR 032): the source-tags selection. Chips render (and a
  // selection payload rides every submit) ONLY when the websearch prop is
  // present — flag off ⇒ this whole block is inert and the calls stay 3-arg,
  // byte-identical to today. Registry sources are PRE-checked; the "Internet"
  // channel defaults OFF (the cost gate). State is per-session and persists
  // across turns (owner's tag mental model).
  const websearch = pricing?.websearch;
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    () => new Set(Object.keys(SOURCES)),
  );
  const [webSelected, setWebSelected] = useState(false);
  // All-deselected (no registry source AND no web) ⇒ send is disabled + an
  // inline hint; the server has its own deterministic belt (no_sources refusal)
  // regardless, but the client should never let an unanswerable turn submit.
  const nothingSelected =
    websearch !== undefined && selectedSources.size === 0 && !webSelected;
  const bottomRef = useRef<HTMLDivElement>(null);
  // WP135 (ADR 033 D5, ⟨A6⟩): the reset effect below fires on every loadNonce
  // change (nieuwe chat / thread switch); this ref skips the mount run, whose
  // seed the useState initializers already applied.
  const seededRef = useRef(true);
  // WP135 (blocker fix): the submit generation. Bumped by the reset effect on
  // every nieuwe-chat / thread-switch, so an in-flight submit can detect — after
  // its await — that the chat has since been reset to a DIFFERENT thread and
  // discard all of its state updates, rather than landing a stale response in
  // the newly displayed thread. Captured at submit start; re-checked after the
  // action resolves.
  const generationRef = useRef(0);
  // #73 v2 review (PR #122), moved onto ChatMessage in the #73 v2 follow-up
  // (session 76, once web/lib/chat-message.ts was free — a sibling PR held it
  // at the time): each answer/refusal message now carries ITS OWN carrier
  // directly (`message.carrier`, chat-message.ts) instead of an index-keyed
  // `Map` in a ref. Two answers' fixed-text chips can share a label byte for
  // byte ("Vergelijk met Nederland", the G4 label), and `takesRescue` below
  // routes on the label alone — so a click must resolve against the CLICKED
  // message's own carrier, never the newest one (the click handler below
  // reads `message.carrier` off the message it renders). A resumed message's
  // `carrier` is always `null` (ADR 033 ⟨A6⟩ — replay-assemble.ts never
  // guesses one), so its chip keeps the current-pending route, exactly as
  // before this move.
  type Carrier = { pending: PendingClarification };
  // Review round 2: the chip clicked LAST, with its message's carrier. The
  // binding is resolved at SEND time (handleSubmit), never on the click — round
  // 1 re-bound `pending` on the click, which (a) discarded an OPEN clarification
  // round when the user then typed a reply to it instead of sending the chip,
  // and (b) lost the race with an in-flight answer whose landing overwrote
  // `pending` again. Consulted only while the sent text is still the clicked
  // label byte for byte; edited text is typed text and keeps the live pending.
  const chipRef = useRef<({ label: string } & Carrier) | null>(null);

  function toggleSource(key: string): void {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyOutcome(outcome: AskOutcome): void {
    if (outcome.gated.kind === 'ok' && outcome.context !== null) {
      setContext(outcome.context);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // WP135 (ADR 033 D5): nieuwe chat = the ADR-021 explicit reset; a thread
  // switch = the same reset seeded with the loaded thread (⟨A6⟩: an abandoned
  // clarification stays abandoned, exactly like a page reload). Keyed on
  // loadNonce ONLY — the seed props change together with it, and selection
  // chips (selectedSources/webSelected) are deliberately NOT touched, so they
  // survive. The mount run is skipped (the initializers already seeded state).
  useEffect(() => {
    if (seededRef.current) {
      seededRef.current = false;
      return;
    }
    // Bump the generation FIRST: a submit that was already in flight when this
    // reset landed will, after its await, see a changed generation and discard
    // its (now stale) updates instead of clobbering the thread we just seeded.
    generationRef.current += 1;
    setMessages(initialMessages ?? []);
    setContext(initialContext ?? null);
    setThreadId(initialThreadId ?? null);
    setPending(null);
    chipRef.current = null;
    setInput('');
    setError(null);
    setStaleDeploy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadNonce]);

  // WP135 (blocker fix): report the in-flight state up so the workspace can
  // disable the sidebar's switch controls while a submit runs (a no-op without
  // the callback — the Dashboard / test call sites).
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // WP135 (ADR 033 D4): report the dockable visuals derived from the messages
  // so the workspace can render the dock and its tabs; a no-op without the
  // callback (the Dashboard / test call sites).
  useEffect(() => {
    onVisualsChange?.(deriveVisuals(messages));
  }, [messages, onVisualsChange]);

  // ADR 037 D10: the upload button's OWN local busy/error state — fixed in
  // review, explicitly NOT this component's main `busy`/`onBusyChange` (that
  // would lock the sidebar's thread-switch controls for the full ~45s ingest
  // budget, a real behavior widening nothing asked for). Declared here,
  // appended strictly after every existing hook/ref above (D10 point 2) —
  // unconditionally, regardless of whether `attachments` is present, exactly
  // like `websearch`'s own state above.
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-choosing the same file name later
    if (!file || !attachments) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const result = await attachments.onUploadFile(file);
      if (!result.ok) {
        setUploadError(result.message ?? t('chat.fileReadError'));
      }
      // A success switches the workspace's handoff to the new dataset thread
      // (onUploadFile's own job, mirroring onThreadId) — this component has
      // nothing further to render; it is about to unmount.
    } catch {
      setUploadError(t('chat.fileReadError'));
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || nothingSelected) return;

    // WP135 (blocker fix): the generation this submit belongs to. If a
    // nieuwe-chat / thread-switch bumps it while the action is in flight, the
    // response below is stale — it must NOT append to (or re-thread) whatever
    // thread is now displayed. Re-checked after the await.
    const submitGeneration = generationRef.current;

    setMessages((m) => [
      ...m,
      { role: 'user', kind: null, text, chart: null, cost: null, citation: null, card: null, csv: null, proof: null, answerView: null, provisional: false, suggestions: [], auditId: null, webSection: null, carrier: null },
    ]);
    setInput('');
    setBusy(true);
    setError(null);
    setStaleDeploy(false);

    try {
      const requestId = crypto.randomUUID();
      // WP129+130 (#129, ADR 032): the selection is a STRUCTURAL payload (never
      // prompt text), sent on EVERY submit only when chips are shown. When the
      // websearch prop is absent the calls stay exactly 3-arg — no 4th argument
      // is passed, so pre-WP behavior (and its tests) are byte-identical.
      const selection = websearch
        ? { sources: [...selectedSources], web: webSelected }
        : undefined;
      // WP135 ⟨A1⟩/⟨A6⟩: thread-aware call sites (the workspace) carry the 5th
      // rawThreadId argument — the LIVE thread, for a question and a reply
      // alike (the #73 v2 follow-up dropped the separate captured-thread
      // state; see the `threadId` declaration above). Non-thread-aware call
      // sites (Dashboard, tests) omit it, keeping their exact 3-/4-argument
      // shapes byte-identical.
      let outcome: AskOutcome;
      // WP26c (ADR 024): a RESCUE pending is not an open clarification round —
      // it exists only so its one chip can resolve deterministically. If the
      // user types anything else, this is their next QUESTION and must take the
      // ordinary question path: replyToClarification deliberately wires no table
      // finder, so routing a fresh question through it would silently drop
      // on-demand table onboarding. (The server keeps its own belt for a client
      // that gets this wrong; this branch is what makes the common case right.)
      // #73 v2 review round 2: a clicked chip is bound to ITS message's carrier
      // HERE, at send time, and only while the input still holds the clicked
      // label byte for byte. Typed or edited text keeps the live pending, so a
      // click elsewhere never discards an open clarification round, and an
      // answer landing after the click cannot re-route the chip to itself.
      const clicked = chipRef.current;
      chipRef.current = null;
      const chip = clicked !== null && clicked.label.trim() === text ? clicked : null;
      const sendPending = chip ? chip.pending : pending;
      // ⟨A6⟩ addendum (#73 v2 follow-up): send the LIVE thread on both the
      // chip-take and the typed-reply path — proven equivalent to the former
      // captured-threadId fallback (see the `threadId` state comment above),
      // including a turn whose OWN attach failed fail-soft (that turn's
      // carrier used to hold `threadId: null`; the live `threadId` already
      // carries the fallback's result, since a switch clears `pending`/every
      // carrier together with `threadId` itself, so nothing here can point at
      // a thread other than the current live one — or fork a fresh one).
      const takesRescue =
        sendPending?.rescueOnly !== true || sendPending.options.some((o) => o.trim() === text);
      if (sendPending && takesRescue) {
        outcome = threadAware
          ? await replyToClarification(sendPending, text, requestId, selection, threadId)
          : websearch
            ? await replyToClarification(sendPending, text, requestId, selection)
            : await replyToClarification(sendPending, text, requestId);
      } else {
        outcome = threadAware
          ? await askQuestion(text, requestId, context, selection, threadId)
          : websearch
            ? await askQuestion(text, requestId, context, selection)
            : await askQuestion(text, requestId, context);
      }
      // WP135 (blocker fix): the chat was reset to a DIFFERENT thread while this
      // action was in flight (the reset effect bumped the generation). Discard
      // EVERYTHING this stale submit would apply — no message append, no
      // setThreadId, no onThreadId (sidebar refresh/highlight), no onOutcome —
      // so the late response never lands in the newly displayed thread. `finally`
      // still clears busy (busy stayed true throughout, so no second submit could
      // have begun on the new thread).
      if (generationRef.current !== submitGeneration) return;
      applyOutcome(outcome);
      // WP135 ⟨A1⟩: adopt the server's attached thread (lazy-created on the
      // first completed turn) so the next turn attaches to it, and report it up
      // for the sidebar highlight/refresh. A failed attach returns null and the
      // chat simply stays threadless.
      if (threadAware && outcome.threadId !== null) {
        setThreadId(outcome.threadId);
        onThreadId?.(outcome.threadId);
      }
      const { gated } = outcome;
      onOutcome?.(gated);

      if (gated.kind !== 'ok') {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            kind: 'info',
            text: gatedMessageText(gated, t),
            chart: null,
            cost: null,
            citation: null,
            card: null,
            csv: null,
            proof: null,
            answerView: null,
            provisional: false,
            suggestions: [],
            auditId: null,
            webSection: null,
            carrier: null,
          },
        ]);
        // None of these kinds change the pending clarification state;
        // `finally` below still clears `busy`.
        return;
      }

      const { response } = gated;
      // ⟨A6⟩: the pending clarification (if any) this turn's response offers
      // for its next reply — a clarification's own open round, or a
      // rescueOnly carrier riding an answer/refusal's follow-up chips (#197
      // step 3 / #73 v2). WP26c (ADR 024): a MISFIRED refusal may carry a
      // rescue pending — the state that lets its one chip resolve
      // deterministically instead of re-entering the parse that misfired. It
      // is explicitly `rescueOnly`, and the server answers any NON-matching
      // reply as a fresh question, so holding it here cannot turn the user's
      // next unrelated question into a clarification-reply merge. `?? null`
      // guards the deploy-window skew (an old server bundle omits the key).
      const carried =
        response.kind === 'clarification'
          ? response.pending
          : response.kind === 'refusal' || response.kind === 'answer'
            ? (response.pending ?? null)
            : null;
      // #73 v2 follow-up (moved onto ChatMessage, session 76): only an
      // answer/refusal's carried pending is a CARRIER a later chip binds to —
      // a clarification IS the open round itself, not a carrier (its own
      // chips take the live `pending` route below instead, exactly as
      // before). Computed HERE, before the message literal below, so it lands
      // in the SAME setMessages call that appends the message — never a
      // render behind, or a chip could briefly render with no bound carrier.
      const carrier: ChatMessage['carrier'] =
        carried && (response.kind === 'answer' || response.kind === 'refusal')
          ? { pending: carried }
          : null;
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          // WP23 review (display-honesty lens, HIGH): meta answers and
          // smalltalk replies ride the refusal ENVELOPE by design (ADR 022 —
          // "the text ANSWERS the question") — the refusal header would
          // visually claim the opposite. They present as plain info.
          // WP16 sub-part 2 (ADR 026): the onboarding acknowledgments ride the
          // same envelope and ANSWER too ("we're fetching it") — nothing was
          // refused, so the "Dit kon ik niet beantwoorden" header + geen-gok
          // badge must NOT show; render as plain info like meta/smalltalk.
          kind: messageKind(response),
          text: response.text,
          chart: response.kind === 'answer' ? response.chart : null,
          cost: gated.netCost,
          citation: response.kind === 'answer' ? buildCitation(response) : null,
          card: response.kind === 'answer' ? statCardData(response) : null,
          csv: response.kind === 'answer' ? buildAnswerCsv(response) : null,
          proof: response.kind === 'answer' ? buildAnswerProof(response) : null,
          answerView:
            response.kind === 'answer'
              ? {
                  body: response.answer.body,
                  // WP26 mechanism B: `?? null` guards the deploy-window skew
                  // (an old server bundle omits the key), like suggestions.
                  assumptionLine: response.answer.assumptionLine ?? null,
                  stalenessWarning: response.stalenessWarning,
                  definitionLine: response.answer.definitionLine,
                  // #39: `?? null` guards the deploy-window skew AND every
                  // answer without registry-recorded alternates (the key is
                  // simply absent — A1).
                  alternatesLine: response.answer.alternatesLine ?? null,
                  markingLine: response.answer.markingLine,
                  attribution: response.answer.attributionLine,
                  tableId: response.result.attribution.tableId,
                  source: response.result.attribution.source,
                  // #170(1): the source badge's measured sync date.
                  syncedAt: response.result.attribution.syncedAt,
                }
              : null,
          provisional:
            response.kind === 'answer' && response.result.cells.some((cell) => cell.provisional),
          // WP29 + #134(a): `?? []` guards the deploy-window skew only (an old
          // server process serving a new client bundle omits the field); a
          // current server always sets it. Answers carry follow-up chips;
          // period-coverage refusals (freshness / outside_loaded_slice) carry a
          // one-click retry chip — both ride the same structural field and the
          // same kind-agnostic render + #75 fill-don't-send handler below.
          // WP26 mechanism A (ADR 024): clarifications join the same surface —
          // their chips are the OPTIONS the server proved answerable before
          // offering them. Same fill-don't-send handler (#75): the click puts
          // the label in the input, the user presses Verstuur and sees the cost
          // line, and the server's deterministic rung recognizes the label and
          // resolves it without a second LLM parse.
          suggestions:
            response.kind === 'answer' ||
            response.kind === 'refusal' ||
            response.kind === 'clarification'
              ? (response.suggestions ?? [])
              : [],
          // WP128: the feedback anchor — only real answers get buttons; the
          // `?? null` guards the same deploy-window skew as suggestions.
          auditId: response.kind === 'answer' ? (gated.auditId ?? null) : null,
          // WP129+130 (#130, ADR 032): the web section rides EVERY response kind
          // (answer/clarification/refusal) — set from the envelope for all of
          // them. `?? null` guards the deploy-window skew (an old server bundle
          // omits the field); it renders keyed on this value, never the kind.
          webSection: response.webSection ?? null,
          carrier,
        },
      ]);
      // ⟨A6⟩: `carried` also becomes the live round a plain typed reply
      // merges against (a resumed/switched thread clears it via the loadNonce
      // reset). The message just appended above carries the identical pending
      // as its own `carrier` for a chip click to bind to instead — see
      // handleSubmit's send-time resolution and the click handler below.
      setPending(carried ?? null);
    } catch (err) {
      // WP135 (blocker fix): same generation guard for the failure path — a
      // stale submit's error must not paint over the thread now displayed.
      if (generationRef.current !== submitGeneration) return;
      if (unstable_isUnrecognizedActionError(err)) {
        // Structurally true no-charge claim: the action never ran, and the
        // debit lives inside it (the billing gate is the action's first step).
        setStaleDeploy(true);
      } else {
        setError(t('chat.genericError'));
      }
    } finally {
      setBusy(false);
    }
  }

  // The pre-send pricing line (WP20 #82; WP129+130 added the Internet
  // variants). Session 88 (#211) moved it into the global footer through a
  // PricingHintContext; the owner then asked (session-89 close-out, built
  // session 90) for it to sit DIRECTLY UNDER the input box instead, so it is
  // a plain derived string rendered inline again and the context plumbing is
  // gone. Same three text variants, same conditions, same numbers.
  const pricingHint = !pricing
    ? null
    : websearch && webSelected && selectedSources.size > 0
      ? t('chat.pricingBoth', {
          total: pricing.simple + websearch.addonPrice,
          addon: websearch.addonPrice,
          balance: pricing.balance,
          clarification: pricing.clarification,
        })
      : websearch && webSelected
        ? t('chat.pricingWebOnly', {
            addon: websearch.addonPrice,
            reserved: pricing.simple + websearch.addonPrice,
            balance: pricing.balance,
          })
        : t('chat.pricingDefault', {
            simple: pricing.simple,
            balance: pricing.balance,
            clarification: pricing.clarification,
          });

  return (
    // Session 87 visual redesign: no frame of its own — the workspace card
    // (workspace.tsx) supplies the border and the header bar. Messages scroll
    // in the middle; the composer sits in a bottom band with the chip row
    // BELOW the input (owner amendment 1). An empty conversation renders
    // nothing above the composer (bare chat, no example chips).
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 tnum">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        {messages.map((message, i) => {
          // WP135 ⟨A7⟩: a redacted row replays as ONE muted placeholder — no
          // user+assistant sentinel pair, no envelope (the chat-side isDeleted
          // posture).
          if (message.role === 'redacted') {
            return (
              <div key={i} className="text-left">
                <p className="text-sm italic text-muted-foreground">{t('chat.redactedMessage')}</p>
              </div>
            );
          }
          // WP135 (ADR 033 D4): in dock mode a message's single visual moves to
          // the right pane and is replaced here by an in-flow reference chip —
          // each visual renders EXACTLY ONCE. Below lg the visuals render inline
          // exactly as today.
          const docked = dockMode && messageHasVisual(message);
          return (
          <div
            key={i}
            className={message.role === 'user' ? 'flex flex-col items-end text-right' : 'text-left'}
          >
            {!dockMode && message.card ? <StatCard data={message.card} /> : null}
            {/* WP23 (#84): a refusal announces itself — the two fixed Dutch
              * strings from the owner-approved row. */}
            {message.kind === 'refusal' ? (
              <div className="mb-0.5 flex items-center gap-2 text-xs">
                <span className="font-semibold text-muted-foreground">{t('chat.refusalHeader')}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                  {t('chat.refusalBadge')}
                </span>
              </div>
            ) : null}
            {/* WP23 (#84): decorative question marker OUTSIDE the bubble so
              * the bubble's text content stays exactly the pipeline's. */}
            {message.kind === 'clarification' ? (
              <span aria-hidden className="mr-1 align-middle text-sm">
                ❓
              </span>
            ) : null}
            {/* Session 87 (mockup Option B): a user message is an outlined
              * card aligned right; assistant text is plain, aligned left. A
              * clarification keeps its amber wash (#84: it must read as a
              * question back, not as an answer). */}
            {/* Session 91 (owner-chosen "Option B — answer card"): a
              * validated ANSWER renders inside a shadcn Card — body + the
              * WP23/#90 structural lines in CardContent, the source +
              * actions in a CardFooter (the old border-t attribution row
              * collapses into it; R4 attribution stays fully visible, never
              * shortened). Every other message kind (refusal / clarification
              * / info) keeps exactly today's plain bubble below. */}
            {message.kind === 'answer' && message.answerView ? (
              <Card size="sm" className="mb-2 max-w-full">
                <CardContent className="flex flex-col gap-1">
                  <div className="max-w-full whitespace-pre-wrap text-sm text-[15px] leading-relaxed text-foreground">
                    {message.answerView.body}
                  </div>
                  {/* WP26 mechanism B (ADR 024): the defaulted-axis
                    * disclosure. It sits directly under the body and at
                    * BODY-adjacent weight, not as muted fine print: it
                    * qualifies the number the reader just read ("this is the
                    * national figure") and carries the correction path.
                    * Burying it would keep the letter of the safelist and
                    * lose its point. */}
                  {message.answerView.assumptionLine ? (
                    <p className="text-sm text-muted-foreground">{message.answerView.assumptionLine}</p>
                  ) : null}
                  {message.answerView.stalenessWarning ? (
                    <p className="text-sm text-warning">{message.answerView.stalenessWarning}</p>
                  ) : null}
                  {message.answerView.definitionLine ? (
                    <p className="text-xs text-muted-foreground">{message.answerView.definitionLine}</p>
                  ) : null}
                  {/* #39: the alternate-reading disclosure — plain text under
                    * the definition it qualifies (the clickable affordance is
                    * #89, deliberately not built here). */}
                  {message.answerView.alternatesLine ? (
                    <p className="text-xs text-muted-foreground">{message.answerView.alternatesLine}</p>
                  ) : null}
                  {message.answerView.markingLine ? (
                    <p className="text-xs text-muted-foreground">{message.answerView.markingLine}</p>
                  ) : null}
                </CardContent>
                <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40">
                  {/* LEFT: the source — the voorlopig pill (#71), the FULL
                    * R4 attribution sentence (always visible, never
                    * shortened — Huisstijl rule 7: quiet, text-xs
                    * text-muted-foreground), and the #86/#170(1) SourceBadge
                    * deep link. */}
                  <span className="inline-flex max-w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {message.provisional ? (
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                        {t('chat.provisionalBadge')}
                      </span>
                    ) : null}
                    <span>{message.answerView.attribution}</span>
                    <SourceBadge
                      tableId={message.answerView.tableId}
                      source={message.answerView.source}
                      syncedAt={message.answerView.syncedAt}
                    />
                  </span>
                  {/* RIGHT: the actions — feedback FIRST (#128; only real
                    * answers with a stored audit row get them — an answer
                    * whose audit write failed, auditId null, gets none), then
                    * the #70/#79/#89 drill-through trigger, citation, CSV,
                    * then the cost line last. `has-[[role=region]]:basis-full`
                    * grows this group to the footer's full width the moment
                    * the proof panel (role="region") opens inside it, so the
                    * panel's own order-last basis-full (answer-proof.tsx)
                    * spans the whole footer instead of just this group's
                    * shrink-to-fit width. */}
                  {/* …and the same for the 👎 panel (data-slot="feedback-panel",
                    * feedback-buttons.tsx), which the answer-card review found
                    * squeezed to the group's width: FeedbackButtons' own root
                    * grows to basis-full when its panel is open, and so does
                    * this group, so the panel spans the whole footer. */}
                  <div className="flex flex-wrap items-center gap-1 has-[[role=region]]:basis-full has-[[data-slot=feedback-panel]]:basis-full">
                    {message.auditId !== null ? <FeedbackButtons auditId={message.auditId} /> : null}
                    {message.proof !== null ? <AnswerProof proof={message.proof} /> : null}
                    {/* Owner ask (session 94): the docked-visual reference
                      * trigger moves out of the floated top-of-card pill and
                      * into this action row, styled like every other footer
                      * button (shared Button, the same toggle-variant pattern
                      * FeedbackButtons already uses — outline/secondary by
                      * aria-pressed — rather than a bespoke rounded pill),
                      * placed immediately left of Copy. */}
                    {docked ? (
                      <Button
                        type="button"
                        variant={activeVisualId === visualId(i) ? 'secondary' : 'outline'}
                        size="xs"
                        onClick={() => onActivateVisual?.(visualId(i))}
                        aria-pressed={activeVisualId === visualId(i)}
                      >
                        <PanelRight aria-hidden className="size-3.5" />
                        {message.chart !== null ? t('chat.dockedChipChart') : t('chat.dockedChipCard')}
                      </Button>
                    ) : null}
                    {/* Task 2 (chat polish batch, owner ask): "Copy" copies
                      * the whole card — body, disclosure lines, attribution
                      * (hyperlinked), citation flags — whenever there's an
                      * AnswerView to build it from, not only when `citation`
                      * happens to be non-null (it's ALWAYS non-null for a
                      * real answer envelope — this widens the gate to match
                      * intent, not a behavior change today). */}
                    {message.answerView !== null ? (
                      <CopyAnswerButton
                        view={message.answerView}
                        sourceUrl={sourceTableUrl(
                          message.answerView.source ?? sourceKeyForTableId(message.answerView.tableId),
                          message.answerView.tableId,
                        )}
                        citation={message.citation}
                      />
                    ) : null}
                    {message.csv !== null ? <DownloadCsvButton csv={message.csv} /> : null}
                    {message.cost !== null ? (
                      <span className="text-xs text-muted-foreground tnum">
                        {t('chat.costCredits', { n: message.cost })}
                      </span>
                    ) : null}
                  </div>
                </CardFooter>
              </Card>
            ) : (
              <>
                <div
                  className={
                    'max-w-full whitespace-pre-wrap text-sm ' +
                    (message.role === 'user'
                      ? 'max-w-[85%] rounded-lg border border-border bg-background px-3.5 py-2.5 text-left text-foreground'
                      : message.kind === 'clarification'
                        ? 'inline-block rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-foreground'
                        : 'text-[15px] leading-relaxed text-foreground')
                  }
                >
                  {message.text}
                </div>
                {message.cost !== null ? (
                  <div className="mt-0.5 text-xs text-muted-foreground tnum">
                    {t('chat.costCredits', { n: message.cost })}
                    {/* WP20 #82(c): the reply's price, stated AT the
                      * clarifying question — client-side caption; the
                      * pipeline's own deterministic message text stays
                      * untouched. */}
                    {message.kind === 'clarification' && pricing
                      ? t('chat.replyCostSuffix', { price: pricing.simple })
                      : ''}
                  </div>
                ) : null}
                {/* Deploy-window-skew fallback (A1): an 'answer' whose
                  * stored/replayed envelope is too old/minimal for a
                  * structural answerView (backend/threads/replay.ts's
                  * extractAnswerView returns null when body/attributionLine
                  * are missing) still gets its feedback + drill-through +
                  * citation + CSV actions — just without the card/footer
                  * treatment, exactly as before the WP218 card redesign. */}
                {message.kind === 'answer' && message.auditId !== null ? (
                  <FeedbackButtons auditId={message.auditId} />
                ) : null}
                {message.kind === 'answer' &&
                (message.citation !== null || message.csv !== null || message.proof !== null) ? (
                  <div className="mt-0.5 flex flex-wrap items-center gap-3">
                    {message.proof !== null ? <AnswerProof proof={message.proof} /> : null}
                    {message.citation !== null ? <CopyCitationButton citation={message.citation} /> : null}
                    {message.csv !== null ? <DownloadCsvButton csv={message.csv} /> : null}
                  </div>
                ) : null}
              </>
            )}
            {!dockMode && message.chart ? <ChartView spec={message.chart} /> : null}
            {/* WP135 (ADR 033 D4): the in-flow reference chip standing in for a
              * docked visual — clicking activates its dock tab ("in het paneel").
              * The web section still renders below this (ADR 032). */}
            {/* Task 3 / superseded session 94: an answer card renders its own
              * docked trigger in the CardFooter action row instead (below) —
              * not here. Refusal/clarification/info messages (no answerView)
              * keep the in-flow chip here, unchanged. */}
            {docked && !(message.kind === 'answer' && message.answerView) ? (
              <button
                type="button"
                onClick={() => onActivateVisual?.(visualId(i))}
                aria-pressed={activeVisualId === visualId(i)}
                className={
                  'mt-2 inline-flex items-center gap-1 ' +
                  (activeVisualId === visualId(i)
                    ? 'rounded-full border border-transparent bg-secondary px-3 py-1 text-xs text-foreground'
                    : PILL)
                }
              >
                {message.chart !== null ? t('chat.dockedChipChart') : t('chat.dockedChipCard')}
              </button>
            ) : null}
            {/* WP29 (#73, ADR 029 D3): follow-up chips — styled exactly like
              * the #75 example chips, and the click handler IS the #75
              * behavior verbatim: fill the input, never send. The user sees
              * the pre-send cost line (#82) and presses Verstuur themselves. */}
            {message.suggestions.length > 0 ? (
              <>
                <p className="mt-2 text-xs text-muted-foreground">{t('chat.suggestionsHint')}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                {message.suggestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => {
                      // #73 v2 review: remember THIS message's own carrier
                      // (message.carrier, chat-message.ts) with the clicked
                      // label; handleSubmit binds the send to it only if the
                      // label goes out unedited (an older answer's or
                      // refusal's chip takes against ITS carrier, not the
                      // latest one). Nothing is re-bound here — `pending`
                      // stays what it is, so an open clarification round
                      // survives a glance at an older chip. A message without
                      // a carrier (a resumed thread, a clarification's own
                      // option) records nothing — chipRef stays null and the
                      // send below falls through to the live `pending`.
                      chipRef.current = message.carrier
                        ? { label: question, ...message.carrier }
                        : null;
                      setInput(question);
                    }}
                    className={PILL}
                  >
                    {question}
                  </button>
                ))}
                </div>
              </>
            ) : null}
            {/* WP129+130 (#130, ADR 032): the unverified-web section — LAST in
              * the bubble, BELOW the validated CBS body / refusal text and every
              * other structural block. Keyed on the FIELD VALUE (never the
              * message kind): any message carrying a non-null webSection renders
              * it. The separation IS the honesty model. */}
            {message.webSection ? <WebSectionView section={message.webSection} /> : null}
          </div>
          );
        })}
        {busy ? (
          <>
            <div className="text-left text-sm text-muted-foreground">
              {/* WP129+130 go-live feedback (owner, 2026-07-12): with the Internet
                * chip on, the wait covers the web search too — say so honestly.
                * Web-only (CBS deselected) names only the web. Session 88:
                * an AnswerSkeleton was ADDED below, this text was NOT removed
                * — it carries a distinction the skeleton can't. */}
              {websearch && webSelected && selectedSources.size > 0
                ? t('chat.busyBoth')
                : websearch && webSelected
                  ? t('chat.busyWebOnly')
                  : t('chat.busyCbsOnly')}
            </div>
            <AnswerSkeleton />
          </>
        ) : null}
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {staleDeploy ? (
          <div className="text-sm text-warning">
            {t('chat.staleDeployPrefix')}{' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-medium underline"
            >
              {t('chat.staleDeployButton')}
            </button>{' '}
            {t('chat.staleDeploySuffix')}
          </div>
        ) : null}
        <div ref={bottomRef} />
        </div>
      </div>
      <div className="shrink-0 border-t border-border px-3 pt-3 pb-4" data-testid="chat-composer">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      {/* WP129+130 (#129, ADR 032): the source-tags chips — one per registered
        * source (label "<displayName> data", PRE-checked) plus the "Internet"
        * channel (default OFF). Toggle buttons carry aria-pressed; a selected
        * chip is filled, an unselected one outlined (icons are aria-hidden, so
        * the accessible name stays the label). Only shown when the websearch
        * prop is present — a lone CBS chip is the choice-noise the owner
        * rejected. Session 87 put the row UNDER the input (owner amendment 1);
        * the owner then asked (session-89 close-out, built session 90) for the
        * data-source pills to sit directly ABOVE the input box, with the
        * pre-send pricing line directly BELOW it. The whole chip row moved up
        * together — sources and the attachment entry points share one row, and
        * the link/upload feedback lines stay next to the chips they belong to,
        * so the input + pricing line form one uninterrupted block underneath. */}
      <div className="flex flex-wrap items-center gap-1.5">
      {websearch ? (
        <>
          {Object.keys(SOURCES).map((key) => {
            const active = selectedSources.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleSource(key)}
                className={active ? CHIP_ON : CHIP_OFF}
              >
                {active ? <Check aria-hidden="true" className="size-3.5" /> : <Database aria-hidden="true" className="size-3.5" />}
                {t('chat.sourceDataSuffix', { name: SOURCES[key]!.displayName })}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={webSelected}
            onClick={() => setWebSelected((v) => !v)}
            className={webSelected ? CHIP_ON : CHIP_OFF}
          >
            {webSelected ? <Check aria-hidden="true" className="size-3.5" /> : <Globe aria-hidden="true" className="size-3.5" />}
            {t('chat.internetChip')}
          </button>
        </>
      ) : null}
      {/* #201/#202 (open-questions, session 83 scoping; R8 collapse, session
        * 97, decision 10): "Link toevoegen"/"Sheet koppelen"/"Data koppelen"
        * and the disabled "Bestand uploaden" placeholder used to be four
        * separate chips — collapsed into one honest "coming soon" chip
        * (principle c: disabled with a reason, never a fake working button)
        * since none of them had a backend. ADR 037 D10's presence-driven
        * exception is unchanged: once `attachments` is present, "Bestand
        * uploaden" alone appears, live — the collapsed chip disappears. */}
        {attachments ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              onChange={(e) => void handleFileChosen(e)}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploadBusy}
              onClick={() => fileInputRef.current?.click()}
              className={CHIP_ACTION}
            >
              <Paperclip aria-hidden="true" className="size-3.5" />
              {t('chat.uploadFile')}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled
            title={t('chat.ownDataComingSoonTitle')}
            className={CHIP_SOON}
          >
            <Paperclip aria-hidden="true" className="size-3.5" />
            {t('chat.ownData')}
          </button>
        )}
      </div>
      {nothingSelected ? (
        <p className="text-xs text-destructive">{t('chat.nothingSelectedHint')}</p>
      ) : null}
      {attachments && uploadBusy ? (
        <p className="text-xs text-muted-foreground">{t('chat.fileReading')}</p>
      ) : null}
      {attachments && uploadError ? (
        <p className="text-xs text-destructive">{uploadError}</p>
      ) : null}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          maxLength={500}
          placeholder={
            // WP26c: a RESCUE pending must not make the box look like it is
            // waiting for an answer — nothing was asked. Only a real
            // clarification round echoes its question here.
            pending && pending.rescueOnly !== true ? pending.questionNl : t('chat.placeholder')
          }
          className="h-10 flex-1 bg-background px-3.5"
        />
        <Button type="submit" size="lg" className="h-10 px-4" disabled={busy || !input.trim() || nothingSelected}>
          {t('chat.send')}
        </Button>
      </form>
      {pricingHint ? <p className="mb-2 text-xs text-muted-foreground">{pricingHint}</p> : null}
        </div>
      </div>
    </div>
  );
}
