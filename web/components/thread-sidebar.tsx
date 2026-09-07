// WP135 (ADR 033 D1/D5): the conversation-history sidebar. "Nieuwe chat" on top
// (the ADR-021 explicit reset), then the user's threads grouped by day —
// vandaag / gisteren / afgelopen 7 dagen / ouder, Europe/Amsterdam boundaries.
// Clicking a thread resumes it (⟨A6⟩: the switch clears any pending
// clarification, exactly like nieuwe chat). Collapsible so the chat can go
// full-width. Titles are the read-time-derived thread titles (no text stored).
//
// Session 87 visual redesign (mockup Option B, owner amendment 2): the
// sidebar sits directly on the grey ground (no border), with a full-width
// "Nieuwe chat" button stacked above a same-size "Search chats" field, then
// dense rows under small uppercase group labels. The search is a purely
// client-side title filter over the threads already loaded — no request, no
// new data.
'use client';

import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useState } from 'react';
import type { ThreadSummary } from '../backend/threads/index.ts';
import { groupThreads } from '../lib/thread-groups.ts';
import { cn } from '../lib/utils.ts';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';

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
  const [query, setQuery] = useState('');

  if (collapsed) {
    return (
      <div className="flex flex-col items-center pt-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapse}
          aria-label="Toon gesprekken"
        >
          <PanelLeftOpen aria-hidden="true" />
        </Button>
      </div>
    );
  }

  const needle = query.trim().toLocaleLowerCase('nl');
  const visible =
    needle === '' ? threads : threads.filter((t) => t.title.toLocaleLowerCase('nl').includes(needle));
  const groups = groupThreads(visible);

  return (
    <nav aria-label="Gesprekken" className="flex h-full w-full flex-col gap-2 px-2 pt-2">
      <div className="flex items-center justify-between pl-2">
        <span className="text-xs font-medium text-muted-foreground">Chats</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onToggleCollapse}
          aria-label="Verberg gesprekken"
        >
          <PanelLeftClose aria-hidden="true" />
        </Button>
      </div>
      <Button type="button" onClick={onNewChat} disabled={busy} className="h-8 w-full">
        Nieuwe chat
      </Button>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="h-8 bg-background pl-8 text-[13px]"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {threads.length === 0 ? (
          <p className="px-2.5 pt-2 text-xs text-muted-foreground">Nog geen gesprekken.</p>
        ) : visible.length === 0 ? (
          <p className="px-2.5 pt-2 text-xs text-muted-foreground">No chats match “{query.trim()}”.</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <p className="px-2.5 pt-3 pb-1 text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                {group.label}
              </p>
              {group.threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => onSelect(thread.id)}
                  disabled={busy}
                  aria-current={thread.id === activeThreadId ? 'true' : undefined}
                  className={cn(
                    'block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50',
                    thread.id === activeThreadId
                      ? 'bg-accent text-foreground'
                      : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
                  )}
                  title={thread.kind === 'dataset' ? `Your data: ${thread.title}` : thread.title}
                >
                  {/* ADR 037 D10: a dataset thread's ONLY visual distinction here
                    * is this prefix — everything else about the row (className,
                    * disabled state, click behavior) is identical to a CBS
                    * thread's. Byte-identical pin (thread-sidebar.test.tsx): a
                    * `kind: 'cbs'` thread renders with NO prefix at all, not an
                    * empty/hidden one. */}
                  {thread.kind === 'dataset' && (
                    <span aria-hidden="true" className="mr-1">
                      📎
                    </span>
                  )}
                  {thread.title}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
