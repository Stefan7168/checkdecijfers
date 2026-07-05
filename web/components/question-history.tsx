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
import type { QuestionHistoryEntry } from '../backend/billing/index.ts';

const SNIPPET_LENGTH = 120;

function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > SNIPPET_LENGTH ? `${collapsed.slice(0, SNIPPET_LENGTH)}…` : collapsed;
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
      {items.map((item) => (
        <details key={item.id} className="rounded border border-zinc-200 p-2">
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
              <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{item.finalText}</div>
            </>
          )}
        </details>
      ))}
    </div>
  );
}
