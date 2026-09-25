'use client';
// Chart-card render helpers (session 128, chart.tsx split): every module-
// level tooltip, axis tick, overlay and bar/dot shape component moved
// verbatim OUT of chart.tsx — same names, same JSX, same comments, no
// behaviour change. chart.tsx re-exports the three of these (ChartTooltip,
// RegionTooltip, AxisTick) that were part of its own public API before this
// split, and imports every other one directly for use inside `ChartView`'s
// own render tree. The pure, React-free types/constants/builder functions
// these components read (Row, SeriesMeta, RegionChartRow, formatOverlayValue,
// heatmapModel, …) live in the sibling `../lib/chart-models.ts` instead.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  DefaultZIndexes,
  ReferenceLine,
  usePlotArea,
  useXAxisScale,
  useXAxisTicks,
  useYAxisScale,
  ZIndexLayer,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import type { ChartSpec } from '../backend/chart/types.ts';
import { dotGeometry, markerVisible } from '../lib/chart-presentation.ts';
import type { MarkerMode, SeriesEndpoints } from '../lib/chart-presentation.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import type { PendingPoint } from './chart-notes.tsx';
import type { DerivationRecord } from '../../src/query/types.ts';
import {
  AXIS_COLOR,
  formatOverlayValue,
  heatmapCellColor,
  heatmapIntensity,
  heatmapModel,
  type AxisTickLabel,
  type DumbbellEnd,
  type DumbbellRow,
  type HbarLabelMode,
  type PointLabel,
  type RegionChartRow,
  type Row,
  type SeriesMeta,
} from '../lib/chart-models.ts';

/** The heatmap canvas: a CSS grid with ARIA table semantics (rows are
 * `display: contents` so the grid's columns line up across every row while a
 * screen reader still hears row/column headers). Column headers = the
 * model's header minus its corner label (same skip the table's own `<th>`
 * loop makes by indexing `header[i + 1]`), row headers = each row's label.
 * `pres` does not apply here — like the table, this view has no line
 * thickness, grid lines or frame to style. */
