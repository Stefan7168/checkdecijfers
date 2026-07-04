// User dashboard: past questions, foldable (docs/06-roadmap.md Phase 1
// "question history"). Server Component -- native <details>/<summary> needs
// no client JS for the fold/unfold interaction.
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
            <span className="font-medium">{item.question}</span>
            <span className="ml-2 text-xs text-zinc-400">
              {item.creditsCharged !== null ? `${item.creditsCharged} credits · ` : ''}
              {formatDate(item.createdAt)}
            </span>
            <div className="mt-0.5 truncate text-xs text-zinc-500">{snippet(item.finalText)}</div>
          </summary>
          <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{item.finalText}</div>
        </details>
      ))}
    </div>
  );
}
