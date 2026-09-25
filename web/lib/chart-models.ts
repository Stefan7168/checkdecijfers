// Chart-card pure models (session 128, chart.tsx split): every module-level
// type, constant and React-free builder function moved verbatim OUT of
// chart.tsx — same names, same bodies, same comments, no behaviour change.
// chart.tsx re-exports everything here that was part of its own public API
// before this split (see the `export { ... } from '../lib/chart-models.ts'`
// block near its own top), so no importer anywhere had to change. Nothing in
// this file touches React, JSX or a Recharts hook — the render-time helper
// components (tooltips, axis ticks, overlays, bar/dot shapes) that consume
// these models live in the sibling `chart-parts.tsx` instead.
import type { ChartPoint, ChartSpec } from '../backend/chart/types.ts';
import type { ChartPresentation, PresentationOverrides } from './chart-presentation.ts';
import { DEFAULT_PALETTE } from './chart-presentation.ts';
import { t, type Lang, type MessageKey } from './i18n/messages.ts';
import { lastPlottedPoint } from './chart-plotted-point.ts';
import { BAR_LABEL_MAX } from './chart-view-state.ts';
import { translateMeasureTitle, translatePeriodLabel, translateRegion, translateUnit } from './i18n/cbs-words.ts';
import { formatValueNl } from '../backend/answer/compose/format.ts';
import { displayDifferenceUnit, displayValueUnit } from '../backend/answer/compose/template.ts';
import type { DerivationRecord } from '../../src/query/types.ts';
import { resolveSourceForTable } from '../backend/sources/registry.ts';
import type { WholePeriodOutcome } from '../app/chart-whole-verification-actions.ts';
import type { StoryStep } from './chart-story.ts';

/**
 * ADR 037 D11: the minimal structural subset `buildRows`/`valueLabelPlan`
 * actually touch — extracted so a `UserChartSpec`-derived adapter (never a
 * real `ChartSpec`, per H2) can satisfy the same interface without being
 * one. Type-only change: a real `ChartSpec`/`ChartPoint` already carries
 * every field here plus more, so it satisfies `PlottableSpec` structurally
 * with zero call-site changes — `ChartView` (and every existing chart.tsx
 * test) is byte-identical, unaffected by this file at all. `yAxisDomain`
 * needs no change; it already takes only `ChartSpec['kind']`.
 */
export interface PlottablePoint {
  periodCode: string;
  periodLabel: string;
  value: number | null;
  formattedValue: string | null;
  provisional: boolean;
  resultId: string;
}

export interface PlottableSeries {
  label: string;
  points: PlottablePoint[];
}

export interface PlottableSpec {
  kind: 'line' | 'bar';
  series: PlottableSeries[];
}

export type Row = Record<string, string | number | boolean | null>;

export interface SeriesMeta {
  key: string;
  label: string;
  color: string;
}

// Series palette — ADR 042 (2026-09-11): the default is now `DEFAULT_PALETTE`,
// a colour-blind-safe set (Okabe-Ito's first four, hand-tuned entries beyond
// that) chosen for the designed default look. The session-87 "basic
// Recharts" palette (owner decision, docs/superpowers/specs/2026-09-07-chat-
// chart-visual-redesign-design.md — the colours Recharts' own documentation
// examples use) is kept as `RECHARTS_PALETTE` for the Classic look and the
// continuity pins that still exercise it. The hollow/hatched provisional
// marker (R11) is unchanged either way — that is honesty, not styling. The
// palette cycles for series nine and up; the Tabel view remains the honest
// surface for many series.
export { RECHARTS_PALETTE, DEFAULT_PALETTE } from './chart-presentation.ts';

export function seriesStyle(index: number): { color: string } {
  return { color: DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]! };
}

// Axis + grid colours (session 87 deep review): Recharts' own defaults are
// literal light-mode greys (#666 axis/ticks, #ccc grid) that it hardcodes on
// the SVG, so in dark mode the x-axis period labels rendered at ~3:1 against
// the card and the grid became the brightest thing on the chart — these two
// colours ride the theme tokens, like every other text in the product. The
// geometry itself is now the ADR 042 designed default (2026-09-11):
// horizontal-only grid, axis lines hidden by default with a hairline
// baseline in their place (`baselineAxisLine` below), and `DEFAULT_PALETTE`
// for series colour. Session 87's "basic Recharts look" survives only as
// the Classic look. One definition, reused by UserChartView and
// ChartSmallMultiples.
export const AXIS_COLOR = 'var(--muted-foreground)';
export const GRID_COLOR = 'var(--border)';

/** Chart-card polish (2026-09-15): the grid is a SOLID hairline at half
 * opacity. The former `3 3` dash was byte-identical to the curated
 * event-marker <ReferenceLine> dash below — ADR 042 decision 10 reserved
 * the dashed vocabulary for event markers and the story ring, and the grid
 * had been the one exception. One constant shared by every CartesianGrid
 * (line, area, bar, hbar, ChartSmallMultiples) so the five sites cannot
 * drift. `pres.grid` still decides WHICH lines exist (ADR 039/042). */
export const GRID_LINE_PROPS = { stroke: GRID_COLOR, strokeOpacity: 0.5 } as const;

