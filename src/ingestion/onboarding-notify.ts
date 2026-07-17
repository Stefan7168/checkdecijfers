// On-demand onboarding email notifications (WP16 sub-part 2, ADR 026,
// design §3). Best-effort: the dashboard is the record (design §5), so a
// notification failure NEVER fails the job or blocks a terminal transition —
// it is logged and swallowed. The email SENDER is injected (design §3) so
// tests stub it (the Stripe-signature test pattern); production wires the
// Resend HTTP call.
//
// Deterministic Dutch templates only — never LLM-generated copy (CLAUDE.md:
// Dutch product copy is templates). Three outcomes: delivered / unanswerable-
// refunded / failed-refunded.
import type { Db } from '../db/types.ts';

export type OnboardingNotifyOutcome = 'delivered' | 'unanswerable' | 'failed';

export interface OnboardingNotifyEvent {
  userId: string;
  questionText: string;
  topicTerm: string;
  outcome: OnboardingNotifyOutcome;
  /** Owner-readable reason for a failed/unanswerable outcome (the pending
   * row's failure_summary). Null on delivered. */
  failureSummary: string | null;
  /** The credits refunded on a failed/unanswerable outcome (the onboarding
   * price the job actually read from the DB and compensated) — never inlined,
   * so the email can name the true amount. Null on delivered (no refund). */
  refundedCredits: number | null;
}

/** One transactional email. The injected sender receives exactly this; the
 * production sender maps it onto the Resend HTTP payload. */
export interface OnboardingEmail {
  to: string;
  subject: string;
  text: string;
}

/** Injected email sender (design §3). Returns nothing; a throw is caught by the
 * notifier and logged, never propagated (best-effort). */
export type SendEmailFn = (email: OnboardingEmail) => Promise<void>;

/** The job calls this after a terminal transition. Resolves the recipient,
 * builds the Dutch template, sends — all best-effort. */
export type NotifyFn = (event: OnboardingNotifyEvent) => Promise<void>;

const FROM_ADDRESS = 'noreply@mail.checkdecijfers.nl';

/** Normalizes an app origin for the deep-link paragraph: strip any trailing
 * slashes, then append exactly one, so 'https://x.nl' and 'https://x.nl/'
 * both produce '{origin}/' (#116). */
function dashboardUrl(appOrigin: string): string {
  return `${appOrigin.replace(/\/+$/, '')}/`;
}

/** Deterministic Dutch bodies. No digits appear in these templates (nothing to
 * fabricate), and they never quote a data value — they point the user back to
 * the chat, where the audited answer lives.
 *
 * `appOrigin` (#116) is optional and fail-soft: when null (the default), a
 * body is byte-identical to the pre-#116 template — no origin, no link. When
 * given, a final paragraph is appended pointing back at the dashboard root
 * (a per-answer deep link stays future work — see open-questions #116). */
export function buildEmail(
  to: string,
  event: OnboardingNotifyEvent,
  appOrigin: string | null = null,
): OnboardingEmail {
  const topic = event.topicTerm;
  switch (event.outcome) {
    case 'delivered':
      return {
        to,
        subject: `Je cijfers over "${topic}" staan klaar`,
        text:
          `Goed nieuws! We hebben de cijfers over "${topic}" opgehaald bij het CBS en gecontroleerd. ` +
          `Je vraag is beantwoord — open de chat om het antwoord te bekijken.\n\n` +
          `Je vraag was: "${event.questionText}"` +
          (appOrigin !== null ? `\n\nBekijk je antwoord: ${dashboardUrl(appOrigin)}` : ''),
      };
    case 'unanswerable': {
      const refund = event.refundedCredits === null ? 'De credits zijn' : `De ${event.refundedCredits} credits zijn`;
      return {
        to,
        subject: `We konden je vraag over "${topic}" toch niet beantwoorden`,
        text:
          // Fetch-neutral phrasing (session-50 review): this event also fires
          // on paths where NOTHING was fetched (fit-gate no_fit, the #166
          // curated-table belt) — the copy must never claim "opgehaald" then.
          `We hebben geprobeerd je vraag over "${topic}" met CBS-cijfers te beantwoorden, maar dat ` +
          `lukte niet betrouwbaar. ${refund} volledig teruggestort.\n\n` +
          `Je vraag was: "${event.questionText}"\n` +
          (event.failureSummary ? `\nToelichting: ${event.failureSummary}` : '') +
          (appOrigin !== null ? `\n\nBekijk de status in je dashboard: ${dashboardUrl(appOrigin)}` : ''),
      };
    }
    case 'failed': {
      const refund = event.refundedCredits === null ? 'De credits zijn' : `De ${event.refundedCredits} credits zijn`;
      return {
        to,
        subject: `Het ophalen van cijfers over "${topic}" is niet gelukt`,
        text:
          `Het is helaas niet gelukt om de cijfers over "${topic}" op te halen bij het CBS. ` +
          `${refund} volledig teruggestort.\n\n` +
          `Je vraag was: "${event.questionText}"\n` +
          (event.failureSummary ? `\nToelichting: ${event.failureSummary}` : '') +
          (appOrigin !== null ? `\n\nBekijk de status in je dashboard: ${dashboardUrl(appOrigin)}` : ''),
      };
    }
  }
}

