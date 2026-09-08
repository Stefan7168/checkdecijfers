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
import { useT } from '../lib/i18n/lang-provider.tsx';
import { Button } from './ui/button.tsx';

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
  const t = useT();

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

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={chosen === 'up' ? 'secondary' : 'outline'}
          size="icon-xs"
          aria-label={t('feedback.helpful')}
          aria-pressed={chosen === 'up'}
          disabled={busy}
          onClick={() => send('up')}
        >
          👍
        </Button>
        <Button
          type="button"
          variant={chosen === 'down' ? 'secondary' : 'outline'}
          size="icon-xs"
          aria-label={t('feedback.notHelpful')}
          aria-pressed={chosen === 'down'}
          disabled={busy}
          onClick={() => setPanelOpen(true)}
        >
          👎
        </Button>
        {status === 'thanks' ? (
          <span className="text-xs text-muted-foreground">{t('feedback.thanks')}</span>
        ) : null}
        {status === 'failed' ? (
          <span className="text-xs text-muted-foreground">{t('feedback.failed')}</span>
        ) : null}
      </div>
      {panelOpen ? (
        <div className="mt-2 flex max-w-md flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('feedback.textPlaceholder')}
            maxLength={2000}
            rows={3}
            className="w-full rounded-md border border-border bg-card p-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => send('down', text.trim() === '' ? undefined : text)}
            >
              {t('feedback.submitWithText')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => send('down')}
            >
              {t('feedback.skip')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