/** Row 10 (session 110 UX audit pass 2): CHART_MIN_HEIGHT_PX (256, ADR 042)
 * is a floor for the height-follows-width auto-height rule below — right
 * for an ordinary card, but at a small embed frame (320×240, a common
 * sidebar unit) that floor is TALLER than the frame itself, so the chart
 * alone overflowed a 240px iframe with no way to scroll it into view.
 * `embedHeightValue` makes the height frame-relative for embedMode ONLY —
 * CSS `min()` against `100dvh` (the embed page's ambient `h-dvh` app shell
 * means `dvh` here resolves to the embed IFRAME's own rendered height, so
 * this is genuinely frame-relative, not a second hardcoded floor) minus a
 * fixed reserve for the attribution block that always sits below the chart
 * in embedMode (definitionLine / the attribution+SourceBadge row / the
 * "Frozen on …" footer — all text-xs). Applied ONLY when embedMode is true
 * (see the containerStyle call sites below); every non-embed chart's height
 * stays exactly the plain px number it always was. */
export const EMBED_ATTRIBUTION_RESERVE_PX = 72;
export function embedHeightValue(idealPx: number): string {
  return `min(${idealPx}px, 100dvh - ${EMBED_ATTRIBUTION_RESERVE_PX}px)`;
}

// Y-axis honesty policy (open-questions #48, resolved 2026-07-04): a bar
// encodes LENGTH, so a non-zero baseline visually lies about ratios — bars
// must floor at zero. A line encodes POSITION, so it may zoom to show real
// movement. Mirrors the deterministic SVG renderer's `makeScale`
// (src/chart/render.ts), which has done this since WP8. Exported + wired into
// the YAxis below so the tested policy IS the rendered policy (WP12 review
// lesson: a policy that the render doesn't actually use is not a guard).
// #197: a zoomed line axis is now also honest BY DISCLOSURE — its plotted
// minimum and maximum are labelled, so a reader can see the axis does not
// start at zero.
export function yAxisDomain(kind: ChartSpec['kind']): [0 | 'auto', 'auto'] {
  return kind === 'bar' ? [0, 'auto'] : ['auto', 'auto'];
}

/** ADR 042: the category (period/region) axis line. With Aslijnen on it is
 * the full axis line in AXIS_COLOR (Recharts' `true`); with Aslijnen off a
 * hairline BASELINE in the grid colour is still drawn as long as any grid
 * is shown — a quiet chart keeps its ground; grid none + axis lines off is
 * a bare plot, as a reader would expect. The number axis follows
 * `axisLines` alone. Recharts accepts SVG props for `axisLine`. */
export function baselineAxisLine(pres: Pick<ChartPresentation, 'axisLines' | 'grid'>): boolean | { stroke: string } {
  if (pres.axisLines === 'shown') return true;
  return pres.grid === 'none' ? false : { stroke: GRID_COLOR };
}

/** Keeps a Vanaf/Tot period-range selection always non-empty: moving one
 * endpoint past the other drags the other one along instead of producing an
 * inverted range (`windowSpec` would then plot zero points, and the
 * disclosure sentence would read as nonsense — "Getoond: 2021-2019 van...").
 * Single source for both selects' onChange handlers (code-review finding:
 * the two were previously duplicated inline with no shared name to keep
 * them in sync) — `clampVanafChange` pins the just-picked Vanaf and drags
 * Tot up to match; `clampTotChange` is the mirror, pinning Tot. */
export function clampVanafChange(from: string, to: string): [string, string] {
  return to < from ? [from, from] : [from, to];
}

export function clampTotChange(from: string, to: string): [string, string] {
  return from > to ? [to, to] : [from, to];
}

export function buildRows(
  spec: PlottableSpec,
  // WP218 (ADR 039) Phase 0: optional effective-colour resolver, so a caller
  // that has already run the presentation resolver (ChartView, Chart
  // SmallMultiples) can feed its resolved series colours straight into
  // `seriesMeta[i].color` — the ONE place every legend swatch, tooltip
  // swatch and hatch pattern reads its colour from. Default = today's
  // literal palette lookup, so every existing caller (UserChartView
  // included, per ADR 037 H2) keeps its current behaviour unchanged.
  colors: (index: number) => string = (i) => seriesStyle(i).color,
): { rows: Row[]; seriesMeta: SeriesMeta[] } {
  const periodCodes = new Set<string>();
  for (const series of spec.series) {
    for (const point of series.points) periodCodes.add(point.periodCode);
  }
  const sortedCodes = Array.from(periodCodes).sort((a, b) => a.localeCompare(b));

  const seriesMeta: SeriesMeta[] = spec.series.map((series, i) => ({
    key: `s${i}`,
    label: series.label,
    color: colors(i),
  }));

  const rows: Row[] = sortedCodes.map((code) => {
    const row: Row = { periodCode: code, periodLabel: code };
    spec.series.forEach((series, i) => {
      const point = series.points.find((p) => p.periodCode === code) ?? null;
      const key = seriesMeta[i].key;
      row[key] = point ? point.value : null;
      row[`${key}_display`] = point ? point.formattedValue : null;
      row[`${key}_provisional`] = point ? point.provisional : false;
      // R1 traceability carried per point, so every displayed string stays
      // BOUND to its source cell (data-label-for in the tooltip) — the WP8
      // membership-without-binding lesson recurred in this wrapper and was
      // caught by the WP12 adversarial review.
      row[`${key}_resultId`] = point ? point.resultId : null;
      // First-wins: a series with a disjoint period set must not overwrite
      // the label another series already provided for this period code.
      if (point && row.periodLabel === code) row.periodLabel = point.periodLabel;
    });
    return row;
  });

  return { rows, seriesMeta };
}

