'use client';
// WP-LOOK part (b) (session 143, 2026-09-29, ADR 063): the Edit popup's
// three sections — Grafiek · Markeringen · Opmaak — as one accessible tab
// strip. Same pattern the repo already uses twice (the form tablist in
// chart.tsx, the Style panel's own tabs in chart-config-panel.tsx): native
// <button role="tab">, roving tabindex, Left/Right/Home/End keys, the panel
// wired with aria-controls / aria-labelledby. No new dependency (there is no
// Tabs primitive under components/ui and the cheapest mechanism wins).
//
// Only the ACTIVE panel is rendered by the caller (chart.tsx) — a hidden
// Style panel would otherwise keep 1,900 lines of controls mounted for
// nothing. A disabled tab (Opmaak in table form) stays in the strip, greyed,
// with a `title` saying why, so the reader learns the section exists.
import type { KeyboardEvent, ReactNode } from 'react';
import { t, type Lang } from '../lib/i18n/messages.ts';

export type ChartEditTabId = 'chart' | 'marks' | 'style';

export interface ChartEditTab {
  id: ChartEditTabId;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function chartEditTabId(idPrefix: string, id: ChartEditTabId): string {
  return `${idPrefix}-edit-tab-${id}`;
}

export function chartEditPanelId(idPrefix: string, id: ChartEditTabId): string {
  return `${idPrefix}-edit-panel-${id}`;
}

export function ChartEditTabs({
  tabs,
  active,
  onChange,
  idPrefix,
  lang,
}: {
  tabs: readonly ChartEditTab[];
  active: ChartEditTabId;
  onChange: (id: ChartEditTabId) => void;
  idPrefix: string;
  lang: Lang;
}): ReactNode {
  const enabled = tabs.filter((tab) => !tab.disabled);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key) || enabled.length === 0) return;
    event.preventDefault();
    const index = Math.max(0, enabled.findIndex((tab) => tab.id === active));
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % enabled.length
            : (index - 1 + enabled.length) % enabled.length;
    const target = enabled[next]!;
    onChange(target.id);
    document.getElementById(chartEditTabId(idPrefix, target.id))?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t(lang, 'chart.edit.tabsLabel')}
      onKeyDown={onKeyDown}
      className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
      data-slot="chart-edit-tabs"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={chartEditTabId(idPrefix, tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={chartEditPanelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            title={tab.disabled ? tab.disabledReason : undefined}
            onClick={() => onChange(tab.id)}
            className={
              'min-h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 ' +
              (selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** A labelled group inside a tab panel: a small muted label above its
 * controls, the repo's quiet style. */
export function ChartEditField({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1.5" data-slot="chart-edit-field">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
