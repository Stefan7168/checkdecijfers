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
import { TRIAL_COPY } from '../lib/trial-copy.ts';
import { LoginNudge, TrialChat } from './trial-chat.tsx';

/** One line per non-open gate state, taken from the SHARED copy (#184) so the
 * sentence a visitor reads at page render is byte-identical to the one the
 * action would show them a round-trip later. The 'closed' copy names the cause
 * because the pot was actually READ and was empty; 'unavailable' deliberately
 * does not, because in that state we do not know why (see TrialGateState in
 * lib/trial.ts — until 2026-07-25 both shared the pot-is-empty sentence, which
 * during a #173 pooler exhaustion told every visitor something untrue). */
const NUDGE_TEXT = {
  used_up: TRIAL_COPY.used_up,
  closed: TRIAL_COPY.pot_empty,
  unavailable: TRIAL_COPY.unavailable,
  ip_limit: TRIAL_COPY.ip_limit,
} as const;

export async function TrialGate() {
  const state = await getTrialGateState();
  if (state.kind === 'dormant') return null;
  return (
    <section className="border-b border-line py-12">
      <h2 className="text-2xl text-ink">Probeer het direct</h2>
      <p className="mt-3 max-w-xl text-ink-soft">
        Twee gratis proefvragen, zonder account. Elk antwoord komt uit officiële
        CBS-cijfers, met bron en datum erbij.
      </p>
      <div className="mt-6">
        {state.kind === 'open' ? (
          <TrialChat initialQuestionsLeft={state.questionsLeft} />
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
