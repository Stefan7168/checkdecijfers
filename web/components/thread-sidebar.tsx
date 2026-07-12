// WP135 (ADR 033 D1/D5): the conversation-history sidebar. "Nieuwe chat" on top
// (the ADR-021 explicit reset), then the user's threads grouped by day —
// vandaag / gisteren / afgelopen 7 dagen / ouder, Europe/Amsterdam boundaries.
// Clicking a thread resumes it (⟨A6⟩: the switch clears any pending
// clarification, exactly like nieuwe chat). Collapsible so the chat can go
// full-width. Titles are the read-time-derived thread titles (no text stored).
'use client';

import type { ThreadSummary } from '../backend/threads/index.ts';
import { groupThreads } from '../lib/thread-groups.ts';

export function ThreadSidebar({
  threads,
  activeThreadId,
  collapsed,
  onSelect,
  onNewChat,
  onToggleCollapse,
}: {
  threads: ThreadSummary[];
  activeThreadId: number | null;
  collapsed: boolean;
  onSelect: (threadId: number) => void;
  onNewChat: () => void;
  onToggleCollapse: () => void;
}) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-r border-zinc-200 p-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Toon gesprekken"
          className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
        >
          ☰
        </button>
      </div>
    );
  }

  const groups = groupThreads(threads);

  return (
    <nav className="flex w-full flex-col gap-3 border-r border-zinc-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Nieuwe chat
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Verberg gesprekken"
          className="rounded border border-zinc-300 px-2 py-2 text-xs text-zinc-600 hover:bg-zinc-50"
        >
          ‹
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="text-xs text-zinc-500">Nog geen gesprekken.</p>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
              {group.label}
            </p>
            {group.threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelect(thread.id)}
                aria-current={thread.id === activeThreadId ? 'true' : undefined}
                className={
                  'truncate rounded px-2 py-1.5 text-left text-sm ' +
                  (thread.id === activeThreadId
                    ? 'bg-zinc-200 text-zinc-900'
                    : 'text-zinc-700 hover:bg-zinc-100')
                }
                title={thread.title}
              >
                {thread.title}
              </button>
            ))}
          </div>
        ))
      )}
    </nav>
  );
}
