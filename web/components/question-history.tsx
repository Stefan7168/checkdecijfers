// User dashboard: past questions, foldable (docs/06-roadmap.md Phase 1
// "question history"). Server Component -- native <details>/<summary> needs
// no client JS for the fold/unfold interaction.
//
// WP19 (open-questions #67): a collapsed clarification round arrives as ONE
// entry (grouped in src/billing/history.ts) whose `clarification` field
// carries the exchange -- rendered inside the fold as what we asked, what the
// user replied, then the final outcome, so the round never looks like the
// same question answered twice.
//
// #14 (GDPR self-service deletion + retention purge, WP14): an entry whose
// question was redacted (isDeleted) renders as a "verwijderde vraag"
// placeholder instead -- the owner-decided UX (session 23): the credit
// amount in the summary line stays visible (it already reads from
// creditsCharged, untouched by redaction), only the question/answer TEXT is
// replaced. The row is never hidden -- hiding it would silently change what
// the credit total above it implies.
//
// WP16 sub-part 2 (design §5-dashboard, ADR 026): an on-demand CBS table
// fetch still in flight has no answer/refusal audit row yet -- history.ts
// synthesizes an entry for it (entry.onboarding !== null) so the user sees
// its state rather than the question silently vanishing until the
// background job finishes. Three sub-states, all deterministic templates
// (never LLM-authored, matching the #84 convention):
//   - pending/running -> amber "wordt voorbereid" box (mirrors the #84
//     amber clarification styling -- an in-progress state, not a refusal).
//   - failed/unanswerable -> an honest "kon niet worden opgehaald, credits
//     teruggestort" box -- the fetch never produced a validated answer, so
//     there is nothing to show but the plain-language failure + the refund.
// A DELIVERED request is never one of these synthesized entries: its real
// answer already arrives as an ordinary entry (source: 'audit') via its own
// audit row, with its real 100-credit cost via the ledger join CORE-2/this
// stage wired in history.ts -- rendered by the existing answer branch below,
// unchanged.
// #115 residual (the definition expander): an answer entry whose stored
// envelope exposed structured fields (entry.answerParts, src/billing/
// history.ts) renders them as separate elements -- body prominent, a LONG
// CBS definition folded behind a native <details> "Meer over deze meting"
// (its scale sentence stays visible, web/lib/definition-display.ts), the R4
// attribution ALWAYS fully visible (the #90 convention: never behind a
// click). Entries without answerParts (refusals, clarifications, legacy
// rows) render the finalText blob exactly as before -- zero-loss fallback.
//
// #74 + #117: while any onboarding request is in flight (pending/running),
// an at-a-glance summary line renders ABOVE the list and a client-side
// router.refresh() poll keeps the whole list live, so a delivered answer
// (or a failure) appears without a manual refresh. Both live in
// onboarding-live-status.tsx; this component stays a Server Component and
// only hands it the server-derived in-flight COUNT — the poll's stop
// condition is that count reaching zero on a refreshed render, never a
// client-held flag.
import type { QuestionHistoryEntry } from '../backend/billing/index.ts';
import { splitDefinitionForDisplay } from '../lib/definition-display.ts';
import { buildAnswerProof } from '../lib/answer-proof.ts';
import { getLang } from '../lib/i18n/server.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { AnswerProof } from './answer-proof.tsx';
import { OnboardingLiveStatus } from './onboarding-live-status.tsx';

/** WP16's two in-flight sub-states — the one predicate behind the per-item
 * amber styling AND the #74/#117 live-status line + poll above the list. */
function isInFlight(onboarding: NonNullable<QuestionHistoryEntry['onboarding']>): boolean {
  return onboarding.status === 'pending' || onboarding.status === 'running';
}

/** Deterministic, owner-readable -- no LLM involved in producing any of this
 * (CLAUDE.md: product copy is always a fixed template). `onboarding.
 * failureSummary` itself is backend-produced text and is never translated --
 * only the fixed catalogue words around it (WP218 phase 4, #219). */
