// #197 idea 8: small multiples — one mini line chart per series instead of
// one shared chart, the honest alternative to a crowded/misleading shared
// axis. Line charts only (see the plan's Task 2 header for why bar charts
// are out of scope). Reuses chart.tsx's own pure spec-only helpers so the
// plotted values are identical to the combined view, never re-derived.
'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { ChartSpec } from '../backend/chart/types.ts';
import { AxisTick, buildRows, valueLabelPlan, yAxisDomain } from './chart.tsx';

// Exported for direct testing (same pattern as chart.tsx's buildRows/
// seriesStyle/valueLabelPlan): the actual y-domain math is what "gelijke
// assen" vs "eigen assen" hinges on, and Recharts renders it as raw SVG path
// geometry with no data-attribute to bind a DOM assertion to -- a unit test
// on the real computation is more robust than inferring it from pixels.
export function sharedLineDomain(spec: ChartSpec, visibleIndexes: number[]): [number, number] | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const i of visibleIndexes) {
    for (const point of spec.series[i].points) {
      if (point.value === null) continue;
      if ((point.value as number) < min) min = point.value as number;
      if ((point.value as number) > max) max = point.value as number;
    }
  }
  if (min === Infinity) return undefined;
  return [min, max];
}

export function ChartSmallMultiples({
  spec,
  hiddenKeys,
  axisMode,
}: {
  spec: ChartSpec;
  hiddenKeys: Set<string>;
  axisMode: 'shared' | 'own';
}) {
  const { rows, seriesMeta } = buildRows(spec);
  const visible = seriesMeta.map((s, i) => ({ s, i })).filter(({ s }) => !hiddenKeys.has(s.key));
  const domain = axisMode === 'shared' ? sharedLineDomain(spec, visible.map(({ i }) => i)) : undefined;

  return (
    <div role="group" aria-label="Kleine grafieken per reeks" className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {visible.map(({ s, i }) => {
        // "Eigen assen": each panel auto-scales to only its own data, so a
        // shape alone can't be honestly compared across panels -- label it
        // with its OWN min/max, computed the same way the combined chart
        // does (valueLabelPlan, so it's still only ever a point's own
        // formattedValue, never a re-derived number). "Gelijke assen" needs
        // no such label: every panel shares the identical domain by
        // construction, so their shapes ARE directly, honestly comparable
        // without it -- and labelling a shared endpoint that belongs to a
        // DIFFERENT series' data here would itself be dishonest.
        const ownTicks = axisMode === 'own' ? valueLabelPlan({ ...spec, series: [spec.series[i]] }).axisTicks : [];
        const tickByValue = new Map(ownTicks.map((t) => [t.value, t]));
        return (
          <div key={s.key} className="rounded border border-line p-1">
            <div className="truncate text-xs text-ink-soft" title={s.label}>
              {s.label}
            </div>
            <div className="h-24 w-full" data-panel-for={s.key}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 200, height: 96 }}>
                <LineChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="periodLabel" tick={false} />
                  <YAxis
                    ticks={ownTicks.map((t) => t.value)}
                    interval={0}
                    tick={ownTicks.length > 0 ? AxisTick(tickByValue) : false}
                    width={ownTicks.length > 0 ? 28 : 0}
                    domain={domain ?? yAxisDomain(spec.kind)}
                  />
                  <Line
                    type="linear"
                    dataKey={s.key}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dasharray}
                    connectNulls={false}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
