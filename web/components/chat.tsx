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

import { Database, Globe, Link2, Paperclip, Plug } from 'lucide-react';
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
import { SOURCES } from '../backend/sources/registry.ts';
import type { WebSection } from '../backend/websearch/types.ts';
import { buildAnswerProof } from '../lib/answer-proof.ts';
import { buildCitation } from '../lib/citation.ts';
import { buildAnswerCsv } from '../lib/csv.ts';
import type { AnswerCsv } from '../lib/csv.ts';
import { statCardData } from '../lib/stat-card-data.ts';
// WP135 (ADR 033 ⟨A3⟩): the ChatMessage/AnswerView shape and the meta/smalltalk
// kind reclassification live in a shared pure leaf so thread replay
// (web/lib/replay-assemble.ts, called from a Server Action) reconstructs the
// SAME messages this live path appends — byte-identity by construction.
import type { ChatMessage } from '../lib/chat-message.ts';
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
import { Badge } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';

// Session 87 visual redesign (owner decision, docs/superpowers/specs/
// 2026-09-07-chat-chart-visual-redesign-design.md): the #75 example-question
// chips and the "Stel een vraag … bijvoorbeeld" prompt are gone from the
// empty state — it is a bare composer now, like a blank LLM chat. The
// follow-up chips (#73) keep the identical fill-don't-send handler.

/** Session 87 (mockup Option B): the squared chips in the row UNDER the
 * composer (owner amendment 1) — source toggles and attachment entry points. */
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

/** WP129+130 (#130, ADR 032): the header on the unverified-web block — a fixed
 * constant so the disclaimer copy is one reviewable source (owner-approved,
 * Q1/Q3). */
const WEB_SECTION_HEADER = 'Van het web (niet door checkdecijfers geverifieerd)';

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
  if (section.status === 'failed') {
    // One honest line; the settlement already refunded the add-on (⟨W4⟩/Q6).
    const line =
      section.code === 'insufficient_balance'
        ? 'De webzoekopdracht is niet uitgevoerd (onvoldoende saldo) — geen extra kosten.'
        : 'De webzoekopdracht is niet gelukt — geen extra kosten.';
    return <p className="mt-2 text-xs text-muted-foreground">{line}</p>;
  }
  return (
    <div className="mt-2 max-w-full rounded border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
      <p className="mb-1 font-medium text-muted-foreground">{WEB_SECTION_HEADER}</p>
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
  return (
    <>
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
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
        Download als CSV
      </button>
      {failed ? (
        <span className="text-xs text-destructive">Downloaden lukte niet in deze browser.</span>
      ) : null}
    </>
  );
}

/** WP20 #78: copies the citation; flips to a transient confirmation. */
function CopyCitationButton({ citation }: { citation: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-muted-foreground underline"
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
      {copied ? 'Gekopieerd!' : 'Kopieer als citaat'}
    </button>
  );
}

/** GatedResponse -> the plain string this chat renders for its non-'ok'
 * kinds. 'ok' is unwrapped by the caller (it carries the real answer). */