export function HeatmapGrid({ spec, lang }: { spec: ChartSpec; lang: Lang }) {
  const model = heatmapModel(spec, lang);
  const columns = model.header.length - 1;
  return (
    <div
      role="table"
      aria-label={model.caption}
      data-testid="heatmap-grid"
      className="grid w-full text-sm"
      style={{ gridTemplateColumns: `max-content repeat(${columns}, minmax(0, 1fr))` }}
    >
      <div role="row" className="contents">
        {model.header.map((h, i) => (
          <div
            key={h}
            role="columnheader"
            className={`border-b border-border px-2 py-1 font-medium text-muted-foreground ${i === 0 ? 'text-left' : 'text-right'}`}
          >
            {h}
          </div>
        ))}
      </div>
      {model.rows.map((row) => (
        <div key={row.label} role="row" className="contents">
          <div role="rowheader" className="border-b border-border px-2 py-1 text-left font-normal text-foreground">
            {row.label}
          </div>
          {row.cells.map((cell, i) => (
            <div
              key={model.header[i + 1] ?? i}
              role="cell"
              data-label-for={cell.resultId}
              className="border-b border-border px-2 py-1 text-right text-foreground tabular-nums"
              style={{ backgroundColor: heatmapCellColor(heatmapIntensity(cell.value, model.min, model.max)) }}
            >
              {cell.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface TooltipPayloadEntry {
  dataKey: string;
  color: string;
  payload: Row;
}

// Exported for direct testing: the tooltip is the one place displayed value
// strings are assembled, so its binding contract is test-pinned (WP12 review).
// #197: a polite live region — Recharts' accessibility layer lets keyboard
// users arrow through the points, and its own default tooltip was a live
// region; this custom replacement (needed for the honesty contract) had
// dropped that, so nothing was announced while navigating.
export function ChartTooltip({
  active,
  payload,
  label,
  seriesMeta,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  seriesMeta: SeriesMeta[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const labelByKey = new Map(seriesMeta.map((s) => [s.key, s.label]));
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-w-36 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
    >
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {payload.map((entry) => {
        const display = entry.payload[`${entry.dataKey}_display`];
        if (display == null) return null;
        const provisional = entry.payload[`${entry.dataKey}_provisional`];
        const resultId = entry.payload[`${entry.dataKey}_resultId`];
        // Session 87 deep review: the series colour is a SWATCH, not the text
        // colour — with the Recharts default palette two of the first three
        // colours (#82ca9d, #ffc658) read at <2:1 on the white popover, and
        // this tooltip is the one place an arbitrary point's exact value is
        // shown. The text itself stays popover-foreground in both themes.
        return (
          <div
            key={entry.dataKey}
            className="flex items-center gap-1.5"
            data-label-for={resultId == null ? undefined : String(resultId)}
          >
            <span
              aria-hidden="true"
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            {/* #260 (session 129): the series name left, its value right in
              * tabular figures — same two spec strings as before, laid out as
              * a card row. The ':' stays (visually quiet) so the node's text
              * still reads "Label: value" to a screen reader and a copy. */}
            <span className="text-muted-foreground">{labelByKey.get(entry.dataKey)}:</span>
            <span className="ml-auto pl-3 font-medium tabular-nums">
              {String(display)}
              {provisional ? ' *' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Exported for direct testing, mirroring ChartTooltip: the horizontal-bar
// form's own tooltip. One row = one region, so unlike ChartTooltip (which
// walks a payload array of every series at a shared period) this composes a
// SINGLE line — "{sharedPeriodLabel}: {value_display}" plus the same ' *'
// provisional suffix used everywhere else, bound to the row's own resultId.
// The region name comes straight off the row (payload.label, a spec string)
// rather than Recharts' own derived tooltip `label` prop, whose exact source
// for a layout="vertical" category axis is an internal Recharts detail this
// file should not depend on.
export function RegionTooltip({
  active,
  payload,
  periodLabel,
}: {
  active?: boolean;
  payload?: { payload: RegionChartRow }[];
  periodLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (row.value_display == null) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
    >
      <div className="font-medium">{row.label}</div>
      <div data-label-for={row.value_resultId ?? undefined}>
        {periodLabel}: {row.value_display}
        {row.value_provisional ? ' *' : ''}
      </div>
    </div>
  );
}

/** Task 3 (Story-stage plan, ADR 044): stage mode's legend — the same
 * swatch/label pairing as `SeriesLegend` above, but plain `<span>` chips with
 * no `aria-pressed`, no handlers, no highlight button: the stage offers no
 * hide/highlight controls, so nothing here is interactive. */
export function StageLegend({ seriesMeta, lang }: { seriesMeta: SeriesMeta[]; lang: Lang }) {
  return (
    <div role="list" aria-label={t(lang, 'chart.seriesGroupLabel')} className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {seriesMeta.map((s) => (
        <span
          key={s.key}
          role="listitem"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
        >
          <span
            aria-hidden="true"
            style={{ backgroundColor: s.color }}
            className="inline-block h-2.5 w-2.5 rounded-full"
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

// ADR 042: value labels are 12 px with a card-coloured halo (paint-order
// stroke), so they stay legible where they cross a line or bar; the export
// inliner resolves var(--card) against the light card (#222). Shared by all
// three value-label `<text>` elements below (SeriesDot's end label,
// SeriesBar's bar label, RegionBar's bar label) so the five attributes never
// drift apart between them.
const VALUE_LABEL_PROPS = { fontSize: 12, paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3, strokeLinejoin: 'round' } as const;

// Session 110 UX audit pass 4, rows 1 and 3: value labels used to be drawn
// INSIDE each series' own shape/dot render (one `<g>` per series, per bar —
// SeriesBar; a `<text>` sibling of each end point's `<circle>` — SeriesDot).
// Recharts paints series in the order their `<Bar>`/`<Line>` JSX appears, so
// a LATER series' `<rect>`s (row 1) painted OVER an EARLIER series' label —
// screen showed `45.58` for a cell whose real formattedValue is `45.587`,
// an R1/R6 violation (a truncated verbatim projection). Two adjacent
// end-of-line labels (row 3) had no collision pass at all and could smear
// into each other by a few px, same root cause: nothing decided paint order
// or spacing ACROSS series.
//
// First attempt, rejected: draw every label in ONE plain `<g>` mounted as
// the LAST child of the `<BarChart>`/`<LineChart>`, on the assumption that
// Recharts 3.x paints arbitrary children in JSX order. Measured false: this
// version DOES render its own known graphical items (Bar, Line, Area, …)
// through an internal Z-INDEX system (`DefaultZIndexes` — grid -100, bar
// 300, line 400, axis 500, label 2000, …), with each one portaled into a
// dedicated z-order bucket regardless of JSX position; a plain custom `<g>`
// with no zIndex lands in the unlabelled default bucket, which sits BELOW
// `bar`'s — so the "last JSX child" assumption held for nothing rendered
// through a `<Bar>`/`<Line>`, and the labels stayed hidden under them.
//
// Actual fix: `ZIndexLayer` (Recharts 3.4+, exported alongside
// `DefaultZIndexes`) is the documented, supported way to place arbitrary
// content in a specific z-order bucket — it portals its children into the
// chart's own zIndex-2000 "label" layer (the SAME bucket Recharts' own
// `LabelList`/`Label` use), which sits above every graphical item bucket.
// Every SeriesBar wraps its OWN label in `<ZIndexLayer zIndex={
// DefaultZIndexes.label}>` at the point it already knows its real, current
// x/y/width/height (no ref, no portal target of our own, no cross-render
// timing to reason about — this is a plain, ordinary child of that one
// Shape render). Row 3's `EndLabelsOverlay` (below) draws every chart's end
// labels together (it needs to, for the collision pass) and wraps its
// WHOLE returned group the same way.
export interface EndLabelSpec {
  resultId: string;
  periodLabel: string;
  value: number;
  text: string;
  /** Row 14: true when `text` had its period prefix dropped because every
   * plotted series shares this same end period (see `valueLabelPlan`). Lets
   * `EndLabelsOverlay` reinstate the period on the one label that stays
   * on-screen when the x-axis itself renders no ticks at this width — never
   * used to decide whether to draw the label at all, only how to word it. */
  periodOmitted: boolean;
}

/** Row 3: the line height a value label needs to stay legible (12px font +
 * the halo, ADR 042's VALUE_LABEL_PROPS). Two end-of-line labels closer than
 * this on the y axis read as smeared digits. */
const END_LABEL_LINE_HEIGHT_PX = 13;

/** Row 3: computes every end-of-line label's real pixel position from
 * Recharts' own settled scales — `useXAxisScale`/`useYAxisScale` (Recharts
 * 3.x's documented way for an arbitrary descendant to read the chart's
 * finalized layout) applied to each label's own already-plotted VALUE and
 * period, never a re-derivation or a guess — resolves collisions (sort by
 * the resulting `cy`, stack labels closer than a line height apart, drop
 * one only if it would spill past `usePlotArea`'s real measured bottom
 * rather than truncate it or let it overflow into the x-axis: the value
 * stays fully readable in the tooltip, legend and Tabel view, per
 * principle (c) — never a half-shown number), and paints the result inside
 * the shared `label` zIndex layer (see the block comment above).
 *
 * Row 14: when `valueLabelPlan` dropped the shared period prefix (every
 * series ends on the same period), that period must still appear on screen
 * SOMEWHERE — normally the x-axis's own last tick already shows it. But at a
 * narrow width the x-axis can render NO ticks at all (session-110 pass-4 row
 * 2's own 375px/6-region measurement: `xTicks: []`), which would leave the
 * period stated nowhere. `useXAxisTicks()` reads Recharts' own settled,
 * POST-collision tick list (the same one the XAxis element actually draws,
 * not a width estimate of our own), so when it comes back empty the topmost
 * label after THIS component's own collision pass (`placed[0]` — sorted by
 * `cy` above) gets its period prefix put back, exactly once. */
export function EndLabelsOverlay({ specs }: { specs: EndLabelSpec[] }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plotArea = usePlotArea();
  const xAxisTicks = useXAxisTicks();
  if (!xScale || !yScale || specs.length === 0) return null;
  const bottom = plotArea ? plotArea.y + plotArea.height : Number.POSITIVE_INFINITY;
  const positioned = specs
    .map((s) => ({ ...s, cx: Number(xScale(s.periodLabel)), cy: Number(yScale(s.value)) }))
    .filter((s) => Number.isFinite(s.cx) && Number.isFinite(s.cy))
    .sort((a, b) => a.cy - b.cy);
  const placed: Array<EndLabelSpec & { cx: number; y: number }> = [];
  for (const draw of positioned) {
    let y = draw.cy;
    const prev = placed[placed.length - 1];
    if (prev && y - prev.y < END_LABEL_LINE_HEIGHT_PX) {
      y = prev.y + END_LABEL_LINE_HEIGHT_PX;
    }
    if (y + 4 > bottom) continue;
    placed.push({ ...draw, y });
  }
  const xAxisIsTickless = (xAxisTicks?.length ?? 0) === 0;
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g>
        {placed.map((l, i) => (
          <text
            key={l.resultId}
            x={l.cx + 8}
            y={l.y + 4}
            {...VALUE_LABEL_PROPS}
            fill="var(--foreground)"
            textAnchor="start"
            data-role="end-label"
            data-label-for={l.resultId}
          >
            {i === 0 && l.periodOmitted && xAxisIsTickless ? `${l.periodLabel}: ${l.text}` : l.text}
          </text>
        ))}
      </g>
    </ZIndexLayer>
  );
}

/** Phase 5 (Task 3): a dumbbell row as the overlay draws it — the pure
 * `DumbbellRow` (buildDumbbellRows) plus the SAME resolved colour and
 * highlight-dimming every other form derives from `seriesMeta`/
 * `state.highlightedKey`, joined in ChartView on the shared `s${i}` key. */
export interface DumbbellChartRow extends DumbbellRow {
  color: string;
  dimmed: boolean;
}

/** Dot radius and the gap between a dot's edge and its label. */
const DUMBBELL_DOT_R = 5;
const DUMBBELL_LABEL_GAP_PX = 4;

/** Phase 5 (chart-fit scorer, Task 3): the dumbbell chart's whole drawing.
 * Modelled directly on `EndLabelsOverlay` above — the SAME mechanism, not a
 * new one: a plain descendant of the `<BarChart layout="vertical">` shell
 * that reads Recharts' own settled scales through `useXAxisScale`/
 * `useYAxisScale` and draws ordinary SVG inside the shared `label` z-index
 * layer. The shell (axes, grid) exists only to establish the coordinate
 * system; it carries NO `<Bar>` — nothing on a dumbbell is a bar, so nothing
 * is drawn through one.
 *
 * Per row: a `<line>` from `xScale(from.value)` to `xScale(to.value)` at the
 * row's own category position — `yScale(label, { position: 'middle' })`, the
 * band CENTRE, which is exactly where Recharts places that row's own axis
 * tick (RegionAxisTick) — and a `<circle>` at each end. Every drawn number is
 * that endpoint's own `formattedValue` (plus the same ' *' provisional
 * suffix every other form uses), rendered as `<text>` beside its dot with
 * `data-label-for="<resultId>"` (R1), exactly like EndLabelsOverlay's own
 * labels. The leftmost dot's label sits to its left and the rightmost dot's
 * to its right, so the two never cross the connector or each other; the
 * shell's x-axis `padding` (set in ChartView from the longest label) is what
 * keeps a label at the domain's edge from running into the region-name
 * column or off the right edge — layout only, the domain itself is never
 * touched. A row whose position the scale cannot resolve (a label not in the
 * category domain, or a value outside a finite range) is skipped, never
 * approximated. */
export function DumbbellOverlay({ rows }: { rows: DumbbellChartRow[] }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale || rows.length === 0) return null;
  const positioned = rows
    .map((row) => ({
      row,
      cy: Number(yScale(row.label, { position: 'middle' })),
      xFrom: Number(xScale(row.from.value)),
      xTo: Number(xScale(row.to.value)),
    }))
    .filter((p) => Number.isFinite(p.cy) && Number.isFinite(p.xFrom) && Number.isFinite(p.xTo));
  const labelText = (end: DumbbellEnd): string => `${end.formattedValue}${end.provisional ? '*' : ''}`;
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g data-role="dumbbell-canvas">
        {positioned.map(({ row, cy, xFrom, xTo }) => {
          const opacity = row.dimmed ? 0.25 : 1;
          // Which end is drawn left/right is a pixel question (a value can
          // fall or rise), settled from the scale's own output, not from
          // comparing the values again here.
          const fromIsLeft = xFrom <= xTo;
          const ends: Array<{ end: DumbbellEnd; x: number; side: 'from' | 'to'; leftOf: boolean }> = [
            { end: row.from, x: xFrom, side: 'from', leftOf: fromIsLeft },
            { end: row.to, x: xTo, side: 'to', leftOf: !fromIsLeft },
          ];
          return (
            <g key={row.key} data-role="dumbbell-row" data-series-key={row.key} data-series-dimmed={row.dimmed ? 'true' : undefined}>
              <line
                x1={xFrom}
                y1={cy}
                x2={xTo}
                y2={cy}
                stroke={row.color}
                strokeWidth={2}
                strokeOpacity={opacity}
                data-role="dumbbell-connector"
              />
              {ends.map(({ end, x, side, leftOf }) => (
                <g key={side}>
                  <circle
                    cx={x}
                    cy={cy}
                    r={DUMBBELL_DOT_R}
                    fill={row.color}
                    fillOpacity={opacity}
                    stroke="var(--card)"
                    strokeWidth={1.5}
                    data-role="dumbbell-dot"
                    data-point={side}
                    data-result-id={end.resultId}
                  />
                  <text
                    x={leftOf ? x - DUMBBELL_DOT_R - DUMBBELL_LABEL_GAP_PX : x + DUMBBELL_DOT_R + DUMBBELL_LABEL_GAP_PX}
                    y={cy + 4}
                    {...VALUE_LABEL_PROPS}
                    fill="var(--foreground)"
                    fillOpacity={opacity}
                    textAnchor={leftOf ? 'end' : 'start'}
                    data-role="dumbbell-label"
                    data-point={side}
                    data-label-for={end.resultId}
                  >
                    {labelText(end)}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </g>
    </ZIndexLayer>
  );
}

/** Task 7 (derived overlays), extracted for the final-review I2/I3 fix: this
 * was ~40 lines duplicated verbatim between the LineChart and AreaChart
 * branches below (I3) — the exact duplication that let I2 happen, since a
 * third copy for the bar branches was simply never made. Now the ONE place
 * both branches render derived overlays from; I1's decimals/unit fix lives
 * here too, so it applies everywhere at once. Bar/hbar forms render nothing
 * at all here — I2's chosen fix gates the add-overlay CONTROLS to the
 * line/area forms instead (see the `activeForm === 'line' || activeForm ===
 * 'area'` gate further down). This does NOT mean `state.derivedOverlayRequests`
 * is always empty on bar/hbar: an overlay added on line/area stays in the
 * (undoable) command log across a later form switch — its remove chip and
 * any refusal message are simply hidden while bar/hbar is active, same as
 * this render function drawing nothing for it there; switching back to
 * line/area or undoing makes both visible again.
 *
 * Deliberately a plain FUNCTION returning an array — NOT a React component
 * (no `<DerivedOverlaysLayer />` JSX element). Recharts decides what to
 * render by scanning its chart container's own DIRECT children for known
 * element types (Line, Area, ReferenceLine, ReferenceArea, …) at the point
 * the JSX tree is authored, the same way `state.eraShadings.map(...)`'s
 * ReferenceAreas above work; it cannot see INTO a custom component to find
 * the ReferenceLines it eventually renders, so a `<DerivedOverlaysLayer />`
 * element silently drew nothing at all when tried (caught empirically while
 * fixing I1 — the resolved value reached React state correctly, but no
 * ReferenceLine ever reached the DOM). Calling this as `{derivedOverlayElements(...)}`
 * instead evaluates to a literal array of ReferenceLine elements, spliced
 * directly into LineChart/AreaChart's children exactly like the era-shading
 * map above — which Recharts' scan sees just fine. */
export function derivedOverlayElements(
  resolvedOverlays: Map<string, DerivationRecord>,
  displaySpec: Pick<ChartSpec, 'series'>,
  lang: Lang = 'nl',
): ReactNode[] {
  const allPoints = displaySpec.series.flatMap((s) => s.points);
  return Array.from(resolvedOverlays.entries()).map(([id, record]) => {
    if (record.kind === 'mean') {
      return (
        <ReferenceLine
          key={`mean-${id}`}
          y={record.value}
          stroke="var(--accent)"
          strokeDasharray="2 2"
          label={{ value: formatOverlayValue(record, allPoints, lang), position: 'right' }}
          data-label-for={record.sourceResultIds.join(',')}
        />
      );
    }
    if (record.kind === 'difference') {
      const a = allPoints.find((p) => p.resultId === record.subtrahendResultId);
      const b = allPoints.find((p) => p.resultId === record.minuendResultId);
      if (!a || !b || a.periodLabel === null || b.periodLabel === null || a.value === null || b.value === null) return null;
      return (
        <ReferenceLine
          key={`diff-${id}`}
          segment={[
            { x: a.periodLabel as string | number, y: a.value as number },
            { x: b.periodLabel as string | number, y: b.value as number },
          ]}
          stroke="var(--accent)"
          strokeWidth={2}
          label={{ value: formatOverlayValue(record, allPoints, lang), position: 'top' }}
          data-label-for={record.sourceResultIds.join(',')}
        />
      );
    }
    return null;
  });
}

/** Line-chart point marker: filled in the series colour, hollow when
 * provisional (R11, same convention as render.ts), plus the #197 end-of-line
 * label on the series' last plotted point. Recharts passes the Line's own
 * `stroke` into a custom dot's props, so the marker follows the series colour
 * without a second palette lookup.
 *
 * Task 5: `opacity` mirrors the `strokeOpacity` passed to the enclosing
 * `<Line>`. Recharts DOES merge the Line's own svg-safe props (including
 * `strokeOpacity`) into what it hands a custom `dot` render function — but
 * only as an extra, ignorable prop; nothing forwards it onto the `<circle>`
 * this function draws unless done explicitly here. Without this, the
 * highlighted-series dimming would visibly stop at the line stroke and leave
 * every point marker at full opacity.
 *
 * Task 6 (#212 click-to-annotate): `seriesLabel`/`onPointClick` let a click on
 * the point report itself (resultId/periodLabel/seriesLabel) up to ChartView,
 * which opens the note entry form — see chart-notes.tsx. Added alongside
 * Task 5's `opacity` param, not in place of it. */
export function SeriesDot(
  seriesKey: string,
  opacity = 1,
  seriesLabel?: string,
  onPointClick?: (point: PendingPoint) => void,
  // WP218 (ADR 039) Phase 0 / ADR 042: r/ring follow the resolved line width
  // (R11: the hollow ring must stay legible at every stroke width — see
  // `dotGeometry`); `markers`/`ends` together decide which NON-provisional
  // markers draw invisible (opacity 0, never removed from the DOM) via the
  // pure `markerVisible` (all / ends / provisionalOnly), so the
  // `[data-point]` count, keyboard walking (#212) and click-to-annotate all
  // keep working identically regardless of mode. Defaulted to today's
  // literal geometry (r 4, ring 2) with `markers: 'all'`/`ends: null` (every
  // marker visible) so every existing call site/test keeps its current
  // arity and rendering.
  geometry: { r: number; ring: number; markers: MarkerMode; ends: SeriesEndpoints | null } = { ...dotGeometry('normal'), markers: 'all', ends: null },
  lang: Lang = 'nl',
  // Story mode (session 92): the periodCode of the point the active story
  // step tells about, or null. Draws ONE extra ring OUTSIDE the point's own
  // marker (r + 5) so the hollow provisional ring (R11) stays fully visible
  // inside it. Not a data point: no data-point attribute, no role, no
  // handlers, pointer-events none — the [data-point] count and keyboard
  // walking are unchanged.
  storyPeriodCode: string | null = null,
) {
  return function Dot(props: { cx?: number; cy?: number; payload?: Row; stroke?: string }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    const value = payload[seriesKey];
    if (value == null) return null;
    const provisional = payload[`${seriesKey}_provisional`];
    const resultId = payload[`${seriesKey}_resultId`];
    const color = props.stroke ?? 'currentColor';
    const isStory = storyPeriodCode !== null && payload.periodCode === storyPeriodCode;
    // ADR 042: which markers are drawn follows the resolved marker mode
    // (all / ends / provisionalOnly) via the pure `markerVisible`; the point
    // the story ring is on is always drawn (final-review fix, kept).
    const hiddenFinal = !markerVisible(geometry.markers, Boolean(provisional), String(payload.periodCode), geometry.ends) && !isStory;
    // Task 6 keyboard-operability fix (#212 follow-up): a synthetic
    // role="button" on an SVG element gets no native Enter/Space activation
    // from the browser the way a real <button> would, so onKeyDown has to
    // reproduce onClick's exact logic — factored here so both handlers stay
    // in sync.
    const activate = (): void => {
      if (resultId == null || !onPointClick) return;
      onPointClick({
        resultId: String(resultId),
        periodLabel: String(payload.periodLabel),
        seriesLabel: seriesLabel ?? '',
      });
    };
    return (
      <g>
        {isStory ? (
          <circle
            cx={cx}
            cy={cy}
            r={geometry.r + 5}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeDasharray="4 3"
            strokeOpacity={opacity}
            pointerEvents="none"
            data-story-marker={resultId == null ? 'true' : String(resultId)}
          />
        ) : null}
        <circle
          cx={cx}
          cy={cy}
          r={geometry.r}
          fill={provisional ? 'var(--card)' : color}
          stroke={color}
          strokeWidth={geometry.ring}
          strokeOpacity={opacity}
          fillOpacity={opacity}
          opacity={hiddenFinal ? 0 : undefined}
          data-point="value"
          data-marker={hiddenFinal ? 'hidden' : undefined}
          data-result-id={resultId == null ? undefined : String(resultId)}
          role={onPointClick ? 'button' : undefined}
          tabIndex={onPointClick ? 0 : undefined}
          aria-label={onPointClick ? t(lang, 'chart.noteAriaLabel', { series: seriesLabel ?? '', period: String(payload.periodLabel) }) : undefined}
          style={onPointClick ? { cursor: 'pointer' } : undefined}
          onClick={onPointClick ? activate : undefined}
          onKeyDown={
            onPointClick
              ? (event: KeyboardEvent<SVGCircleElement>) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  // Row 9 (session 110 UX audit pass 2): Recharts' own
                  // `.recharts-wrapper` ancestor has its own onKeyDown
                  // (RechartsWrapper.js) that feeds its built-in tooltip
                  // keyboard-navigation feature, and that feature treats
                  // 'Enter' specially (one of exactly three keys its
                  // listener middleware acts on) while leaving ' ' alone —
                  // which is exactly why Enter silently did nothing here
                  // while Space worked: this activation was competing with
                  // Recharts' own Enter handling for the same keystroke. A
                  // point that already activated on this key owns the
                  // gesture completely, the same way a real <button> would
                  // never hand the keypress that activated it to an
                  // ancestor's unrelated keyboard handling.
                  event.stopPropagation();
                  activate();
                }
              : undefined
          }
        />
      </g>
    );
  };
}

/** #260 (session 129, owner-decisions brief item 3): a final (non-
 * provisional) bar's two corners AWAY from the zero baseline are rounded;
 * the two corners ON the baseline stay square, so a bar never looks lifted
 * off zero (the ADR 042 refusal of a rounded baseline still stands). Drawn
 * as a `clipPath` over the unchanged `<rect>` — the rect keeps every
 * data-point/click/keyboard attribute and every test selector — and only
 * for non-provisional bars: a provisional bar's hatch + outline stays
 * square, since clipping would halve its outline (R11 must stay legible).
 * Pure geometry; no number is drawn or changed. */
export const BAR_CORNER_RADIUS_PX = 4;

export type BarFreeEnd = 'top' | 'bottom' | 'right' | 'left';

/** The rounded outline of a bar whose free (non-baseline) end is `end`, or
 * null when the bar is too small for a visible radius. */
export function roundedBarClipPath(x: number, y: number, width: number, height: number, end: BarFreeEnd): string | null {
  // Normalise a negative extent (a renderer may hand a downward/leftward bar
  // as a negative height/width) — the outline itself is always drawn from
  // the rectangle's true top-left corner.
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }
  const r = Math.min(BAR_CORNER_RADIUS_PX, width / 2, height / 2);
  if (!(r >= 0.5)) return null;
  const x2 = x + width;
  const y2 = y + height;
  switch (end) {
    case 'top':
      return `M${x},${y2}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x2 - r},${y}Q${x2},${y} ${x2},${y + r}L${x2},${y2}Z`;
    case 'bottom':
      return `M${x},${y}L${x2},${y}L${x2},${y2 - r}Q${x2},${y2} ${x2 - r},${y2}L${x + r},${y2}Q${x},${y2} ${x},${y2 - r}Z`;
    case 'right':
      return `M${x},${y}L${x2 - r},${y}Q${x2},${y} ${x2},${y + r}L${x2},${y2 - r}Q${x2},${y2} ${x2 - r},${y2}L${x},${y2}Z`;
    case 'left':
      return `M${x2},${y}L${x2},${y2}L${x + r},${y2}Q${x},${y2} ${x},${y2 - r}L${x},${y + r}Q${x},${y} ${x + r},${y}Z`;
  }
}

/** A DOM-safe clipPath id built from ids already unique on the page. */
export function barClipId(...parts: string[]): string {
  return parts.join('-').replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Bar-chart bar: the series colour, or a hatch pattern in that colour when
 * provisional (a provisional bar used to be indistinguishable from a final
 * one — only the prose note said so), plus the #197 value label.
 *
 * Task 5: `opacity` mirrors the `fillOpacity` passed to the enclosing
 * `<Bar>`. A custom `shape` render function completely REPLACES how Recharts
 * draws the bar — Recharts still merges `fillOpacity`/`data-series-dimmed`
 * into the props this function receives, but nothing forwards them onto the
 * `<rect>` actually drawn below unless done explicitly here. Without this,
 * highlighting a series would have no visible effect at all in Staaf
 * (bar) form.
 *
 * Task 6 (#212 click-to-annotate): `seriesLabel`/`onPointClick`, same
 * contract as SeriesDot above — added alongside Task 5's `opacity` param,
 * not in place of it. */
export function SeriesBar(
  seriesKey: string,
  color: string,
  patternId: string,
  labelByPeriod: Map<string, PointLabel>,
  opacity = 1,
  seriesLabel?: string,
  onPointClick?: (point: PendingPoint) => void,
  lang: Lang = 'nl',
  // Story mode (session 92) final-review fix: mirrors SeriesDot's own
  // `storyPeriodCode` param — a single-series time series shown as Staaf
  // (bar) never reacted to the story before this fix, because only
  // SeriesDot (Lijn/Vlak) had this thread. The periodCode of the point the
  // active story step tells about, or null. Draws a dashed outline `<rect>`
  // AROUND the bar (never `data-point`, `pointerEvents="none"`) rather than
  // reusing the dot ring — a bar has no point for a ring to surround.
  storyPeriodCode: string | null = null,
) {
  return function Shape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
    const { x, y, width, height, payload } = props;
    if (x == null || y == null || width == null || height == null || !payload) return null;
    const value = payload[seriesKey];
    if (value == null) return null;
    const provisional = Boolean(payload[`${seriesKey}_provisional`]);
    const resultId = payload[`${seriesKey}_resultId`];
    const label = labelByPeriod.get(String(payload.periodCode));
    const negative = typeof value === 'number' && value < 0;
    const isStory = storyPeriodCode !== null && payload.periodCode === storyPeriodCode;
    const clipD = provisional ? null : roundedBarClipPath(x, y, width, height, negative ? 'bottom' : 'top');
    const clipId = clipD === null ? null : barClipId(patternId, 'clip', String(payload.periodCode));
    // Row 1 (session 110 UX audit pass 4): wrapped in the shared `label`
    // zIndex layer (see the block comment above SeriesDot) so a LATER
    // series' bar `<rect>` — Recharts draws every `<Bar>` through its own
    // `bar` zIndex bucket, JSX order notwithstanding — can never again
    // paint over an EARLIER series' label.
    const labelNode = label ? (
      <ZIndexLayer zIndex={DefaultZIndexes.label}>
        <text
          x={x + width / 2}
          y={negative ? y + height + 12 : y - 4}
          {...VALUE_LABEL_PROPS}
          fill="var(--foreground)"
          textAnchor="middle"
          data-role="bar-label"
          data-label-for={label.resultId}
        >
          {label.text}
        </text>
      </ZIndexLayer>
    ) : null;
    // Task 6 keyboard-operability fix (#212 follow-up): same rationale as
    // SeriesDot's `activate` above — a synthetic role="button" on an SVG
    // element gets no native Enter/Space activation, so onKeyDown has to
    // reproduce onClick's exact logic.
    const activate = (): void => {
      if (resultId == null || !onPointClick) return;
      onPointClick({
        resultId: String(resultId),
        periodLabel: String(payload.periodLabel),
        seriesLabel: seriesLabel ?? '',
      });
    };
    return (
      <g>
        {clipD !== null && clipId !== null ? (
          <clipPath id={clipId}>
            <path d={clipD} />
          </clipPath>
        ) : null}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          clipPath={clipId === null ? undefined : `url(#${clipId})`}
          fill={provisional ? `url(#${patternId})` : color}
          fillOpacity={opacity}
          stroke={provisional ? color : undefined}
          strokeOpacity={provisional ? opacity : undefined}
          strokeWidth={provisional ? 1 : undefined}
          data-point="value"
          // Story mode (session 92) finding: the doc comment above already
          // says `data-series-dimmed` must be forwarded explicitly onto the
          // drawn `<rect>` — fillOpacity was, this marker itself was not.
          // The gap was invisible until now because the only prior test for
          // a dimmed BAR asserted `fill-opacity` directly (see the "Liggend"
          // RegionBar tests below); a code-built story's "highest bar"
          // step is the first one to need the SAME marker Line/Area's own
          // paths already carry (there, Recharts forwards it natively).
          // `opacity` only ever carries the two values (1 or the 0.25 dim)
          // every call site of SeriesBar passes, so deriving from it is
          // exactly the caller's own dimmed boolean, not a guess.
          data-series-dimmed={opacity < 1 ? 'true' : undefined}
          data-result-id={resultId == null ? undefined : String(resultId)}
          role={onPointClick ? 'button' : undefined}
          tabIndex={onPointClick ? 0 : undefined}
          aria-label={onPointClick ? t(lang, 'chart.noteAriaLabel', { series: seriesLabel ?? '', period: String(payload.periodLabel) }) : undefined}
          style={onPointClick ? { cursor: 'pointer' } : undefined}
          onClick={onPointClick ? activate : undefined}
          onKeyDown={
            onPointClick
              ? (event: KeyboardEvent<SVGRectElement>) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  // Row 9 (session 110 UX audit pass 2): see SeriesDot's
                  // identical stopPropagation above — Recharts' own
                  // `.recharts-wrapper` ancestor onKeyDown treats 'Enter'
                  // specially for its built-in tooltip keyboard navigation
                  // (not ' '), which is why only Enter silently did nothing
                  // here.
                  event.stopPropagation();
                  activate();
                }
              : undefined
          }
        />
        {isStory ? (
          <rect
            x={x - 3}
            y={y - 3}
            width={width + 6}
            height={Math.max(height + 6, 6)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeDasharray="4 3"
            pointerEvents="none"
            data-story-marker={resultId == null ? 'true' : String(resultId)}
          />
        ) : null}
        {labelNode}
      </g>
    );
  };
}

/** Chart co-pilot phase 5b (verified-whole, Task 4): the smallest segment
 * a stacked bar still labels — below this height (px) the 12 px label text
 * would overrun its own segment and collide with its neighbours' labels. A
 * geometry gate ONLY (which segments get a label, the same class of rule
 * `valueLabelPlan`'s >BAR_LABEL_MAX thinning is); the tooltip still shows
 * every segment's own value. */
const STACK_LABEL_MIN_HEIGHT_PX = 14;

/** Phase 5b: one slice of a verified-whole pie — the pie draws
 * `regionChartRowsAll` (one row per region, the same rows the horizontal
 * bar draws), so this is the SAME row shape and the same `value_display`/
 * `value_resultId` binding `RegionBar` and `RegionTooltip` already read. */
type PieRow = RegionChartRow;

/** Phase 5b: the pie's own slice label — Recharts' `label` render prop gets
 * the sector entry spread in (`payload` = the row it was built from, plus
 * the label anchor `x`/`y`/`textAnchor` it computed at `outerRadius` plus
 * its offset). Draws ONLY the row's own `value_display` (never Recharts'
 * own `percent`, never the raw `value`), the same ' *' provisional suffix as
 * every other label on the card, bound to its source cell via
 * `data-label-for` (R1). A row with no display string draws nothing. */
export function PieSliceLabel(props: PieLabelRenderProps) {
  const row = (props.payload ?? null) as PieRow | null;
  if (row === null || row.value_display == null || props.x == null || props.y == null) return null;
  return (
    <text
      x={props.x}
      y={props.y}
      {...VALUE_LABEL_PROPS}
      fill="var(--foreground)"
      textAnchor={props.textAnchor}
      dominantBaseline="central"
      data-role="pie-label"
      data-label-for={row.value_resultId ?? undefined}
    >
      {row.value_display}
      {row.value_provisional ? '*' : ''}
    </text>
  );
}

/** Phase 5b: one segment of a stacked / 100%-stacked bar. The SAME
 * shape-factory convention as SeriesBar above (one instance per series,
 * called once per period), reading the period row's own per-series fields:
 * `valueKey` is what Recharts stacked (`<key>` for stacked — the real
 * value; `<key>_share` for 100%-stacked — the computed percentage), and
 * `labelKey` is the display string drawn INSIDE the segment (`<key>_display`
 * — the point's own formattedValue; or `<key>_share_label` — the percentage
 * text `buildStack100Rows` formatted). Both are bound to the point's own
 * resultId via `data-label-for` (R1). Provisional points keep the hatch
 * pattern (R11). A segment shorter than STACK_LABEL_MIN_HEIGHT_PX draws no
 * label (geometry only — the tooltip still shows it). */
export function StackSegment(
  seriesKey: string,
  valueKey: string,
  labelKey: string,
  color: string,
  patternId: string,
  opacity = 1,
) {
  return function Shape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
    const { x, y, width, height, payload } = props;
    if (x == null || y == null || width == null || height == null || !payload) return null;
    const value = payload[valueKey];
    if (value == null) return null;
    const provisional = Boolean(payload[`${seriesKey}_provisional`]);
    const resultId = payload[`${seriesKey}_resultId`];
    const label = payload[labelKey];
    const showLabel = label != null && height >= STACK_LABEL_MIN_HEIGHT_PX;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={provisional ? `url(#${patternId})` : color}
          fillOpacity={opacity}
          stroke={provisional ? color : 'var(--card)'}
          strokeOpacity={provisional ? opacity : 1}
          strokeWidth={1}
          data-point="value"
          data-series-dimmed={opacity < 1 ? 'true' : undefined}
          data-result-id={resultId == null ? undefined : String(resultId)}
        />
        {showLabel ? (
          <ZIndexLayer zIndex={DefaultZIndexes.label}>
            <text
              x={x + width / 2}
              y={y + height / 2}
              {...VALUE_LABEL_PROPS}
              fill="var(--foreground)"
              textAnchor="middle"
              dominantBaseline="central"
              data-role="stack-label"
              data-label-for={resultId == null ? undefined : String(resultId)}
            >
              {String(label)}
              {provisional ? '*' : ''}
            </text>
          </ZIndexLayer>
        ) : null}
      </g>
    );
  };
}

/** Horizontal-bar shape: one row IS one region (RegionChartRow, built in
 * ChartView from buildRegionRows), so unlike SeriesBar — one shape instance
 * per SERIES, called once per period — this shape is mounted ONCE (one
 * `<Bar dataKey="value">`) and called once per ROW; every field it needs
 * (colour/dimmed/patternId/provisional/resultId) already rides the row
 * itself rather than being threaded through closures the way SeriesBar
 * threads seriesKey/labelByPeriod. Click-to-annotate mirrors SeriesBar/
 * SeriesDot exactly: role="button" + tabIndex + Enter/Space activation,
 * because a synthetic role on an SVG element gets no native keyboard
 * activation from the browser the way a real <button> would. `periodLabel`
 * is the ONE period every region in a comparison shares (resolved once in
 * ChartView, same fallback tableModel's bar-kind header already uses). */
export function RegionBar(
  periodLabel: string,
  labelMode: HbarLabelMode,
  extremeKeys: ReadonlySet<string>,
  onPointClick?: (point: PendingPoint) => void,
  lang: Lang = 'nl',
) {
  return function Shape(props: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: RegionChartRow;
  }) {
    const { x, y, width, height, payload } = props;
    if (x == null || y == null || width == null || height == null || !payload) return null;
    if (payload.value == null) return null;
    const { key, label, value_display, value_provisional, value_resultId, color, dimmed, patternId } = payload;
    // Session 110 UX audit pass 3, row 10 (decided by the parent session):
    // 'all' labels every plotted row (the pre-existing rule, unchanged at or
    // below BAR_LABEL_MAX); 'extremesOnly' labels ONLY the first and last
    // PLOTTED row (the ranking's top/bottom when a ranking record sorted
    // them, otherwise simply the first/last rows — computed once by the
    // caller as `extremeKeys`) so a 16-40 bar chart is never left with zero
    // numbers anywhere on it; 'none' matches the pre-existing empty case.
    const showLabel = labelMode === 'all' ? true : labelMode === 'extremesOnly' ? extremeKeys.has(key) : false;
    const activate = (): void => {
      if (value_resultId == null || !onPointClick) return;
      onPointClick({ resultId: value_resultId, periodLabel, seriesLabel: label });
    };
    // #260: the free end of a horizontal bar is its right end (left for a
    // negative value); the baseline end stays square.
    const clipD = value_provisional ? null : roundedBarClipPath(x, y, width, height, payload.value < 0 ? 'left' : 'right');
    const clipId = clipD === null ? null : barClipId(patternId, 'clip', key);
    return (
      <g>
        {clipD !== null && clipId !== null ? (
          <clipPath id={clipId}>
            <path d={clipD} />
          </clipPath>
        ) : null}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          clipPath={clipId === null ? undefined : `url(#${clipId})`}
          fill={value_provisional ? `url(#${patternId})` : color}
          fillOpacity={dimmed ? 0.25 : 1}
          stroke={value_provisional ? color : undefined}
          strokeOpacity={value_provisional ? (dimmed ? 0.25 : 1) : undefined}
          strokeWidth={value_provisional ? 1 : undefined}
          data-point="value"
          // Session 110 pass 3 row 1's own follow-up note (ADR 042): this
          // was the one remaining spot with the SAME gap SeriesBar's doc
          // comment above already named and fixed — `fillOpacity` was
          // forwarded onto the drawn `<rect>` (a custom `shape` fully
          // replaces Recharts' own rendering, so nothing forwards a prop
          // unless done explicitly here), but the `data-series-dimmed`
          // marker itself was not, so a test asserting on the marker (rather
          // than `fill-opacity` directly, as the pre-existing "Liggend"
          // tests did) saw no dimmed rows in hbar form even though the
          // highlight was already visually correct. `dimmed` is exactly the
          // caller's own boolean (payload.dimmed, set from
          // state.highlightedKey in ChartView) — not a guess.
          data-series-dimmed={dimmed ? 'true' : undefined}
          data-result-id={value_resultId ?? undefined}
          role={onPointClick ? 'button' : undefined}
          tabIndex={onPointClick ? 0 : undefined}
          aria-label={onPointClick ? t(lang, 'chart.noteAriaLabel', { series: label, period: periodLabel }) : undefined}
          style={onPointClick ? { cursor: 'pointer' } : undefined}
          onClick={onPointClick ? activate : undefined}
          onKeyDown={
            onPointClick
              ? (event: KeyboardEvent<SVGRectElement>) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  // Row 9 (session 110 UX audit pass 2): see SeriesDot's
                  // identical stopPropagation above — Recharts' own
                  // `.recharts-wrapper` ancestor onKeyDown treats 'Enter'
                  // specially for its built-in tooltip keyboard navigation
                  // (not ' '), which is why only Enter silently did nothing
                  // here.
                  event.stopPropagation();
                  activate();
                }
              : undefined
          }
        />
        {showLabel && value_display != null ? (
          <text
            x={x + width + 4}
            y={y + height / 2 + 4}
            {...VALUE_LABEL_PROPS}
            fill="var(--foreground)"
            textAnchor="start"
            data-role="bar-label"
            data-label-for={value_resultId ?? undefined}
          >
            {value_display}
            {value_provisional ? '*' : ''}
          </text>
        ) : null}
      </g>
    );
  };
}

/** Y-axis tick that shows a point's own display string — or nothing. With an
 * explicit `ticks` list Recharts only asks for the values we gave it; if it
 * ever asked for another one, rendering nothing beats inventing a number.
 * Exported for reuse by ChartSmallMultiples' own-axis mode, same reason as
 * buildRows/seriesStyle/valueLabelPlan: the honesty contract (only ever a
 * point's own formattedValue) has to be the SAME mechanism everywhere. */
export function AxisTick(tickByValue: Map<number, AxisTickLabel>) {
  return function Tick(props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
    const value = props.payload?.value;
    const tick = typeof value === 'number' ? tickByValue.get(value) : undefined;
    if (!tick || props.x == null || props.y == null) return null;
    return (
      <text
        x={props.x}
        y={props.y}
        dy={4}
        fontSize={11}
        fill="var(--muted-foreground)"
        textAnchor="end"
        data-role="axis-tick"
        data-label-for={tick.resultId}
      >
        {tick.display}
      </text>
    );
  };
}

/** WP218 phase 5: the horizontal-bar form's category (region) axis tick.
 * Recharts' own default axis <Text> measures glyphs and renders NOTHING in
 * jsdom (chart.test.tsx's own top-of-file note on the #197 section) — a real
 * browser draws it fine, but every text-bearing tick in this file is drawn
 * by a small custom component for exactly this reason (mirrors `AxisTick`
 * above, the numeric value-axis equivalent). Unlike `AxisTick` this needs no
 * lookup map: a category axis's own tick payload IS the row's `label` field
 * verbatim (a spec string, R6) — never invented text, so no `data-label-for`
 * binding either (that contract is for NUMBERS, and a region name is not
 * one — same as the period labels on every other form's x-axis). */
export function RegionAxisTick(props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
  const value = props.payload?.value;
  if (typeof value !== 'string' || props.x == null || props.y == null) return null;
  return (
    <text x={props.x} y={props.y} dy={4} fontSize={11} fill={AXIS_COLOR} textAnchor="end" data-role="region-axis-tick">
      {value}
    </text>
  );
}

/** Touch-only devices (no hover): Recharts' tooltip only follows a press-and-
 * drag there, and a plain tap did nothing — so the tooltip pins on tap
 * instead. Hover-capable devices keep the hover tooltip. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(hover: none) and (pointer: coarse)');
    setCoarse(query.matches);
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

