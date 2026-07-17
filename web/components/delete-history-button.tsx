// #14 (GDPR self-service deletion, WP14): "Verwijder mijn vraaggeschiedenis"
// in the account/dashboard area. Owner-decided UX (session 23): one click
// then a confirmation step -- an inline confirm, NOT a typed-word
// confirmation. Calls deleteMyQuestionHistory (web/app/actions.ts), which
// re-verifies the session server-side (getClaims) and scopes the delete to
// the CALLING user only -- this component never sends a user id itself.
//
// After a successful delete the page is reloaded (window.location.reload(),
// the same convention chat.tsx's stale-deploy "Ververs de pagina" button
// already uses -- no next/navigation router dependency, so this component
// drops cleanly into any tree, including the existing AccountPanel/Dashboard
// tests that render no app-router context) so the Server Component
// question-history list re-fetches and shows the "verwijderde vraag"
// placeholder rows the redacted rows now render as
// (web/components/question-history.tsx) -- no client-side list state to keep
// in sync here.
'use client';

import { useState } from 'react';
import { deleteMyQuestionHistory } from '../app/actions.ts';

type Stage = 'idle' | 'confirming' | 'deleting' | 'error';

export function DeleteHistoryButton() {
  const [stage, setStage] = useState<Stage>('idle');

  async function handleConfirm(): Promise<void> {
    setStage('deleting');
    try {
      await deleteMyQuestionHistory();
      window.location.reload();
    } catch (error) {
      console.error('deleteMyQuestionHistory failed:', error);
      setStage('error');
    }
  }

  if (stage === 'confirming' || stage === 'deleting') {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-danger bg-paper-sunken p-3 text-sm">
        <p className="text-danger">
          Weet je het zeker? Je vraagteksten worden permanent verwijderd. Dit kan niet ongedaan
          worden gemaakt.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={stage === 'deleting'}
            className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {stage === 'deleting' ? 'Bezig…' : 'Ja, verwijder'}
          </button>
          <button
            type="button"
            onClick={() => setStage('idle')}
            disabled={stage === 'deleting'}
            className="rounded-md border border-line-strong bg-paper-raised px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-sunken disabled:opacity-60"
          >
            Annuleren
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setStage('confirming')}
        className="text-left text-xs text-danger underline"
      >
        Verwijder mijn vraaggeschiedenis
      </button>
      {stage === 'error' ? (
        <p role="alert" className="text-xs text-danger">
          Verwijderen is niet gelukt. Probeer het later opnieuw.
        </p>
      ) : null}
    </div>
  );
}
