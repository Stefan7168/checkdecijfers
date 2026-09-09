'use client';

// Click-to-annotate notes (Phase 3, open-questions #212). A note is a plain
// user-typed string anchored to the resultId/period/series the user clicked
// — it is NEVER sent to the LLM, never stored in a ChartSpec or an audit
// record, and it is rendered by the PARENT (chart.tsx) structurally OUTSIDE
// the chart's own chartContainerRef subtree, so it can never be scanned as
// chart data (no R6 token-scan exemption needed) and is automatically
// excluded from the PNG/SVG export (which only ever reads the live <svg>
// inside chartContainerRef). Session-only by owner decision (F): no
// persistence, nothing here survives a reload.
import { useEffect, useState } from 'react';
import { t, type Lang } from '../lib/i18n/messages.ts';

export interface ChartNote {
  id: string;
  resultId: string;
  periodLabel: string;
  seriesLabel: string;
  text: string;
}

export interface PendingPoint {
  resultId: string;
  periodLabel: string;
  seriesLabel: string;
}

export function ChartNotes({
  notes,
  pendingPoint,
  idPrefix,
  lang = 'nl',
  onSave,
  onCancelPending,
  onDelete,
}: {
  notes: ChartNote[];
  pendingPoint: PendingPoint | null;
  /** Unique id prefix for this instance's form controls (e.g. a chart's own
   * `domId`), so two ChartNotes forms open at once on the same page — as
   * happens when Ontdek renders several ChartViews in a grid — never emit
   * the same textarea id. */
  idPrefix: string;
  /** WP218 phase 4 (#219): the resolved chart language ChartView passes down
   * — defaults to 'nl' so an existing direct render (a test with no `lang`)
   * keeps its current Dutch output. */
  lang?: Lang;
  onSave: (text: string) => void;
  onCancelPending: () => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');

  // A click on a DIFFERENT chart point swaps `pendingPoint` (chart.tsx calls
  // setPendingPoint(p) unconditionally on every point click) while this
  // component instance stays mounted. Without this, whatever text was typed
  // for the PREVIOUS point survives into the new point's form and gets
  // saved under the wrong resultId/period/series on the next Opslaan.
  // Compare by resultId — the unique anchor — so this does not also fire
  // (and needlessly reset the same in-progress draft) on unrelated re-renders.
  useEffect(() => {
    setDraft('');
  }, [pendingPoint?.resultId]);

  const noteDraftId = `${idPrefix}-note-draft`;

  if (notes.length === 0 && !pendingPoint) return null;

  function save(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    onSave(trimmed);
    setDraft('');
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-3">
      <div role="heading" aria-level={4} className="text-xs font-semibold text-muted-foreground">
        {t(lang, 'chart.notes.heading')}
      </div>
      {notes.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start justify-between gap-2 text-sm">
              <span>
                <span className="text-xs text-muted-foreground">
                  {note.seriesLabel} · {note.periodLabel}:{' '}
                </span>
                {note.text}
              </span>
              <button
                type="button"
                onClick={() => onDelete(note.id)}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                {t(lang, 'chart.notes.delete')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {pendingPoint ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <label htmlFor={noteDraftId} className="text-xs text-muted-foreground">
            {t(lang, 'chart.notes.draftLabel', { series: pendingPoint.seriesLabel, period: pendingPoint.periodLabel })}
          </label>
          <textarea
            id={noteDraftId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft('');
                onCancelPending();
              }
            }}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              className="min-h-6 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
            >
              {t(lang, 'chart.notes.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft('');
                onCancelPending();
              }}
              className="min-h-6 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {t(lang, 'chart.notes.cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
