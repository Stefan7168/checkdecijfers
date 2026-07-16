// #144 (ADR 034 §5 — owner decision 2026-07-16, in-chat): fail-open + ADMIN
// ALERT. When the semantic checker itself could not run (API outage,
// malformed output — never a judgment) and the answer was served fail-open on
// the strength of the full deterministic validator, the owner wants to KNOW:
// which user, which question, and what the skip meant. Hooked at the ONE
// shared site every user-visible answer passes (respond-audited.ts), so the
// chat question, the clarification reply and the onboarding delivery re-run
// are all covered.
//
// Entirely FAIL-SOFT and dormant-safe: no stored checker record (flag off,
// benchmark, tests) → no call at all; RESEND_API_KEY/ADMIN_ALERT_EMAIL unset
// → the console.error line is the floor (visible in Vercel logs); an email
// failure is logged and can never affect the served response.
import type { AuditedResponse } from './respond-audited.ts';

/** Same verified sender the onboarding notifier uses (onboarding-notify.ts). */
const FROM_ADDRESS = 'noreply@mail.checkdecijfers.nl';

export interface SemanticCheckSkipAlert {
  auditId: number | null;
  userId: string | null;
  question: string;
  error: string;
}

/** Send the owner alert for ONE fail-open checker skip. Exported separately
 * from the hook below so tests can drive it with a stubbed fetch. */
export async function alertSemanticCheckSkip(
  alert: SemanticCheckSkipAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const summary =
    `semantic-check FAIL-OPEN skip: answer served on deterministic validation alone ` +
    `(audit row ${alert.auditId ?? 'unknown'}, user ${alert.userId ?? 'anonymous'}) — ${alert.error}`;
  // The log line is the floor: present even without email configuration.
  console.error(`ADMIN ALERT: ${summary}`);

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!apiKey || !to) return;
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to,
        subject: 'checkdecijfers: semantische controle overgeslagen (fail-open)',
        text: [
          'De semantische dubbelcheck (#144) kon niet draaien; het antwoord is geserveerd op de volledige deterministische validatie (fail-open, ADR 034 §5).',
          '',
          'Wat dit betekent: het antwoord bevatte een residu-gevoelig getal dat normaal een tweede AI-controle krijgt; die controle is deze keer overgeslagen door een storing. Elke getoonde waarde is wél deterministisch gevalideerd (letterlijk herleidbaar naar een opgeslagen cel of geregistreerde bewerking).',
          '',
          `Audit-rij: ${alert.auditId ?? 'onbekend (audit-write faalde — zie internalNote)'}`,
          `Gebruiker: ${alert.userId ?? 'anoniem'}`,
          `Vraag: ${alert.question}`,
          `Storing: ${alert.error}`,
          `Tijd: ${new Date().toISOString()}`,
          '',
          `Naslaan: npm run audit:verify -- <rij> <rij>, of de audit_answers-rij zelf (response->answer->semanticCheck).`,
        ].join('\n'),
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${res.statusText}`);
    }
  } catch (error) {
    console.error('semantic-check admin alert email failed (answer unaffected):', error);
  }
}

/** The hook respond-audited calls after persisting: fires ONLY when the
 * served answer carries a checker record with status 'error' (which, on a
 * served body, structurally implies fail_open — R8 enforces that). Never
 * throws. */
export async function maybeAlertSemanticCheckSkip(
  audited: AuditedResponse,
  userId: string | null,
): Promise<void> {
  try {
    if (audited.response.kind !== 'answer') return;
    const check = audited.response.answer.semanticCheck ?? null;
    if (check === null || check.status !== 'error') return;
    await alertSemanticCheckSkip({
      auditId: audited.auditId,
      userId,
      question: audited.response.question,
      error: check.error ?? 'unknown checker error',
    });
  } catch (error) {
    console.error('semantic-check admin alert hook failed (answer unaffected):', error);
  }
}
