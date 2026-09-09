// #197 idea 8: small multiples — one mini line chart per series instead of
// one shared chart, the honest alternative to a crowded/misleading shared
// axis. Line charts only (see the plan's Task 2 header for why bar charts
// are out of scope). Reuses chart.tsx's own pure spec-only helpers so the
// plotted values are identical to the combined view, never re-derived.
'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { ChartSpec } from '../backend/chart/types.ts';
import { dotGeometry, LINE_WIDTH_PX, seriesColor, type ChartPresentation } from '../lib/chart-presentation.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { AXIS_COLOR, AxisTick, buildRows, GRID_COLOR, type Row, valueLabelPlan, yAxisDomain } from './chart.tsx';

/** R11 (WP218 gap fix): the hollow provisional marker, same convention as
 * chart.tsx's SeriesDot — but ONLY for a provisional point; a final point
 * renders nothing, exactly like the plain `dot={false}` this replaces. Not
 * reusing SeriesDot itself: that function also carries the end-of-line
 * label and click-to-annotate handlers, neither of which a mini panel
 * offers (no room for either at this size). */
function ProvisionalDot(seriesKey: string, color: string, geometry: { r: number; ring: number }) {
  return function Dot(props: { cx?: number; cy?: number; payload?: Row }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    const value = payload[seriesKey];
    if (value == null) return null;
    if (!payload[`${seriesKey}_provisional`]) return null;
    const resultId = payload[`${seriesKey}_resultId`];
    return (
      <circle
        cx={cx}
        cy={cy}
        r={geometry.r}
        fill="var(--card)"
        stroke={color}
        strokeWidth={geometry.ring}
        data-point="value"
        data-result-id={resultId == null ? undefined : String(resultId)}
      />
    );
  };
}

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
  presentation,
  lang = 'nl',
}: {
  /** WP218 phase 4: ChartView passes its already-translated `displaySpec`
   * (see chart.tsx's `translateSpecForDisplay`) — this component never
   * translates anything itself, only draws whatever spec it is given, same
   * division of labour as `presentation` below. */
  spec: ChartSpec;
  hiddenKeys: Set<string>;
  axisMode: 'shared' | 'own';
  /** WP218 (ADR 039) Phase 0: the resolved effective values from ChartView's
   * own `resolvePresentation` call — this component never resolves overrides
   * itself, only draws them, same division of labour as the combined chart. */
  presentation: ChartPresentation;
  /** WP218 phase 4 (#219): defaults to 'nl' so an existing direct render (a
   * test with no `lang`) keeps its current Dutch output. */
  lang?: Lang;
}) {
  const colorFor = (i: number) => seriesColor(presentation, i);
  const { rows, seriesMeta } = buildRows(spec, colorFor);
  const visible = seriesMeta.map((s, i) => ({ s, i })).filter(({ s }) => !hiddenKeys.has(s.key));
  const domain = axisMode === 'shared' ? sharedLineDomain(spec, visible.map(({ i }) => i)) : undefined;
  const geometry = dotGeometry(presentation.lineWidth);

  return (
    <div role="group" aria-label={t(lang, 'chart.smallMultiplesGroupLabel')} className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
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
          <div key={s.key} className="rounded-lg border border-border p-1.5">
            <div className="truncate text-xs text-muted-foreground" title={s.label}>
              {s.label}
            </div>
            <div className="h-24 w-full" data-panel-for={s.key}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 200, height: 96 }}>
                <LineChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                  {/* Recharts' own default grid/axis geometry (session 87:
                    * "basic Recharts look") in theme colours (AXIS_COLOR/
                    * GRID_COLOR, chart.tsx — the literal #666/#ccc defaults
                    * are illegible in dark mode); only the honesty-bound tick
                    * mechanism is custom. WP218: grid on/off follows
                    * `presentation.grid`, same as the combined chart. */}
                  {presentation.grid !== 'none' ? (
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={GRID_COLOR}
                      // Always true: this element only renders inside the
                      // `presentation.grid !== 'none'` branch above, and
                      // GridMode has no vertical-only option.
                      horizontal
                      vertical={presentation.grid === 'both'}
                    />
                  ) : null}
                  <XAxis dataKey="periodLabel" tick={false} stroke={AXIS_COLOR} />
                  <YAxis
                    ticks={ownTicks.map((t) => t.value)}
                    interval={0}
                    tick={ownTicks.length > 0 ? AxisTick(tickByValue) : false}
                    width={ownTicks.length > 0 ? 28 : 0}
                    domain={domain ?? yAxisDomain(spec.kind)}
                    stroke={AXIS_COLOR}
                  />
                  <Line
                    type="linear"
                    dataKey={s.key}
                    stroke={s.color}
                    strokeWidth={LINE_WIDTH_PX[presentation.lineWidth]}
                    connectNulls={false}
                    dot={ProvisionalDot(s.key, s.color, geometry)}
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
