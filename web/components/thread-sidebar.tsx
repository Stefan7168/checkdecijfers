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
  busy = false,
  onSelect,
  onNewChat,
  onToggleCollapse,
}: {
  threads: ThreadSummary[];
  activeThreadId: number | null;
  collapsed: boolean;
  /** WP135 (blocker fix): true while a chat submit is in flight — "Nieuwe chat"
   * and the thread rows are disabled so a mid-flight switch can't reset the chat
   * and let the late response land in the wrong thread. Collapse stays enabled
   * (it neither resets nor switches). */
  busy?: boolean;
  onSelect: (threadId: number) => void;
  onNewChat: () => void;
  onToggleCollapse: () => void;
}) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-r border-line p-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Toon gesprekken"
          className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink-soft hover:bg-paper-sunken"
        >
          ☰
        </button>
      </div>
    );
  }

  const groups = groupThreads(threads);

  return (
    <nav className="flex w-full flex-col gap-3 border-r border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onNewChat}
          disabled={busy}
          className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
        >
          Nieuwe chat
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Verberg gesprekken"
          className="rounded-md border border-line-strong px-2 py-2 text-xs text-ink-soft hover:bg-paper-sunken"
        >
          ‹
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="text-xs text-ink-muted">Nog geen gesprekken.</p>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {group.label}
            </p>
            {group.threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelect(thread.id)}
                disabled={busy}
                aria-current={thread.id === activeThreadId ? 'true' : undefined}
                className={
                  'truncate rounded px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ' +
                  (thread.id === activeThreadId
                    ? 'bg-paper-sunken text-ink'
                    : 'text-ink-soft hover:bg-paper-sunken')
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