/**
 * WP218 phase 5: the transposed row set for the horizontal-bar form — a
 * comparison's spec has one series PER REGION and exactly one point per
 * series (one period), so unlike `buildRows` (one row per period, one
 * column per series) this is one row PER SERIES, read from that series'
 * FIRST point. Spec order is preserved verbatim (R6: a comparison's series
 * order is never re-sorted by value here — any ranking display is a refused
 * chart type, see the phase-5 plan's Global Constraints), and a series with
 * no point at all degrades to a null row rather than throwing, mirroring
 * `buildRows`' own null-safety for a missing point.
 */
export interface RegionRow {
  label: string;
  value: number | null;
  value_display: string | null;
  value_provisional: boolean;
  value_resultId: string | null;
  colorIndex: number;
}

export function buildRegionRows(
  spec: PlottableSpec,
  colorFor: (index: number) => string,
): { rows: RegionRow[]; colors: string[] } {
  const rows: RegionRow[] = spec.series.map((series, i) => {
    const point = series.points[0] ?? null;
    return {
      label: series.label,
      value: point ? point.value : null,
      value_display: point ? point.formattedValue : null,
      value_provisional: point ? point.provisional : false,
      value_resultId: point ? point.resultId : null,
      colorIndex: i,
    };
  });
  const colors = spec.series.map((_, i) => colorFor(i));
  return { rows, colors };
}

/** Phase 5 (chart-fit scorer, Task 3): one endpoint of a dumbbell row — a
 * point's own already-verified value and display string, verbatim (R6),
 * plus the resultId the drawn label is bound to (R1, `data-label-for`). */
export interface DumbbellEnd {
  value: number;
  formattedValue: string;
  resultId: string;
  periodLabel: string;
  provisional: boolean;
}

/** Phase 5 (Task 3): the dumbbell form's own row model — one row per SERIES
 * (a region, say), its two points as the row's two dots. `range` is the
 * `[min, max]` of the two values and exists ONLY so the numeric x-axis can
 * derive its extent from the chart data through its own `dataKey` (Recharts
 * 3.x derives a numeric axis domain from `axis.dataKey` when the chart has
 * no graphical items, and accepts a `[lo, hi]` pair — verified against the
 * installed 3.10.1 `axisSelectors`). It is never drawn or shown as a number;
 * every visible digit comes from `from`/`to`'s own `formattedValue`. */
export interface DumbbellRow {
  key: string;
  label: string;
  from: DumbbellEnd;
  to: DumbbellEnd;
  range: [number, number];
}

/** Phase 5 (Task 3): builds the dumbbell rows from the spec's series, in
 * spec order (R6: never re-sorted), keyed `s${i}` exactly like `seriesMeta`
 * so colour/hidden/highlight state joins on the same key every other form
 * uses. `dumbbellFormAllowed` (chart-view-state.ts) already guarantees the
 * ORIGINAL spec has exactly two real-valued points per series — but the spec
 * this is handed is the DISPLAYED (period-windowed) one, so a series the
 * Vanaf/Tot window has narrowed below two points, or whose point lost its
 * display string, is skipped here rather than drawn half-way: a row is
 * either both real dots or nothing (principle (c)), mirroring how RegionBar
 * draws nothing for a null value. Exported for direct testing, mirroring
 * buildRegionRows. */
export function buildDumbbellRows(spec: Pick<PlottableSpec, 'series'>): DumbbellRow[] {
  const rows: DumbbellRow[] = [];
  spec.series.forEach((series, i) => {
    if (series.points.length !== 2) return;
    const [from, to] = series.points as [PlottablePoint, PlottablePoint];
    if (from.value === null || to.value === null || from.formattedValue === null || to.formattedValue === null) return;
    const end = (p: PlottablePoint, value: number, formattedValue: string): DumbbellEnd => ({
      value,
      formattedValue,
      resultId: p.resultId,
      periodLabel: p.periodLabel,
      provisional: p.provisional,
    });
    rows.push({
      key: `s${i}`,
      label: series.label,
      from: end(from, from.value, from.formattedValue),
      to: end(to, to.value, to.formattedValue),
      range: [Math.min(from.value, to.value), Math.max(from.value, to.value)],
    });
  });
  return rows;
}

/** #170(4): which curated annotations to draw, resolved to the exact
 * `periodLabel` string Recharts' categorical x-axis (dataKey="periodLabel")
 * matches on — looked up from `rows`, never reformatted or recomputed here.
 * Only meaningful for line charts (a bar/comparison result is one period
 * across regions — no time axis to place a vertical marker on) and only for
 * an annotation whose period is literally one of this chart's own plotted
 * rows (R6 discipline extended to metadata: never an approximate or
 * interpolated placement). Exported for direct testing, mirroring buildRows. */
export function annotationMarkers(spec: ChartSpec, rows: Row[]): { periodLabel: string; label: string }[] {
  if (spec.kind !== 'line') return [];
  const annotations = spec.annotations ?? [];
  if (annotations.length === 0) return [];
  const labelByCode = new Map<string, string>();
  for (const row of rows) labelByCode.set(String(row.periodCode), String(row.periodLabel));
  const markers: { periodLabel: string; label: string }[] = [];
  for (const a of annotations) {
    const periodLabel = labelByCode.get(a.periodCode);
    if (periodLabel !== undefined) markers.push({ periodLabel, label: a.label });
  }
  return markers;
}

