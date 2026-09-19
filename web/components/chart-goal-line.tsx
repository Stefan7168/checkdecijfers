'use client';

// Reader-typed goal lines (Phase 4, WP218). A goal line is a user-typed target
// value and label — it is NEVER sent to the LLM, never stored in a ChartSpec
// or an audit record: it is the reader's own annotation, never checked
// against a CBS cell.
//
// THIS component renders only the text list and the add/remove form, and it
// stays structurally OUTSIDE the chart's own chartContainerRef subtree, so
// the reader's typed LABEL text can never be scanned as chart data (no R6
// token-scan exemption needed) and never enters a PNG/SVG export. The goal
// VALUE is drawn separately, as a `<ReferenceLine>` inside chart.tsx's own
// chart JSX (see chart.tsx's "Task 3 (phase 4)" block / the C2 final-review
// fix) — that line renders INSIDE chartContainerRef and DOES appear in
// downloads/embeds; only this component's own list/label text stays
// excluded.
//
// Final-review fix I5: this used to say "Session-only by owner decision (F):
// no persistence, nothing here survives a reload" — wrong. For a signed-in
// reader on a saved chart, the WHOLE command (including `addGoalLine`) is
// part of the saved command log (use-chart-edits.ts) and is replayed on
// reload, exactly like every other chart-copilot command. It is session-only
// only in the sense that an anonymous/embed/no-saved-row viewer never gets a
// chart_edits row to save to at all — the same rule every other command in
// this file's vocabulary already follows, not something specific to goal
// lines.
import { useState } from 'react';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { CHART_GOAL_LINE_LABEL_MAX_LENGTH, type GoalLine } from '../lib/chart-commands.ts';

export function ChartGoalLine({
  goalLines,
  idPrefix,
  lang = 'nl',
  onAdd,
  onRemove,
}: {
  goalLines: GoalLine[];
  /** Unique id prefix for this instance's form controls (e.g. a chart's own
   * `domId`), so two ChartGoalLine forms open at once on the same page never
   * emit the same input id. */
  idPrefix: string;
  /** WP218 phase 4 (#219): the resolved chart language ChartView passes down
   * — defaults to 'nl' so an existing direct render (a test with no `lang`)
   * keeps its current Dutch output. */
  lang?: Lang;
  onAdd: (value: number, label: string) => void;
  onRemove: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [draftLabel, setDraftLabel] = useState('');

  const goalLineValueId = `${idPrefix}-goalline-value`;
  const goalLineLabelId = `${idPrefix}-goalline-label`;

  function save(): void {
    const value = parseFloat(draftValue);
    const label = draftLabel.trim();
    if (!isNaN(value) && label.length > 0 && label.length <= CHART_GOAL_LINE_LABEL_MAX_LENGTH) {
      onAdd(value, label);
      setDraftValue('');
      setDraftLabel('');
      setShowForm(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-3">
      <div role="heading" aria-level={4} className="text-xs font-semibold text-muted-foreground">
        {t(lang, 'chart.goalLine.heading')}
      </div>
      {/* Goal lines are session-only and excluded from every download/embed
        * by construction (ADR 038) — this is the disclosure that says so. */}
      <p className="mt-0.5 text-[11px] text-muted-foreground">{t(lang, 'chart.goalLine.sessionOnly')}</p>
      {goalLines.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {goalLines.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                <span className="text-xs text-muted-foreground">{line.value}: </span>
                {line.label}
              </span>
              <button
                type="button"
                data-command-kind="removeGoalLine"
                onClick={() => onRemove(line.id)}
                aria-label={t(lang, 'chart.goalLine.removeAriaLabel', { label: line.label })}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                {t(lang, 'chart.goalLine.delete')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-2 min-h-6 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
        >
          {t(lang, 'chart.goalLine.add')}
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          <div>
            <label htmlFor={goalLineValueId} className="text-xs text-muted-foreground">
              {t(lang, 'chart.goalLine.valueLabel')}
            </label>
            <input
              id={goalLineValueId}
              type="number"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDraftValue('');
                  setDraftLabel('');
                  setShowForm(false);
                }
              }}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              placeholder="0"
            />
          </div>
          <div>
            <label htmlFor={goalLineLabelId} className="text-xs text-muted-foreground">
              {t(lang, 'chart.goalLine.textLabel')}
            </label>
            <input
              id={goalLineLabelId}
              type="text"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDraftValue('');
                  setDraftLabel('');
                  setShowForm(false);
                }
              }}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              placeholder={t(lang, 'chart.goalLine.textLabel')}
              maxLength={CHART_GOAL_LINE_LABEL_MAX_LENGTH}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              data-command-kind="addGoalLine"
              onClick={save}
              className="min-h-6 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
            >
              {t(lang, 'chart.goalLine.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftValue('');
                setDraftLabel('');
                setShowForm(false);
              }}
              className="min-h-6 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {t(lang, 'chart.goalLine.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
