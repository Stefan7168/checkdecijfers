'use client';
// Own-data card render helpers (session 130, user-chart.tsx split, open-questions
// #312): every module-level helper, shape and overlay component that sat between
// `chartDocStateFromPublic` and `UserChartView` moved verbatim OUT of
// user-chart.tsx — same names, same JSX, same comments, no behaviour change (the
// only edit is an `export` on each). user-chart.tsx imports what its card uses and
// re-exports the four names (toPlottableSpec, userHeatmapModel, UserHeatmapCell,
// UserHeatmapModel) that were part of its own public API before this split —
// the same shape as session 128's chart.tsx -> chart-parts.tsx split.
import { type KeyboardEvent, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  DefaultZIndexes,
  LabelList,
  Pie,
  ReferenceArea,
  ReferenceLine,
  Sector,
  useXAxisScale,
  useYAxisScale,
  ZIndexLayer,
} from 'recharts';
import type { PieLabelRenderProps, PieSectorShapeProps } from 'recharts';
import { type RenderDatasetInstructionOutcome } from '../app/dataset-actions.ts';
import { formatValueNl } from '../backend/answer/compose/format.ts';
import type { ResolvedOverlay } from '../backend/attachments/derive-overlay.ts';
import type { DerivedOverlayRequest } from '../lib/chart-commands.ts';
import { markerVisible, type SeriesEndpoints } from '../lib/chart-presentation.ts';
import { dumbbellFormAllowed, heatmapFormAllowed, ownDataPieFormAllowed, type ChartForm } from '../lib/chart-view-state.ts';
import { t, type Lang, type MessageKey } from '../lib/i18n/messages.ts';
import {
  AxisTick,
  buildDumbbellRows,
  buildRegionRows,
  buildRows,
  buildStack100Rows,
  AXIS_COLOR,
  ChartTooltip,
  heatmapIntensity,
  labelWidthPx,
  RegionTooltip,
  valueLabelPlan,
  type AxisTickLabel,
  type DumbbellEnd,
  type DumbbellRow,
  type PlottablePoint,
  type PlottableSpec,
  type RegionRow,
  type Row,
  type SeriesMeta,
} from './chart.tsx';
import type { PendingPoint } from './chart-notes.tsx';
import type { UserChartSpec } from '../backend/attachments/types.ts';

/** #318: chart.tsx's `tabClass` pill styling for the small-multiples toggle
 * row — the same classes, so the two cards' toggles look identical. */
export function pillClass(active: boolean): string {
  return (
    'min-h-11 sm:min-h-6 rounded-full border px-2.5 py-1 text-xs ' +
    (active ? 'border-transparent bg-secondary text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')
  );
}

/** The ONE place a UserChartSpec is narrowed to the minimal shape
 * buildRows/valueLabelPlan need — every plotted string still comes straight
 * from the spec's own `formattedValue`/`xLabel` (R6-analog: no reformatting,
 * no computation), only the field NAMES are adapted. `provisional: false`
 * throughout — this tier has no CBS publication-status concept (D7: v1
 * performs no arithmetic and carries no provisional/definitief distinction
 * at all), so nothing here is ever marked provisional. Exported (Task 5,
 * plan 2026-09-22) so chart-commands-contract.test.tsx's own-data form ↔ tab
 * contract test can hand `ownDataRenderableForms` the SAME adapted shape
 * this card itself renders from, rather than a second, drift-prone copy of
 * this mapping — the same reuse-over-duplicate call Task 4 made exporting
 * derive-overlay.ts's `allResolvedPoints`. */
