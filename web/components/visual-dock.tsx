// WP135 (ADR 033 D4): the right-pane visual dock — a MOUNT-POINT change, not a
// rendering change. Tabs are derived from the messages (visual-dock/dock-visuals
// derivation upstream); each tab renders the SAME ChartView / StatCard component,
// internally unchanged (honesty bindings, PNG export, footer untouched). Tab
// state is never stored — a resumed thread reconstructs it for free. The web
// section NEVER docks (ADR 032): it stays last-in-bubble in the conversation.
'use client';

import type { DockVisual } from '../lib/dock-visuals.ts';
import { ChartView } from './chart.tsx';
import { StatCard } from './stat-card.tsx';

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
    <aside className="flex h-full flex-col gap-2 rounded-lg border border-line bg-paper-raised p-3">
      <div role="tablist" aria-label="Visualisaties" className="flex flex-wrap gap-1">
        {visuals.map((visual) => {
          const selected = visual.id === active.id;
          return (
            <button
              key={visual.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(visual.id)}
              className={
                'max-w-full truncate rounded-full border px-3 py-1 text-xs ' +
                (selected
                  ? 'border-line-strong bg-paper-sunken text-ink'
                  : 'border-line-strong text-ink-soft hover:bg-paper-sunken')
              }
              title={`${visual.label} · ${visual.question}`}
            >
              {visual.label}
              {visual.question !== '' ? <span className="text-ink-muted"> · {visual.question}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="min-w-0">
        {active.kind === 'chart' && active.chart !== null ? (
          <ChartView spec={active.chart} />
        ) : active.card !== null ? (
          <StatCard data={active.card} />
        ) : null}
      </div>
    </aside>
  );
}
