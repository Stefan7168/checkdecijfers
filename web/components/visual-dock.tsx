// WP135 (ADR 033 D4): the right-pane visual dock — a MOUNT-POINT change, not a
// rendering change. Tabs are derived from the messages (visual-dock/dock-visuals
// derivation upstream); each tab renders the SAME ChartView / StatCard component,
// internally unchanged (honesty bindings, PNG export, footer untouched). Tab
// state is never stored — a resumed thread reconstructs it for free. The web
// section NEVER docks (ADR 032): it stays last-in-bubble in the conversation.
//
// ADR 037 D10/WP202a: the `userChart` branch renders UserChartView — its own
// H2 chrome (badge, dashed border, disclaimer) is untouched by mounting it
// here instead of inline, exactly like ChartView/StatCard above.
//
// Session 87 visual redesign (mockup Option B): the dock is its own card with
// a header bar ("Charts" + count) and underline tabs; the CBS ChartView
// renders frameless inside it (its own card border would nest a card in a
// card), while UserChartView keeps its dashed H2 frame — that frame IS the
// user-data-vs-CBS distinction, not decoration.
'use client';

import { useEffect, useRef } from 'react';
import type { DockVisual } from '../lib/dock-visuals.ts';
import { useT } from '../lib/i18n/lang-provider.tsx';
import { cn } from '../lib/utils.ts';
import { ChartView } from './chart.tsx';
import { ChartSkeleton } from './loading-skeletons.tsx';
import { StatCard } from './stat-card.tsx';
import { UserChartView } from './user-chart.tsx';

export function VisualDock({
  visuals,
  activeVisualId,
  onSelect,
  busy,
}: {
  visuals: DockVisual[];
  activeVisualId: string | null;
  onSelect: (visualId: string) => void;
  busy: boolean;
}) {
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const t = useT();
  const active =
    visuals.find((visual) => visual.id === activeVisualId) ?? visuals[visuals.length - 1] ?? null;
  const activeId = active?.id ?? null;

  // Session 87 deep review: the underline tabs scroll horizontally (the old
  // dock wrapped them), and at the default w-96 dock width two tabs already
  // overflow — the newest (auto-activated) tab was rendered half clipped with
  // no scroll affordance. Keep the active tab in view whenever it changes.
  // `scrollIntoView` is absent in jsdom, hence the guard.
  useEffect(() => {
    const tab = activeTabRef.current;
    if (tab && typeof tab.scrollIntoView === 'function') {
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeId]);

  if (active === null) return null;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-sm font-semibold">{t('dock.header')}</span>
        <span className="text-[13px] text-muted-foreground tnum">{visuals.length}</span>
      </div>
      <div
        role="tablist"
        aria-label={t('dock.tablistLabel')}
        className="flex shrink-0 gap-4 overflow-x-auto border-b border-border px-4"
      >
        {visuals.map((visual) => {
          const selected = visual.id === active.id;
          return (
            <button
              key={visual.id}
              ref={selected ? activeTabRef : undefined}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(visual.id)}
              className={cn(
                // min-w-24/shrink (deep review): a few tabs share the row by
                // truncating instead of overflowing; many tabs still scroll.
                '-mb-px min-w-24 max-w-56 shrink truncate border-b-2 py-2.5 text-[13px] font-medium transition-colors',
                selected
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              title={`${visual.label} · ${visual.question}`}
            >
              {visual.label}
              {visual.question !== '' ? <span className="text-muted-foreground"> · {visual.question}</span> : null}
            </button>
          );
        })}
      </div>
      {/* ADR 042: the chart's height now follows its measured width, so a
          scrollbar appearing/disappearing here would change the width and
          re-trigger a height change — a stable gutter keeps the width
          constant (a no-op with overlay scrollbars). */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 [scrollbar-gutter:stable]">
        {busy ? (
          <ChartSkeleton />
        ) : active.kind === 'chart' && active.chart !== null ? (
          <ChartView
            spec={active.chart}
            frameless
            embed={active.auditId !== null ? { auditId: active.auditId } : undefined}
          />
        ) : active.kind === 'userChart' && active.userChart !== null ? (
          <UserChartView spec={active.userChart} />
        ) : active.card !== null ? (
          <StatCard data={active.card} />
        ) : null}
      </div>
    </aside>
  );
}
