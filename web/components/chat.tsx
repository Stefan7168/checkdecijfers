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
import type { ChartSpec } from '../backend/chart/types.ts';
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
import type { StatCardData } from '../lib/stat-card-data.ts';
import { sourceLinkLabel, sourceTableUrl } from '../lib/statline.ts';
import { ChartView } from './chart.tsx';
import { FeedbackButtons } from './feedback-buttons.tsx';
import { StatCard } from './stat-card.tsx';

/** WP23 (#90/#84): an answer renders from its STRUCTURAL fields — body in
 * the bubble, staleness/definition/marking as their own lines, attribution
 * as a chip with the #86 StatLine link. Zero loss by construction: these are
 * exactly the fields compose.ts assembles `text` from; `text` itself (the
 * R8 audit string) is untouched server-side. */
interface AnswerView {
  body: string;
  stalenessWarning: string | null;
  definitionLine: string | null;
  markingLine: string | null;
  /** The full R4 attribution sentence — ALWAYS visible on the chip, never
   * behind a click. */
  attribution: string;
  tableId: string;
  /** Source-registry key for the deep link + label (WP30a); absent on
   * answers stored before WP30a → resolves to 'cbs' (A1). */
  source?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  /** WP23 (#84): message-type styling. Null on user messages; 'info' for
   * the gated non-'ok' kinds. */
  kind: 'answer' | 'clarification' | 'refusal' | 'info' | null;
  text: string;
  chart: ChartSpec | null;
  /** Credits charged for this turn (GatedResponse.netCost) -- null on user
   * messages and on any non-'ok' gated outcome (nothing was charged). */
  cost: number | null;
  /** WP20 #78: the ready-to-paste quote — built once at receive time from
   * the validated answer envelope; null on non-answers. */
  citation: string | null;
  /** WP20 #80: single-number card data; null unless the answer is a
   * single-cell result (stat-card-data.ts decides). */
  card: StatCardData | null;
  /** WP21 #52: the exported data file — built once at receive time from the
   * validated envelope (csv.ts); null on non-answers. */
  csv: AnswerCsv | null;
  /** WP23 (#90): structural answer rendering; null on non-answers. */
  answerView: AnswerView | null;
  /** WP23 (#71): any quoted cell is provisional — the amber pill. */
  provisional: boolean;
  /** WP29 (#73, ADR 029): servability-gated follow-up chips under an answer.
   * Every text passed the server-side dry-run gate this request; clicking
   * FILLS the input (the #75 convention — never sends). [] on user messages
   * and non-answers. */
  suggestions: string[];
  /** WP128 (#128): the audit_answers row id this answer was stored under —
   * the anchor the feedback buttons write against. Transient CLIENT state
   * only (it rides the action result OUTSIDE the R8-stored envelope). Null
   * on user messages, non-answers, and when the audit write failed. */
  auditId: number | null;
  /** WP129+130 (#130, ADR 032): the unverified-web augmentation outcome for
   * THIS turn, read from `gated.response.webSection ?? null` (the deploy-skew
   * guard pattern). Rendered BELOW everything else in the bubble, keyed on
   * this FIELD VALUE (never message.kind) — an 'ok' section shows the findings
   * block, a 'failed' section one honest line, null nothing. Null on user
   * messages, non-'ok' gated outcomes, and turns that owed no web attempt. */
  webSection: WebSection | null;
}

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
}: { onOutcome?: (gated: GatedResponse) => void; pricing?: ChatPricing } = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingClarification | null>(null);
  // WP15 (ADR 021): the structured referent carried between turns. Held
  // exactly like `pending` (client-held React state, sent back verbatim on
  // the next submit) but updated only on an 'ok' outcome that itself
  // produced a context — any other outcome (a gated non-'ok' kind, or an
  // 'ok' response with no honest referent, e.g. a clarification) leaves the
  // held context untouched, so a smalltalk/refusal detour never erases it.
  const [context, setContext] = useState<ConversationContext | null>(null);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || nothingSelected) return;

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
      const outcome = pending
        ? websearch
          ? await replyToClarification(pending, text, requestId, selection)
          : await replyToClarification(pending, text, requestId)
        : websearch
          ? await askQuestion(text, requestId, context, selection)
          : await askQuestion(text, requestId, context);
      applyOutcome(outcome);
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
          kind:
            response.kind === 'refusal' &&
            (response.reason === 'meta' ||
              response.reason === 'smalltalk' ||
              response.reason === 'onboarding_pending' ||
              response.reason === 'onboarding_already_pending')
              ? 'info'
              : response.kind,
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
          // WP29: `?? []` guards the deploy-window skew only (an old server
          // process serving a new client bundle omits the field); a current
          // server always sets it.
          suggestions: response.kind === 'answer' ? (response.suggestions ?? []) : [],
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
      setPending(response.kind === 'clarification' ? response.pending : null);
    } catch (err) {
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
        {messages.map((message, i) => (
          <div
            key={i}
            className={message.role === 'user' ? 'text-right' : 'text-left'}
          >
            {message.card ? <StatCard data={message.card} /> : null}
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
            {message.chart ? <ChartView spec={message.chart} /> : null}
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
        ))}
        {busy ? (
          <div className="text-left text-sm text-zinc-500">
            Bezig met het doorzoeken van CBS-cijfers…
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
