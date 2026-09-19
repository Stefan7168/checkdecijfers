'use client';

// Era shading (Phase 4, chart co-pilot): reader-marked period ranges with
// typed labels. Like notes, era shadings are NEVER sent to the LLM, never
// stored in a ChartSpec or an audit record: they are the reader's own
// annotation, never checked against a CBS cell.
//
// THIS component renders only the text list and the add/remove form, and it
// stays OUTSIDE the chart's own chartContainerRef subtree, so the reader's
// typed LABEL text is automatically excluded from PNG/SVG export. The shaded
// BAND itself is drawn separately, as a `<ReferenceArea>` inside chart.tsx's
// own chart JSX ("Task 3 (phase 4)" block) — that band renders INSIDE
// chartContainerRef and DOES appear in downloads/embeds (the C2/I5
// final-review ruling); only the label text this component renders stays
// excluded.
//
// Final-review fix I5: this used to say "Session-only by design" — wrong.
// For a signed-in reader on a saved chart, the WHOLE command (including
// `addEraShading`) is part of the saved command log (use-chart-edits.ts) and
// is replayed on reload, exactly like every other chart-copilot command —
// not specific to era shading.
import { useEffect, useRef, useState } from 'react';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { CHART_ERA_SHADING_LABEL_MAX_LENGTH } from '../lib/chart-commands.ts';
import type { EraShading } from '../lib/chart-commands.ts';

export interface PeriodOption {
  code: string;
  label: string;
}

export function ChartEraShading({
  eraShadings,
  periodOptions,
  onAdd,
  onRemove,
  lang = 'nl',
  idPrefix,
}: {
  eraShadings: EraShading[];
  periodOptions: PeriodOption[];
  onAdd: (fromPeriodCode: string, toPeriodCode: string, label: string) => void;
  onRemove: (id: string) => void;
  lang?: Lang;
  idPrefix: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [fromPeriod, setFromPeriod] = useState(periodOptions[0]?.code ?? '');
  const [toPeriod, setToPeriod] = useState(periodOptions[0]?.code ?? '');
  const [label, setLabel] = useState('');
  const triggerElRef = useRef<HTMLElement | SVGElement | null>(null);

  useEffect(() => {
    // Initialize to/from with the first option if not already set
    if (periodOptions.length > 0) {
      if (!fromPeriod) setFromPeriod(periodOptions[0].code);
      if (!toPeriod) setToPeriod(periodOptions[0].code);
    }
  }, [periodOptions, fromPeriod, toPeriod]);

  function save(): void {
    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0) return;
    // Guard against inverted from/to: if from > to, swap them
    const [from, to] = fromPeriod > toPeriod ? [toPeriod, fromPeriod] : [fromPeriod, toPeriod];
    onAdd(from, to, trimmedLabel);
    setLabel('');
    setFromPeriod(periodOptions[0]?.code ?? '');
    setToPeriod(periodOptions[0]?.code ?? '');
    setIsOpen(false);
    triggerElRef.current?.focus();
  }

  function cancel(): void {
    setLabel('');
    setIsOpen(false);
    triggerElRef.current?.focus();
  }

  const eraFormId = `${idPrefix}-era-form`;
  const fromSelectId = `${idPrefix}-era-from`;
  const toSelectId = `${idPrefix}-era-to`;
  const labelInputId = `${idPrefix}-era-label`;

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-3">
      <div role="heading" aria-level={4} className="text-xs font-semibold text-muted-foreground">
        {t(lang, 'chart.eraShading.heading')}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{t(lang, 'chart.eraShading.sessionOnly')}</p>
      {eraShadings.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {eraShadings.map((era) => (
            <li key={era.id} className="flex items-start justify-between gap-2 text-sm">
              <span>
                <span className="text-xs text-muted-foreground">
                  {era.fromPeriodCode} – {era.toPeriodCode}:{' '}
                </span>
                {era.label}
              </span>
              <button
                type="button"
                data-command-kind="removeEraShading"
                onClick={() => onRemove(era.id)}
                aria-label={t(lang, 'chart.eraShading.deleteAriaLabel', { period: `${era.fromPeriodCode}–${era.toPeriodCode}` })}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                {t(lang, 'chart.eraShading.delete')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!isOpen ? (
        <button
          type="button"
          onClick={() => {
            const active = document.activeElement;
            triggerElRef.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
            setIsOpen(true);
          }}
          className="mt-2 min-h-6 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
        >
          {t(lang, 'chart.eraShading.trigger')}
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-0.5">
              <label htmlFor={fromSelectId} className="text-xs text-muted-foreground">
                {t(lang, 'chart.eraShading.fromLabel')}
              </label>
              <select
                id={fromSelectId}
                value={fromPeriod}
                onChange={(e) => setFromPeriod(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              >
                {periodOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 flex flex-col gap-0.5">
              <label htmlFor={toSelectId} className="text-xs text-muted-foreground">
                {t(lang, 'chart.eraShading.toLabel')}
              </label>
              <select
                id={toSelectId}
                value={toPeriod}
                onChange={(e) => setToPeriod(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              >
                {periodOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <label htmlFor={labelInputId} className="text-xs text-muted-foreground">
              {t(lang, 'chart.eraShading.labelLabel')}
            </label>
            <input
              id={labelInputId}
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, CHART_ERA_SHADING_LABEL_MAX_LENGTH))}
              maxLength={CHART_ERA_SHADING_LABEL_MAX_LENGTH}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  cancel();
                }
              }}
              placeholder={t(lang, 'chart.eraShading.labelPlaceholder')}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              data-command-kind="addEraShading"
              onClick={save}
              className="min-h-6 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
            >
              {t(lang, 'chart.eraShading.save')}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="min-h-6 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {t(lang, 'chart.eraShading.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