/** Looks up the requester's email. Supabase's auth.users holds it in
 * production; the table does not exist in the hermetic PGlite schema, so this
 * returns null there (the notifier then skips — no recipient, no send).
 * Defensive by design: a missing table / lookup error must never fail the
 * job. */
export async function resolveRecipientEmail(db: Db, userId: string): Promise<string | null> {
  try {
    const { rows } = await db.query('select email from auth.users where id = $1', [userId]);
    const email = rows[0]?.email;
    return typeof email === 'string' && email.length > 0 ? email : null;
  } catch {
    return null;
  }
}

export interface NotifierDeps {
  db: Db;
  /** Injected sender (tests stub). Absent → notifications are skipped entirely
   * (used when RESEND_API_KEY is unset — the production factory below returns a
   * no-op notifier in that case). */
  sendEmail: SendEmailFn;
  /** The deployed app's origin (#116), threaded into buildEmail's deep-link
   * paragraph. Null degrades to link-less bodies (fail-soft — same posture as
   * a missing RESEND_API_KEY: no origin, no link, never a throw). */
  appOrigin: string | null;
}

/** Builds the NotifyFn the job calls. Every step is best-effort: no recipient,
 * a build error, or a send throw all degrade to a logged skip — the job's
 * terminal transition + refund already happened before this runs. */
export function buildOnboardingNotifier(deps: NotifierDeps): NotifyFn {
  return async (event: OnboardingNotifyEvent): Promise<void> => {
    try {
      const to = await resolveRecipientEmail(deps.db, event.userId);
      if (to === null) {
        console.log(
          `onboarding notify skipped (no recipient email for user ${event.userId}, outcome=${event.outcome})`,
        );
        return;
      }
      await deps.sendEmail(buildEmail(to, event, deps.appOrigin));
    } catch (error) {
      // Best-effort: the dashboard is the record. Log loudly, never throw.
      console.error(`onboarding notify failed (outcome=${event.outcome}):`, error);
    }
  };
}

/** The production Resend HTTP sender (design §3): POST https://api.resend.com/
 * emails with the API key from RESEND_API_KEY. Returns a no-op notifier when
 * the key is unset (logged), so the job runs unchanged on a machine without
 * email configured. NEVER imported by hermetic tests — they build their own
 * notifier with a stub sender. */
export function resendSendEmail(apiKey: string): SendEmailFn {
  return async (email: OnboardingEmail): Promise<void> => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: email.to,
        subject: email.subject,
        text: email.text,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${res.statusText}`);
    }
  };
}

/** Production notifier factory: reads RESEND_API_KEY from the environment. When
 * unset, returns a notifier that logs + skips (best-effort, design §3).
 *
 * Also reads NEXT_PUBLIC_APP_URL (#116, same `?? null` read pattern as the
 * RESEND_API_KEY check above) and threads it through as the deep-link
 * origin. The deploy sets NEXT_PUBLIC_APP_URL (web/.env.production);
 * server-side process.env reads of it work in this route's Node runtime —
 * web/app/credits/actions.ts:34 already relies on the same pattern. Unset →
 * appOrigin is null → buildEmail's link-less, fail-soft default. */
export function productionNotifier(db: Db): NotifyFn {
  const apiKey = process.env.RESEND_API_KEY;
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? null;
  if (!apiKey) {
    return async (event: OnboardingNotifyEvent): Promise<void> => {
      console.log(
        `onboarding notify skipped (RESEND_API_KEY unset, outcome=${event.outcome}, user ${event.userId})`,
      );
    };
  }
  return buildOnboardingNotifier({ db, sendEmail: resendSendEmail(apiKey), appOrigin });
}
