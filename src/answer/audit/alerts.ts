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
import { shouldAlertToday } from '../../ingestion/stale-sync.ts';

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
    // A THROW is caught by every caller; a HANG is not — nothing times out a
    // stalled socket, so an alert on a user-facing path would hold the request
    // to the platform limit and cost a visitor an answer that was already
    // produced. Bounds all four alerts, not just the newest one.
    signal: AbortSignal.timeout(5_000),
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

// #189 (2026-07-25): the RETENTION-PURGE alert. The purge is the only thing
// enforcing either retention window, and once a cron runs it unattended its
// failure mode is silence — the same shape as the two alerts above, and the
// reason #189 existed at all was that nobody noticed the job was never running.
// Same posture: console.error is the floor, e-mail when configured, fail-soft
// always (an alert failure must never turn a SUCCESSFUL purge into a failed
// cron response).
export interface RetentionPurgeAlert {
  /** 'failed' — the job threw. 'skipped' — it reported the trial table absent
   * on a database where migration 020 has been live since 2026-07-17, which is
   * now a real signal rather than a shrug. */
  kind: 'failed' | 'skipped';
  detail: string;
}

export async function alertRetentionPurge(
  alert: RetentionPurgeAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const subject =
    alert.kind === 'failed'
      ? 'checkdecijfers: de GDPR-bewaartermijnpurge is MISLUKT'
      : 'checkdecijfers: de GDPR-purge sloeg het trial-been over';
  const meaning =
    alert.kind === 'failed'
      ? 'De purge is het ENIGE dat de bewaartermijnen afdwingt (auditrijen 2 jaar, ' +
        'trial-boekhouding 90 dagen). Zolang dit faalt loopt er niets af.'
      : 'De purge meldde dat trial_questions niet bestaat. Migratie 020 draait sinds ' +
        '17-07-2026 op productie, dus dit hoort niet te kunnen — onderzoek het.';
  await sendAdminAlertEmail(subject, `${meaning}\n\n${alert.detail}`, fetchImpl);
}

/** Fail-soft wrapper: logs the floor, never throws. */
export async function maybeAlertRetentionPurge(
  alert: RetentionPurgeAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  console.error(`[retention-purge] ${alert.kind}: ${alert.detail}`);
  try {
    await alertRetentionPurge(alert, fetchImpl);
  } catch (err) {
    console.error('[retention-purge] alert e-mail failed:', err);
  }
}

// #180 (2026-07-26): the TRIAL POT low-water alert. The pot is the anonymous
// lead magnet's whole budget and nothing watched it: an outsider could drain it
// for well under a euro (5 addresses x 5/day covers a 25-question pot), the
// homepage would quietly degrade to "log in om verder te gaan", and the owner
// would find out by looking. Same posture as the alerts above — console.error
// is the floor, e-mail when configured, fail-soft always.
//
// Deliberately fired by the CALLER after the take commits, never inside it: the
// take holds a global advisory lock, and this module sends over the network.
// Holding that lock across an HTTP request would serialise every anonymous
// visitor behind an e-mail (the ledger's own "never across an LLM call" rule,
// same reasoning).
export interface TrialPotAlert {
  remaining: number;
  threshold: number;
}

export async function alertTrialPotLow(
  alert: TrialPotAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const empty = alert.remaining <= 0;
  const subject = empty
    ? 'checkdecijfers: het gratis proefpotje is LEEG'
    : `checkdecijfers: nog ${alert.remaining} proefvragen in het potje`;
  const body = empty
    ? 'De homepage toont vanaf nu "log in om verder te gaan" in plaats van het proefveld. ' +
      'Bijvullen: npm run trialpot:set -- <aantal>. De trial heropent ZONDER deploy — ' +
      'wacht na het bijvullen wel even met herladen: de landing leest het potje uit een korte cache (#186).'
    : `Het potje staat op de waarschuwingsgrens van ${alert.threshold}. Bijvullen met ` +
      'npm run trialpot:set -- <aantal> voordat het leeg is; dat heropent de trial zonder deploy ' +
      '(de landing kan de oude stand nog even tonen — korte cache, #186).';
  await sendAdminAlertEmail(subject, body, fetchImpl);
}

