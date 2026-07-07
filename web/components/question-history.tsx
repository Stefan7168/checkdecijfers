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
import type { QuestionHistoryEntry } from '../backend/billing/index.ts';
import { splitDefinitionForDisplay } from '../lib/definition-display.ts';

/** Dutch, deterministic, owner-readable -- no LLM involved in producing any
 * of this (CLAUDE.md: Dutch product copy is always a fixed template). */
function onboardingStatusCopy(entry: QuestionHistoryEntry): { label: string; body: string } {
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
        label: 'Wordt voorbereid',
        body: `We vragen de cijfers over "${onboarding.topicTerm}" nu automatisch op bij het CBS en controleren ze. Je krijgt een e-mail zodra je vraag beantwoord kan worden.`,
      };
    case 'failed':
    case 'unanswerable':
      return {
        label: 'Kon niet worden opgehaald',
        body:
          (onboarding.failureSummary ?? 'Het ophalen van deze cijfers is niet gelukt.') +
          ' De credits zijn teruggestort.',
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
function AnswerBody({ parts }: { parts: NonNullable<QuestionHistoryEntry['answerParts']> }) {
  const definition = parts.definitionLine === null ? null : splitDefinitionForDisplay(parts.definitionLine);
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-sm text-zinc-700">
      <p className="whitespace-pre-wrap">{parts.body}</p>
      {parts.stalenessWarning === null ? null : (
        <p className="text-xs text-amber-800">{parts.stalenessWarning}</p>
      )}
      {definition === null ? null : (
        <>
          {definition.inline === null ? null : <p className="text-xs text-zinc-500">{definition.inline}</p>}
          {definition.folded === null ? null : (
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer font-medium text-zinc-600">Meer over deze meting</summary>
              <p className="mt-1 whitespace-pre-wrap">{definition.folded}</p>
            </details>
          )}
        </>
      )}
      {parts.markingLine === null ? null : <p className="text-xs text-zinc-500">{parts.markingLine}</p>}
      {/* The R4 attribution sentence: always fully visible (#90), smallest. */}
      <p className="text-xs text-zinc-400">{parts.attributionLine}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function QuestionHistory({ items }: { items: QuestionHistoryEntry[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">Nog geen eerdere vragen.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-zinc-700">Eerdere vragen</h2>
      {items.map((item) => {
        // WP16 sub-part 2: an onboarding-queue entry (pending/running/failed/
        // unanswerable) has no answer/refusal body -- its own render branch,
        // entirely separate from the isDeleted/clarification/answer paths
        // below (which only ever apply to an ordinary audit-row entry).
        if (item.onboarding !== null) {
          const inFlight = item.onboarding.status === 'pending' || item.onboarding.status === 'running';
          const { label, body } = onboardingStatusCopy(item);
          return (
            <details
              // Scoped by source (WP16 sub-part 2): pending_table_requests and
              // audit_answers both use bigint identity, so raw `item.id`
              // alone is not unique across the merged list.
              key={`${item.source}-${item.id}`}
              className={
                'rounded border p-2 ' + (inFlight ? 'border-amber-200 bg-amber-50' : 'border-zinc-200')
              }
            >
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{item.question}</span>
                <span className="ml-2 text-xs text-zinc-400">
                  {item.creditsCharged !== null ? `${item.creditsCharged} credits · ` : ''}
                  {formatDate(item.createdAt)}
                </span>
                <div className={'mt-0.5 text-xs font-medium ' + (inFlight ? 'text-amber-800' : 'text-zinc-500')}>
                  {label}
                </div>
              </summary>
              <p className={'mt-2 text-sm ' + (inFlight ? 'text-amber-900' : 'text-zinc-700')}>{body}</p>
            </details>
          );
        }

        return (
          <details key={`${item.source}-${item.id}`} className="rounded border border-zinc-200 p-2">
            <summary className="cursor-pointer text-sm">
              <span className={item.isDeleted ? 'italic text-zinc-400' : 'font-medium'}>
                {item.isDeleted ? 'Verwijderde vraag' : item.question}
              </span>
              <span className="ml-2 text-xs text-zinc-400">
                {/* A collapsed round's number is the SUM of two turns -- say so
                  * (adversarial-review finding: unlabeled, it reads as one
                  * answer's price). The credit amount survives deletion
                  * (#14) -- only the question/answer text is redacted. */}
                {item.creditsCharged !== null
                  ? `${item.creditsCharged} credits${item.clarification !== null ? ' totaal' : ''} · `
                  : ''}
                {formatDate(item.createdAt)}
              </span>
              {item.isDeleted ? null : (
                <div className="mt-0.5 truncate text-xs text-zinc-500">{snippet(item.finalText)}</div>
              )}
            </summary>
            {item.isDeleted ? (
              <p className="mt-2 text-sm italic text-zinc-400">
                De tekst van deze vraag is verwijderd.
              </p>
            ) : (
              <>
                {item.clarification ? (
                  <div className="mt-2 flex flex-col gap-1 border-l-2 border-zinc-200 pl-2 text-sm">
                    <div>
                      <span className="text-xs text-zinc-500">Verduidelijkingsvraag</span>
                      <div className="whitespace-pre-wrap text-zinc-700">{item.clarification.text}</div>
                    </div>
                    <div>
                      <span className="text-xs text-zinc-500">Jouw antwoord</span>
                      <div className="whitespace-pre-wrap text-zinc-700">{item.clarification.reply}</div>
                    </div>
                  </div>
                ) : null}
                {item.answerParts !== null ? (
                  <AnswerBody parts={item.answerParts} />
                ) : (
                  <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{item.finalText}</div>
                )}
              </>
            )}
          </details>
        );
      })}
    </div>
  );
}
