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
import { sourceLinkLabel, sourceTableUrl } from '../lib/statline.ts';
import { ChartView } from './chart.tsx';
import { FeedbackButtons } from './feedback-buttons.tsx';
import { StatCard } from './stat-card.tsx';

/** WP23 (#75): clickable examples on the empty chat — each a benchmark-
 * proven answerable shape. Clicking FILLS the input, never auto-sends: the
 * user sees the #82 cost line and presses Verstuur themselves. */
const EXAMPLE_QUESTIONS = [
  'Wat was de inflatie in 2024?',
  'Hoeveel inwoners heeft Nederland?',
  'Maak een grafiek van de inflatie van 2020 tot en met 2024.',
] as const;

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
    return <p className="mt-2 text-xs text-zinc-500">{line}</p>;
  }
  return (
    <div className="mt-2 max-w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
      <p className="mb-1 font-medium text-zinc-500">{WEB_SECTION_HEADER}</p>
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
        className="text-xs text-zinc-400 underline"
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
        <span className="text-xs text-red-600">Downloaden lukte niet in deze browser.</span>
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
      className="text-xs text-zinc-400 underline"
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
  // ⟨A6⟩: the threadId captured ALONGSIDE `pending` at question time — a reply
  // attaches to ITS clarification's originating thread, never the sidebar's
  // currently-active one. Cleared with pending on a thread switch.
  const [capturedThreadId, setCapturedThreadId] = useState<number | null>(null);
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
    setCapturedThreadId(null);
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
      { role: 'user', kind: null, text, chart: null, cost: null, citation: null, card: null, csv: null, answerView: null, provisional: false, suggestions: [], auditId: null, webSection: null },
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
      // rawThreadId argument — the current thread for a question, the CAPTURED
      // thread for a reply. Non-thread-aware call sites (Dashboard, tests) omit
      // it, keeping their exact 3-/4-argument shapes byte-identical.
      let outcome: AskOutcome;
      if (pending) {
        outcome = threadAware
          ? await replyToClarification(pending, text, requestId, selection, capturedThreadId)
          : websearch
            ? await replyToClarification(pending, text, requestId, selection)
            : await replyToClarification(pending, text, requestId);
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
            answerView: null,
            provisional: false,
            suggestions: [],
            auditId: null,
            webSection: null,
          },
        ]);
        // None of these kinds change the pending clarification state;
        // `finally` below still clears `busy`.
        return;
      }

      const { response } = gated;
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
          answerView:
            response.kind === 'answer'
              ? {
                  body: response.answer.body,
                  stalenessWarning: response.stalenessWarning,
                  definitionLine: response.answer.definitionLine,
                  markingLine: response.answer.markingLine,
                  attribution: response.answer.attributionLine,
                  tableId: response.result.attribution.tableId,
                  source: response.result.attribution.source,
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
          suggestions:
            response.kind === 'answer' || response.kind === 'refusal'
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
        },
      ]);
      // ⟨A6⟩: capture the thread this clarification attached to, alongside
      // `pending`, so the reply binds to it regardless of any later sidebar
      // switch (which clears both via the loadNonce reset).
      if (response.kind === 'clarification') {
        setPending(response.pending);
        setCapturedThreadId(outcome.threadId);
      } else {
        setPending(null);
        setCapturedThreadId(null);
      }
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
    <div className="flex h-[65vh] w-full flex-col rounded border border-zinc-200 p-4">
      <h1 className="mb-4 text-lg font-semibold">Check de Cijfers</h1>
      <div className="flex-1 space-y-3 overflow-y-auto tabular-nums">
        {messages.length === 0 ? (
          <div>
            <p className="text-sm text-zinc-500">
              Stel een vraag over officiële CBS-cijfers, bijvoorbeeld:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => setInput(question)}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((message, i) => {
          // WP135 ⟨A7⟩: a redacted row replays as ONE muted placeholder — no
          // user+assistant sentinel pair, no envelope (the chat-side isDeleted
          // posture).
          if (message.role === 'redacted') {
            return (
              <div key={i} className="text-left">
                <p className="text-sm italic text-zinc-400">Deze vraag is verwijderd.</p>
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
            className={message.role === 'user' ? 'text-right' : 'text-left'}
          >
            {!dockMode && message.card ? <StatCard data={message.card} /> : null}
            {/* WP23 (#84): a refusal announces itself — the two fixed Dutch
              * strings from the owner-approved row. */}
            {message.kind === 'refusal' ? (
              <div className="mb-0.5 flex items-center gap-2 text-xs">
                <span className="font-semibold text-zinc-700">Dit kon ik niet beantwoorden</span>
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-zinc-600">
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
            <div
              className={
                'inline-block max-w-full whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ' +
                (message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : message.kind === 'clarification'
                    ? 'border border-amber-200 bg-amber-50 text-zinc-900'
                    : message.kind === 'refusal'
                      ? 'border border-zinc-200 bg-zinc-50 text-zinc-900'
                      : 'bg-zinc-100 text-zinc-900')
              }
            >
              {message.answerView ? message.answerView.body : message.text}
            </div>
            {/* WP23 (#90): the structural lines an answer's text used to
              * carry inline — nothing may be lost (R5/R11 surfaces). */}
            {message.answerView?.stalenessWarning ? (
              <p className="mt-1 text-sm text-amber-700">{message.answerView.stalenessWarning}</p>
            ) : null}
            {message.answerView?.definitionLine ? (
              <p className="mt-1 text-xs text-zinc-600">{message.answerView.definitionLine}</p>
            ) : null}
            {message.answerView?.markingLine ? (
              <p className="mt-1 text-xs text-zinc-600">{message.answerView.markingLine}</p>
            ) : null}
            {message.answerView ? (
              <div className="mt-1 flex max-w-full flex-wrap items-center gap-2">
                {/* WP23 (#71): the voorlopig pill at message level. */}
                {message.provisional ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    voorlopig
                  </span>
                ) : null}
                {/* WP23 (#90+#86): the source chip — the FULL R4 sentence,
                  * always visible, plus the StatLine deep-link. */}
                <span className="inline-flex max-w-full flex-wrap items-center gap-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-500">
                  <span>{message.answerView.attribution}</span>
                  {sourceTableUrl(message.answerView.source, message.answerView.tableId) !== null ? (
                    <a
                      href={sourceTableUrl(message.answerView.source, message.answerView.tableId)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 underline"
                    >
                      {sourceLinkLabel(message.answerView.source)}
                    </a>
                  ) : null}
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
              <div className="mt-0.5 text-xs text-zinc-400 tabular-nums">
                {message.cost} credits
                {/* WP20 #82(c): the reply's price, stated AT the clarifying
                  * question — client-side caption; the pipeline's own
                  * deterministic message text stays untouched. */}
                {message.kind === 'clarification' && pricing
                  ? ` · antwoorden op de wedervraag kost ~${pricing.simple} credits`
                  : ''}
              </div>
            ) : null}
            {message.citation !== null || message.csv !== null ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-3">
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
                  'mt-2 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ' +
                  (activeVisualId === visualId(i)
                    ? 'border-zinc-500 bg-zinc-200 text-zinc-900'
                    : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50')
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
                    onClick={() => setInput(question)}
                    className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
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
          <div className="text-left text-sm text-zinc-500">
            {/* WP129+130 go-live feedback (owner, 2026-07-12): with the Internet
              * chip on, the wait covers the web search too — say so honestly.
              * Web-only (CBS deselected) names only the web. */}
            {websearch && webSelected && selectedSources.size > 0
              ? 'Bezig met het doorzoeken van CBS-cijfers en het web…'
              : websearch && webSelected
                ? 'Bezig met het doorzoeken van het web…'
                : 'Bezig met het doorzoeken van CBS-cijfers…'}
          </div>
        ) : null}
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        {staleDeploy ? (
          <div className="text-sm text-amber-700">
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
      {/* WP129+130 (#129, ADR 032): the source-tags chips — one per registered
        * source (label "<displayName> data", PRE-checked) plus the "Internet"
        * channel (default OFF). Toggle buttons carry aria-pressed; selected
        * chips get the FeedbackButtons active-state styling + a trailing ✕
        * affordance (aria-hidden, so the accessible name stays the label). Only
        * shown when the websearch prop is present — a lone CBS chip is the
        * choice-noise the owner rejected. */}
      {websearch ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {Object.keys(SOURCES).map((key) => {
            const active = selectedSources.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleSource(key)}
                className={
                  'rounded-full border px-3 py-1 text-xs ' +
                  (active
                    ? 'border-zinc-500 bg-zinc-200 text-zinc-900'
                    : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50')
                }
              >
                {`${SOURCES[key]!.displayName} data`}
                {active ? <span aria-hidden="true"> ✕</span> : null}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={webSelected}
            onClick={() => setWebSelected((v) => !v)}
            className={
              'rounded-full border px-3 py-1 text-xs ' +
              (webSelected
                ? 'border-zinc-500 bg-zinc-200 text-zinc-900'
                : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50')
            }
          >
            Internet
            {webSelected ? <span aria-hidden="true"> ✕</span> : null}
          </button>
        </div>
      ) : null}
      {nothingSelected ? (
        <p className="mt-1 text-xs text-red-600">Selecteer minstens één bron.</p>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          maxLength={500}
          placeholder={pending ? pending.questionNl : 'Stel een vraag…'}
          className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100"
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || nothingSelected}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Verstuur
        </button>
      </form>
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
        <p className="mt-1 text-xs text-zinc-400">
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
  );
}
