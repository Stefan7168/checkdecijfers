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
import type { ChartSpec } from '../backend/chart/types.ts';
import type { PendingClarification } from '../backend/answer/respond/types.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import { ChartView } from './chart.tsx';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  chart: ChartSpec | null;
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

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingClarification | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setMessages((m) => [...m, { role: 'user', text, chart: null }]);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const requestId = crypto.randomUUID();
      const result = pending
        ? await replyToClarification(pending, text, requestId)
        : await askQuestion(text, requestId);

      if (result.kind !== 'ok') {
        setMessages((m) => [...m, { role: 'assistant', text: gatedMessageText(result), chart: null }]);
        // None of these kinds change the pending clarification state;
        // `finally` below still clears `busy`.
        return;
      }

      const { response } = result;
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: response.text,
          chart: response.kind === 'answer' ? response.chart : null,
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
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col p-4">
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
            <div
              className={
                'inline-block max-w-full whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ' +
                (message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-900')
              }
            >
              {message.text}
            </div>
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
    </div>
  );
}