function onboardingStatusCopy(lang: Lang, entry: QuestionHistoryEntry): { label: string; body: string } {
  const onboarding = entry.onboarding;
  if (onboarding === null) {
    // Unreachable given the callers below only invoke this when onboarding
    // is set -- typed defensively rather than with a non-null assertion.
    return { label: '', body: '' };
  }
  switch (onboarding.status) {
    case 'pending':
    case 'running':
      return {
        label: t(lang, 'history.onboardingPreparingLabel'),
        body: t(lang, 'history.onboardingPreparingBody', { topic: onboarding.topicTerm }),
      };
    case 'failed':
    case 'unanswerable':
      return {
        label: t(lang, 'history.onboardingFailedLabel'),
        body:
          (onboarding.failureSummary ?? t(lang, 'history.onboardingFailedFallback')) +
          t(lang, 'history.onboardingFailedRefundSuffix'),
      };
    case 'delivered':
      // Never reached (delivered requests are represented by their own
      // audit-row entry, source: 'audit') -- exhaustive for the type only.
      return { label: '', body: '' };
  }
}

const SNIPPET_LENGTH = 120;

function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > SNIPPET_LENGTH ? `${collapsed.slice(0, SNIPPET_LENGTH)}…` : collapsed;
}

/** The structured answer view (#115): each envelope field as its own element,
 * so a long definition can fold without touching the body, marking or
 * attribution. Only rendered when history.ts vouched for zero loss (body +
 * attribution both present in the stored envelope). */
function AnswerBody({ lang, parts }: { lang: Lang; parts: NonNullable<QuestionHistoryEntry['answerParts']> }) {
  const definition = parts.definitionLine === null ? null : splitDefinitionForDisplay(parts.definitionLine);
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
      <p className="whitespace-pre-wrap">{parts.body}</p>
      {parts.stalenessWarning === null ? null : (
        <p className="text-xs text-warning">{parts.stalenessWarning}</p>
      )}
      {definition === null ? null : (
        <>
          {definition.inline === null ? null : <p className="text-xs text-muted-foreground">{definition.inline}</p>}
          {definition.folded === null ? null : (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                {t(lang, 'history.moreAboutMeasurement')}
              </summary>
              <p className="mt-1 whitespace-pre-wrap">{definition.folded}</p>
            </details>
          )}
        </>
      )}
      {parts.markingLine === null ? null : <p className="text-xs text-muted-foreground">{parts.markingLine}</p>}
      {/* The R4 attribution sentence: always fully visible (#90), smallest. */}
      <p className="text-xs text-muted-foreground">{parts.attributionLine}</p>
    </div>
  );
}