// ---------------------------------------------------------------------------
// #197: the numbers on the chart. WHICH points get a label is a count-based
// presentation rule of the same kind as the idea bank's label-thinning rule
// (docs/idea-bank.md §1): the plotted minimum and maximum on the y-axis, the
// last plotted point of every line, every bar up to a readable maximum. WHAT
// the label says is always the point's own `formattedValue` (+ the same '*'
// provisional suffix the tooltip and src/chart/render.ts use) — never a
// number this file formatted, rounded or interpolated. Selecting among
// existing spec strings is rendering; producing a new one would not be.
// ---------------------------------------------------------------------------

export interface AxisTickLabel {
  /** The raw value, used only to POSITION the tick (geometry). */
  value: number;
  /** The point's own display string — the only text a viewer sees. */
  display: string;
  resultId: string;
}

export interface PointLabel {
  seriesKey: string;
  periodCode: string;
  resultId: string;
  text: string;
}

export interface ValueLabelPlan {
  /** Line charts: the plotted min and max (one entry when they coincide). */
  axisTicks: AxisTickLabel[];
  /** Line charts: "periodLabel: value" at each series' last plotted point —
   * or, per session-110 pass-4 row 14, just "value" when EVERY series' last
   * plotted point falls on the SAME period (the period is then only stated
   * once, by the x-axis/legend, instead of once per series). A series that
   * ends on a different period (a partial region, ADR 055) always keeps its
   * own prefix, because then the label is the only thing on screen that says
   * which period IT covers. */
  endLabels: PointLabel[];
  /** Bar charts: one label per bar, or none above BAR_LABEL_MAX bars. */
  barLabels: PointLabel[];
}

function pointLabelText(point: PlottablePoint): string {
  return `${point.formattedValue ?? ''}${point.provisional ? '*' : ''}`;
}

export function valueLabelPlan(spec: PlottableSpec): ValueLabelPlan {
  const empty: ValueLabelPlan = { axisTicks: [], endLabels: [], barLabels: [] };
  const plotted = spec.series.flatMap((series, i) =>
    series.points
      .filter((p) => p.value !== null && p.formattedValue !== null)
      .map((point) => ({ seriesKey: `s${i}`, point })),
  );
  if (plotted.length === 0) return empty;

  if (spec.kind === 'bar') {
    if (plotted.length > BAR_LABEL_MAX) return empty;
    return {
      ...empty,
      barLabels: plotted.map(({ seriesKey, point }) => ({
        seriesKey,
        periodCode: point.periodCode,
        resultId: point.resultId,
        text: pointLabelText(point),
      })),
    };
  }

  // First occurrence wins on ties, in the spec's own order — deterministic.
  let lo = plotted[0];
  let hi = plotted[0];
  for (const entry of plotted) {
    if ((entry.point.value as number) < (lo.point.value as number)) lo = entry;
    if ((entry.point.value as number) > (hi.point.value as number)) hi = entry;
  }
  const tick = (entry: { point: PlottablePoint }): AxisTickLabel => ({
    value: entry.point.value as number,
    display: entry.point.formattedValue as string,
    resultId: entry.point.resultId,
  });
  const axisTicks = lo.point.value === hi.point.value ? [tick(lo)] : [tick(lo), tick(hi)];

  // Session-110 pass-4 row 14: when every plotted series' last point falls on
  // the same period, repeating that period on every end-of-line label is
  // pure clutter (the flagship case is a 6-region comparison: six identical
  // "2024: " prefixes eating most of the right margin, see row 2's own
  // measurement). Two or more last points, all equal, is required —
  // single-series charts keep the prefix unchanged (their one end label is
  // still the clearest on-chart statement of "as of which period", same as
  // before this row), and a lone differing series (a partial region, ADR
  // 055) keeps EVERY label prefixed, because then the prefix is the only
  // thing on screen naming which period that specific series' number is for
  // — self-describing per R6's own framing above.
  const lastPointsBySeries = spec.series.map((series) => lastPlottedPoint(series.points));
  const validLastPoints = lastPointsBySeries.filter((p): p is NonNullable<typeof p> => p !== undefined);
  const sharedEndPeriodCode =
    validLastPoints.length >= 2 && validLastPoints.every((p) => p.periodCode === validLastPoints[0]!.periodCode)
      ? validLastPoints[0]!.periodCode
      : null;

  const endLabels: PointLabel[] = spec.series.flatMap((series, i) => {
    // Code-review fix (2026-09-15): this selection now shares
    // lastPlottedPoint with chart-headline.ts's headlineFigure, so the
    // end-of-line label and the card's headline number can never disagree
    // about which point is "current" — see chart-plotted-point.ts.
    const last = lastPlottedPoint(series.points);
    if (!last) return [];
    return [
      {
        seriesKey: `s${i}`,
        periodCode: last.periodCode,
        resultId: last.resultId,
        text: last.periodCode === sharedEndPeriodCode ? pointLabelText(last) : `${last.periodLabel}: ${pointLabelText(last)}`,
      },
    ];
  });

  return { axisTicks, endLabels, barLabels: [] };
}

// ---------------------------------------------------------------------------
// #197 step 2: the "Tabel" view — a second dumb renderer over the same spec.
// Period × series, the point's own formattedValue (+ the '*' provisional
// suffix), a null cell as an honest gap with its CBS reason (R11 — never a
// blank that reads as zero). Bars transpose: one row per region under the
// single period. Nothing here is computed; every cell is a spec string bound
// to its resultId, same contract as the chart.
// ---------------------------------------------------------------------------

