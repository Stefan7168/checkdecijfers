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

import { useEffect, useRef, useState } from 'react';
import { askQuestion, replyToClarification } from '../app/actions.ts';
import type { AskOutcome } from '../app/actions.ts';
import type { ChartSpec } from '../backend/chart/types.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import type { PendingClarification } from '../backend/answer/respond/types.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import { buildCitation } from '../lib/citation.ts';
import { statCardData } from '../lib/stat-card-data.ts';
import type { StatCardData } from '../lib/stat-card-data.ts';
import { ChartView } from './chart.tsx';
import { StatCard } from './stat-card.tsx';

interface ChatMessage {
  role: 'user' | 'assistant';
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
  /** WP20 #82: lets the cost caption add the reply price under a
   * clarification message. */
  isClarification: boolean;
}

/** WP20 #82: live pricing for the pre-send cost surfaces — read from the
 * pricing tables by the page (ADR 006), threaded via Dashboard. `balance` is
 * the live displayed balance (the #68 state), so the line moves with it. */
export interface ChatPricing {
  simple: number;
  clarification: number;
  balance: number;
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
  const bottomRef = useRef<HTMLDivElement>(null);

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
    if (!text || busy) return;

    setMessages((m) => [
      ...m,
      { role: 'user', text, chart: null, cost: null, citation: null, card: null, isClarification: false },
    ]);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const requestId = crypto.randomUUID();
      const outcome = pending
        ? await replyToClarification(pending, text, requestId)
        : await askQuestion(text, requestId, context);
      applyOutcome(outcome);
      const { gated } = outcome;
      onOutcome?.(gated);

      if (gated.kind !== 'ok') {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: gatedMessageText(gated),
            chart: null,
            cost: null,
            citation: null,
            card: null,
            isClarification: false,
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
          text: response.text,
          chart: response.kind === 'answer' ? response.chart : null,
          cost: gated.netCost,
          citation: response.kind === 'answer' ? buildCitation(response) : null,
          card: response.kind === 'answer' ? statCardData(response) : null,
          isClarification: response.kind === 'clarification',
        },
      ]);
      setPending(response.kind === 'clarification' ? response.pending : null);
    } catch {
      setError('Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[65vh] w-full flex-col rounded border border-zinc-200 p-4">
      <h1 className="mb-4 text-lg font-semibold">Check de Cijfers</h1>
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Stel een vraag over officiële CBS-cijfers, bijvoorbeeld &ldquo;Wat was de inflatie in
            2024?&rdquo;
          </p>
        ) : null}
        {messages.map((message, i) => (
          <div
            key={i}
            className={message.role === 'user' ? 'text-right' : 'text-left'}
          >
            {message.card ? <StatCard data={message.card} /> : null}
            <div
              className={
                'inline-block max-w-full whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ' +
                (message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-900')
              }
            >
              {message.text}
            </div>
            {message.cost !== null ? (
              <div className="mt-0.5 text-xs text-zinc-400">
                {message.cost} credits
                {/* WP20 #82(c): the reply's price, stated AT the clarifying
                  * question — client-side caption; the pipeline's own
                  * deterministic message text stays untouched. */}
                {message.isClarification && pricing
                  ? ` · antwoorden op de wedervraag kost ~${pricing.simple} credits`
                  : ''}
              </div>
            ) : null}
            {message.citation !== null ? (
              <div className="mt-0.5">
                <CopyCitationButton citation={message.citation} />
              </div>
            ) : null}
            {message.chart ? <ChartView spec={message.chart} /> : null}
          </div>
        ))}
        {busy ? (
          <div className="text-left text-sm text-zinc-500">
            Bezig met het doorzoeken van CBS-cijfers…
          </div>
        ) : null}
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        <div ref={bottomRef} />
      </div>
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
          disabled={busy || !input.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Verstuur
        </button>
      </form>
      {/* WP20 #82(a)+(b): pre-send cost line from LIVE pricing + the live
        * balance, and the honest static clarification hint (a
        * confidence-conditional hint is impossible before the parse runs —
        * open-questions #82). */}
      {pricing ? (
        <p className="mt-1 text-xs text-zinc-400">
          {`Een vraag kost ~${pricing.simple} credits · saldo: ${pricing.balance} credits. ` +
            `Stel ik eerst een verduidelijkingsvraag, dan kost die ${pricing.clarification} credits en krijg je de rest terug.`}
        </p>
      ) : null}
    </div>
  );
}