export function toPlottableSpec(spec: UserChartSpec): PlottableSpec {
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

/** The one line a failed render shows. `invalid` is the reader's own doing
 * (a combination that cannot be drawn); the other two are the dataset or the
 * session having gone away, which already have their own copy elsewhere. */
export function failureMessage(outcome: Exclude<RenderDatasetInstructionOutcome, { kind: 'ok' }>): MessageKey {
  if (outcome.kind === 'invalid') return `userChart.renderFailed.${outcome.reason}` as MessageKey;
  return outcome.kind === 'unauthenticated' ? 'common.sessionExpired' : 'datasetChat.notFound';
}

export const FORM_TABS: readonly { form: ChartForm; label: MessageKey }[] = [
  { form: 'line', label: 'chart.tabLine' },
  { form: 'area', label: 'chart.form.area' },
  { form: 'bar', label: 'chart.tabBar' },
  { form: 'hbar', label: 'chart.form.hbar' },
  { form: 'table', label: 'chart.tabTable' },
  // Own-data chart-fit parity (plan 2026-09-22, Tasks 1-2): the phase-5 trio
  // trails Tabel in the scorer's own fixed order — dumbbell, slope, heatmap
  // (chart-fit.ts's `allowedForms`; chart.tsx's tabs use the same order).
  // Helling and Warmtekaart were wired in Task 1; the Dumbbell — its own
  // render branch, `UserDumbbellOverlay` below — in Task 2. The list the
  // chat is told about (chart-capabilities.ts's `ownDataRenderableForms`)
  // must never name a form this list lacks.
  { form: 'dumbbell', label: 'chart.form.dumbbell' },
  { form: 'slope', label: 'chart.form.slope' },
  { form: 'heatmap', label: 'chart.form.heatmap' },
  // Own-data verified-whole parity (Task 3): the three whole forms trail
  // Warmtekaart, in the scorer's fixed order — the same tier-neutral tab
  // words chart.tsx uses. UNCONDITIONAL on this tier (see the own-data
  // whole-forms block below): offered on shape alone, always with the note.
  { form: 'pie', label: 'chart.form.pie' },
  { form: 'stacked', label: 'chart.form.stacked' },
  { form: 'stacked100', label: 'chart.form.stacked100' },
];

/** ADR 042's value-label look, copied from chart.tsx (where it is
 * module-private): 12 px with a card-coloured halo, so a label stays legible
 * where it crosses a line or a bar. */
export const VALUE_LABEL_PROPS = { fontSize: 12, paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3, strokeLinejoin: 'round' } as const;

/** The `valueLabels` presentation key, honoured (Task 5 review finding
 * IMPORTANT 1: it used to be a live toggle that changed nothing, and the
 * resolver FORCES it on for bar/hbar — "zonder waarden heeft een
 * staafdiagram geen schaal", which was exactly what an own-data bar showed:
 * no number anywhere but the tooltip).
 *
 * The label's text is `row[`${key}_display`]` — the point's OWN
 * `formattedValue`, carried into the row by `buildRows` — so a drawn label
 * is a spec string, never a number this card formatted (the whole-card digit
 * scan pins that). */
export function valueLabels(seriesKey: string, position: 'top' | 'right'): ReactNode {
  return <LabelList dataKey={`${seriesKey}_display`} position={position} fill="var(--foreground)" {...VALUE_LABEL_PROPS} />;
}

/** The plot's own dot: the click-to-annotate target (#212) and the marker
 * mode's on/off switch. A simplified `SeriesDot` (chart.tsx) — this tier has
 * no provisional cells and no story ring, so neither the hollow R11 marker
 * nor the ring has anything to draw. Hidden markers stay in the DOM at
 * opacity 0, exactly like the CBS card, so the click targets survive every
 * mode. */
export function UserSeriesDot(
  seriesKey: string,
  opacity: number,
  seriesLabel: string,
  onPointClick: ((point: PendingPoint) => void) | undefined,
  geometry: { r: number; ring: number; markers: 'all' | 'ends' | 'provisionalOnly'; ends: SeriesEndpoints | null },
  lang: Lang,
) {
  return function Dot(props: { cx?: number; cy?: number; payload?: Row; stroke?: string }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    if (payload[seriesKey] == null) return null;
    const resultId = payload[`${seriesKey}_resultId`];
    const color = props.stroke ?? 'currentColor';
    const hidden = !markerVisible(geometry.markers, false, String(payload.periodCode), geometry.ends);
    const activate = (): void => {
      if (resultId == null || !onPointClick) return;
      onPointClick({ resultId: String(resultId), periodLabel: String(payload.periodLabel), seriesLabel });
    };
    return (
      <circle
        cx={cx}
        cy={cy}
        r={geometry.r}
        fill={color}
        stroke={color}
        strokeWidth={geometry.ring}
        strokeOpacity={opacity}
        fillOpacity={opacity}
        opacity={hidden ? 0 : undefined}
        data-point="value"
        data-marker={hidden ? 'hidden' : undefined}
        data-result-id={resultId == null ? undefined : String(resultId)}
        role={onPointClick ? 'button' : undefined}
        tabIndex={onPointClick ? 0 : undefined}
        aria-label={onPointClick ? t(lang, 'chart.noteAriaLabel', { series: seriesLabel, period: String(payload.periodLabel) }) : undefined}
        style={onPointClick ? { cursor: 'pointer' } : undefined}
        onClick={onPointClick ? activate : undefined}
        onKeyDown={
          onPointClick
            ? (event: KeyboardEvent<SVGCircleElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                // Row 9 (session 110 UX audit pass 2): Recharts' own wrapper
                // has an Enter handler of its own; a point that activated on
                // this key owns the gesture, like a real <button> would.
                event.stopPropagation();
                activate();
              }
            : undefined
        }
      />
    );
  };
}

/** Draws a resolved derived-overlay value (Task 7 parity) — mirrors
 * chart.tsx's own `derivedOverlayElements` exactly, including WHY it's a
 * plain function returning an array rather than a `<Layer>`-style
 * component: Recharts only recognises known element types (ReferenceLine,
 * ReferenceArea, …) among a chart container's own DIRECT children, so a
 * wrapping component's own ReferenceLines never reach the DOM. Unlike goal
 * lines/era shadings, this label IS server-computed, verified prose (never
 * reader-typed free text), so — same as any other plotted value label on
 * this chart — it gets a `label` prop and DOES enter a PNG/SVG export; R6's
 * digit-guard only ever exempted READER-typed text, never a value this
 * product itself computed and is standing behind. `requests` is
 * state.derivedOverlayRequests (the id -> calcKind/resultIds recipe);
 * `resolvedOverlays` is this render's own resolved-value map — a request
 * with no resolved entry yet (still in flight, or refused) draws nothing. */
export function derivedOverlayElements(
  resolvedOverlays: Map<string, ResolvedOverlay>,
  requests: DerivedOverlayRequest[],
  allPoints: PlottablePoint[],
): ReactNode[] {
  return Array.from(resolvedOverlays.entries()).map(([id, result]) => {
    const request = requests.find((r) => r.id === id);
    if (request === undefined) return null;
    const display = formatValueNl(result.value, result.decimals);
    if (request.calcKind === 'mean') {
      return (
        <ReferenceLine
          key={`mean-${id}`}
          y={result.value}
          stroke="var(--accent)"
          strokeDasharray="2 2"
          label={{ value: display, position: 'right' }}
          data-label-for={request.resultIds.join(',')}
        />
      );
    }
    const [refA, refB] = request.resultIds;
    const a = allPoints.find((p) => p.resultId === refA);
    const b = allPoints.find((p) => p.resultId === refB);
    if (a === undefined || b === undefined || a.value === null || b.value === null) return null;
    return (
      <ReferenceLine
        key={`diff-${id}`}
        segment={[
          { x: a.periodLabel, y: a.value },
          { x: b.periodLabel, y: b.value },
        ]}
        stroke="var(--accent)"
        strokeWidth={2}
        label={{ value: result.value >= 0 ? `+${display}` : display, position: 'top' }}
        data-label-for={request.resultIds.join(',')}
      />
    );
  });
}

// ---------------------------------------------------------------------------
// Own-data chart-fit parity (plan 2026-09-22, Task 1): the "Warmtekaart" —
// this card's OWN table rows recoloured. A sibling of chart.tsx's
// `heatmapModel`/`HeatmapGrid` (the same CSS grid with ARIA table
// semantics, the same colour scale, the same "throw on a missing cell"
// stance), rebuilt over the `rows`/`seriesMeta` model `tableNode` below
// renders rather than over a ChartSpec — a UserChartSpec cannot be one
// (ADR 037 H2), so chart.tsx's grid, which takes a ChartSpec, cannot be
// mounted here. Deliberately WITHOUT chart.tsx's bar-kind transposition:
// this card's table never transposes on kind, so neither does its grid.
// ---------------------------------------------------------------------------

/** chart.tsx's `heatmapCellColor`, copied (module-private there, like
 * VALUE_LABEL_PROPS above): the same two `--heatmap-low`/`--heatmap-high`
 * tokens (app/globals.css, light + dark), the same whole-percentage oklch
 * mix — so both cards' grids share one scale and one look. */
export function heatmapCellColor(intensity: number): string {
  return `color-mix(in oklch, var(--heatmap-low), var(--heatmap-high) ${Math.round(intensity * 100)}%)`;
}

export interface UserHeatmapCell {
  text: string;
  resultId: string;
  value: number;
}

export interface UserHeatmapModel {
  /** The file's own xHeader, then the series labels — the table's header words. */
  header: string[];
  rows: { key: string; label: string; cells: UserHeatmapCell[] }[];
  /** The grid's own extremes, computed ONCE over every cell — the one scale
   * every cell's colour is read against (equal when every cell holds the
   * same value; `heatmapIntensity` then yields the mid tone for all). */
  min: number;
  max: number;
}

/**
 * One row per x category (the SAME `rows` the table shows, chronological by
 * xKey), one column per series. Every cell is one point's own
 * `formattedValue` (`_display`, carried into the row by `buildRows`) bound
 * to its rowRef (`_resultId`); the colour is a second cue read off that
 * same point's raw value, never the only way a value is shown. A missing
 * intersection cannot occur — `activeForm` is `fallbackForm`'s verdict over
 * this very spec, and `heatmapFormAllowed` only passes when every series
 * carries a real value at every x — so a cell without one is a guard bug:
 * thrown, exactly as chart.tsx's `heatmapModel` does, never painted as an
 * empty or default-coloured cell.
 */
export function userHeatmapModel(xHeader: string, rows: readonly Row[], seriesMeta: readonly SeriesMeta[]): UserHeatmapModel {
  const modelRows = rows.map((row) => ({
    key: String(row.periodCode),
    label: String(row.periodLabel),
    cells: seriesMeta.map((s): UserHeatmapCell => {
      const value = row[s.key];
      const resultId = row[`${s.key}_resultId`];
      if (typeof value !== 'number' || resultId == null) {
        throw new Error(
          `userHeatmapModel: no real value for series "${s.label}" at ${String(row.periodLabel)} — heatmapFormAllowed should have refused this spec`,
        );
      }
      const display = row[`${s.key}_display`];
      return { text: display == null ? '' : String(display), resultId: String(resultId), value };
    }),
  }));
  const values = modelRows.flatMap((row) => row.cells.map((cell) => cell.value));
  return { header: [xHeader, ...seriesMeta.map((s) => s.label)], rows: modelRows, min: Math.min(...values), max: Math.max(...values) };
}

/** The heatmap canvas — chart.tsx's `HeatmapGrid` shape exactly: a CSS grid
 * with ARIA table semantics, rows `display: contents` so the grid lays every
 * row's cells out in shared columns while a screen reader still hears row
 * and column headers. The model is built HERE, inside the component, so it
 * only ever runs while this form is on screen (it throws on a spec the guard
 * would have refused). Its own test id, `user-heatmap-grid`, next to this
 * file's `user-chart-container`/`user-chart-title`: a CBS card and an
 * own-data card can share one page, and a locator must never confuse the
 * two (ADR 037 H2). `pres` does not apply — like the table, no line, grid
 * line or frame to style. */
export function UserHeatmapGrid({
  xHeader,
  rows,
  seriesMeta,
  label,
}: {
  xHeader: string;
  rows: readonly Row[];
  seriesMeta: readonly SeriesMeta[];
  label: string;
}) {
  const model = userHeatmapModel(xHeader, rows, seriesMeta);
  const columns = model.header.length - 1;
  return (
    <div
      role="table"
      aria-label={label}
      data-testid="user-heatmap-grid"
      className="grid w-full text-sm"
      style={{ gridTemplateColumns: `max-content repeat(${columns}, minmax(0, 1fr))` }}
    >
      <div role="row" className="contents">
        {model.header.map((h, i) => (
          <div
            key={i}
            role="columnheader"
            className={`border-b border-border px-2 py-1 font-medium text-muted-foreground ${i === 0 ? 'text-left' : 'text-right'}`}
          >
            {h}
          </div>
        ))}
      </div>
      {model.rows.map((row) => (
        <div key={row.key} role="row" className="contents">
          <div role="rowheader" className="border-b border-border px-2 py-1 text-left font-normal text-foreground">
            {row.label}
          </div>
          {row.cells.map((cell, i) => (
            <div
              key={i}
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

// ---------------------------------------------------------------------------
// Own-data chart-fit parity (plan 2026-09-22, Task 2): the "Dumbbell" —
// chart.tsx's `DumbbellOverlay`, MIRRORED here rather than shared. Its prop
// contract is entirely primitive (no ChartSpec: a row is a key, a label,
// two `DumbbellEnd`s and a `[min, max]` pair), so on that test alone it
// would be extractable — but every way of sharing it edits chart.tsx (an
// `export` on the function and its row type, or moving it plus its two
// module-private constants out and importing them back), and chart.tsx is
// off-limits to this task; and this card's contract genuinely differs in
// two small ways a shared component would have had to grow for: (1) the
// dimming is this card's two-level `opacityFor` (reader-dimmed 0.35,
// highlight-dimmed 0.25 — what every other branch here honours) where
// chart.tsx's overlay knows only a boolean at 0.25; (2) this tier has no
// provisional cells (`toPlottableSpec` sets `provisional: false`
// throughout, ADR 037 D7), so chart.tsx's ' *' label suffix has nothing to
// draw and is left out — the same simplification `UserSeriesDot` above
// makes of `SeriesDot`. What IS reused rather than copied: chart.tsx's
// exported `buildDumbbellRows` (the row model, over this card's own
// `plottable`), its `DumbbellRow`/`DumbbellEnd` types, `labelWidthPx`, and
// chart-view-state.ts's `dumbbellFormAllowed`/`fallbackForm`. The drawing
// itself is the CBS mechanism unchanged: a plain descendant of the
// `<BarChart layout="vertical">` shell reading Recharts' own settled scales
// (`useXAxisScale`/`useYAxisScale`) and painting ordinary SVG inside the
// shared `label` z-index layer; the shell carries NO `<Bar>`.
// ---------------------------------------------------------------------------

/** chart.tsx's `DUMBBELL_DOT_R`/`DUMBBELL_LABEL_GAP_PX`, copied (module-
 * private there, like VALUE_LABEL_PROPS above): the dot radius, and the gap
 * between a dot's edge and its label. */
export const DUMBBELL_DOT_R = 5;
export const DUMBBELL_LABEL_GAP_PX = 4;

/** A dumbbell row as this card draws it: chart.tsx's pure `DumbbellRow`
 * (its exported `buildDumbbellRows`) plus the SAME resolved colour every
 * other form derives from `seriesMeta`, and this card's own `opacityFor`/
 * `dimmedFor` verdicts, joined in the card on the shared `s${i}` key. */
export interface UserDumbbellRow extends DumbbellRow {
  color: string;
  opacity: number;
  dimmed: boolean;
}

/** The category (series) axis tick — chart.tsx's `RegionAxisTick`, copied
 * (module-private there). Recharts' own default axis <Text> measures glyphs
 * and renders NOTHING in jsdom (chart.tsx's own note on that component), so
 * the tick is drawn by this small component instead — which is also what
 * lets a test pin each dot's `cy` against the tick Recharts placed for its
 * row. The payload IS the row's `label` verbatim (a spec string), never
 * invented text — so no `data-label-for` (that contract is for numbers). */
export function UserCategoryAxisTick(props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
  const value = props.payload?.value;
  if (typeof value !== 'string' || props.x == null || props.y == null) return null;
  return (
    <text x={props.x} y={props.y} dy={4} fontSize={11} fill={AXIS_COLOR} textAnchor="end" data-role="category-axis-tick">
      {value}
    </text>
  );
}

/** #283 residual: the hbar form's numeric (X) axis tick — chart.tsx's
 * `AxisTick`, oriented for a BOTTOM axis instead of a left-hand one
 * (`textAnchor="middle"` and a downward `dy`, vs. `AxisTick`'s right-
 * aligned, vertically-centred layout, which assumes ticks running down a Y
 * axis). Same honesty contract and same lookup map as `AxisTick`: the only
 * text drawn is `tick.display`, an existing spec string reached via
 * `tickByValue`, never a number this component formats or invents — this
 * is a rendering-ORIENTATION variant of `AxisTick`, not a new formatting
 * path. Fed `hbarTickByValue` (below): `valueLabelPlan`'s lo/hi tick pair
 * for the same `plottable` the other forms plot, so every tick is a plotted
 * point's own `formattedValue`. */
export function UserHbarValueAxisTick(tickByValue: Map<number, AxisTickLabel>) {
  return function Tick(props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
    const value = props.payload?.value;
    const tick = typeof value === 'number' ? tickByValue.get(value) : undefined;
    if (!tick || props.x == null || props.y == null) return null;
    return (
      <text x={props.x} y={props.y} dy={12} fontSize={11} fill="var(--muted-foreground)" textAnchor="middle" data-role="axis-tick" data-label-for={tick.resultId}>
        {tick.display}
      </text>
    );
  };
}

/** The dumbbell's whole drawing. Per row: a `<line>` from
 * `xScale(from.value)` to `xScale(to.value)` at the row's own category
 * position — `yScale(label, { position: 'middle' })`, the band CENTRE,
 * exactly where Recharts places that row's own axis tick — and a
 * `<circle>` at each end. Every drawn number is that endpoint's own
 * `formattedValue`, rendered as `<text>` beside its dot with
 * `data-label-for="<rowRef>"`, like every other value label on this card.
 * The leftmost dot's label sits to its left and the rightmost dot's to its
 * right (a pixel question settled from the scale's own output, never from
 * comparing the values again), so the two never cross the connector or
 * each other; the shell's x-axis `padding` (sized in the card from the
 * widest label) keeps a label at the domain's edge from running into the
 * series-name column or off the right edge — layout only, the domain
 * itself is never touched. A row whose position the scale cannot resolve
 * is skipped, never approximated. */
export function UserDumbbellOverlay({ rows }: { rows: UserDumbbellRow[] }) {
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
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g data-role="dumbbell-canvas">
        {positioned.map(({ row, cy, xFrom, xTo }) => {
          const fromIsLeft = xFrom <= xTo;
          const ends: Array<{ end: DumbbellEnd; x: number; side: 'from' | 'to'; leftOf: boolean }> = [
            { end: row.from, x: xFrom, side: 'from', leftOf: fromIsLeft },
            { end: row.to, x: xTo, side: 'to', leftOf: !fromIsLeft },
          ];
          return (
            <g key={row.key} data-role="dumbbell-row" data-series-key={row.key} data-series-dimmed={row.dimmed ? 'true' : undefined}>
              <line x1={xFrom} y1={cy} x2={xTo} y2={cy} stroke={row.color} strokeWidth={2} strokeOpacity={row.opacity} data-role="dumbbell-connector" />
              {ends.map(({ end, x, side, leftOf }) => (
                <g key={side}>
                  <circle
                    cx={x}
                    cy={cy}
                    r={DUMBBELL_DOT_R}
                    fill={row.color}
                    fillOpacity={row.opacity}
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
                    fillOpacity={row.opacity}
                    textAnchor={leftOf ? 'end' : 'start'}
                    data-role="dumbbell-label"
                    data-point={side}
                    data-label-for={end.resultId}
                  >
                    {end.formattedValue}
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

// ---------------------------------------------------------------------------
// Own-data chart-fit + verified-whole parity (plan 2026-09-22, Task 3): the
// Taartdiagram / Gestapeld / Gestapeld (%) forms, UNCONDITIONAL on this
// tier. chart.tsx offers these three only once a chart's regions are a
// complete, registry-known roster whose parts are checked on demand against
// a CBS-published total (phase 5b). An own-data chart has no registry and
// no independent total to check against, so — the owner's decision, plan
// 2026-09-22 — the three forms are offered on shape alone (chart-view-
// state.ts's `ownData*FormAllowed`, which never read provenance) and ALWAYS
// carry a visible note under the chart saying what has and has not been
// checked (`chart.ownWhole.*`, at the same prominence chart.tsx gives its
// own verified note). This task builds the forms and the ONE default note
// state (nothing designated, nothing checked); Task 4 lets the reader click
// a point to designate it as the total, runs the real arithmetic check, and
// swaps in the other three states — extend `OWN_WHOLE_NOTE` below, keep the
// one <p>.
//
// Reused from chart.tsx rather than copied: `buildRegionRows` (the pie's
// one-row-per-series model), `buildStack100Rows` (the 100%-stacked share
// arithmetic — pure arithmetic over the values on screen; here the
// denominator is simply the sum of the CURRENTLY-DISPLAYED parts for that
// period, with no verification step gating it, because there was never an
// independent total to wait on), `RegionTooltip` and `ChartTooltip`.
// Copied, with the same simplification precedent as UserSeriesDot /
// UserDumbbellOverlay (no provisional cells on this tier, ADR 037 D7, so no
// hatch pattern and no ' *' suffix): chart.tsx's module-private
// `PieSliceLabel` → UserPieSliceLabel, `StackSegment` → UserStackSegment,
// and STACK_LABEL_MIN_HEIGHT_PX. No click affordance on a slice or segment
// yet — chart.tsx's own pie/stack have none either; Task 4's designation
// gesture adds it (role="button" + Enter/Space, like UserSeriesDot).
// ---------------------------------------------------------------------------

/** chart.tsx's `STACK_LABEL_MIN_HEIGHT_PX`, copied (module-private there):
 * the smallest segment a stacked bar still labels — below this height the
 * 12 px label text would overrun its own segment and collide with its
 * neighbours'. A geometry gate ONLY; the tooltip still shows every value. */
export const STACK_LABEL_MIN_HEIGHT_PX = 14;

/** One slice of the own-data pie: chart.tsx's exported `RegionRow` (its
 * `buildRegionRows` — one row per series from that series' FIRST point,
 * which `ownDataPieFormAllowed` makes its ONLY point) joined to `seriesMeta`
 * for the key and colour and to this card's `opacityFor`/`dimmedFor`. The
 * same `value_display`/`value_resultId` field names chart.tsx's own pie rows
 * carry, so `RegionTooltip` reads it unchanged. */
export interface UserPieRow extends RegionRow {
  key: string;
  color: string;
  opacity: number;
  dimmed: boolean;
}

/** The pie's slice label — chart.tsx's `PieSliceLabel`, copied (module-
 * private there). Recharts' `label` render prop gets the sector entry
 * spread in (`payload` = the row it was built from, plus the anchor
 * `x`/`y`/`textAnchor` it computed at `outerRadius` plus its offset). Draws
 * ONLY the row's own `value_display` — never Recharts' own `percent`, never
 * the raw `value` — bound to its source rowRef via `data-label-for`, like
 * every other value label on this card. A row with no display string draws
 * nothing. */
export function UserPieSliceLabel(props: PieLabelRenderProps) {
  const row = (props.payload ?? null) as UserPieRow | null;
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
    </text>
  );
}

/** One segment of the stacked / 100%-stacked bar — chart.tsx's
 * `StackSegment`, copied (module-private there), minus the provisional
 * hatch this tier has nothing to draw with. The SAME shape-factory
 * convention as chart.tsx (one instance per series, called once per
 * period), reading the period row's own per-series fields: `valueKey` is
 * what Recharts stacked (`<key>` for stacked — the real value; `<key>_share`
 * for 100%-stacked — the computed share), `labelKey` the text drawn INSIDE
 * the segment (`<key>_display` — the point's own formattedValue; or
 * `<key>_share_label` — the share `buildStack100Rows` formatted). Both are
 * bound to the point's own rowRef via `data-label-for`. A segment shorter
 * than STACK_LABEL_MIN_HEIGHT_PX draws no label (geometry only — the
 * tooltip still shows it).
 *
 * Task 4 adds the designation gesture: `seriesLabel`/`onPointClick`/`lang`
 * mirror `UserSeriesDot`'s own three extra parameters exactly (role="button"
 * + tabIndex + Enter/Space, since a synthetic role on an SVG element gets no
 * native keyboard activation) — `<rect>` is a raw element this function
 * fully controls, so unlike the pie (see UserPieSlice below) there is no
 * Recharts prop-merging to work around.
 *
 * Fix wave (session 124, final-review I2): `designatedRowRef` marks the
 * segment the reader designated as the total — it is still drawn as one of
 * the bar's segments (the reader's own data, never hidden), so without a
 * marker nothing on the chart said WHICH segment the note's "checked
 * against" refers to (and on a derived/aggregate chart, where every series
 * shares one label, the note's `{label}` alone cannot say it either — I3).
 * See `wholeReferenceMarkProps` for the shared marker. */
export function UserStackSegment(
  seriesKey: string,
  valueKey: string,
  labelKey: string,
  color: string,
  opacity: number,
  seriesLabel: string,
  onPointClick: ((point: PendingPoint) => void) | undefined,
  lang: Lang,
  designatedRowRef: string | null,
) {
  return function Shape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
    const { x, y, width, height, payload } = props;
    if (x == null || y == null || width == null || height == null || !payload) return null;
    const value = payload[valueKey];
    if (value == null) return null;
    const resultId = payload[`${seriesKey}_resultId`];
    const label = payload[labelKey];
    const showLabel = label != null && height >= STACK_LABEL_MIN_HEIGHT_PX;
    const periodLabel = payload.periodLabel;
    const designated = resultId != null && String(resultId) === designatedRowRef;
    const activate = (): void => {
      if (resultId == null || !onPointClick) return;
      onPointClick({ resultId: String(resultId), periodLabel: String(periodLabel), seriesLabel });
    };
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={color}
          fillOpacity={opacity}
          stroke="var(--card)"
          strokeWidth={1}
          data-point="value"
          data-series-key={seriesKey}
          data-series-dimmed={opacity < 1 ? 'true' : undefined}
          data-result-id={resultId == null ? undefined : String(resultId)}
          {...wholeReferenceMarkProps(designated, onPointClick !== undefined, lang, seriesLabel, String(periodLabel))}
          style={onPointClick ? { cursor: 'pointer' } : undefined}
          onClick={onPointClick ? activate : undefined}
          onKeyDown={
            onPointClick
              ? (event: KeyboardEvent<SVGRectElement>) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  event.stopPropagation();
                  activate();
                }
              : undefined
          }
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
            </text>
          </ZIndexLayer>
        ) : null}
      </g>
    );
  };
}

/** Fix wave (session 124, final-review I2/I3): the designation affordance
 * and the designated-total marker, shared by `UserPieSlice` and
 * `UserStackSegment` so the two shapes cannot drift. `clickable` false (no
 * edit context — I4) emits nothing interactive at all: no role, no
 * tabIndex, no label offering an action that cannot happen. When
 * clickable, every slice/segment is a toggle button (`aria-pressed`: a
 * second click on the designated one clears it), and the designated one
 * gets a heavy foreground outline — the visible counterpart of the note's
 * "checked against the row you selected", so a reader can see WHICH drawn
 * slice/segment is the total even when its label is shared with another
 * series (a derived/aggregate own-data chart). The outline is presentation
 * only: no value, size, or label changes. These props are spread AFTER
 * the Cell/segment defaults, so the outline wins over the card-colour
 * separator stroke. */
export function wholeReferenceMarkProps(designated: boolean, clickable: boolean, lang: Lang, series: string, period: string) {
  return {
    ...(designated ? { stroke: 'var(--foreground)', strokeWidth: 3, 'data-whole-reference': 'true' } : {}),
    'data-command-kind': clickable ? 'setWholeReference' : undefined,
    role: clickable ? 'button' : undefined,
    tabIndex: clickable ? 0 : undefined,
    'aria-pressed': clickable ? designated : undefined,
    'aria-label': clickable
      ? t(lang, designated ? 'chart.ownWhole.designatedAriaLabel' : 'chart.ownWhole.designateAriaLabel', { series, period })
      : undefined,
  };
}

/** The pie's designation gesture (Task 4): a custom `shape` for `<Pie>`.
 * Recharts merges each `<Cell>`'s OWN props (fill, the data-* attributes
 * Task 3 added) into the sector object BEFORE calling this — confirmed by
 * reading node_modules/recharts's own Pie.js — but it ALSO unconditionally
 * hardcodes `tabIndex: -1` on that same object afterward, so a `<Cell
 * tabIndex>` would be silently overwritten and never reach the DOM. A
 * custom `shape` sidesteps this: it receives the SAME Cell-merged props
 * (spread first, so fill/data-* survive unchanged) and renders them through
 * Recharts' own exported `<Sector>` (byte-identical to Recharts' internal
 * default — `defaultPieSectorShape` IS `Sector`) with the interactivity
 * props applied AFTER the spread, so they win. `props.value_resultId`/
 * `.label` are UserPieRow's own fields, carried through the same merge. */
export function UserPieSlice(
  periodLabel: string,
  onPointClick: ((point: PendingPoint) => void) | undefined,
  lang: Lang,
  designatedRowRef: string | null,
) {
  // Only the two UserPieRow fields this shape actually reads — NOT
  // `Partial<UserPieRow>`, whose own `key: string` field (the series key,
  // e.g. 's0') collides with React's OWN reserved `key` prop already on
  // PieSectorShapeProps (`Key | null | undefined`) and fails to intersect.
  return function Shape(props: PieSectorShapeProps & { value_resultId?: string | null; label?: string }) {
    // Task 5 fix (found by this task's own e2e run, a real browser: React
    // 19 logs a console error — which this app's e2e harness treats as a
    // hard failure — when a props object carrying a `key` field (Recharts'
    // own merge puts the `<Cell key={r.key}>` React key here too, per the
    // doc comment above) is spread onto JSX. `key` was never read by this
    // component and a `key` on `<Sector>` here would be inert anyway (it is
    // the sole element `Shape` returns, not one of a `.map()`'d list), so it
    // is destructured out and never re-attached, exactly as React's own
    // warning text prescribes.
    const { key: _key, ...sectorProps } = props;
    const resultId = props.value_resultId ?? null;
    const seriesLabel = props.label ?? '';
    const designated = resultId !== null && resultId === designatedRowRef;
    const activate = (): void => {
      if (resultId === null || !onPointClick) return;
      onPointClick({ resultId, periodLabel, seriesLabel });
    };
    return (
      <Sector
        {...sectorProps}
        {...wholeReferenceMarkProps(designated, onPointClick !== undefined, lang, seriesLabel, periodLabel)}
        style={onPointClick ? { cursor: 'pointer' } : undefined}
        onClick={onPointClick ? activate : undefined}
        onKeyDown={
          onPointClick
            ? (event: KeyboardEvent<SVGPathElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                activate();
              }
            : undefined
        }
      />
    );
  };
}

/** The own-data whole note's states → the message key and tone each one
 * renders with. Task 3 builds only `not_checked` — the default, shown
 * whenever a whole form is on screen and nothing has been designated. Task
 * 4 adds `checked` (a confirmed tone), `mismatch` and `cannot_check` (a
 * warning tone) HERE, each carrying the designated row's label as
 * `{label}`, and the card picks the state from the designated reference
 * plus the check's outcome. The <p> under the chart (data-testid
 * "own-whole-note", data-state = the key of this map) is the ONE mount
 * point; the 100%-stacked no-share omission is appended to whatever state
 * is current, exactly as chart.tsx appends its own omissions. */
export const OWN_WHOLE_NOTE = {
  not_checked: { key: 'chart.ownWhole.notChecked', className: 'text-muted-foreground' },
  // Fix wave (session 124, final-review I4): the same default without the
  // "click a point" invitation, for a card with no edit context — there the
  // slices/segments are not clickable at all (see `wholeDesignationClick`).
  not_checked_read_only: { key: 'chart.ownWhole.notCheckedReadOnly', className: 'text-muted-foreground' },
  // Task 4: the three states once a reader has designated a cell as "this
  // is my total". `text-success`/`text-warning` are this app's own existing
  // semantic tone tokens (globals.css) — chart.tsx's CBS whole-note never
  // needed more than one tone because a mismatch there REFUSES the form
  // outright (never rendered); own-data's note instead has to visually
  // distinguish a confirmed match from a mismatch/can't-check, since all
  // three render the chart in full (the deliberate CBS-vs-own-data
  // difference this task's brief calls out).
  checked: { key: 'chart.ownWhole.checked', className: 'text-success' },
  mismatch: { key: 'chart.ownWhole.mismatch', className: 'text-warning' },
  cannot_check: { key: 'chart.ownWhole.cannotCheck', className: 'text-warning' },
} as const satisfies Record<string, { key: MessageKey; className: string }>;
export type OwnWholeNoteState = keyof typeof OWN_WHOLE_NOTE;

/** Task 4: which currently-displayed rowRefs count as "parts" for the
 * designated whole — exactly the set Task 3 already renders (visible
 * series only, per the plan's ratified ruling), MINUS the designated cell
 * itself (summing a "total" as one of its own parts would be nonsensical
 * arithmetic, not a policy choice — verifyPartsSumToWhole is never handed
 * the whole a second time as one of its own parts). Pie has one period by
 * construction, so every OTHER visible slice counts; a stack spans several
 * periods, so only the OTHER visible series AT THE SAME PERIOD as the
 * designated cell count — a stacked bar's "whole" is one full bar (one
 * period), never a sum across unrelated periods, the same "one moment"
 * scoping a pie's whole circle already has.
 *
 * `pieVerificationRows` (Task 4 fix, C1) is deliberately NOT the same array
 * `<Pie>` draws from (`pieRows`, which drops a null-valued row since it
 * cannot be rendered as a slice) — a visible-but-null part must still
 * reach `verifyPartsSumToWhole` as `withheld_member`, never silently
 * vanish from the sum the way it would if this used the rendering-filtered
 * set. See `pieVerificationRows`'s own definition where it is built. */
export function wholePartRowRefsFor(
  activeForm: ChartForm,
  wholeRowRef: string | null,
  pieVerificationRows: readonly UserPieRow[],
  rows: readonly Row[],
  visibleSeries: readonly SeriesMeta[],
): string[] {
  if (wholeRowRef === null) return [];
  if (activeForm === 'pie') {
    return pieVerificationRows
      .filter((r) => r.value_resultId !== null && r.value_resultId !== wholeRowRef)
      .map((r) => r.value_resultId as string);
  }
  if (activeForm === 'stacked' || activeForm === 'stacked100') {
    const row = rows.find((r) => visibleSeries.some((s) => r[`${s.key}_resultId`] === wholeRowRef));
    if (row === undefined) return [];
    return visibleSeries
      .map((s) => row[`${s.key}_resultId`])
      .filter((ref): ref is string => typeof ref === 'string' && ref !== wholeRowRef);
  }
  return [];
}

/** Task 4: the designated cell's own human-readable label for the note's
 * `{label}` — the series alone for a pie (one shared period, so naming it
 * again would be redundant), series + period for a stack (a cell is a
 * (series, period) pair, and the SAME series can be designated at more than
 * one period). Mirrors chart-notes.tsx's own "{seriesLabel} · {periodLabel}"
 * join exactly (chart-notes.tsx:122). Falls back to the raw rowRef itself
 * when the designated cell is not among the currently-displayed rows at all
 * (e.g. its series was hidden after designation, or a data edit dropped it)
 * — defensive, not expected on a fresh designation (a reader can only click
 * an already-rendered point), but never blank: the note always names
 * SOMETHING traceable rather than showing nothing. */
export function wholeReferenceLabel(
  activeForm: ChartForm,
  wholeRowRef: string,
  pieRows: readonly UserPieRow[],
  rows: readonly Row[],
  visibleSeries: readonly SeriesMeta[],
): string {
  if (activeForm === 'pie') {
    const row = pieRows.find((r) => r.value_resultId === wholeRowRef);
    return row?.label ?? wholeRowRef;
  }
  for (const row of rows) {
    const series = visibleSeries.find((s) => row[`${s.key}_resultId`] === wholeRowRef);
    if (series !== undefined) return `${series.label} · ${String(row.periodLabel)}`;
  }
  return wholeRowRef;
}
