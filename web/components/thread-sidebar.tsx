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
//
// Session 90 (owner requests, in chat): (1) a plus icon inside the "Nieuwe
// chat" button; (2) every thread row gets a ⋯ "Chat options" button — shown
// on hover/focus (always on touch, where there is no hover) — opening a
// one-item menu, "Delete chat", which asks for an inline confirmation (the
// owner-decided delete UX from session 23: one click, then confirm in place,
// never a typed word) before calling `onDelete`. The parent (Workspace) owns
// the actual deletion (web/app/actions.ts deleteMyThread: redact-not-delete,
// ownership-validated server-side) and the list refresh; this component only
// reports the confirmed intent and shows the failure line when the parent
// says it didn't work. Rows without an `onDelete` handler render exactly as
// before — no options button in the tree at all.
'use client';

import { Ellipsis, PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import { useId, useState } from 'react';
import type { ThreadSummary } from '../backend/threads/index.ts';
import { groupThreads } from '../lib/thread-groups.ts';
import { cn } from '../lib/utils.ts';
import { Button } from './ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';
import { Input } from './ui/input.tsx';

export function ThreadSidebar({
  threads,
  activeThreadId,
  collapsed,
  busy = false,
  onSelect,
  onNewChat,
  onToggleCollapse,
  onDelete,
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
  /** Session 90: resolves true when the chat was deleted (the parent has
   * refreshed the list), false when it wasn't (the row shows an error line
   * and keeps its confirmation open). Absent ⇒ no options button rendered. */
  onDelete?: (threadId: number) => Promise<boolean>;
}) {
  const [query, setQuery] = useState('');
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failedId, setFailedId] = useState<number | null>(null);
  const idPrefix = useId();

  async function confirmDelete(threadId: number): Promise<void> {
    if (!onDelete) return;
    setDeleting(true);
    setFailedId(null);
    try {
      const ok = await onDelete(threadId);
      if (ok) setConfirmingId(null);
      else setFailedId(threadId);
    } catch {
      setFailedId(threadId);
    } finally {
      setDeleting(false);
    }
  }

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
        <Plus aria-hidden="true" className="size-3.5" />
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
              {group.threads.map((thread) => {
                const titleId = `${idPrefix}-t${thread.id}`;
                const active = thread.id === activeThreadId;
                return (
                  <div key={thread.id} className="flex flex-col">
                    {/* group/row: the ⋯ button below reveals on hover of the
                      * WHOLE row, not just itself, so it's discoverable
                      * without knowing it's there. */}
                    <div className="group/row flex items-center gap-0.5">
                      <button
                        type="button"
                        id={titleId}
                        onClick={() => onSelect(thread.id)}
                        disabled={busy}
                        aria-current={active ? 'true' : undefined}
                        className={cn(
                          'block min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50',
                          // font-medium (session 87 deep review): in light mode the
                          // active row's bg-accent (oklch .97) on the bg-sidebar ground
                          // (oklch .985) is a ~1.04:1 difference — colour alone did
                          // not mark the current thread (WCAG 1.4.1). Weight is the
                          // non-colour cue, as shadcn's own sidebar active state does.
                          active
                            ? 'bg-accent font-medium text-foreground'
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
                      {onDelete ? (
                        <DropdownMenu>
                          {/* aria-label + aria-describedby (the row's own title
                            * button) rather than the title IN the label: a screen
                            * reader still hears "Chat options, <title>", while the
                            * button's accessible NAME stays constant — so the
                            * existing `getByRole('button', { name: /title/ })`
                            * lookups (tests and, more importantly, any future
                            * automation) keep resolving to the row, not the menu. */}
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Chat options"
                                aria-describedby={titleId}
                                disabled={busy}
                                className="shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
                              />
                            }
                          >
                            <Ellipsis aria-hidden="true" />
                          </DropdownMenuTrigger>
                          {/* w-auto: the primitive's default width tracks the
                            * anchor (--anchor-width), which here is a 24px icon
                            * button. */}
                          <DropdownMenuContent align="end" className="w-auto min-w-36">
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                setFailedId(null);
                                setConfirmingId(thread.id);
                              }}
                            >
                              Delete chat
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                    {confirmingId === thread.id ? (
                      <div
                        role="group"
                        aria-label="Delete this chat?"
                        className="mx-1 my-1 flex flex-col gap-2 rounded-md border border-destructive bg-muted p-2 text-xs"
                      >
                        <p className="text-destructive">
                          Delete this chat? Its questions also disappear from your history. This can’t be undone.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void confirmDelete(thread.id)}
                            disabled={deleting}
                            className="rounded-md bg-destructive px-2.5 py-1 font-medium text-white disabled:opacity-60"
                          >
                            {deleting ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmingId(null);
                              setFailedId(null);
                            }}
                            disabled={deleting}
                            className="rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                        {failedId === thread.id ? (
                          <p role="alert" className="text-destructive">
                            Couldn’t delete this chat. Try again later.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
