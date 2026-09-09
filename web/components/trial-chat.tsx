// The #53 trial chat (ADR 036) — the client side of the anonymous homepage
// trial. Deliberately NOT the full Chat component: no threads, no feedback,
// no reply round, no CSV/citation chrome — two served responses in the
// landing's own bubble idiom, then the account nudge. The response `text` is
// the R8-audited string rendered verbatim (R4 attribution and all); an
// answer's chart renders through the SAME ChartView as everywhere else.
'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { TrialAskOutcome } from '../app/trial-actions.ts';
import { useT } from '../lib/i18n/lang-provider.tsx';
import { askTrialQuestion } from '../app/trial-actions.ts';
import { ChartView } from './chart.tsx';

const INPUT_MAX = 500;

interface TrialMessage {
  role: 'user' | 'assistant';
  text: string;
  response: ComposedResponse | null;
}

type Notice = 'pot_empty' | 'ip_limit' | 'used_up' | 'error' | null;

export function LoginNudge({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-muted-foreground">{text}</p>
      <Link
        href="/login"
        className="mt-3 inline-block rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t('common.createFreeAccount')}
      </Link>
    </div>
  );
}

export function TrialChat({ initialQuestionsLeft }: { initialQuestionsLeft: number }) {
  const [messages, setMessages] = useState<TrialMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(initialQuestionsLeft);
  const [notice, setNotice] = useState<Notice>(null);
  const t = useT();
  // From the SHARED catalogue (#184, now folded into messages.ts — WP218
  // phase 4 #219): the landing gate can discover pot_empty, used_up and
  // ip_limit at page render, and this component shows the same states after
  // a submit. Two spellings of one state is the drift this closes.
  const NOTICE_TEXT: Record<Exclude<Notice, null>, string> = {
    pot_empty: t('trial.potEmpty'),
    ip_limit: t('trial.ipLimit'),
    used_up: t('trial.usedUp'),
    error: t('trial.error'),
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const question = input.trim();
    if (question.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: question, response: null }]);
    try {
      const outcome: TrialAskOutcome = await askTrialQuestion(question, crypto.randomUUID());
      if (outcome.kind === 'ok') {
        setMessages((m) => [
          ...m,
          { role: 'assistant', text: outcome.response.text, response: outcome.response },
        ]);
        setLeft(outcome.questionsLeft);
        if (outcome.questionsLeft <= 0) setNotice('used_up');
      } else if (outcome.kind === 'used_up') {
        setNotice('used_up');
      } else if (outcome.kind === 'closed') {
        setNotice(outcome.reason === 'ip_limit' ? 'ip_limit' : 'pot_empty');
      }
      // duplicate_request: a double submit of the same logical question —
      // the first submission's outcome is (or will be) on screen; nothing to add.
    } catch {
      // Server-side the pot was already refunded (trial-actions.ts catch).
      setNotice('error');
    } finally {
      setBusy(false);
    }
  };

  const inputOpen = notice === null || notice === 'error';

  return (
    <div className="space-y-3">
      {messages.map((message, i) =>
        message.role === 'user' ? (
          <div key={i} className="ml-auto max-w-md rounded-lg bg-muted px-4 py-3 text-foreground">
            {message.text}
          </div>
        ) : (
          <div key={i} className="max-w-xl rounded-lg border border-border bg-card px-4 py-3">
            <p className="whitespace-pre-wrap text-foreground">{message.text}</p>
            {message.response?.kind === 'answer' && message.response.chart !== null ? (
              <ChartView spec={message.response.chart} />
            ) : null}
            {message.response?.kind === 'clarification' ? (
              // ADR 036 D5 (build revision 1): the trial has no reply round —
              // the clarification is read-only; doorvragen needs an account
              // (or the visitor's next trial question, better phrased).
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                {t('trial.clarificationPrefix')}
                <Link href="/login" className="text-primary hover:text-primary/80">
                  {t('trial.createAccountInline')}
                </Link>
                .
              </p>
            ) : null}
          </div>
        ),
      )}

      {notice !== null && notice !== 'error' ? (
        <LoginNudge text={NOTICE_TEXT[notice]} />
      ) : (
        <>
          {notice === 'error' ? <p className="text-sm text-warning">{NOTICE_TEXT.error}</p> : null}
          <form onSubmit={submit} className="flex gap-2">
            <input
              type="text"
              value={input}
              maxLength={INPUT_MAX}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('trial.inputPlaceholder')}
              aria-label={t('trial.inputAriaLabel')}
              disabled={busy}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <button
              type="submit"
              disabled={busy || input.trim().length === 0}
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {busy ? t('trial.submitBusy') : t('trial.submitIdle')}
            </button>
          </form>
          <p className="text-xs text-muted-foreground">
            <span className="tnum">{left}</span> {t('trial.of')} <span className="tnum">2</span>{' '}
            {t('trial.freeQuestionsLeft')}
          </p>
        </>
      )}
    </div>
  );
}
