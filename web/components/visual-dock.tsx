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

import type { DockVisual } from '../lib/dock-visuals.ts';
import { cn } from '../lib/utils.ts';
import { ChartView } from './chart.tsx';
import { StatCard } from './stat-card.tsx';
import { UserChartView } from './user-chart.tsx';

export function VisualDock({
  visuals,
  activeVisualId,
  onSelect,
}: {
  visuals: DockVisual[];
  activeVisualId: string | null;
  onSelect: (visualId: string) => void;
}) {
  if (visuals.length === 0) return null;
  const active =
    visuals.find((visual) => visual.id === activeVisualId) ?? visuals[visuals.length - 1]!;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-sm font-semibold">Charts</span>
        <span className="text-[13px] text-muted-foreground tnum">{visuals.length}</span>
      </div>
      <div
        role="tablist"
        aria-label="Visualisaties"
        className="flex shrink-0 gap-4 overflow-x-auto border-b border-border px-4"
      >
        {visuals.map((visual) => {
          const selected = visual.id === active.id;
          return (
            <button
              key={visual.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(visual.id)}
              className={cn(
                '-mb-px max-w-56 shrink-0 truncate border-b-2 py-2.5 text-[13px] font-medium transition-colors',
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
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {active.kind === 'chart' && active.chart !== null ? (
          <ChartView spec={active.chart} frameless />
        ) : active.kind === 'userChart' && active.userChart !== null ? (
          <UserChartView spec={active.userChart} />
        ) : active.card !== null ? (
          <StatCard data={active.card} />
        ) : null}
      </div>
    </aside>
  );
}
