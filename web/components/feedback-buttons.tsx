'use client';
// WP128 (#128): 👍/👎 on one answer message + an INLINE free-text panel on 👎
// (no modal — the delete-history-button inline-confirm precedent). Self-
// contained per message: own state, receives the audit-row id and the server
// action as a prop-injectable seam (tests inject a fake; chat.tsx uses the
// real action). The verdict is CHANGEABLE (the store upserts, last write
// wins) — aria-pressed carries the toggle state for assistive tech.
//
// Fail-soft mirror of the action: a failed submit shows the muted Dutch
// line, resets busy so retry stays possible, and never touches the answer
// display above it.
import { useState } from 'react';
import { submitAnswerFeedback } from '../app/actions.ts';

type Verdict = 'up' | 'down';

export function FeedbackButtons({
  auditId,
  submit = submitAnswerFeedback,
}: {
  auditId: number;
  submit?: (auditId: number, verdict: Verdict, feedbackText?: string) => Promise<{ ok: boolean }>;
}) {
  const [chosen, setChosen] = useState<Verdict | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'thanks' | 'failed'>('idle');

  async function send(verdict: Verdict, feedbackText?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await submit(auditId, verdict, feedbackText);
      if (result.ok) {
        setChosen(verdict);
        setStatus('thanks');
        setPanelOpen(false);
        setText('');
      } else {
        setStatus('failed');
      }
    } catch {
      setStatus('failed');
    } finally {
      // Busy always resets — a failure must leave retry possible.
      setBusy(false);
    }
  }

  const buttonClass = (active: boolean) =>
    'rounded-full border px-2 py-0.5 text-xs ' +
    (active
      ? 'border-zinc-500 bg-zinc-200 text-zinc-900'
      : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50');

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Nuttig antwoord"
          aria-pressed={chosen === 'up'}
          disabled={busy}
          onClick={() => send('up')}
          className={buttonClass(chosen === 'up')}
        >
          👍
        </button>
        <button
          type="button"
          aria-label="Niet nuttig"
          aria-pressed={chosen === 'down'}
          disabled={busy}
          onClick={() => setPanelOpen(true)}
          className={buttonClass(chosen === 'down')}
        >
          👎
        </button>
        {status === 'thanks' ? (
          <span className="text-xs text-zinc-500">Bedankt voor je feedback.</span>
        ) : null}
        {status === 'failed' ? (
          <span className="text-xs text-zinc-500">Feedback kon niet worden opgeslagen.</span>
        ) : null}
      </div>
      {panelOpen ? (
        <div className="mt-2 flex max-w-md flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Wat kon beter? (optioneel)"
            maxLength={2000}
            rows={3}
            className="w-full rounded border border-zinc-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => send('down', text.trim() === '' ? undefined : text)}
              className="rounded bg-zinc-700 px-3 py-1 text-xs text-white disabled:opacity-50"
            >
              Verstuur feedback
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => send('down')}
              className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              Overslaan
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