export interface TableCell {
  text: string;
  resultId: string | null;
}

export interface TableModel {
  caption: string;
  header: string[];
  rows: { label: string; cells: TableCell[] }[];
}

function tableCellText(point: ChartPoint): string {
  if (point.value === null || point.formattedValue === null) {
    return point.valueAttribute === 'None' ? '—' : `— (${point.valueAttribute})`;
  }
  return pointLabelText(point);
}

const EMPTY_CELL: TableCell = { text: '', resultId: null };

/** `lang` defaults to 'nl' so every existing direct call (chart.test.tsx)
 * keeps its current signature and output. `spec` is expected to already
 * carry translated title/unit/series-labels/periodLabels when `lang` is
 * 'en' (ChartView feeds it `displaySpec` — see `translateSpecForDisplay` —
 * so this function itself only needs to translate its OWN fixed header
 * words, never re-derive CBS text from the spec a second time). */
export function tableModel(spec: ChartSpec, lang: Lang = 'nl'): TableModel {
  const caption = `${spec.title} (${spec.unit})`;
  if (spec.kind === 'bar') {
    const periodLabels = new Set(spec.series.flatMap((s) => s.points.map((p) => p.periodLabel)));
    const periodHeader = periodLabels.size === 1 ? [...periodLabels][0] : t(lang, 'chart.table.value');
    return {
      caption,
      header: [t(lang, 'chart.table.region'), periodHeader],
      rows: spec.series.map((series) => {
        const point = series.points[0];
        return {
          label: series.label,
          cells: [point ? { text: tableCellText(point), resultId: point.resultId } : EMPTY_CELL],
        };
      }),
    };
  }
  // Same chronological ordering rule as buildRows (period codes sort
  // lexicographically = chronologically within one grain).
  const codes = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.periodCode)))].sort((a, b) =>
    a.localeCompare(b),
  );
  const labelByCode = new Map<string, string>();
  for (const series of spec.series) {
    for (const point of series.points) {
      if (!labelByCode.has(point.periodCode)) labelByCode.set(point.periodCode, point.periodLabel);
    }
  }
  return {
    caption,
    header: [t(lang, 'chart.table.period'), ...spec.series.map((s) => s.label)],
    rows: codes.map((code) => ({
      label: labelByCode.get(code) ?? code,
      cells: spec.series.map((series) => {
        const point = series.points.find((p) => p.periodCode === code);
        return point ? { text: tableCellText(point), resultId: point.resultId } : EMPTY_CELL;
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Phase 5 (chart-fit scorer, session 116, Task 4): the "Warmtekaart" view —
// the table's own rows and columns again, each cell shaded by where its
// value sits between the grid's smallest and largest. NOT a Recharts chart:
// a plain CSS grid (`HeatmapGrid` below), the cheapest mechanism that draws
// it. `heatmapModel` is a SIBLING of `tableModel`, not a wrapper over it —
// the same branching (bar: one column, one row per series; time series: one
// column per series, one row per period, chronological) and the same
// header words, but each cell also carries its raw `value`, which the colour
// needs and which `TableCell` deliberately never had (the table only shows
// text). `TableCell`/`TableModel`/`tableModel` are untouched.
//
// Every cell is one point's OWN formattedValue bound to its resultId (R1),
// exactly like the table; the colour is a second cue derived from that same
// point's value, never the only way a value is communicated. A missing
// intersection cannot occur: `heatmapFormAllowed` (chart-view-state.ts)
// only offers this form when every series carries a real value at every
// period, so a cell with no point here is a guard bug — thrown, never
// papered over as an empty cell.
// ---------------------------------------------------------------------------

export interface HeatmapCell {
  text: string;
  resultId: string;
  value: number;
}

export interface HeatmapModel {
  caption: string;
  header: string[];
  rows: { label: string; cells: HeatmapCell[] }[];
  /** The grid's own extremes, computed ONCE over every cell — the one scale
   * every cell's colour is read against. Equal when every cell holds the
   * same value (see `heatmapIntensity`). */
  min: number;
  max: number;
}

function heatmapCell(point: ChartPoint | undefined, where: string): HeatmapCell {
  if (point === undefined || point.value === null) {
    throw new Error(`heatmapModel: no real value at ${where} — heatmapFormAllowed should have refused this spec`);
  }
  return { text: pointLabelText(point), resultId: point.resultId, value: point.value };
}

export function heatmapModel(spec: ChartSpec, lang: Lang = 'nl'): HeatmapModel {
  const caption = `${spec.title} (${spec.unit})`;
  let header: string[];
  let rows: HeatmapModel['rows'];
  if (spec.kind === 'bar') {
    const periodLabels = new Set(spec.series.flatMap((s) => s.points.map((p) => p.periodLabel)));
    const periodHeader = periodLabels.size === 1 ? [...periodLabels][0]! : t(lang, 'chart.table.value');
    header = [t(lang, 'chart.table.region'), periodHeader];
    rows = spec.series.map((series) => ({
      label: series.label,
      cells: [heatmapCell(series.points[0], `series "${series.label}"`)],
    }));
  } else {
    // Same chronological ordering rule as tableModel/buildRows (period codes
    // sort lexicographically = chronologically within one grain).
    const codes = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.periodCode)))].sort((a, b) =>
      a.localeCompare(b),
    );
    const labelByCode = new Map<string, string>();
    for (const series of spec.series) {
      for (const point of series.points) {
        if (!labelByCode.has(point.periodCode)) labelByCode.set(point.periodCode, point.periodLabel);
      }
    }
    header = [t(lang, 'chart.table.period'), ...spec.series.map((s) => s.label)];
    rows = codes.map((code) => ({
      label: labelByCode.get(code) ?? code,
      cells: spec.series.map((series) =>
        heatmapCell(
          series.points.find((p) => p.periodCode === code),
          `period ${code} of series "${series.label}"`,
        ),
      ),
    }));
  }
  const values = rows.flatMap((row) => row.cells.map((cell) => cell.value));
  return { caption, header, rows, min: Math.min(...values), max: Math.max(...values) };
}

/** Maps `value` linearly onto `min..max` as a 0..1 intensity. Returns 0.5
 * when min === max (every cell the same value — nothing to contrast, so
 * every cell gets the same mid tone rather than all-low or all-high). */
export function heatmapIntensity(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/** The cell background for a 0..1 intensity: a mix between the two
 * `--heatmap-low`/`--heatmap-high` tokens (app/globals.css, light + dark),
 * whole percentages — the ONE scale every cell of a grid shares. */
export function heatmapCellColor(intensity: number): string {
  return `color-mix(in oklch, var(--heatmap-low), var(--heatmap-high) ${Math.round(intensity * 100)}%)`;
}

/** WP218 phase 4 (#219, design §4): a verbatim-projection view of `spec` with
 * only its CBS-word DISPLAY TEXT translated (title, unit, series
 * labels/regions, period labels) — the SAME "project, never recompute"
 * contract as `windowSpec` (chart-view-state.ts): every value/
 * formattedValue/resultId/provisional/status/decimals/attribution/
 * annotations field is untouched, and 'nl' returns `spec` itself unchanged
 * (no-op fast path). Every downstream pure function (buildRows,
 * annotationMarkers, valueLabelPlan, tableModel) reads whatever spec it is
 * given verbatim, so feeding this one translated spec into all of them keeps
 * every plotted numeric token bound to a spec string exactly as before —
 * the converters never touch a value, only the label text around it.
 * `provisionalNote`/`nullNotes`/`definitionLine`/`attribution.trendHeadline`
 * are backend prose (documented limitation, design §4) and are NOT touched
 * here — they stay Dutch on an English chart. */
export function translateSpecForDisplay(spec: ChartSpec, lang: Lang): ChartSpec {
  if (lang !== 'en') return spec;
  return {
    ...spec,
    title: translateMeasureTitle(spec.title),
    unit: translateUnit(spec.unit),
    series: spec.series.map((series) => ({
      ...series,
      label: translateRegion(series.label),
      points: series.points.map((point) => ({ ...point, periodLabel: translatePeriodLabel(point.periodLabel) })),
    })),
  };
}

/**
 * WP218 phase 5 (Task 2): the horizontal-bar form's OWN render-time row —
 * one per region, built in ChartView from `buildRegionRows` (Task 1) plus
 * the SAME seriesKey (`s${i}`), resolved colour and hatch-pattern id every
 * other branch derives from `seriesMeta`. Unlike `Row` (period x series,
 * many columns) this is one row per BAR, so `RegionBar` below reads
 * everything it needs straight off the row instead of a seriesKey-indexed
 * lookup — there is exactly one series (the region itself) per row.
 */
/** Session 110 UX audit pass 3, row 10: which rows of an hbar chart carry a
 * value label. 'all' (the pre-existing rule, <= BAR_LABEL_MAX plotted rows)
 * labels every row; 'extremesOnly' (> BAR_LABEL_MAX) labels only the first
 * and last PLOTTED row so the chart is never left with zero numbers; 'none'
 * is the pre-existing empty case (no plotted rows at all). */
export type HbarLabelMode = 'all' | 'extremesOnly' | 'none';

export interface RegionChartRow {
  key: string;
  label: string;
  value: number | null;
  value_display: string | null;
  value_provisional: boolean;
  value_resultId: string | null;
  color: string;
  dimmed: boolean;
  patternId: string;
}

/** Final-review fix I1: formats a resolved derived-overlay value (mean or
 * difference) through the SAME helpers the answer body's own derivation
 * rendering uses (`displayValueUnit`/`displayDifferenceUnit`,
 * src/answer/compose/template.ts — see answer-proof.ts's identical use for
 * the difference/mean sentences), at the SOURCE cells' own decimals and
 * unit. Replaces the old hardcoded `formatValueNl(record.value, 0)`, which
 * always rounded to 0 decimals and dropped the unit regardless of what the
 * underlying series actually carries (a mean of 10.55 on a '%' series used
 * to render as the wrong number, "11", inside the chart and its export).
 * `points` is every point across every series of the DISPLAYED spec — the
 * same "look the source cell up by resultId" pattern chart.tsx's own
 * difference-arrow render already uses just below. Falls back to 0 decimals
 * only if none of the overlay's own source points can be found, which
 * should not happen in practice: `requestChartDerivation` only ever resolves
 * an overlay from resultIds that came from this same displaySpec. */
export function formatOverlayValue(
  record: Extract<DerivationRecord, { kind: 'mean' } | { kind: 'difference' }>,
  points: ChartPoint[],
  lang: Lang = 'nl',
): string {
  const decimals =
    record.sourceResultIds
      .map((id) => points.find((p) => p.resultId === id)?.decimals)
      .find((d): d is number => d !== undefined) ?? 0;
  if (lang === 'en') {
    // #294 (session 129, owner-decisions brief item 4): an English chart's
    // overlay label uses the SAME hand-written CBS-word table as the rest of
    // the translated spec (translateSpecForDisplay's `translateUnit`) — the
    // number itself is formatted exactly as in Dutch (same helper, same
    // decimals); only the unit word after it changes. A difference over %
    // cells is a percentage point, never % (R10), in English too.
    const unit = record.kind === 'difference' && record.unit.trim() === '%' ? 'percentage point' : translateUnit(record.unit);
    return displayValueUnit(record.value, decimals, unit);
  }
  return record.kind === 'mean'
    ? displayValueUnit(record.value, decimals, record.unit)
    : displayDifferenceUnit(record.value, decimals, record.unit);
}

/** Final-review fix I6: the known, LITERAL server refusal reasons (English
 * developer strings from app/chart-derivation-actions.ts and the registered
 * derivation functions in src/query/derivations.ts — deriveDifference /
 * deriveMean's `checkComputable`/`checkSingleRegion` guards) mapped to a
 * translated message, so a Dutch reader never sees raw English mixed into
 * the chart card. Deliberately a flat exact-match lookup, not a parser: most
 * of derivations.ts's own refusal strings interpolate a resultId, a count,
 * or a unit list, which cannot be pre-translated word-for-word without
 * guessing at their content — those (and anything else unrecognised) fall
 * back to one generic Dutch/English sentence via `errorGeneric`. */
export const KNOWN_DERIVATION_REFUSAL_KEYS: Record<string, MessageKey> = {
  'only a CBS/Eurostat chart can be re-derived this way': 'chart.derived.errorUnavailableChart',
  'this answer is not available': 'chart.derived.errorAnswerUnavailable',
  'this answer has no chart to derive from': 'chart.derived.errorNoChart',
  'one of those points is not on this chart': 'chart.derived.errorPointNotOnChart',
  'difference needs two distinct periods': 'chart.derived.errorSamePeriod',
  // Same underlying problem the client-side picker already precludes with
  // its own `errorMissingRegion` message (chart.tsx's `onPointClick`) — this
  // covers the server reaching the same refusal by a different path.
  'difference compares periods at one place — regions differ': 'chart.derived.errorMissingRegion',
  // #316: a Eurostat break-in-series flag lies between the two compared
  // periods (found by the server's whole-window lookup, not visible in the
  // two clicked cells alone) — ADR 048 D5b / ruling R8.
  'a Eurostat break in series lies between these points': 'chart.derived.errorSeriesBreak',
};

export function derivationRefusalMessage(lang: Lang, reason: string): string {
  const key = KNOWN_DERIVATION_REFUSAL_KEYS[reason];
  return t(lang, key ?? 'chart.derived.errorGeneric');
}

/** Chart co-pilot phase 5b (verified-whole, Task 4): one period's verdict as
 * ChartView holds it — the server's own `WholePeriodOutcome` plus the one
 * client-side reason ('unavailable': the action answered `ok: false` or
 * threw), so a failed round trip is an explained refusal, never a spinner. */
export type WholeClientOutcome = WholePeriodOutcome | { verified: false; reason: 'unavailable' };

/** Phase 5b: the digit-free message key for a refused verdict — one key per
 * reason code, never the server's raw string (the same rule
 * `derivationRefusalMessage` follows for phase 4's overlays). */
export function wholeRefusalKey(reason: Extract<WholeClientOutcome, { verified: false }>['reason']): MessageKey {
  switch (reason) {
    case 'missing_whole':
      return 'chart.whole.refused.missing_whole';
    case 'withheld_member':
      return 'chart.whole.refused.withheld_member';
    case 'sum_mismatch':
      return 'chart.whole.refused.sum_mismatch';
    case 'incomplete_roster':
      return 'chart.whole.refused.incomplete_roster';
    case 'unavailable':
      return 'chart.whole.refused.unavailable';
  }
}

/** Phase 5b: the 100%-stacked row model — `rows` (period × series, from
 * buildRows) for the VERIFIED periods only, each series' value replaced by
 * its share of that period's own verified total, as a percentage. Pure
 * arithmetic over already-verified reals (spec §11), run only after the
 * on-demand whole check passed for that period — a caller must never hand
 * this an unverified period. The denominator is the sum of the period's own
 * parts (the very sum the check just confirmed matches CBS's published
 * total within tolerance), so the shares add up to exactly one full bar.
 * Per series `k` the row gains `k_share` (the number Recharts stacks),
 * `k_share_label` (the percentage text drawn in the segment) and
 * `k_share_display` (the tooltip line: the real formattedValue with the
 * share in brackets — ChartTooltip reads `<dataKey>_display`), plus
 * `k_share_provisional`/`k_share_resultId` copied so the same tooltip binds
 * each line to its cell. A period whose parts are not all non-negative
 * reals with a positive total has no honest share and is DROPPED (returned
 * in `omitted`) — a stack of signed values is not a whole of parts. */
export function buildStack100Rows(
  rows: Row[],
  seriesKeys: string[],
  verifiedPeriodCodes: ReadonlySet<string>,
): { rows: Row[]; omitted: string[] } {
  const out: Row[] = [];
  const omitted: string[] = [];
  for (const row of rows) {
    const periodCode = String(row.periodCode);
    if (!verifiedPeriodCodes.has(periodCode)) continue;
    const values = seriesKeys.map((k) => row[k]);
    const total = values.reduce<number>((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
    if (values.some((v) => typeof v !== 'number' || v < 0) || total <= 0) {
      omitted.push(periodCode);
      continue;
    }
    const next: Row = { ...row };
    for (const k of seriesKeys) {
      const share = ((row[k] as number) / total) * 100;
      const shareLabel = `${formatValueNl(share, 1)}%`;
      next[`${k}_share`] = share;
      next[`${k}_share_label`] = shareLabel;
      next[`${k}_share_display`] = `${String(row[`${k}_display`] ?? '')} (${shareLabel})`;
      next[`${k}_share_provisional`] = row[`${k}_provisional`] ?? false;
      next[`${k}_share_resultId`] = row[`${k}_resultId`] ?? null;
    }
    out.push(next);
  }
  return { rows: out, omitted };
}

// WP218 phase 4 (#219): the keyboard hint and the disabled-Lijn reason
// (below, `LINE_DISABLED_REASON`) moved from module-level Dutch literals to
// `t(chartLang, …)` calls inside ChartView — 'chart.keyboardHint' and
// 'chart.lineDisabledReason' in the catalogue (messages.ts), Dutch entries
// byte-identical to these former literals. The disabled Lijn tab's reason is
// shared verbatim between its `title` (pointer/tooltip) and a visually-
// hidden span reached via `aria-describedby` — a `title` alone is invisible
// to a screen reader, and a keyboard/AT user hits exactly the same disabled
// control a mouse user does, so the same explanation must be reachable both
// ways.

/** Approximate text width at the 12px value-label font plus its halo stroke
 * (ADR 042, VALUE_LABEL_PROPS below) — layout only, so the plot leaves room
 * for the end-of-line label instead of clipping it. Deliberately generous:
 * this only reserves margin, it never affects what's actually drawn.
 * Exported (session 110 UX audit pass 4, row 4) so ChartSmallMultiples sizes
 * its own-axis tick labels from the SAME estimate instead of a second,
 * invented constant — the fixed 28px it used before clipped `651.157` down
 * to `1.157` on screen (R1/R6: a clipped digit is a wrong number). */
export function labelWidthPx(text: string): number {
  return Math.ceil(text.length * 7.5) + 16;
}

/** Session 110 UX audit pass 4, row 6: `src/chart/build.ts`'s `nullNote`
 * prints the raw CBS `ValueAttribute` verbatim inside otherwise-Dutch prose
 * ("Geen waarde voor 2020 (Eemsdelta): Impossible (CBS)."). R8 blast-radius
 * check (reconstruct.ts:507-509, `buildChartSpec`'s own `nullNote` comment
 * "this stored, R8-re-derived string"): `reconstruct.ts` re-derives the
 * chart spec from the stored result via `buildChartSpec` and compares it
 * BYTE-IDENTICALLY to the stored spec. `nullNotes` is part of `ChartSpec`
 * (build.ts:192-194), so changing `nullNote`'s wording in build.ts would
 * make every ALREADY-STORED row carrying this attribute fail that
 * comparison the next time it is re-verified — a backend wording change
 * cannot be made here. This function instead re-words the note at RENDER
 * TIME only: the stored/re-derived spec (and every stored audit row) is
 * untouched, so R8 keeps holding for old and new rows alike.
 *
 * Only the exact shape `nullNote` actually emits is touched — anything else
 * (every existing chart.test.tsx fixture note, which predates the real
 * production shape) passes through unchanged, same fail-closed discipline
 * as cbs-words.ts's converters. The digits (the period) are never touched —
 * they come back out of the ORIGINAL note string, still a spec string. */
export function humanizeNullNote(note: string, tableId: string): string {
  const source = resolveSourceForTable(tableId);
  const suffix = ` (${source.displayName}).`;
  if (!note.endsWith(suffix)) return note;
  const withoutSuffix = note.slice(0, -suffix.length);
  const sepIndex = withoutSuffix.lastIndexOf(': ');
  if (sepIndex === -1) return note;
  const where = withoutSuffix.slice(0, sepIndex);
  const attribute = withoutSuffix.slice(sepIndex + 2);
  if (attribute === 'None' || attribute === '') return note;
  // Same registry-approved fallback the answer body already uses
  // (nullReasonText, src/answer/compose/template.ts) for an attribute
  // outside the map: naming the marker in a full Dutch sentence rather than
  // printing it bare.
  const reason = source.nullReasonLabels[attribute] ?? `door ${source.displayName} gemarkeerd als '${attribute}'`;
  return `${where}: ${reason}.`;
}

/** Task 3 (Story-stage plan, ADR 044): drives a second, chrome-less
 * `ChartView` instance from a given story step, for the full-screen stage
 * overlay Task 4 renders. `step` is the active step (null = overview,
 * nothing highlighted); `overrides` are the chat chart's current per-chart
 * presentation overrides (template included), so the stage wears the same
 * look. */
export interface ChartStageMode {
  /** The active step: drives the highlight (`step.highlight`) and the dashed ring (`step.point`); null = overview (nothing highlighted). */
  step: StoryStep | null;
  /** The chat chart's current per-chart overrides, so the stage wears the same look (template included). */
  overrides: PresentationOverrides;
}