/** Fail-soft wrapper: logs the floor, never throws, never blocks a served answer. */
export async function maybeAlertTrialPotLow(
  alert: TrialPotAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  // console.ERROR, like every sibling alert: an owner filtering Vercel logs to
  // error level must see this one too.
  console.error(`[trial-pot] low water: ${alert.remaining} left (threshold ${alert.threshold})`);
  // Returns whether the send SUCCEEDED, because the caller latches on it.
  // Latching on the ATTEMPT was a review finding: one transient Resend failure
  // then burned the only notification for that drain, and the owner learned the
  // lead magnet was dark by looking at it — the outcome #180 exists to prevent.
  // `false` when the alert pair is unconfigured too, so an unset RESEND_API_KEY
  // never latches a notification as delivered.
  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_ALERT_EMAIL) return false;
  try {
    await alertTrialPotLow(alert, fetchImpl);
    return true;
  } catch (err) {
    console.error('[trial-pot] low-water alert e-mail failed:', err);
    return false;
  }
}

// #108 (2026-08-27, session 66): a REGISTERED table (one we actually serve
// answers from, cbs_tables) flipping to a non-current catalog status
// (CBS 'Gediscontinueerd'/'Vervallen', or vanishing from the catalog fetch
// entirely) with no machine-readable successor link. Detection only — the
// row is explicit that re-onboarding a successor stays an owner-reviewed
// action, never automatic. Same posture as every alert above: console.error
// is the floor, e-mail when configured, fail-soft always. "Current" is read
// from the table's OWN source registry entry (SourceInfo.currentCatalogStatuses,
// src/sources/registry.ts) rather than a hardcoded CBS string list, so this
// stays correct as WP30 multi-source tables get registered too.
export interface TableStatusFlip {
  tableId: string;
  /** The catalog status this table had before this refresh (null: the
   * registered table had no catalog mirror row at all — a gap in its own
   * right, worth flagging the same way). */
  oldStatus: string | null;
  /** The catalog status after this refresh (null: CBS no longer lists this
   * id in the catalog fetch at all — the table vanished, not just its status
   * changing). */
  newStatus: string | null;
}

export interface TableStatusFlipAlert {
  flips: TableStatusFlip[];
}

export async function alertTableStatusFlip(
  alert: TableStatusFlipAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const subject =
    alert.flips.length === 1
      ? `checkdecijfers: tabel ${alert.flips[0]!.tableId} is niet meer actueel bij de bron`
      : `checkdecijfers: ${alert.flips.length} geregistreerde tabellen zijn niet meer actueel bij de bron`;
  const lines = alert.flips.map(
    (f) =>
      `- ${f.tableId}: ${f.oldStatus ?? '(geen catalogusrij)'} -> ${f.newStatus ?? '(niet meer in de catalogus)'}`,
  );
  const body = [
    'Een of meer tabellen waar checkdecijfers.nl echt cijfers uit serveert, staan bij de bron niet ' +
      'meer als actueel geregistreerd (bijv. CBS "Gediscontinueerd"/"Vervallen"), of zijn helemaal ' +
      'uit de catalogus verdwenen.',
    '',
    'Wat dit betekent: bestaande, al gesynchroniseerde cijfers blijven gewoon bruikbaar (de warn-and-serve ' +
      'staleness-regel verandert hier niets aan) — maar de bron publiceert dit onderwerp mogelijk voortaan ' +
      'onder een ANDERE tabel-id, waardoor toekomstige verversingen achterblijven zonder dat iets dat luid meldt.',
    '',
    'Actie: geen automatische her-onboarding — dat is bewust een door jou beoordeelde stap. Zoek zelf (of ' +
      'laat een sessie zoeken) of de bron een opvolgtabel heeft voor hetzelfde onderwerp.',
    '',
    ...lines,
    '',
    `Tijd: ${new Date().toISOString()}`,
  ].join('\n');
  await sendAdminAlertEmail(subject, body, fetchImpl);
}

/** Fail-soft wrapper: logs the floor, never throws — a catalog:refresh run
 * must never fail or block on this. No-op on an empty flip list. */
