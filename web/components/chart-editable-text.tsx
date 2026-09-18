'use client';
// Chart co-pilot (phase 1 session 112 Task 5 — lifted out of
// web/components/chart.tsx in phase 2 session 113 Task 4): one piece of the
// reader's OWN text, edited in place. chart.tsx uses it for the caption
// under a CBS chart; the own-data card uses it for that chart's title.
//
// The VALUE lives in the command document (undoable like every other edit);
// only "is an editor open, and what is typed in it so far" is component
// state. `onCommit` is called with the trimmed text, or `null` when the box
// is emptied — a no-op commit (unchanged text) calls nothing at all, so
// pressing Enter on an unchanged line never puts a do-nothing step in the
// undo stack.
import { Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from './ui/button.tsx';

export function ChartEditableText(props: {
  /** The reader's text; null = none yet. */
  value: string | null;
  /** → `data-command-kind` on the edit/add buttons (the §6 command ↔ control
   * contract: every command kind is reachable from an on-screen control). */
  commandKind: 'setTitle' | 'setCaption';
  placeholder: string;
  editLabel: string;
  addLabel: string;
  saveLabel: string;
  cancelLabel: string;
  maxLength: number;
  onCommit: (next: string | null) => void;
  /** The story lock — see chart-history-actions.tsx. */
  locked?: { title: string; describedBy: string };
  testId: string;
  /** Display element when not editing (caption: p, own-data title: h3). */
  as?: 'p' | 'h3';
  className?: string;
}): ReactNode {
  const { value, commandKind, placeholder, editLabel, addLabel, saveLabel, cancelLabel, maxLength, onCommit, locked, testId } = props;
  const Display = props.as ?? 'p';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() {
    if (locked !== undefined) return;
    setDraft(value ?? '');
    setEditing(true);
  }
  function commit() {
    // Phase-1 review: the lock covers the COMMIT too, not only the buttons
    // that open the editor — an editor already open when the story starts
    // must not be able to write through the lock (Enter, or the blur the
    // story's own click causes in a real browser).
    if (locked !== undefined) return;
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next !== value) onCommit(next);
    setEditing(false);
  }

  // No margin on the wrapper: each branch below carries its own top spacing.
  return (
    <div>
      {editing ? (
        <>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            maxLength={maxLength}
            className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            autoFocus
          />
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={commit}
              disabled={locked !== undefined}
              title={locked?.title}
              aria-describedby={locked?.describedBy}
              className={'text-xs font-medium text-foreground' + (locked !== undefined ? ' cursor-not-allowed opacity-60' : '')}
            >
              {saveLabel}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted-foreground">
              {cancelLabel}
            </button>
          </div>
        </>
      ) : value !== null ? (
        <div className="mt-2 flex items-center gap-1">
          <Display data-testid={testId} className={props.className}>
            {value}
          </Display>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-command-kind={commandKind}
            onClick={startEdit}
            disabled={locked !== undefined}
            aria-label={editLabel}
            title={locked?.title ?? editLabel}
            aria-describedby={locked?.describedBy}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          data-command-kind={commandKind}
          onClick={startEdit}
          disabled={locked !== undefined}
          title={locked?.title}
          aria-describedby={locked?.describedBy}
          className={
            'mt-2 text-xs text-muted-foreground underline underline-offset-2' + (locked !== undefined ? ' cursor-not-allowed opacity-60' : '')
          }
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}