// WP218 phase 4 (#219), design §2.7: DISPLAY dates switch locale by lang.
function formatDate(lang: Lang, iso: string): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nl-NL', {
    timeZone: 'Europe/Amsterdam',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** The credits-charged inline fragment ("{n} credits · " / "{n} credits
 * totaal · "), reused by both the onboarding branch (never a total) and the
 * ordinary answer branch (a total exactly when a clarification round was
 * collapsed into this entry). */
function creditsLine(lang: Lang, n: number, isTotal: boolean): string {
  return isTotal ? t(lang, 'history.creditsInlineTotal', { n }) : t(lang, 'history.creditsInline', { n });
}

// WP218 phase 4 (#219): Server Component -- takes lang from getLang()
// directly (design §2.4). Async, so tests call `await QuestionHistory({...})`
// rather than rendering `<QuestionHistory/>` directly (the trial.tsx /
// ontdek.tsx precedent) -- jsdom's client renderer cannot invoke an async
// function component itself.
export async function QuestionHistory({ items }: { items: QuestionHistoryEntry[] }) {
  const lang = await getLang();
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, 'history.empty')}</p>;
  }

  const inFlightCount = items.filter(
    (item) => item.onboarding !== null && isInFlight(item.onboarding),
  ).length;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{t(lang, 'history.heading')}</h2>
      <OnboardingLiveStatus inFlightCount={inFlightCount} />
      {items.map((item) => {
        // WP16 sub-part 2: an onboarding-queue entry (pending/running/failed/
        // unanswerable) has no answer/refusal body -- its own render branch,
        // entirely separate from the isDeleted/clarification/answer paths
        // below (which only ever apply to an ordinary audit-row entry).
        if (item.onboarding !== null) {
          const inFlight = isInFlight(item.onboarding);
          const { label, body } = onboardingStatusCopy(lang, item);
          return (
            <details
              // Scoped by source (WP16 sub-part 2): pending_table_requests and
              // audit_answers both use bigint identity, so raw `item.id`
              // alone is not unique across the merged list.
              key={`${item.source}-${item.id}`}
              // #116 residual: the SAME string, as a real HTML id — the
              // onboarding delivery email's per-answer deep link anchors on
              // exactly this (src/ingestion/onboarding-notify.ts
              // dashboardAnchorUrl). Plain fragment scroll, no client JS.
              id={`${item.source}-${item.id}`}
              className={
                'rounded-lg border p-2 ' + (inFlight ? 'border-warning bg-warning-soft' : 'border-border')
              }
            >
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{item.question}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {item.creditsCharged !== null ? creditsLine(lang, item.creditsCharged, false) : ''}
                  {formatDate(lang, item.createdAt)}
                </span>
                <div className={'mt-0.5 text-xs font-medium ' + (inFlight ? 'text-warning' : 'text-muted-foreground')}>
                  {label}
                </div>
              </summary>
              <p className={'mt-2 text-sm ' + (inFlight ? 'text-warning' : 'text-muted-foreground')}>{body}</p>
            </details>
          );
        }

        return (
          <details
            key={`${item.source}-${item.id}`}
            // #116 residual: matches the onboarding-branch id above — the
            // delivery email's deep link anchors on this exact string.
            id={`${item.source}-${item.id}`}
            className="rounded-lg border border-border p-2"
          >
            <summary className="cursor-pointer text-sm">
              <span className={item.isDeleted ? 'italic text-muted-foreground' : 'font-medium'}>
                {item.isDeleted ? t(lang, 'history.deletedQuestionLabel') : item.question}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {/* A collapsed round's number is the SUM of two turns -- say so
                  * (adversarial-review finding: unlabeled, it reads as one
                  * answer's price). The credit amount survives deletion
                  * (#14) -- only the question/answer text is redacted. */}
                {item.creditsCharged !== null
                  ? creditsLine(lang, item.creditsCharged, item.clarification !== null)
                  : ''}
                {formatDate(lang, item.createdAt)}
              </span>
              {item.isDeleted ? null : (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{snippet(item.finalText)}</div>
              )}
            </summary>
            {item.isDeleted ? (
              <p className="mt-2 text-sm italic text-muted-foreground">{t(lang, 'history.deletedBody')}</p>
            ) : (
              <>
                {item.clarification ? (
                  <div className="mt-2 flex flex-col gap-1 border-l-2 border-border pl-2 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground">{t(lang, 'history.clarificationLabel')}</span>
                      <div className="whitespace-pre-wrap text-muted-foreground">{item.clarification.text}</div>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">{t(lang, 'history.yourReplyLabel')}</span>
                      <div className="whitespace-pre-wrap text-muted-foreground">{item.clarification.reply}</div>
                    </div>
                  </div>
                ) : null}
                {item.answerParts !== null ? (
                  <AnswerBody lang={lang} parts={item.answerParts} />
                ) : (
                  <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.finalText}</div>
                )}
                {/* Critical: the !item.isDeleted guard above is the ONLY protection
                  * against a proof panel appearing under a "Verwijderde vraag" heading.
                  * In a collapsed round where the clarification row is redacted but the
                  * reply row is not, isDeleted=true (OR of both rows' redaction state)
                  * but answerEnvelope≠null (from the non-redacted reply row only).
                  * Without this structural guard, the proof panel could expose
                  * table/measure/region/period info on a deleted entry. */}
                {item.answerEnvelope !== null ? (() => {
                  const proof = buildAnswerProof(item.answerEnvelope);
                  return proof !== null ? <AnswerProof proof={proof} /> : null;
                })() : null}
              </>
            )}
          </details>
        );
      })}
    </div>
  );
}