function gatedMessageText(result: Exclude<GatedResponse, { kind: 'ok' }>): string {
  switch (result.kind) {
    case 'unauthenticated':
      return 'Je bent niet ingelogd. Log in via /login om een vraag te stellen.';
    case 'duplicate_request':
      return 'Deze vraag wordt al verwerkt — even geduld.';
    case 'insufficient_credits':
      return `Je hebt niet genoeg credits (${result.balance} over, ${result.required} nodig). Koop credits via /credits.`;
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

  // WP202b preview (owner request, session 86): "Link toevoegen" opens the
  // inline URL row the original design sketched (D10), so the intended flow
  // is visible for demos, WITHOUT a working backend behind it (url_html
  // ingest has no `src/attachments/` module yet — no SSRF guard exists to
  // fetch anything through safely). Submitting shows an honest "not yet"
  // message, never a fake fetch — principle (c), same posture as every other
  // disabled-with-a-reason button in this row. Pure UI state, no dependency
  // on `attachments`/any flag — appended after every existing hook, per this
  // file's own convention.
  const [linkRowOpen, setLinkRowOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkComingSoon, setLinkComingSoon] = useState(false);

  function handleLinkSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setLinkComingSoon(true);
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-choosing the same file name later
    if (!file || !attachments) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const result = await attachments.onUploadFile(file);
      if (!result.ok) {
        setUploadError(result.message ?? 'Something went wrong reading that file. Please try again.');
      }
      // A success switches the workspace's handoff to the new dataset thread
      // (onUploadFile's own job, mirroring onThreadId) — this component has
      // nothing further to render; it is about to unmount.
    } catch {
      setUploadError('Something went wrong reading that file. Please try again.');
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
            text: gatedMessageText(gated),
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
        setError('Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    // Session 87 visual redesign: no frame of its own — the workspace card
    // (workspace.tsx) supplies the border and the header bar. Messages scroll
    // in the middle; the composer sits in a bottom band with the chip row
    // BELOW the input (owner amendment 1). An empty conversation renders
    // nothing above the composer (bare chat, no example chips).
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 tnum">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {messages.map((message, i) => {
          // WP135 ⟨A7⟩: a redacted row replays as ONE muted placeholder — no
          // user+assistant sentinel pair, no envelope (the chat-side isDeleted
          // posture).
          if (message.role === 'redacted') {
            return (
              <div key={i} className="text-left">
                <p className="text-sm italic text-muted-foreground">Deze vraag is verwijderd.</p>
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
                <span className="font-semibold text-muted-foreground">Dit kon ik niet beantwoorden</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                  geen antwoord = geen gok
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
              {message.answerView ? message.answerView.body : message.text}
            </div>
            {/* WP23 (#90): the structural lines an answer's text used to
              * carry inline — nothing may be lost (R5/R11 surfaces). */}
            {/* WP26 mechanism B (ADR 024): the defaulted-axis disclosure. It
              * sits directly under the body and at BODY-adjacent weight, not as
              * muted fine print: it qualifies the number the reader just read
              * ("this is the national figure") and carries the correction path.
              * Burying it would keep the letter of the safelist and lose its
              * point. */}
            {message.answerView?.assumptionLine ? (
              <p className="mt-1 text-sm text-muted-foreground">{message.answerView.assumptionLine}</p>
            ) : null}
            {message.answerView?.stalenessWarning ? (
              <p className="mt-1 text-sm text-warning">{message.answerView.stalenessWarning}</p>
            ) : null}
            {message.answerView?.definitionLine ? (
              <p className="mt-1 text-xs text-muted-foreground">{message.answerView.definitionLine}</p>
            ) : null}
            {/* #39: the alternate-reading disclosure — plain text under the
              * definition it qualifies (the clickable affordance is #89,
              * deliberately not built here). */}
            {message.answerView?.alternatesLine ? (
              <p className="mt-1 text-xs text-muted-foreground">{message.answerView.alternatesLine}</p>
            ) : null}
            {message.answerView?.markingLine ? (
              <p className="mt-1 text-xs text-muted-foreground">{message.answerView.markingLine}</p>
            ) : null}
            {message.answerView ? (
              <div className="mt-1 flex max-w-full flex-wrap items-center gap-2 border-t border-border pt-1">
                {/* WP23 (#71): the voorlopig pill at message level. */}
                {message.provisional ? (
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                    voorlopig
                  </span>
                ) : null}
                {/* WP23 (#90) + #170(1): the source chip — the FULL R4
                  * sentence, always visible; the #86 deep-link now rides the
                  * SourceBadge (table id + measured sync date, same pinned
                  * URL builder). Huisstijl rule 7: attribution stays quiet —
                  * text-xs text-muted-foreground. */}
                <span className="inline-flex max-w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{message.answerView.attribution}</span>
                  <SourceBadge
                    tableId={message.answerView.tableId}
                    source={message.answerView.source}
                    syncedAt={message.answerView.syncedAt}
                  />
                </span>
              </div>
            ) : null}
            {/* WP128 (#128): feedback buttons — only real answers with a
              * stored audit row get them; refusals, clarifications, info
              * messages and answers whose audit write failed (auditId null)
              * do not. Self-contained child: its state and its fail-soft
              * behavior can never affect the answer display above. */}
            {message.kind === 'answer' && message.auditId !== null ? (
              <FeedbackButtons auditId={message.auditId} />
            ) : null}
            {message.cost !== null ? (
              <div className="mt-0.5 text-xs text-muted-foreground tnum">
                {message.cost} credits
                {/* WP20 #82(c): the reply's price, stated AT the clarifying
                  * question — client-side caption; the pipeline's own
                  * deterministic message text stays untouched. */}
                {message.kind === 'clarification' && pricing
                  ? ` · antwoorden op de wedervraag kost ~${pricing.simple} credits`
                  : ''}
              </div>
            ) : null}
            {message.citation !== null || message.csv !== null || message.proof !== null ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-3">
                {/* Session 72 design brief (#70/#79/#89): the drill-through
                  * trigger is FIRST in this row, same label style as the
                  * citation/CSV buttons; its panel (self-managed open state)
                  * wraps onto its own line directly under the row via
                  * basis-full — and `order-last` (orchestrator review round
                  * 1) keeps the trigger/citation/CSV buttons together on the
                  * row's first line regardless of the panel's DOM position,
                  * so opening it pushes nothing out of the row itself, only
                  * the panel wraps beneath — still before the chart / dock
                  * chip / suggestion chips / web section below (D5). */}
                {message.proof !== null ? <AnswerProof proof={message.proof} /> : null}
                {message.citation !== null ? <CopyCitationButton citation={message.citation} /> : null}
                {message.csv !== null ? <DownloadCsvButton csv={message.csv} /> : null}
              </div>
            ) : null}
            {!dockMode && message.chart ? <ChartView spec={message.chart} /> : null}
            {/* WP135 (ADR 033 D4): the in-flow reference chip standing in for a
              * docked visual — clicking activates its dock tab ("in het paneel").
              * The web section still renders below this (ADR 032). */}
            {docked ? (
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
                {message.chart !== null ? 'Grafiek' : 'Kaart'} in het paneel →
              </button>
            ) : null}
            {/* WP29 (#73, ADR 029 D3): follow-up chips — styled exactly like
              * the #75 example chips, and the click handler IS the #75
              * behavior verbatim: fill the input, never send. The user sees
              * the pre-send cost line (#82) and presses Verstuur themselves. */}
            {message.suggestions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
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
                ? 'Bezig met het doorzoeken van CBS-cijfers en het web…'
                : websearch && webSelected
                  ? 'Bezig met het doorzoeken van het web…'
                  : 'Bezig met het doorzoeken van CBS-cijfers…'}
            </div>
            <AnswerSkeleton />
          </>
        ) : null}
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {staleDeploy ? (
          <div className="text-sm text-warning">
            De site is net bijgewerkt, waardoor deze vraag niet is verstuurd (er zijn geen credits
            afgeschreven).{' '}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-medium underline"
            >
              Ververs de pagina
            </button>{' '}
            en stel je vraag daarna opnieuw.
          </div>
        ) : null}
        <div ref={bottomRef} />
        </div>
      </div>
      <div className="shrink-0 border-t border-border px-4 py-3">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
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
            pending && pending.rescueOnly !== true ? pending.questionNl : 'Stel een vraag…'
          }
          className="h-10 flex-1 bg-background px-3.5"
        />
        <Button type="submit" size="lg" className="h-10 px-4" disabled={busy || !input.trim() || nothingSelected}>
          Verstuur
        </Button>
      </form>
      {/* WP129+130 (#129, ADR 032): the source-tags chips — one per registered
        * source (label "<displayName> data", PRE-checked) plus the "Internet"
        * channel (default OFF). Toggle buttons carry aria-pressed; a selected
        * chip is filled, an unselected one outlined (icons are aria-hidden, so
        * the accessible name stays the label). Only shown when the websearch
        * prop is present — a lone CBS chip is the choice-noise the owner
        * rejected. Session 87: the row sits UNDER the input (owner amendment 1)
        * and shares one row with the attachment entry points below. */}
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
                <Database aria-hidden="true" className="size-3.5" />
                {`${SOURCES[key]!.displayName} data`}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={webSelected}
            onClick={() => setWebSelected((v) => !v)}
            className={webSelected ? CHIP_ON : CHIP_OFF}
          >
            <Globe aria-hidden="true" className="size-3.5" />
            Internet
          </button>
        </>
      ) : null}
      {/* #201/#202 (open-questions, session 83 scoping): attachment entry
        * points. "Databron verbinden" stays disabled regardless of
        * `attachments` (D5: OAuth data sources have no backend at all yet)
        * — disabled with an explanatory title rather than removed, so the
        * button honestly signals "coming soon" instead of silently doing
        * nothing or pretending to work (principle c: never fake it).
        * "Link toevoegen" (session 86, owner request) is clickable — it
        * opens the inline URL row below, so the intended flow is visible
        * for demos, but url_html ingest itself still has no backend (WP202b,
        * not built): submitting shows the same honest "not yet" message
        * rather than fetching anything. "Bestand uploaden" is the ADR 037
        * D10 presence-driven exception: enabled ONLY when `attachments` is
        * present; byte-identical to today (same disabled button, same
        * title, no file input in the DOM at all) when it is absent. */}
        <button
          type="button"
          onClick={() => setLinkRowOpen((open) => !open)}
          aria-expanded={linkRowOpen}
          className={CHIP_ACTION}
        >
          <Link2 aria-hidden="true" className="size-3.5" />
          Add link
        </button>
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
              Upload file
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled
            title="Binnenkort beschikbaar: upload een bestand (bijv. PDF)"
            className={CHIP_SOON}
          >
            <Paperclip aria-hidden="true" className="size-3.5" />
            Upload file
          </button>
        )}
        <button
          type="button"
          disabled
          title="Binnenkort beschikbaar: verbind een databron (bijv. Google Sheets)"
          className={CHIP_SOON}
        >
          <Plug aria-hidden="true" className="size-3.5" />
          Connect database
          <Badge aria-hidden="true" variant="outline" className="h-4 px-1 text-[10px] leading-none">
            Soon
          </Badge>
        </button>
      </div>
      {nothingSelected ? (
        <p className="text-xs text-destructive">Selecteer minstens één bron.</p>
      ) : null}
      {linkRowOpen ? (
        <form
          onSubmit={handleLinkSubmit}
          className="flex flex-wrap items-center gap-2"
        >
          <Input
            type="url"
            value={linkUrl}
            onChange={(e) => {
              setLinkUrl(e.target.value);
              setLinkComingSoon(false);
            }}
            placeholder="https://example.com/page-with-a-table"
            className="min-w-0 flex-1 bg-background"
          />
          <Button type="submit" variant="outline" disabled={!linkUrl.trim()}>
            Fetch
          </Button>
        </form>
      ) : null}
      {linkComingSoon ? (
        <p className="text-xs text-muted-foreground">
          This isn&apos;t available yet — coming soon.
        </p>
      ) : null}
      {attachments && uploadBusy ? (
        <p className="text-xs text-muted-foreground">Bestand wordt gelezen…</p>
      ) : null}
      {attachments && uploadError ? (
        <p className="text-xs text-destructive">{uploadError}</p>
      ) : null}
      {/* WP20 #82(a)+(b): pre-send cost line from LIVE pricing + the live
        * balance, and the honest static clarification hint (a
        * confidence-conditional hint is impossible before the parse runs —
        * open-questions #82).
        * ⟨W4⟩ (WP129+130, ADR 032): three variants when the Internet chip is on.
        * The numbers state the TRUE transient hold and are honest about the
        * per-mode net (web-only nets ~10 but 30 is reserved): CBS + internet ⇒
        * "~30 credits (waarvan 10 voor internet)"; web-only ⇒ "~10 credits (er
        * wordt tijdelijk 30 gereserveerd)"; internet off / no websearch prop ⇒
        * unchanged. */}
      {pricing ? (
        <p className="text-xs text-muted-foreground">
          {websearch && webSelected && selectedSources.size > 0
            ? `Een vraag kost ~${pricing.simple + websearch.addonPrice} credits (waarvan ${websearch.addonPrice} voor internet) · saldo: ${pricing.balance} credits. ` +
              `Stel ik eerst een verduidelijkingsvraag, dan kost die ${pricing.clarification} credits en krijg je de rest terug.`
            : websearch && webSelected
              ? `Een vraag kost ~${websearch.addonPrice} credits (er wordt tijdelijk ${pricing.simple + websearch.addonPrice} gereserveerd) · saldo: ${pricing.balance} credits.`
              : `Een vraag kost ~${pricing.simple} credits · saldo: ${pricing.balance} credits. ` +
                `Stel ik eerst een verduidelijkingsvraag, dan kost die ${pricing.clarification} credits en krijg je de rest terug.`}
        </p>
      ) : null}
        </div>
      </div>
    </div>
  );
}