export async function maybeAlertTableStatusFlip(
  alert: TableStatusFlipAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (alert.flips.length === 0) return;
  for (const f of alert.flips) {
    console.error(`[catalog-status-flip] ${f.tableId}: ${f.oldStatus ?? '(none)'} -> ${f.newStatus ?? '(gone)'}`);
  }
  try {
    await alertTableStatusFlip(alert, fetchImpl);
  } catch (err) {
    console.error('[catalog-status-flip] alert e-mail failed:', err);
  }
}

// #23 (2026-09-17, session 109): the INGESTION-RUN alert — the broader owner-
// alerting row. A batch failure, a validation quarantine (needs_review), or a
// sync throwing were loud only to whoever happened to be watching that run's
// own console/logs — nothing told the owner PROACTIVELY. Reuses the exact
// mechanism every alert above does (Resend via sendAdminAlertEmail, same
// fail-soft posture) — no new module, no new provider (CLAUDE.md "cheapest
// mechanism first"). Batched exactly like #108's TableStatusFlip: AT MOST ONE
// email per run, never one per table.
//
// Wired from two call sites: the ingestion CLI's `sync`/`sync --all` (which
// always has a real ingestion_batches row per table, so `batchId` is set),
// and the on-demand onboarding-cron route (one table per invocation; that
// path's failure detail comes back as a pending_table_requests.failure_summary
// string rather than a fresh SyncResult, so `batchId` is null there — a
// documented residual, not a bug: see docs/open-questions.md #23).
//
// Deliberately NOT covering "missed syncs" or `/api/health` failures (the
// row's other two original triggers): both need a scheduler/expectation
// baseline this mechanism doesn't have (what "missed" even means requires
// knowing the expected cadence per table) — out of scope here, tracked as the
// #23 residual rather than guessed at.
export interface IngestionRunProblem {
  tableId: string;
  /** The table's source key ('cbs', 'eurostat', ...) — sources/registry.ts's
   * own derivation (sourceKeyForTableId), never guessed here. */
  source: string;
  /** The failed validation check's stage name (e.g. 'row_plausibility'), or
   * 'threw' when the sync itself raised (an infrastructure error, not one of
   * the five ordered checks). */
  check: string;
  message: string;
  /** The ingestion_batches row id, when this run recorded one. Null when the
   * call site has no SyncResult to read one from (see the onboarding-cron
   * residual above). */
  batchId: number | null;
}

export interface IngestionRunAlert {
  problems: IngestionRunProblem[];
}

export async function alertIngestionRunProblems(
  alert: IngestionRunAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const subject =
    alert.problems.length === 1
      ? `checkdecijfers: ingestieprobleem bij tabel ${alert.problems[0]!.tableId}`
      : `checkdecijfers: ${alert.problems.length} ingestieproblemen in deze run`;
  const lines = alert.problems.map(
    (p) =>
      `- ${p.tableId} (bron: ${p.source}), check: ${p.check}, batch: ${p.batchId ?? '(geen batch-id)'} — ${p.message}`,
  );
  const body = [
    'Een of meer tabellen in deze ingestie-run hebben een mislukte batch, zijn ' +
      'gequarantaind (needs_review) door een validatiecheck, of de sync gooide een ' +
      'onverwachte fout (#23).',
    '',
    'Wat dit betekent: eerder al gevalideerde cijfers blijven gewoon bruikbaar — deze ' +
      'tabellen kregen alleen GEEN nieuwe, gevalideerde ververing deze run. Een ' +
      "tabel met status needs_review wordt uitgesloten van beantwoording tot iemand 'm herbeoordeelt.",
    '',
    ...lines,
    '',
    `Tijd: ${new Date().toISOString()}`,
  ].join('\n');
  await sendAdminAlertEmail(subject, body, fetchImpl);
}

/** Fail-soft wrapper: logs the floor, never throws — an ingestion run (CLI or
 * cron) must never fail or block on this. No-op on an empty problem list: the
 * AT-MOST-ONE-email contract means a fully clean run sends nothing. */
export async function maybeAlertIngestionRunProblems(
  alert: IngestionRunAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (alert.problems.length === 0) return;
  for (const p of alert.problems) {
    console.error(`[ingestion-run] ${p.tableId} (${p.source}) ${p.check}: ${p.message}`);
  }
  try {
    await alertIngestionRunProblems(alert, fetchImpl);
  } catch (err) {
    console.error('[ingestion-run] alert e-mail failed:', err);
  }
}

