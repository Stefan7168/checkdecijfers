// The #53 trial section on the public landing (ADR 036) — server side.
// Dormancy contract: while TRIAL_ENABLED/key/secret are unset the section
// renders NOTHING at all (byte-identical landing, deploy-order-safe — the
// WP129/WP135 pattern). Once configured, the gate state is computed PER
// REQUEST — with one qualification since #186: the POT half is served from a
// short in-process cache (TRIAL_POT_TTL_MS, ../lib/trial.ts), so a pot refill
// re-opens the trial without a deploy to within that TTL, while everything
// derived from the VISITOR stays live on every request. An empty pot degrades
// to the login prompt — the owner's continuity fail-safe, the site never breaks.
import { Suspense } from 'react';
import { getTrialGateState, trialConfigured } from '../lib/trial.ts';
import { getLang } from '../lib/i18n/server.ts';
import { t } from '../lib/i18n/messages.ts';
import { LoginNudge, TrialChat } from './trial-chat.tsx';

export async function TrialGate() {
  const [state, lang] = await Promise.all([getTrialGateState(), getLang()]);
  if (state.kind === 'dormant') return null;
  // One line per non-open gate state, taken from the SHARED catalogue (#184,
  // now folded into messages.ts — WP218 phase 4 #219) so the sentence a
  // visitor reads at page render is byte-identical to the one the action
  // would show them a round-trip later. The 'closed' copy names the cause
  // because the pot was actually READ and was empty; 'unavailable'
  // deliberately does not, because in that state we do not know why (see
  // TrialGateState in lib/trial.ts — until 2026-07-25 both shared the
  // pot-is-empty sentence, which during a #173 pooler exhaustion told every
  // visitor something untrue).
  const NUDGE_TEXT = {
    closed: t(lang, 'trial.potEmpty'),
    unavailable: t(lang, 'trial.unavailable'),
    ip_limit: t(lang, 'trial.ipLimit'),
  } as const;
  return (
    <section className="border-b border-border py-12">
      <h2 className="text-2xl text-foreground">{t(lang, 'trial.heading')}</h2>
      <p className="mt-3 max-w-xl text-muted-foreground">{t(lang, 'trial.subheading')}</p>
      <div className="mt-6">
        {state.kind === 'open' ? (
          <TrialChat initialQuestionsLeft={state.questionsLeft} />
        ) : state.kind === 'used_up' ? (
          // Row 1 (session 110 UX audit pass 2): a Server Action call from
          // TrialChat implicitly refreshes this Server Component, and it used
          // to swap TrialChat out for a bare LoginNudge the instant
          // questionsLeft hit 0 — unmounting the client message list and
          // discarding the very answer the visitor's last question paid for.
          // TrialChat already renders this exact nudge itself (see its own
          // `used_up` notice); handing it the notice as an initial prop, INSTEAD
          // of swapping components, keeps the transcript mounted across the
          // refresh. The other non-open states never had a transcript to lose
          // (the visitor is capped before ever chatting), so only this one
          // branch needed to change.
          <TrialChat initialQuestionsLeft={0} initialNotice="used_up" />
        ) : (
          <LoginNudge text={NUDGE_TEXT[state.kind]} />
        )}
      </div>
    </section>
  );
}

export function TrialSectie() {
  // The flag check ALSO lives here, synchronously: while dormant the landing
  // must not even mount a Suspense boundary for this (byte-identical).
  if (!trialConfigured()) return null;
  return (
    <Suspense fallback={null}>
      <TrialGate />
    </Suspense>
  );
}
