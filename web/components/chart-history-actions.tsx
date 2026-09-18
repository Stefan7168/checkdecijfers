'use client';
// Chart co-pilot (phase 1 session 112 Task 3/4 — lifted out of
// web/components/chart.tsx in phase 2 session 113 Task 4): the Undo / Redo /
// history-menu group, so both cards (CBS and own-data) offer the SAME
// controls over the same command log.
//
// `locked` is the story lock as chart.tsx wires it: while the Insights story
// is open every reader control that could contradict the active step's
// caption is disabled, with ONE shared, digit-free reason exposed via both
// `title` (pointer) and `aria-describedby` (screen reader).
import { Redo2, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ChartHistory } from '../lib/chart-history.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { ChartHistoryMenu } from './chart-history-menu.tsx';
import { Button } from './ui/button.tsx';

export function ChartHistoryActions(props: {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  history: ChartHistory;
  lang: Lang;
  /** Disables both buttons, hides the menu, adds title + aria-describedby. */
  locked?: { title: string; describedBy: string };
}): ReactNode {
  const { undo, redo, canUndo, canRedo, history, lang, locked } = props;
  return (
    <div className="flex shrink-0 items-center gap-1" data-slot="chart-history-actions">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={undo}
        disabled={!canUndo || locked !== undefined}
        aria-label={t(lang, 'chart.history.undo')}
        title={locked?.title ?? t(lang, 'chart.history.undoHint')}
        aria-describedby={locked?.describedBy}
      >
        <Undo2 className="size-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={redo}
        disabled={!canRedo || locked !== undefined}
        aria-label={t(lang, 'chart.history.redo')}
        title={locked?.title ?? t(lang, 'chart.history.redoHint')}
        aria-describedby={locked?.describedBy}
      >
        <Redo2 className="size-4" aria-hidden="true" />
      </Button>
      {/* The story lock covers every history control (see the Undo/Redo
        * `disabled`/`title`/`aria-describedby` pattern above); the popover
        * itself has no equivalent lockable trigger state to wire up, so —
        * simpler — it's just not rendered while the story is open, same as
        * it would be if it had nothing left to show. */}
      {locked === undefined ? (
        <ChartHistoryMenu
          history={history}
          lang={lang}
          onUndoTo={(i) => {
            for (let n = history.past.length - 1 - i; n > 0; n--) undo();
          }}
          onRedoTo={(i) => {
            for (let n = 0; n <= i; n++) redo();
          }}
        />
      ) : null}
    </div>
  );
}