// #23 residual (2026-09-17, session 110): the MISSED-SYNC alert — the row's
// other still-open trigger ("a table that should have refreshed by now but
// silently didn't"). Same mechanism, same fail-soft posture as every alert
// above. The cadence baseline (which grain → how many days is "too long") and
// the dedupe (shouldAlertToday) both live in src/ingestion/stale-sync.ts as
// pure, DB-free functions — this module only knows how to phrase and send
// the e-mail. Wired from the daily onboarding-cron route (see
// docs/RUNBOOK.md "Missed-sync alert"), guarded so a failure here can never
// fail that cron's actual job.
export interface MissedSyncEntry {
  tableId: string;
  /** ISO timestamp of the table's last successful sync (never null — see
   * findStaleSyncs, which excludes tables that have never synced at all). */
  lastSuccessfulSyncAt: string;
  thresholdDays: number;
  /** Whole days past the threshold, as of the check that produced this list. */
  overdueDays: number;
}

export interface MissedSyncAlert {
  overdue: MissedSyncEntry[];
}

export async function alertMissedSyncs(
  alert: MissedSyncAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const subject =
    alert.overdue.length === 1
      ? `checkdecijfers: tabel ${alert.overdue[0]!.tableId} heeft geen verversing binnen de verwachte termijn`
      : `checkdecijfers: ${alert.overdue.length} tabellen hebben geen verversing binnen de verwachte termijn`;
  const lines = alert.overdue.map(
    (e) =>
      `- ${e.tableId}: laatst succesvol gesynchroniseerd op ${e.lastSuccessfulSyncAt} ` +
      `(drempel ${e.thresholdDays} dagen, nu ${e.overdueDays} dag(en) daaroverheen)`,
  );
  const body = [
    'Een of meer geregistreerde, actieve tabellen zijn langer geleden voor het laatst succesvol ' +
      'gesynchroniseerd dan hun eigen publicatieritme redelijkerwijs toestaat (#23, het "gemiste ' +
      'sync"-restpunt).',
    '',
    'Wat dit betekent: eerder al gevalideerde cijfers blijven gewoon bruikbaar — dit is geen ' +
      'kwaliteitsprobleem met bestaande data, maar een signaal dat de reguliere verversing voor ' +
      'deze tabel(len) is opgehouden (bijv. de bron heeft de tabel-id gewijzigd, of een geplande ' +
      'sync draait niet meer). De drempels zijn bewust ruim gekozen (60/130/420 dagen voor maand-/' +
      'kwartaal-/jaarcijfers) om normale CBS-publicatievertraging nooit als vals alarm te melden.',
    '',
    'Actie: controleer of deze tabel bij de bron nog bestaat/hetzelfde publiceert, en draai zo nodig ' +
      'een handmatige sync (npm run ingest sync <tabel-id>).',
    '',
    ...lines,
    '',
    `Tijd: ${new Date().toISOString()}`,
  ].join('\n');
  await sendAdminAlertEmail(subject, body, fetchImpl);
}

/** Fail-soft wrapper: logs the floor, never throws — the daily cron this is
 * wired into must never fail or block on this. Applies the daily-alert-
 * fatigue dedupe (shouldAlertToday) itself, so callers can pass the RAW
 * findStaleSyncs() output on every run without re-deriving the dedupe logic;
 * a fully clean run, or a run where every overdue table is mid-cooldown,
 * sends nothing. */
export async function maybeAlertMissedSyncs(
  alert: MissedSyncAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const due = alert.overdue.filter((e) => shouldAlertToday(e.overdueDays));
  if (due.length === 0) return;
  for (const e of due) {
    console.error(
      `[missed-sync] ${e.tableId}: last synced ${e.lastSuccessfulSyncAt}, ${e.overdueDays} day(s) past its ${e.thresholdDays}-day threshold`,
    );
  }
  try {
    await alertMissedSyncs({ overdue: due }, fetchImpl);
  } catch (err) {
    console.error('[missed-sync] alert e-mail failed:', err);
  }
}
