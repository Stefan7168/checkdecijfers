// The #53 trial's visitor-facing copy, in ONE place (ADR 036).
//
// Why this file exists (#184). Every one of these sentences describes a STATE,
// and each state can now be discovered at two different moments: by the landing
// gate at page render, or by the Server Action one round-trip later. Before
// this file, three of them were written out twice — once in `trial.tsx`'s
// NUDGE_TEXT (server) and once in `trial-chat.tsx`'s NOTICE_TEXT (client) —
// which is the drift shape this project keeps re-closing: a state that says one
// thing when the page loads and a subtly different thing when you press send.
// #184 was about to add a fourth duplicate pair, so the copy is single-sourced
// instead.
//
// Deliberately dependency-free: a CLIENT component imports this, so it must not
// reach `web/lib/trial.ts` (node:crypto, next/headers) even transitively.
export const TRIAL_COPY = {
  /** The pot was READ and is empty. Only a state that actually read it may say
   * so — see TrialGateState in trial.ts for why 'unavailable' exists beside it.
   * Since #186 that reading may be up to TRIAL_POT_TTL_MS old, so "op dit
   * moment" means "when we last looked, seconds ago" — an observed fact of
   * bounded age, not an unverified cause. */
  pot_empty:
    'Het gratis proefpotje is op dit moment leeg. Log in om verder te gaan — een account is gratis.',
  /** We could not determine the pot state. Names NO cause, because we have none. */
  unavailable:
    'De gratis proefvragen zijn nu even niet beschikbaar. Log in om verder te gaan — een account is gratis.',
  /** THIS visitor's own budget is spent. */
  used_up: 'Je hebt je gratis proefvragen gebruikt. Maak een gratis account om verder te gaan.',
  /** The per-IP backstop for this NETWORK is spent for the rolling 24h window.
   * Attributes to the network and never to the person — behind CGNAT or an
   * office NAT the visitor genuinely did nothing, and telling them otherwise
   * would be both rude and untrue. Says nothing about how we count, either. */
  ip_limit:
    'Vanaf dit netwerk zijn de gratis proefvragen voor vandaag op. Maak een gratis account om verder te gaan.',
  /** The pipeline threw before anything was shown; the question was refunded. */
  error: 'Er ging iets mis; je proefvraag is niet verbruikt. Probeer het zo nog eens.',
} as const;
