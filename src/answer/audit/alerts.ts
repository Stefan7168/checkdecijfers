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

  try {
    await sendAdminAlertEmail(
      'checkdecijfers: semantische controle overgeslagen (fail-open)',
      [
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
      fetchImpl,
    );
  } catch (error) {
    console.error('semantic-check admin alert email failed (answer unaffected):', error);
  }
}

/** Shared Resend send for the admin alerts above and below: silently a no-op
 * when the RESEND_API_KEY/ADMIN_ALERT_EMAIL pair is unconfigured (the
 * caller's console.error line is the floor); throws on a failed send so each
 * caller's catch logs its own context label. */
async function sendAdminAlertEmail(
  subject: string,
  text: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!apiKey || !to) return;
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, text }),
  });
  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${res.statusText}`);
  }
}

// #121 (the unconditional half, 2026-07-18): the INTERNAL-REFUSAL alert.
// MEASURED correction to the design brief: a template-rung throw does NOT
// propagate uncaught — respondToQuestion/respondToClarificationReply already
// catch every downstream throw and serve the honest 'internal' refusal
// (respond.ts's fail-closed contract), on every production path. What WAS
// true in the brief's finding: that failure is SILENT — nothing but the
// audit row's internalNote records that the floor of the ladder (or anything
// else) broke. This alert makes every served 'internal' refusal loud, the
// same #144 posture: console.error floor, Resend email when configured,
// fail-soft always.

export interface InternalRefusalAlert {
  auditId: number | null;
  userId: string | null;
  question: string;
  /** The caught error message the refusal recorded (never rendered to the
   * user; see RefusalResponse.internalNote). */
  internalNote: string | null;
}

/** Send the owner alert for ONE served internal refusal. Exported separately
 * from the hook below so tests can drive it with a stubbed fetch. */
export async function alertInternalRefusal(
  alert: InternalRefusalAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const summary =
    `INTERNAL refusal served: the pipeline hit an unexpected error and refused honestly ` +
    `(audit row ${alert.auditId ?? 'unknown'}, user ${alert.userId ?? 'anonymous'}) — ` +
    `${alert.internalNote ?? 'no internal note recorded'}`;
  // The log line is the floor: present even without email configuration.
  console.error(`ADMIN ALERT: ${summary}`);

  try {
    await sendAdminAlertEmail(
      'checkdecijfers: interne weigering geserveerd',
      [
        'De pijplijn liep tegen een onverwachte fout aan en heeft eerlijk geweigerd ("internal", principe c) — de gebruiker kreeg een nette weigering en is gecompenseerd via het normale gate-pad.',
        '',
        'Wat dit betekent: ergens onder de motorkap brak iets (bijv. de template-trap van de antwoordladder, een db-fout, onverwerkbare LLM-output). Er is géén fout getal geserveerd; wel is dit een blinde vlek die je wilt kennen zodra hij zich voordoet (#121).',
        '',
        `Audit-rij: ${alert.auditId ?? 'onbekend'}`,
        `Gebruiker: ${alert.userId ?? 'anoniem'}`,
        `Vraag: ${alert.question}`,
        `Interne fout: ${alert.internalNote ?? 'geen internalNote vastgelegd'}`,
        `Tijd: ${new Date().toISOString()}`,
      ].join('\n'),
      fetchImpl,
    );
  } catch (error) {
    console.error('internal-refusal admin alert email failed (response unaffected):', error);
  }
}

// #121 option A (owner decision 2026-07-24, in-chat): a TEMPLATE answer that
// fails its own validator is SERVED (the template renders values straight
// from cells — structurally incapable of fabricating; a failing verdict
// indicates a VALIDATOR blind spot, the −39 precedent) — and the owner is
// told immediately. Same fail-soft posture as the alerts above.

export interface TemplateValidationAlert {
  auditId: number | null;
  userId: string | null;
  question: string;
  problems: string[];
}

/** Send the owner alert for ONE served template answer with a failing
 * validator verdict. Exported separately so tests can stub fetch. */
export async function alertTemplateValidationFailure(
  alert: TemplateValidationAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const summary =
    `TEMPLATE answer served with a FAILING validator verdict (audit row ` +
    `${alert.auditId ?? 'unknown'}, user ${alert.userId ?? 'anonymous'}) — likely a validator ` +
    `blind spot: ${alert.problems.join('; ') || 'no problems recorded'}`;
  // The log line is the floor: present even without email configuration.
  console.error(`ADMIN ALERT: ${summary}`);

  try {
    await sendAdminAlertEmail(
      'checkdecijfers: sjabloon-antwoord geserveerd met afgekeurd validator-verdict',
      [
        'Een sjabloon-antwoord is geserveerd terwijl de automatische dubbelcheck het afkeurde (#121, owner-keuze optie A: tonen + melden).',
        '',
        'Wat dit betekent: het sjabloon plakt letterlijk databasewaarden in een zin en kan geen getal verzinnen — een afkeurend verdict wijst vrijwel zeker op een blinde vlek in de CHECKER zelf (het −39-precedent uit PR #15). Het antwoord is dus zeer waarschijnlijk correct; de checker verdient een fix. Zodra de checker gerepareerd is, "heelt" de auditrij vanzelf bij herverificatie.',
        '',
        `Audit-rij: ${alert.auditId ?? 'onbekend'}`,
        `Gebruiker: ${alert.userId ?? 'anoniem'}`,
        `Vraag: ${alert.question}`,
        `Afkeur-redenen: ${alert.problems.join('; ') || 'geen vastgelegd'}`,
        `Tijd: ${new Date().toISOString()}`,
        '',
        'Naslaan: npm run audit:verify -- <rij> <rij> (de rij toont het #121 serve+alert-label).',
      ].join('\n'),
      fetchImpl,
    );
  } catch (error) {
    console.error('template-validation admin alert email failed (answer unaffected):', error);
  }
}

/** The hook respond-audited calls after persisting: fires ONLY on a served
 * ANSWER whose source is the template rung AND whose recorded validator
 * verdict is ok:false (only template bodies can be served that way — the LLM
 * rungs retry/fall through on a failing verdict). Never throws. */
export async function maybeAlertTemplateValidationFailure(
  audited: AuditedResponse,
  userId: string | null,
): Promise<void> {
  try {
    if (audited.response.kind !== 'answer') return;
    const answer = audited.response.answer;
    if (answer.source !== 'template') return;
    if (answer.validation?.ok !== false) return;
    await alertTemplateValidationFailure({
      auditId: audited.auditId,
      userId,
      question: audited.response.question,
      problems: answer.validation.problems ?? [],
    });
  } catch (error) {
    console.error('template-validation admin alert hook failed (answer unaffected):', error);
  }
}

/** The hook respond-audited calls after persisting: fires ONLY on a served
 * refusal with reason 'internal'. Never throws. */
export async function maybeAlertInternalRefusal(
  audited: AuditedResponse,
  userId: string | null,
): Promise<void> {
  try {
    if (audited.response.kind !== 'refusal') return;
    if (audited.response.reason !== 'internal') return;
    await alertInternalRefusal({
      auditId: audited.auditId,
      userId,
      question: audited.response.question,
      internalNote: audited.response.internalNote,
    });
  } catch (error) {
    console.error('internal-refusal admin alert hook failed (response unaffected):', error);
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
