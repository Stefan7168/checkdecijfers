// ADR 037 D11 (H2) — the user-data chart renderer. A SEPARATE component from
// ChartView, over a SEPARATE spec type (UserChartSpec — cannot parse as a
// ChartSpec, so the mis-render H2 guards against is structurally impossible,
// not merely styled away). Reuses ChartView's exported pure helpers
// (buildRows, yAxisDomain, valueLabelPlan, AxisTick, ChartTooltip,
// seriesStyle) over an adapter mapping UserChartPoint -> the minimal
// PlottableSpec interface those helpers actually need (rowRef := resultId,
// xKey := periodCode, xLabel := periodLabel) — no runtime change to
// chart.tsx, per its own header comment.
//
// v1 scope, deliberately smaller than ChartView: no small multiples, no
// table view, no per-point/per-bar value labels (those render via
// chart.tsx-internal SeriesDot/SeriesBar, not in the design doc's reuse
// list), no trend headline, no CSV export (D11 names a CSV-injection
// defense a "Download als CSV" of user data would need — not built here;
// tracked as a follow-up alongside the table view). What v1 DOES carry:
// the axis + tooltip + Y-axis min/max ticks (still real spec strings, never
// invented), the download-as-image menu (PNG/SVG — no CSV-specific risk),
// and every H2 chrome requirement (badge, dashed border, provenance +
// disclaimer footer, no SourceBadge/StatLine/license line).
'use client';

import { useRef } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LINE_WIDTH_PX, STOCK_PRESENTATION } from '../lib/chart-presentation.ts';
import {
  AxisTick,
  buildRows,
  AXIS_COLOR,
  ChartTooltip,
  GRID_COLOR,
  valueLabelPlan,
  yAxisDomain,
  type PlottableSpec,
} from './chart.tsx';
import { ChartDownloadMenu } from './chart-download.tsx';
import type { UserChartSpec } from '../backend/attachments/types.ts';
import { USER_DATA_BADGE } from '../backend/attachments/types.ts';

/** The ONE place a UserChartSpec is narrowed to the minimal shape
 * buildRows/valueLabelPlan need — every plotted string still comes straight
 * from the spec's own `formattedValue`/`xLabel` (R6-analog: no reformatting,
 * no computation), only the field NAMES are adapted. `provisional: false`
 * throughout — this tier has no CBS publication-status concept (D7: v1
 * performs no arithmetic and carries no provisional/definitief distinction
 * at all), so nothing here is ever marked provisional. */
function toPlottableSpec(spec: UserChartSpec): PlottableSpec {
  return {
    kind: spec.kind,
    series: spec.series.map((series) => ({
      label: series.label,
      points: series.points.map((point) => ({
        periodCode: point.xKey,
        periodLabel: point.xLabel,
        value: point.value,
        formattedValue: point.formattedValue,
        provisional: false,
        resultId: point.rowRef,
      })),
    })),
  };
}

const KEYBOARD_HINT = 'Use the arrow keys to move through the chart’s points.';

export function UserChartView({ spec }: { spec: UserChartSpec }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plottable = toPlottableSpec(spec);
  const { rows, seriesMeta } = buildRows(plottable);
  const plan = valueLabelPlan(plottable);
  const tickByValue = new Map(plan.axisTicks.map((tick) => [tick.value, tick]));
  const heading = `${spec.yHeaders.join(', ')} by ${spec.xHeader}`;
  const accessibleName = `Chart: ${heading}`;
  const uploadedOn = spec.provenance.capturedAt.slice(0, 10);
  // `rows.length` is THIS CHART's own plotted x-categories (post filter/limit)
  // — not the dataset's total row count (the profile card shows that,
  // elsewhere) — worded "points plotted" so the two are never conflated.
  const provenanceLine = `From file ${spec.provenance.displayName}, uploaded ${uploadedOn} · ${rows.length} points plotted`;

  return (
    // H2: the dashed frame is what tells a user-data chart apart from a CBS
    // one at a glance — it stays in every mount point, dock included.
    <div className="mt-3 rounded-xl border-2 border-dashed border-border bg-card p-4 text-card-foreground">
      <div className="mb-2 inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
        {USER_DATA_BADGE}
      </div>
      <div role="heading" aria-level={3} className="text-sm font-semibold text-foreground">
        {heading}
      </div>
      <div ref={containerRef} className="mt-2 h-64 w-full touch-pan-y">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 256 }}>
          {spec.kind === 'line' ? (
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} desc={KEYBOARD_HINT} aria-label={accessibleName}>
              {/* Theme axis/grid colours (AXIS_COLOR/GRID_COLOR, chart.tsx):
                * Recharts' literal #666/#ccc defaults are illegible in dark mode. */}
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="periodLabel" stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} />
              <YAxis
                ticks={plan.axisTicks.map((t) => t.value)}
                interval={0}
                tick={plan.axisTicks.length > 0 ? AxisTick(tickByValue) : false}
                width={plan.axisTicks.length > 0 ? 48 : 16}
                domain={yAxisDomain(spec.kind)}
                stroke={AXIS_COLOR}
              />
              <Tooltip content={<ChartTooltip seriesMeta={seriesMeta} />} />
              {seriesMeta.map((s) => (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={LINE_WIDTH_PX[STOCK_PRESENTATION.lineWidth]}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} desc={KEYBOARD_HINT} aria-label={accessibleName}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="periodLabel" stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} />
              <YAxis tick={false} width={16} domain={yAxisDomain(spec.kind)} stroke={AXIS_COLOR} />
              <Tooltip content={<ChartTooltip seriesMeta={seriesMeta} />} />
              {seriesMeta.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} isAnimationActive={false} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {seriesMeta.length > 1 ? (
        <ul className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {seriesMeta.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          <p>{provenanceLine}</p>
          <p>{spec.disclaimerLine}</p>
        </div>
        <ChartDownloadMenu
          containerRef={containerRef}
          attributionText={`${spec.disclaimerLine} · checkdecijfers.nl`}
          filenameBase={`checkdecijfers-your-data-${spec.provenance.datasetId}`}
        />
      </div>
    </div>
  );
}
