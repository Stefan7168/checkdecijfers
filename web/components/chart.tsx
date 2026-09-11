// The Recharts wrapper ADR 014 deferred to this session — renders the exact
// same server-built ChartSpec the SVG renderer (src/chart/render.ts) draws,
// over the client charting library ADR 008 named (ADR 018 decision 6).
//
// Honesty contract, mirrored from the SVG renderer: every numeric STRING a
// viewer can read must be a point's own `formattedValue`, never Recharts'
// own formatting of the raw `value` — enforced below via a custom tooltip
// that reads a sibling `_display` field, custom axis ticks that show only a
// point's own display string (Recharts' own tick numbers stay switched off:
// "no invented axis ticks", the SVG renderer's rule), and custom point/bar
// labels that do the same. `value` itself is used only for geometry (bar
// height / line position / WHICH points get a label), never rendered as
// text. Every displayed value is additionally BOUND to its source cell via
// `data-label-for="<resultId>"` — membership alone ("the string appears
// somewhere in the spec") provably misses swapped labels (WP8 review lesson;
// recurred here, WP12 review).
//
// #197 step 1 (session 69, open-questions #197): the numbers came back onto
// the chart (axis min/max, end-of-line and per-bar labels), the series
// palette became colour-blind-safe with dash patterns as the non-colour
// channel, the chart got an accessible name + announced tooltip, tap-to-pin
// on touch devices, and a schemaVersion guard mirroring render.ts. All of it
// is presentation over the same spec — nothing here changes what the builder
// emits, so stored specs (R8) and `reconstruct.ts` are untouched.
'use client';

import { useEffect, useId, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartPoint, ChartSpec } from '../backend/chart/types.ts';
import {
  chartHeightForWidth,
  DEFAULT_PALETTE,
  dotGeometry,
  findFont,
  fontStack,
  LINE_WIDTH_PX,
  markerVisible,
  resolvePresentation,
  seriesColor,
  withAccountDefault,
  xAxisHeight,
  xLabelOverhang,
} from '../lib/chart-presentation.ts';
import type { ChartPresentation, MarkerMode, SeriesEndpoints } from '../lib/chart-presentation.ts';
import { useElementWidth } from '../lib/use-element-width.ts';
import { useChartStyle } from '../lib/chart-style-context.tsx';
import { trackChartStyleEvent } from '../lib/chart-usage-client.ts';
import { templateById } from '../lib/chart-templates.ts';
import {
  translateAttributionLine,
  translateMeasureTitle,
  translatePeriodLabel,
  translateRegion,
  translateUnit,
} from '../lib/i18n/cbs-words.ts';
import { useLang } from '../lib/i18n/lang-provider.tsx';
import { useStylePanelOwner } from '../lib/style-panel-owner.tsx';
import { t, type Lang } from '../lib/i18n/messages.ts';
// WP218 phase 2 (owner C): the account-default Server Actions live in their
// OWN tiny-import-graph file, never web/app/actions.ts — see that file's own
// header for why (the usage-actions.ts precedent this mirrors).
import { forgetMyChartStyle, lookupBrand, saveMyChartStyle } from '../app/chart-style-actions.ts';
import { generateInsights } from '../app/chart-insights-actions.ts';
import { ensureFontLoaded } from '../lib/font-loader.ts';
import { ChartConfigPanel, ChartConfigTrigger } from './chart-config-panel.tsx';
import { ChartFrame } from './chart-frame.tsx';
import { ChartDownloadMenu } from './chart-download.tsx';
import { buildFindings } from '../lib/chart-insights.ts';
import type { StoryStep } from '../lib/chart-story.ts';
import { ChartStoryPanel, ChartStoryTrigger } from './chart-story.tsx';
import { ChartNotes, type ChartNote, type PendingPoint } from './chart-notes.tsx';
import { ChartSmallMultiples } from './chart-small-multiples.tsx';
import { SourceBadge } from './source-badge.tsx';
import {
  areaFormAllowed,
  chartViewReducer,
  fallbackForm,
  hbarFormAllowed,
  initialViewState,
  lineFormAllowed,
  windowSpec,
  type ChartForm,
  type ChartViewState,
} from '../lib/chart-view-state.ts';

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
export { RECHARTS_PALETTE, DEFAULT_PALETTE } from '../lib/chart-presentation.ts';

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
  /** Line charts: "periodLabel: value" at each series' last plotted point. */
  endLabels: PointLabel[];
  /** Bar charts: one label per bar, or none above BAR_LABEL_MAX bars. */
  barLabels: PointLabel[];
}

/** Above this many bars the labels would smear into each other; the idea
 * bank's >15-categories rule says a table is the honest view there. */
export const BAR_LABEL_MAX = 15;

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

  const endLabels: PointLabel[] = spec.series.flatMap((series, i) => {
    // Spec order is period-ascending (R6: the spec's order IS the render
    // order), so the last plotted point is the last non-null one.
    const last = [...series.points].reverse().find((p) => p.value !== null && p.formattedValue !== null);
    if (!last) return [];
    return [
      {
        seriesKey: `s${i}`,
        periodCode: last.periodCode,
        resultId: last.resultId,
        text: `${last.periodLabel}: ${pointLabelText(last)}`,
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
      className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
    >
      <div className="font-medium">{label}</div>
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
            <span>
              {labelByKey.get(entry.dataKey)}: {String(display)}
              {provisional ? ' *' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
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
interface RegionChartRow {
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

/** #197 idea 6: a real interactive legend, replacing Recharts' decorative
 * default. One button per series toggles it in/out of the chart; hidden
 * series stay listed (dimmed) so they can be brought back. Client-side
 * presentation only — never touches the spec or the audit record
 * (open-questions #46(b)).
 *
 * Task 5 (#212 series highlight): a second, independent button per series —
 * "Markeer X" — dims every OTHER series (strokeOpacity/fillOpacity on the
 * Line/Bar elements below) without hiding them. Independent of the hide
 * toggle: a highlighted series can still be hidden. Hiding the currently
 * highlighted series clears the highlight too (chartViewReducer's
 * 'toggleSeries' case) — otherwise every OTHER visible series would stay
 * dimmed with nothing actually highlighted on screen, a confusing dead state
 * a review caught after this landed. The highlight button is disabled while
 * its own series is hidden, since "highlight a series that isn't drawn" has
 * nothing to dim relative to. */
function SeriesLegend({
  seriesMeta,
  hiddenKeys,
  highlightedKey,
  onToggle,
  onHighlight,
  lang,
  disabled = false,
  disabledReasonId,
}: {
  seriesMeta: SeriesMeta[];
  hiddenKeys: Set<string>;
  highlightedKey: string | null;
  onToggle: (key: string) => void;
  onHighlight: (key: string | null) => void;
  lang: Lang;
  // Story mode (session 92 review fix): while the story is open, the chart
  // must keep showing exactly what the active step's caption describes —
  // hiding or highlighting a series out from under a live caption would
  // contradict it. `disabled` locks both buttons per series; `disabledReasonId`
  // points at the one shared `${domId}-story-lock` span rendered near the
  // panel, so every locked control shares the same reason via
  // aria-describedby instead of duplicating the string per button.
  disabled?: boolean;
  disabledReasonId?: string;
}) {
  const lockedTitle = disabled ? t(lang, 'chart.story.controlsLocked') : undefined;
  return (
    <div role="group" aria-label={t(lang, 'chart.seriesGroupLabel')} className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {seriesMeta.map((s) => {
        const hidden = hiddenKeys.has(s.key);
        const highlighted = highlightedKey === s.key;
        return (
          <span key={s.key} className="inline-flex items-center gap-1">
            <button
              type="button"
              /* Pressed = shown (the toggle's "on" state), not "is hidden" --
               * the accessible name is just the series label ("Nederland"), so
               * aria-pressed={hidden} would announce "pressed" exactly when
               * the series is OFF. Matches the fix already applied once
               * elsewhere in this codebase for the same mistake (see
               * chart-toggle.tsx). */
              aria-pressed={!hidden}
              disabled={disabled}
              onClick={() => onToggle(s.key)}
              title={lockedTitle}
              aria-describedby={disabled ? disabledReasonId : undefined}
              // ADR 042: the series (hide/show) button is a chip — rounded-
              // full, bordered — so the legend reads as a set of toggleable
              // tags rather than plain text links. The highlight button
              // right below keeps its quiet text style; only this one
              // becomes a chip.
              className={
                'inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
                (hidden ? 'border-border text-muted-foreground line-through' : 'border-border bg-background text-foreground hover:bg-muted')
              }
            >
              <span
                aria-hidden="true"
                style={{ backgroundColor: hidden ? 'var(--muted-foreground)' : s.color }}
                className="inline-block h-2.5 w-2.5 rounded-full"
              />
              {s.label}
            </button>
            <button
              type="button"
              aria-pressed={highlighted}
              disabled={hidden || disabled}
              onClick={() => onHighlight(highlighted ? null : s.key)}
              /* A locked legend takes priority over the plain highlight-title
               * (kept only while NOT locked, per the review fix's own note
               * that a control already carrying a `title` keeps the lock
               * reason in aria-describedby and sets `title` only while
               * locked). */
              title={disabled ? lockedTitle : t(lang, 'chart.highlightTitle', { label: s.label })}
              aria-describedby={disabled ? disabledReasonId : undefined}
              className={
                'min-h-6 rounded-md px-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 ' +
                (highlighted ? 'text-foreground font-semibold' : 'text-muted-foreground')
              }
            >
              {t(lang, 'chart.highlightButton', { label: s.label })}
            </button>
          </span>
        );
      })}
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
function SeriesDot(
  seriesKey: string,
  endLabel: PointLabel | undefined,
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
    const isEnd = endLabel !== undefined && payload.periodCode === endLabel.periodCode;
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
                  activate();
                }
              : undefined
          }
        />
        {isEnd ? (
          <text
            x={cx + 8}
            y={cy + 4}
            {...VALUE_LABEL_PROPS}
            fill="var(--foreground)"
            textAnchor="start"
            data-role="end-label"
            data-label-for={endLabel.resultId}
          >
            {endLabel.text}
          </text>
        ) : null}
      </g>
    );
  };
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
function SeriesBar(
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
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
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
                  activate();
                }
              : undefined
          }
        />
        {label ? (
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
        ) : null}
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
function RegionBar(
  periodLabel: string,
  showLabels: boolean,
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
    const { label, value_display, value_provisional, value_resultId, color, dimmed, patternId } = payload;
    const activate = (): void => {
      if (value_resultId == null || !onPointClick) return;
      onPointClick({ resultId: value_resultId, periodLabel, seriesLabel: label });
    };
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={value_provisional ? `url(#${patternId})` : color}
          fillOpacity={dimmed ? 0.25 : 1}
          stroke={value_provisional ? color : undefined}
          strokeOpacity={value_provisional ? (dimmed ? 0.25 : 1) : undefined}
          strokeWidth={value_provisional ? 1 : undefined}
          data-point="value"
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
                  activate();
                }
              : undefined
          }
        />
        {showLabels && value_display != null ? (
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
function RegionAxisTick(props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
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
function useCoarsePointer(): boolean {
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
 * this only reserves margin, it never affects what's actually drawn. */
function labelWidthPx(text: string): number {
  return Math.ceil(text.length * 7.5) + 16;
}

export function ChartView({
  spec,
  frameless = false,
}: {
  spec: ChartSpec;
  /** Session 87 (purely presentational): drop the component's own card frame
   * when the mount point already IS a card (the visual dock) — a card inside a
   * card is the one thing the shadcn direction says not to do. Inline in the
   * conversation and on Ontdek the frame stays. */
  frameless?: boolean;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const frameClass = frameless ? '' : 'mt-3 rounded-xl border border-border bg-card p-4 text-card-foreground';
  const rawId = useId();
  const domId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const coarsePointer = useCoarsePointer();
  // #197 step 2: chart or table. A comparison with more bars than the chart
  // can label opens on the table — the idea bank's >15-categories rule, the
  // honest view for many series.
  const initialForm = spec.series.length > BAR_LABEL_MAX ? 'table' : spec.kind;
  const [state, dispatch] = useReducer(chartViewReducer, initialForm, initialViewState);
  const lineTabRef = useRef<HTMLButtonElement>(null);
  const areaTabRef = useRef<HTMLButtonElement>(null);
  const barTabRef = useRef<HTMLButtonElement>(null);
  const hbarTabRef = useRef<HTMLButtonElement>(null);
  const tableTabRef = useRef<HTMLButtonElement>(null);

  const [smallMultiples, setSmallMultiples] = useState(false);
  const [axisMode, setAxisMode] = useState<'shared' | 'own'>('shared');

  // Task 6 (#212 click-to-annotate): session-only, plain component state —
  // never persisted, never sent anywhere, never touches ChartSpec or the
  // audit record. Reset by the same specIdentity guard below (a new chart's
  // clicks must not carry over another chart's notes).
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const [pendingPoint, setPendingPoint] = useState<PendingPoint | null>(null);
  // Final review finding: a new note's id used to be
  // `${resultId}-${prev.length}`, but `prev.length` is not monotonic — it
  // shrinks on delete — so two notes on the same point could end up with the
  // identical id after a delete-then-recreate sequence. `onDelete` filters by
  // id, so a duplicate id meant clicking delete on ONE note silently deleted
  // BOTH. A ref-backed counter only ever increases, regardless of deletion
  // order, and (unlike component state) incrementing it never itself
  // triggers a re-render.
  const noteIdCounter = useRef(0);

  // Stable per-chart identity, not object identity: a fresh spec object can
  // represent the exact same chart across a re-render. Resets ALL
  // presentation state below when the viewer is shown a genuinely DIFFERENT
  // chart without ChartView remounting — both the visual dock
  // (visual-dock.tsx) and the Ontdek reading toggle (chart-toggle.tsx) swap
  // `spec` on the same mounted instance (no `key` at either call site), so a
  // useState/useReducer initializer only runs once and would otherwise leak
  // state across charts. A single reducer `reset` action now clears form,
  // hiddenKeys, highlightedKey and periodRange atomically — replacing the
  // three separate setState calls this used to be, which is what let a
  // stale hiddenKeys entry collide with a different chart's own series key
  // and silently drop a real line with no visible disclosure
  // (open-questions #46(a); found reachable via ordinary dock-tab switching
  // in the 2026-09-05 final review of this file). React's own documented
  // pattern for this ("adjusting state when a prop changes", no Effect):
  // compare against the last-seen identity and, if it changed, call the
  // setters directly during render.
  const specIdentity = JSON.stringify(spec);
  const [lastSpecIdentity, setLastSpecIdentity] = useState(specIdentity);
  // WP218 (ADR 039, task-6 re-review): the Opmaak panel keeps small local
  // state per series row (an uncommitted hex draft, a refusal alert). Series
  // keys are positional (`s0`, `s1` — buildRows), so after a spec swap on this
  // same mounted instance a leftover row state would land on a DIFFERENT
  // chart's series. The panel is remounted per chart via this epoch — the
  // same "each chart starts fresh" the reducer's `reset` gives the overrides.
  const [chartEpoch, setChartEpoch] = useState(0);
  // Review fix (chart-panel-layout, option A): the previous version of this
  // refactor tried to keep the "Opmaak" trigger inside the Weergave tablist
  // row by portaling it into a placeholder DOM node set via a callback ref —
  // verified in a real browser, the portaled node never actually moved into
  // that row and the trigger did nothing when clicked (`aria-expanded` never
  // changed), so the panel could not be opened at all in production. Fixed
  // by lifting just the open/closed boolean here instead: `ChartConfigPanel`
  // is now a fully controlled component and `ChartConfigTrigger` (also
  // exported by chart-config-panel.tsx) renders directly in the tablist row
  // below — no portal, no placeholder node. Declared here, well above the
  // `schemaVersion` guard below, so this `useState` call itself is never
  // conditionally skipped — the same reason `chartLang`'s `useLang()` sits
  // above that guard too. Reset to `false` in the spec-swap block right
  // below (owner decision E: each chart starts fresh) — unlike the old
  // portal version, this state now lives in THIS component, not in the
  // remounted-per-epoch ChartConfigPanel, so it would otherwise survive a
  // spec swap on its own.
  // Story mode (session 92): Style and Story share the slot under the chart —
  // one open at a time, so a single discriminated value replaces the old
  // boolean (`styleOpen` is derived, every existing read of it is unchanged).
  const [openPanel, setOpenPanel] = useState<'style' | 'story' | null>(null);
  const styleOpen = openPanel === 'style';
  // Final-review fix: a derived setter must route a `false` through the
  // story exactly like `toggleStylePanel` already does — restoring the
  // reader's own snapshot (`closeStory`) rather than just switching
  // `openPanel` straight to `null` and leaving the snapshot stranded.
  // `closeStory` is a function declaration further down this component, so
  // JS hoists it before this component body runs — calling it here, ahead
  // of its own textual definition, is safe.
  const setStyleOpen = (open: boolean): void => {
    if (!open && openPanel === 'story') {
      closeStory();
      return;
    }
    setOpenPanel(open ? 'style' : null);
  };
  // Task 6 (chart frame plan): one Style panel open per page. This chart
  // claims the shared owner slot for as long as ITS panel is open, and
  // releases it the moment that stops being true (panel closed, or this
  // chart unmounts) — `claim`/`release` are the no-provider default's
  // no-ops outside `StylePanelOwnerProvider`, so a chart rendered alone
  // (most tests) behaves exactly as before this task.
  const { owner: stylePanelOwner, claim: claimStylePanel, release: releaseStylePanel } = useStylePanelOwner();
  useEffect(() => {
    if (!styleOpen) return;
    claimStylePanel(domId);
    return () => releaseStylePanel(domId);
  }, [styleOpen, domId, claimStylePanel, releaseStylePanel]);
  // Opening another chart's panel (which claims the slot with ITS domId)
  // closes this one's. Deliberately keyed on [stylePanelOwner, domId] only
  // (not styleOpen): on the very commit where THIS chart's own click above
  // flips styleOpen to true, `stylePanelOwner` in context is still the
  // PREVIOUS owner (this chart's own `claimStylePanel` call above hasn't
  // propagated through the provider yet) — since that value is unchanged
  // from the prior commit, this effect's dependencies haven't changed
  // either and it correctly does not re-run, so this chart never closes the
  // panel it just opened. It only fires once `stylePanelOwner` itself
  // actually changes (a real claim by ANY chart, this one included, lands
  // one commit later). The functional update reads the current `openPanel`
  // rather than closing over a possibly-stale `styleOpen`, and leaves an
  // open Story panel (`openPanel === 'story'`) alone — only 'style' is ever
  // shared across charts.
  useEffect(() => {
    if (stylePanelOwner === null || stylePanelOwner === domId) return;
    setOpenPanel((current) => (current === 'style' ? null : current));
  }, [stylePanelOwner, domId]);
  const [storyIndex, setStoryIndex] = useState(0);
  // The reader's own hidden/highlight/zoom state, taken when the story opens
  // and put back when it closes (the story drives highlight itself and needs
  // the full, unhidden, unzoomed chart so every step's point is on screen).
  const storySnapshot = useRef<Pick<ChartViewState, 'hiddenKeys' | 'highlightedKey' | 'periodRange'> | null>(null);
  // WP218 phase 3 (owner B): the last brand a signed-in visitor actually
  // applied via "Pas merkkleuren toe" — deliberately NOT reset by the spec-
  // swap block below (unlike notes/pendingPoint), because it describes
  // something that outlives a single CHART (a spec swap), not a single
  // ACCOUNT. Final-review fix: this is `useState` inside `ChartView`, so
  // it's scoped to THIS MOUNTED INSTANCE only — a brand applied on the
  // inline chat chart is invisible to the dock's own separately-mounted
  // ChartView. Handed to `saveMyChartStyle` as `brandApplied` on the next
  // "Bewaar als mijn standaard" on THIS instance, whichever chart (via a
  // spec swap) that happens to be showing by then.
  const [lastAppliedBrand, setLastAppliedBrand] = useState<{
    domain: string;
    name: string;
    fetchedAt: string;
  } | null>(null);
  // Task 3 (design §C2): the frame's own image background (a data URL, once
  // the Frame tab supports choosing one) — chart-only state, not part of
  // `pres`/`resolvePresentation`'s account-default machinery, so it is reset
  // here alongside every other per-chart-instance piece of state.
  const [frameImage, setFrameImage] = useState<string | null>(null);
  if (specIdentity !== lastSpecIdentity) {
    setLastSpecIdentity(specIdentity);
    setChartEpoch((n) => n + 1);
    dispatch({ type: 'reset', initialForm: state.form });
    setSmallMultiples(false);
    setAxisMode('shared');
    setNotes([]);
    setPendingPoint(null);
    setOpenPanel(null);
    setStoryIndex(0);
    storySnapshot.current = null;
    setFrameImage(null);
  }

  // Task 3: a real three-way Lijn/Staaf/Tabel switch. Computed here, ABOVE
  // the schemaVersion guard below, purely so the font-loading Hook right
  // after (WP218) stays unconditional — neither `canUseLine`, `activeForm`
  // nor `effectiveKind` reads anything the guard gates (only `spec` and
  // `state`), so moving them earlier changes nothing about what they
  // compute; `seriesMeta.length` (used before this move) always equals
  // `spec.series.length` (filtering periods never removes a whole series —
  // see the buildRows call further below).
  //
  // Guarded, not just `state.form` verbatim: the visual dock and Ontdek's
  // reading toggle swap `spec` on the SAME mounted ChartView (no `key`), and
  // the reducer's `reset` action deliberately PRESERVES the previously
  // chosen form across that swap (so a user-picked Tabel view survives —
  // see the reset test below). Without this guard, a 'line' form chosen on
  // an earlier allowed spec would carry straight into a freshly-swapped
  // multi-region spec where canUseLine is now false, rendering the exact
  // connected-line-across-regions the honesty rule exists to forbid.
  //
  // `activeForm` is the single derived source for what is actually ON
  // SCREEN — every read below (effectiveKind, the tablist's
  // aria-selected/tabIndex/segment styling, and onFormTabKeyDown's
  // FORM_ORDER lookup) shares this one value rather than each re-deriving
  // the same ternary. It is a display-only projection: `state.form` itself
  // is untouched, so the reset-preserves-form behaviour above still works
  // (the stored 'line' choice survives a spec swap even while it renders as
  // 'bar'). Final review finding: with three separate re-derivations of
  // this ternary, the tablist's copy used to be missing, so a stale 'line'
  // form meeting a newly-disallowed multi-region spec made the (disabled)
  // Lijn tab both aria-selected and tabIndex=0 while neither Staaf nor
  // Tabel got tabIndex=0 — no tab was keyboard-reachable at all.
  //
  // Owner decision B (session 88): a multi-region comparison (bar, >1 series
  // — one point per region, no time axis) may never be shown as a connected
  // line — that would imply a trend across regions that was never measured.
  // `effectiveKind` is what actually drives the Recharts dispatch and both
  // Y-axis domains below, so the honesty rule and the rendered chart can
  // never drift apart (WP12 review lesson: a policy the render doesn't
  // actually use is not a guard). Reads the ORIGINAL spec.kind (the honesty
  // rule is about the chart's true shape, not the current zoom window).
  const canUseLine = lineFormAllowed(spec, spec.series.length);
  // WP218 phase 5 (Task 2): area/hbar get the identical guard-then-fallback
  // treatment Lijn already had — `canUseArea`/`canUseHbar` gate the tab
  // buttons below (disabled + reason), `fallbackForm` is the ONE function
  // (chart-view-state.ts, shared with its own tests) both this render and a
  // same-instance spec swap use, so "area falls back to line else bar; hbar
  // falls back to bar; line falls back to bar" can never drift between the
  // guard and the fallback the way three independent ternaries could. Third
  // argument is `spec.series.length`, not `seriesMeta.length`: `seriesMeta`
  // is built by `buildRows` further below, which itself depends on `pres`
  // (via `colorFor`), which depends on `activeForm` computed here — the two
  // counts are always equal regardless (filtering periods never removes a
  // whole series), per the note this replaces.
  const canUseArea = areaFormAllowed(spec, spec.series.length);
  const canUseHbar = hbarFormAllowed(spec);
  const activeForm: ChartForm = fallbackForm(state.form, spec, spec.series.length);
  // WP218 phase 5: area renders through the SAME LineChart-shaped data model
  // as line (one row per period, `rows`/`plan`/`markers` all reused
  // verbatim — see the Area branch below), and hbar through the same
  // bar-shaped `valueLabelPlan`/`annotationMarkers` inputs as bar (hbar's OWN
  // region-row model, `buildRegionRows`, is independent and computed
  // separately). `effectiveKind` is what actually drives the Recharts
  // dispatch, Y-axis domain and label-plan kind below, so the honesty rule
  // and the rendered chart can never drift apart (WP12 review lesson).
  const effectiveKind: ChartSpec['kind'] = activeForm === 'table' ? spec.kind : activeForm === 'line' || activeForm === 'area' ? 'line' : 'bar';
  // Final-review fix (defensive snapshot guard, session 92 follow-up):
  // hoisted from just above the small-multiples toggle below — moved here,
  // ABOVE the schemaVersion guard, so `storyAvailable` (right below) can
  // feed the stranded-snapshot Effect that must itself sit above the guard
  // (same Rules-of-Hooks reasoning as `activeForm`/the font Effect above).
  // `spec.series.length`, not `seriesMeta.length`: identical count, per the
  // note on `canUseArea` above — `seriesMeta` isn't built until `buildRows`
  // runs, further below this guard.
  const smallMultiplesAvailable = activeForm === 'line' && spec.series.length > 1;

  // WP218 (ADR 039) Phase 0: the presentation resolver, run once per render
  // with the ACTUAL rendered form (`activeForm`, not raw `state.form` — the
  // bar-lock rules on valueLabels/zeroBaseline must apply exactly when Staaf
  // is what's on screen, not whatever `state.form` said before the
  // canUseLine guard above). `pres` feeds the colour resolver passed into
  // `buildRows` further below (so every legend swatch, tooltip swatch and
  // hatch pattern follows the SAME effective colour automatically) plus
  // every Recharts prop this task wires. `hasProvisional` reads the RAW
  // spec (not the zoomed viewSpec) — a provisional point outside the
  // current zoom window still governs the honesty-locked defaults, the same
  // pattern spec.attribution uses elsewhere in this file.
  const hasProvisional = spec.series.some((s) => s.points.some((p) => p.provisional));
  // WP218 phase 2 (owner C): the signed-in account's saved style is the
  // `base` every chart resolves ON TOP OF — `withAccountDefault` degrades
  // anything invalid/absent to the stock look, so a logged-out visitor
  // (useChartStyle()'s no-provider default) or an account with no saved
  // default both resolve exactly as before this task. Per-chart overrides
  // (`state.presentation`) still win over the account default (owner E is
  // untouched: a spec swap clears `state.presentation`, not `accountStyle`,
  // so "Standaard" and a fresh chart both fall back to THIS base, not stock).
  const { accountStyle, signedIn, setAccountStyle } = useChartStyle();
  const base = withAccountDefault(accountStyle);
  const resolved = resolvePresentation(
    { kind: spec.kind, form: activeForm, seriesCount: spec.series.length, hasProvisional },
    state.presentation,
    base,
  );
  const pres = resolved.values;
  // ADR 042: the chart's height follows the card's measured width (a pure
  // rule, chartHeightForWidth) whenever nothing else sizes the box — no
  // frame aspect ratio (ChartFrame sets the height then), no small
  // multiples (its own grid grows), not the table. 0 until measured →
  // the h-64 floor, so SSR/jsdom render exactly as before.
  const autoHeight = pres.frameAspect === 'auto' && !(smallMultiples && smallMultiplesAvailable) && state.form !== 'table';
  const measuredWidth = useElementWidth(chartContainerRef, autoHeight);
  const autoHeightPx = autoHeight && measuredWidth > 0 ? chartHeightForWidth(measuredWidth) : null;
  // This is the one Hook `pres` feeds, so it must run unconditionally on
  // every render — ABOVE the schemaVersion guard below, which a live spec
  // swap on this same mounted instance (see the specIdentity block above)
  // could otherwise flip between renders and skip this call on some of them.
  useEffect(() => {
    const family = pres.fontFamily;
    const font = findFont(family);
    if (font && font.source === 'google') {
      ensureFontLoaded(font);
    } else if (font === undefined && family !== null) {
      // Final-review fix: `findFont` only matches the seven curated
      // FONT_OPTIONS, but a brand font (phase 3's `pickBrandFont`) can put
      // ANY family name straight into `fontFamily` without ever being
      // curated — previously that family was applied as CSS (`fontStack`
      // below) with no `<link>` ever created, so the chart silently
      // rendered in the fallback system font while the panel's status line
      // still said the brand font was applied. `fontFamily` doesn't carry
      // the brand's own origin (google/system) past `handleApplyBrand`, so
      // this speculatively requests it from Google Fonts — a family the
      // reader's OS already has installed (a true system font) simply
      // 404s here, which is harmless: `ensureFontLoaded` only ever adds a
      // `<link>`, and the browser renders the already-installed family
      // regardless of whether that link resolves.
      ensureFontLoaded({ family, source: 'google', stack: fontStack(family)! });
    }
  }, [pres.fontFamily]);
  // WP218 phase 4 (#219, design §4): the chart's own language. `useLang()`
  // is called UNCONDITIONALLY (its own statement, same reason as the Hook
  // above it) — writing `pres.language ?? useLang()` directly would only
  // call the hook when `pres.language` is null, a conditional Hook call that
  // breaks React's Rules of Hooks the moment a reader toggles the per-chart
  // select on/off. `pres.language` (null = follow the app) wins when set.
  const appLang = useLang();
  const chartLang: Lang = pres.language ?? appLang;
  // Insights (session 94, superseding Story mode's selection): built from
  // the FULL spec (never the zoomed viewSpec) in the chart's language, so
  // every finding's point exists on the chart the panel shows. This Hook
  // must run unconditionally on every render — ABOVE the schemaVersion guard
  // below, same reason as the font Effect and `chartLang` itself above it.
  const findings = useMemo(
    () => buildFindings(translateSpecForDisplay(spec, chartLang), chartLang),
    [spec, chartLang],
  );
  // The AI-phrased upgrade, keyed by finding id — null until openStory's
  // generateInsights call resolves (or is never attempted, or fails). Reset
  // whenever `findings` itself changes (a new spec/language means the old
  // phrasing no longer applies to anything on screen). A finding id absent
  // from this map simply keeps its own deterministic caption below — never
  // an error state, never a loading placeholder that could read as "no
  // number" (R3): the panel is always complete from the first open.
  const [phrasedCaptions, setPhrasedCaptions] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    setPhrasedCaptions(null);
  }, [findings]);
  const storySteps: StoryStep[] = useMemo(
    () =>
      findings.map((f) => ({
        id: f.id,
        kind: f.kind,
        title: f.title,
        caption: phrasedCaptions?.get(f.id) ?? f.caption,
        highlight: f.seriesKey,
        point: f.point,
      })),
    [findings, phrasedCaptions],
  );
  // Story mode (session 92): hoisted from next to `storyTriggerId`/
  // `storyControlsId` below — needed here, above the guard, so the
  // stranded-snapshot Effect right after it can itself run unconditionally
  // (every input — `state.form`, `smallMultiples`, `smallMultiplesAvailable`,
  // `storySteps.length` — is already available above this line).
  // Threshold lowered from the old >= 3 (session 92: every step counted,
  // including the non-data "overview"/"explore" filler steps) to >= 1
  // (session 94: every Insights finding is real content — a 2-point chart
  // with one genuine finding still deserves to show it).
  const storyAvailable =
    state.form !== 'table' && !(smallMultiples && smallMultiplesAvailable) && storySteps.length >= 1;
  // Final-review fix (defensive snapshot guard): every reachable UI path
  // already closes the story before `storyAvailable` could go false while
  // still open (`selectForm`, `toggleStylePanel`, and the small-multiples
  // toggle is `disabled={storyOpen}`) — this Effect is a backstop for any
  // future path that forgets to, so a snapshot (the reader's hidden/
  // highlighted/zoom state, taken in `openStory`) is never left stranded
  // with no way back to it. `closeStory` is a function declaration (hoisted
  // by JS before this component body runs), so referencing it here, ahead
  // of its own textual definition, is safe.
  useEffect(() => {
    if (openPanel === 'story' && !storyAvailable) closeStory();
  }, [openPanel, storyAvailable]);

  if (spec.schemaVersion !== 1) {
    // Renderers dispatch on the schema version (ADR 007); this one only
    // speaks v1 and must say so rather than misrender a future spec — the
    // guard src/chart/render.ts has always had, and this wrapper lacked
    // until #197 (a v2 spec would have rendered silently, possibly wrong).
    const refusalAttributionLine =
      chartLang === 'en' ? translateAttributionLine(spec.attributionLine) : spec.attributionLine;
    const refusalTitle = chartLang === 'en' ? translateMeasureTitle(spec.title) : spec.title;
    return (
      <div className={frameClass}>
        <div role="heading" aria-level={3} className="text-sm font-semibold text-foreground">
          {refusalTitle}
        </div>
        <p className="mt-2 text-sm text-warning">{t(chartLang, 'chart.schemaRefusal')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-xs text-muted-foreground">{refusalAttributionLine}</p>
          <SourceBadge tableId={spec.attribution.tableId} syncedAt={spec.attribution.syncedAt} />
        </div>
      </div>
    );
  }

  // Task 4 (#212 period-range zoom): the full period-code list for the
  // Vanaf/Tot selectors, and `viewSpec` — the spec windowed to the currently
  // selected [from, to] range, or the untouched `spec` when no window is
  // active or zoom isn't offered at all. Only offered for a line-kind chart
  // with more than one period: a bar/comparison chart has one period per
  // region, so there is nothing to zoom into. `windowSpec` only ever filters
  // `series[].points` (R6 verbatim projection) — it never touches
  // `spec.kind`/`spec.attribution`/`spec.title`/`spec.unit`, which describe
  // the chart's identity, not its windowed content. Every DATA-derivation
  // call below (buildRows/annotationMarkers/valueLabelPlan/tableModel) reads
  // `viewSpec`; every IDENTITY read (spec.kind, spec.attribution, spec.title,
  // spec.unit) stays on the raw `spec`.
  const allPeriodCodes = Array.from(
    new Set(spec.series.flatMap((s) => s.points.map((p) => p.periodCode))),
  ).sort((a, b) => a.localeCompare(b));
  // WP218 phase 4: these feed the Vanaf/Tot <select> options and the zoom
  // disclosure sentence below — translated via the SAME word-list converter
  // ChartView uses everywhere else (never a second, independent translation
  // of period text).
  const periodLabelByCode = new Map(
    spec.series.flatMap((s) =>
      s.points.map((p): [string, string] => [
        p.periodCode,
        chartLang === 'en' ? translatePeriodLabel(p.periodLabel) : p.periodLabel,
      ]),
    ),
  );
  const zoomAvailable = spec.kind === 'line' && allPeriodCodes.length > 1;
  const viewSpec = zoomAvailable ? windowSpec(spec, state.periodRange) : spec;
  // WP218 phase 4 (design §4): title/unit/series-labels(regions)/period-
  // labels translated ONCE here — every derivation below (buildRows,
  // annotationMarkers, valueLabelPlan, tableModel, the accessible name) reads
  // `displaySpec` instead of `viewSpec`, so the honesty-bound value/
  // formattedValue/resultId fields are untouched (translateSpecForDisplay
  // never rewrites them) while every CBS-word label on screen matches
  // `chartLang`. A no-op (`displaySpec === viewSpec`) when chartLang is 'nl'.
  const displaySpec = translateSpecForDisplay(viewSpec, chartLang);
  // WP218 phase 4: the download menu receives this SAME displayed string
  // (never re-derived from spec.attributionLine independently), so the
  // exported PNG/SVG's baked-in attribution matches what the card shows.
  const displayAttributionLine =
    chartLang === 'en' ? translateAttributionLine(spec.attributionLine) : spec.attributionLine;

  // WP218 (ADR 039) Phase 0: `pres` (canUseLine/activeForm/effectiveKind
  // included) is computed above, ahead of the schemaVersion guard — see the
  // comment there. `colorFor` feeds buildRows so every legend swatch,
  // tooltip swatch and hatch pattern reads the SAME effective colour.
  const colorFor = (i: number) => seriesColor(pres, i);
  const { rows, seriesMeta } = buildRows(displaySpec, colorFor);
  const dimEntries = Object.entries(spec.dimLabels);
  // Final review finding: this used to read `viewSpec` (the ORIGINAL
  // spec.kind) directly, so a line-kind chart's curated annotations stayed
  // non-empty even after switching to Staaf — but the <ReferenceLine>
  // markers that actually draw them only render in the LineChart branch
  // below, never BarChart. The "Gemarkeerd in de grafiek" footer text would
  // then claim something is marked in the chart when nothing visually is.
  // Composing `effectiveKind` here, exactly as `valueLabelPlan` already does
  // below, keeps the claim and the render in sync.
  const markers = annotationMarkers({ ...displaySpec, kind: effectiveKind }, rows);
  const plan = valueLabelPlan({ ...displaySpec, kind: effectiveKind });
  const tickByValue = new Map(plan.axisTicks.map((t) => [t.value, t]));
  const endLabelByKey = new Map(plan.endLabels.map((l) => [l.seriesKey, l]));
  // ADR 042 ('ends' marker mode): the first and last PLOTTED point per series,
  // from the DISPLAYED spec (a zoomed window's own ends get the markers).
  const endpointsByKey = new Map<string, SeriesEndpoints>();
  displaySpec.series.forEach((series, i) => {
    const plotted = series.points.filter((p) => p.value !== null && p.formattedValue !== null);
    if (plotted.length > 0) endpointsByKey.set(`s${i}`, { first: plotted[0]!.periodCode, last: plotted[plotted.length - 1]!.periodCode });
  });
  const barLabelsByKey = new Map<string, Map<string, PointLabel>>();
  for (const label of plan.barLabels) {
    const byPeriod = barLabelsByKey.get(label.seriesKey) ?? new Map<string, PointLabel>();
    byPeriod.set(label.periodCode, label);
    barLabelsByKey.set(label.seriesKey, byPeriod);
  }
  const yAxisWidth =
    plan.axisTicks.length > 0
      ? Math.min(80, Math.max(24, labelWidthPx(plan.axisTicks.reduce((w, t) => (t.display.length > w.length ? t.display : w), ''))))
      : 16;
  const rightMargin =
    plan.endLabels.length > 0
      ? Math.min(140, plan.endLabels.reduce((w, l) => Math.max(w, labelWidthPx(l.text)), 0))
      : 8;
  // WP218: reserved x-axis height for tilted labels (xAxisHeight) needs the
  // longest label actually plotted — `rows`, never a re-derivation, so a
  // zoomed viewSpec's shorter label set reserves less height too.
  const longestPeriodLabel = rows.reduce(
    (longest, row) => (String(row.periodLabel).length > longest.length ? String(row.periodLabel) : longest),
    '',
  );
  // undefined (flat labels, the stock look) reserves no extra height —
  // spread only when defined so Recharts' own XAxis default height applies,
  // exactly as if the prop were never passed.
  const xAxisHeightPx = xAxisHeight(pres.xLabels, longestPeriodLabel);
  // Tilted labels overhang the first tick to the left; reserve what the y-axis
  // width does not already cover (see xLabelOverhang).
  const leftMargin = 8 + Math.max(0, xLabelOverhang(pres.xLabels, longestPeriodLabel) - yAxisWidth);
  const accessibleName = `${t(chartLang, 'chart.graphPanelLabel')}: ${displaySpec.title} (${displaySpec.unit})`;
  // Final review finding (owner-directed follow-up): small multiples always
  // drew line panels regardless of the form switch, so choosing Staaf while
  // small multiples was on silently kept showing lines — the bar-zero-axis
  // honesty rule was bypassed by drawing no bar at all, not a dishonest bar.
  // Gated off (not given its own bar path) as the cheapest, most
  // conservative fix: ChartSmallMultiples stays a line-only view, exactly
  // like before this task, just no longer reachable from a non-line form.
  // WP218 phase 5: narrowed from `effectiveKind === 'line'` to `activeForm
  // === 'line'` — area's effectiveKind is ALSO 'line' (same data model,
  // reused verbatim below), but small multiples stays a line-only view by
  // owner design; without this narrowing it would silently become
  // reachable from the Vlak tab too. (`smallMultiplesAvailable` itself now
  // lives above the schemaVersion guard, next to `effectiveKind` — see the
  // comment there.)
  const hiddenDisclosure =
    state.hiddenKeys.size > 0
      ? ` ${t(chartLang, 'chart.hiddenSeriesDisclosure', { n: state.hiddenKeys.size, m: seriesMeta.length })}.`
      : '';
  // Task 4: describes the currently shown window against the chart's full
  // covered range — from the ORIGINAL spec.attribution (identity, not
  // windowed content), never recomputed from viewSpec's own filtered points.
  const zoomDisclosure = state.periodRange
    ? ` ${t(chartLang, 'chart.zoomDisclosure', {
        from: periodLabelByCode.get(state.periodRange[0]) ?? '',
        to: periodLabelByCode.get(state.periodRange[1]) ?? '',
        coveredFrom: spec.attribution.coveredPeriods.from,
        coveredTo: spec.attribution.coveredPeriods.to,
      })}`
    : '';
  const viewDisclosure = `${hiddenDisclosure}${zoomDisclosure}`;
  const tooltipTrigger = coarsePointer ? 'click' : 'hover';
  const table = tableModel(displaySpec, chartLang);
  const panelId = `${domId}-panel`;

  // WP218 phase 5 (Task 2): the horizontal-bar form's OWN transposed row
  // model — one row per region, built from `buildRegionRows` (Task 1) over
  // the SAME `displaySpec`/`colorFor` as `buildRows` above, so `seriesMeta`
  // and `regionRowsAll` are index-aligned (both iterate `displaySpec.series`
  // in spec order — R6). Independent of `rows` (period x series): the
  // vertical forms never read this, and this never reads `rows`. Hidden
  // regions are DROPPED (not zeroed), order kept; highlight dims every OTHER
  // region, sharing `state.hiddenKeys`/`state.highlightedKey` with the
  // legend exactly like the vertical bar form's series do.
  const { rows: regionRowsAll } = buildRegionRows(displaySpec, colorFor);
  const regionChartRowsAll: RegionChartRow[] = regionRowsAll.map((r, i) => ({
    key: seriesMeta[i].key,
    label: r.label,
    value: r.value,
    value_display: r.value_display,
    value_provisional: r.value_provisional,
    value_resultId: r.value_resultId,
    color: seriesMeta[i].color,
    dimmed: state.highlightedKey !== null && state.highlightedKey !== seriesMeta[i].key,
    patternId: `hatch-${domId}-${seriesMeta[i].key}`,
  }));
  const visibleRegionRows = regionChartRowsAll.filter((r) => !state.hiddenKeys.has(r.key));
  // Same >BAR_LABEL_MAX thinning rule as valueLabelPlan's bar branch (the
  // idea-bank's >15-categories rule) — counted over EVERY region in the
  // spec, not just the visible ones, so hiding a region can never make
  // labels that were already suppressed reappear.
  const hbarPlottedCount = regionChartRowsAll.filter((r) => r.value !== null && r.value_display !== null).length;
  const hbarLabelsShown = hbarPlottedCount > 0 && hbarPlottedCount <= BAR_LABEL_MAX;
  const longestRegionLabel = regionChartRowsAll.reduce(
    (longest, r) => (r.label.length > longest.length ? r.label : longest),
    '',
  );
  const hbarYAxisWidth = Math.min(160, Math.max(48, labelWidthPx(longestRegionLabel)));
  const longestRegionValueText = regionChartRowsAll.reduce((longest, r) => {
    const text = `${r.value_display ?? ''}${r.value_provisional ? '*' : ''}`;
    return text.length > longest.length ? text : longest;
  }, '');
  const rightMarginForLabels = hbarLabelsShown && longestRegionValueText ? labelWidthPx(longestRegionValueText) : 8;
  // A comparison has exactly one period shared by every region; this is the
  // SAME fallback tableModel's own bar-kind header above already uses for
  // the identical "which period label represents every region" question.
  const regionPeriodLabels = new Set(displaySpec.series.flatMap((s) => s.points.map((p) => p.periodLabel)));
  const regionPeriodLabel = regionPeriodLabels.size === 1 ? [...regionPeriodLabels][0]! : t(chartLang, 'chart.table.value');

  // Task 3 / WP218 phase 5 Task 2: the real five-way Lijn/Vlak/Staaf/Liggend/
  // Tabel switch, tab order per the phase-5 plan. A disallowed tab is
  // skipped from the keyboard order entirely (as Lijn already was) so
  // arrow-key navigation never lands on a control the pointer can't activate
  // either; Staaf and Tabel are never gated.
  const FORM_ORDER: ChartForm[] = [
    ...(canUseLine ? (['line'] as const) : []),
    ...(canUseArea ? (['area'] as const) : []),
    'bar',
    ...(canUseHbar ? (['hbar'] as const) : []),
    'table',
  ];
  const formTabRef: Record<ChartForm, typeof lineTabRef> = {
    line: lineTabRef,
    area: areaTabRef,
    bar: barTabRef,
    hbar: hbarTabRef,
    table: tableTabRef,
  };
  // WP218 phase 5 (Global Constraints): each disabled tab explains itself —
  // the SAME reason string feeds both the pointer `title` and the
  // screen-reader `aria-describedby` span below, mirroring the Lijn tab's
  // existing pattern. Area has two distinct reasons depending on WHY it's
  // disallowed: a still-line-kind spec with >1 series (the fill would cover
  // other series' markers and gaps) vs. a comparison (bar-kind, no time
  // axis for a fill to trace) — `areaFormAllowed` returning false for a
  // line-kind spec only ever happens via the multi-series case, so branching
  // on `spec.kind` alone picks the right one. Hbar has exactly one reason
  // (disallowed only for a line-kind spec, regardless of series count).
  const areaDisabledReason =
    spec.kind === 'line' ? t(chartLang, 'chart.formReason.areaMultiSeries') : t(chartLang, 'chart.formReason.areaComparison');
  const hbarDisabledReason = t(chartLang, 'chart.formReason.hbarTimeSeries');

  function selectForm(next: ChartForm): void {
    // Review fix (controller decision): a story is only ever meaningful for
    // the chart form it was opened against — switching Weergave tabs while
    // it's open must restore the reader's own snapshot FIRST (closeStory),
    // same as toggleStylePanel already does before switching to Style,
    // rather than leaving `openPanel` stuck on 'story' once `storyAvailable`
    // goes false for the new form (which would otherwise strand the panel
    // open with no way to reach it, per the review finding).
    if (openPanel === 'story') closeStory();
    // Round 2: table form has no frame and no Style panel at all — switching
    // TO it must close the panel itself (not just skip rendering it while on
    // Tabel), or `openPanel` stays stuck on 'style' and the panel silently
    // reappears the moment the user switches back to a chart form.
    if (next === 'table') setOpenPanel(null);
    dispatch({ type: 'setForm', form: next });
    formTabRef[next].current?.focus();
  }

  function onFormTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const idx = FORM_ORDER.indexOf(activeForm);
    const nextIdx = (idx + dir + FORM_ORDER.length) % FORM_ORDER.length;
    selectForm(FORM_ORDER[nextIdx]);
  }

  // Review fix (chart-panel-layout, option A): these two ids are the ONLY
  // link between the trigger rendered here and the region ChartConfigPanel
  // renders further down — `styleControlsId` must equal exactly what
  // ChartConfigPanel builds internally from its own `idPrefix` prop
  // (`${idPrefix}-style`) so the trigger's `aria-controls` actually resolves.
  const styleTriggerId = `${domId}-style-trigger`;
  const styleControlsId = `${domId}-style`;

  // Story mode (session 92): the trigger/panel ids, availability and the
  // controls chart.tsx (not the dumb, controlled chart-story.tsx components)
  // owns — mirrors styleTriggerId/styleControlsId immediately above.
  const storyTriggerId = `${domId}-story-trigger`;
  const storyControlsId = `${domId}-story`;
  // `storyAvailable` itself now lives above the schemaVersion guard, next to
  // `storySteps` — see the comment there (needed by the stranded-snapshot
  // Effect, which must run unconditionally).
  const storyOpen = openPanel === 'story' && storyAvailable;
  const activeStoryStep: StoryStep | null = storyOpen ? (storySteps[storyIndex] ?? null) : null;
  // Review fix (controller decision): while the story is open, every reader
  // view control that could contradict its active caption — the legend's
  // hide/highlight buttons, the Vanaf/Tot zoom selects, the small-multiples
  // toggle — gets disabled with ONE shared, digit-free reason exposed via
  // both `title` (pointer) and `aria-describedby` (screen reader), pointing
  // at the single hidden span rendered once near the panel below.
  const storyLockId = `${domId}-story-lock`;
  const storyLockedTitle = storyOpen ? t(chartLang, 'chart.story.controlsLocked') : undefined;

  function openStory(): void {
    storySnapshot.current = { hiddenKeys: state.hiddenKeys, highlightedKey: state.highlightedKey, periodRange: state.periodRange };
    // setView BEFORE setOpenPanel: so the first render of the OPEN story
    // already shows the first step's own highlight/full-range view, never a
    // stray frame with the reader's own state still showing.
    dispatch({ type: 'setView', view: { hiddenKeys: new Set(), highlightedKey: storySteps[0]?.highlight ?? null, periodRange: null } });
    setStoryIndex(0);
    setOpenPanel('story');
    trackChartStyleEvent('story_open');
    // Insights (session 94): fired once per findings set (the null check),
    // on open rather than eagerly on every render — cheapest-viable-
    // mechanism (a chart nobody opens the panel for never spends a token).
    // Deliberately the RAW spec, never translateSpecForDisplay's
    // output: the AI phrasing is Dutch prose either way (matching the core
    // answer pipeline's own Dutch-only convention), so an English-displayed
    // chart's deterministic titles/captions stay English while an upgraded
    // caption, once it lands, is Dutch — a known, accepted v1 limitation
    // (open-questions.md) rather than a second English prompt. Finding ids
    // are translation-invariant (built from periodCode/kind/seriesKey, never
    // a label), so they still map back onto `findings` correctly either way.
    if (phrasedCaptions === null && findings.length > 0) {
      void generateInsights(spec).then((result) => {
        if (result.ok) setPhrasedCaptions(new Map(Object.entries(result.phrased)));
      });
    }
  }

  function closeStory(): void {
    const snapshot = storySnapshot.current;
    storySnapshot.current = null;
    if (snapshot) dispatch({ type: 'setView', view: snapshot });
    setOpenPanel(null);
  }

  function toggleStory(): void {
    if (storyOpen) closeStory();
    else openStory();
  }

  function onStoryIndexChange(next: number): void {
    setStoryIndex(next);
    dispatch({ type: 'setHighlight', key: storySteps[next]?.highlight ?? null });
    trackChartStyleEvent('story_step');
  }

  function toggleStylePanel(): void {
    // Side effect outside the state updater: React may invoke an updater
    // twice (Strict Mode) and requires it to be pure — the usage counter
    // must fire exactly once per open (task-5 review finding, carried over
    // from the panel's own former toggleOpen).
    // Story mode: Style and Story share this one slot — opening Style while
    // the story is showing must first restore the reader's own snapshot
    // (closeStory), never leave it stranded mid-story.
    if (openPanel === 'story') closeStory();
    if (openPanel !== 'style') trackChartStyleEvent('panel_open');
    setOpenPanel(openPanel === 'style' ? null : 'style');
  }

  // Session 87 (mockup Option B): the Grafiek/Tabel switch is a shadcn-style
  // segment (muted track, raised active segment); the small-multiples and
  // axis toggles are quiet pills.
  const segmentTab = (active: boolean): string =>
    'min-h-6 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ' +
    (active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground');
  const tabClass = (active: boolean): string =>
    'min-h-6 rounded-full border px-2.5 py-1 text-xs ' +
    (active
      ? 'border-transparent bg-secondary text-foreground'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground');
  // ADR 042: the export container's font override and auto height merged
  // into one style object — `undefined` (not `{}`) when neither applies, so
  // the stock DOM stays attribute-identical to before this task.
  const containerStyle: CSSProperties = {
    ...(fontStack(pres.fontFamily) ? { fontFamily: fontStack(pres.fontFamily) } : {}),
    ...(autoHeightPx !== null ? { height: autoHeightPx } : {}),
  };

  return (
    <div className={frameClass}>
      <div role="heading" aria-level={3} className="text-base font-semibold leading-snug text-foreground">
        {displaySpec.title}
      </div>
      {/* ADR 042: one muted subtitle line — the unit first, then the pinned
        * dimensions — as separate spans (tests and the digit scan read them
        * per text node). */}
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>{displaySpec.unit}</span>
        {dimEntries.length > 0 ? <span>{dimEntries.map(([k, v]) => `${k}: ${v}`).join(' · ')}</span> : null}
      </div>
      {/* WP218 phase 1 (Task 7), updated by the option-A layout refactor: the
        * Weergave tablist and the Opmaak trigger share one row — the trigger
        * (`ChartConfigTrigger`, rendered directly here — see the review-fix
        * comment on `styleOpen` above) is a plain row-mate of the tablist,
        * not a child of it — the tablist's own `mt-3` moved up onto this
        * wrapper so the row keeps its original top spacing regardless of
        * whether the trigger is offered. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t(chartLang, 'chart.weergaveLabel')}
          onKeyDown={onFormTabKeyDown}
          className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
        >
          <button
            ref={lineTabRef}
            type="button"
            role="tab"
            aria-selected={activeForm === 'line'}
            aria-controls={panelId}
            aria-describedby={canUseLine ? undefined : `${domId}-line-reason`}
            tabIndex={activeForm === 'line' ? 0 : -1}
            disabled={!canUseLine}
            title={canUseLine ? undefined : t(chartLang, 'chart.lineDisabledReason')}
            onClick={() => selectForm('line')}
            className={segmentTab(activeForm === 'line') + (canUseLine ? '' : ' cursor-not-allowed opacity-40')}
          >
            {t(chartLang, 'chart.tabLine')}
          </button>
          <button
            ref={areaTabRef}
            type="button"
            role="tab"
            aria-selected={activeForm === 'area'}
            aria-controls={panelId}
            aria-describedby={canUseArea ? undefined : `${domId}-area-reason`}
            tabIndex={activeForm === 'area' ? 0 : -1}
            disabled={!canUseArea}
            title={canUseArea ? undefined : areaDisabledReason}
            onClick={() => selectForm('area')}
            className={segmentTab(activeForm === 'area') + (canUseArea ? '' : ' cursor-not-allowed opacity-40')}
          >
            {t(chartLang, 'chart.form.area')}
          </button>
          <button
            ref={barTabRef}
            type="button"
            role="tab"
            aria-selected={activeForm === 'bar'}
            aria-controls={panelId}
            tabIndex={activeForm === 'bar' ? 0 : -1}
            onClick={() => selectForm('bar')}
            className={segmentTab(activeForm === 'bar')}
          >
            {t(chartLang, 'chart.tabBar')}
          </button>
          <button
            ref={hbarTabRef}
            type="button"
            role="tab"
            aria-selected={activeForm === 'hbar'}
            aria-controls={panelId}
            aria-describedby={canUseHbar ? undefined : `${domId}-hbar-reason`}
            tabIndex={activeForm === 'hbar' ? 0 : -1}
            disabled={!canUseHbar}
            title={canUseHbar ? undefined : hbarDisabledReason}
            onClick={() => selectForm('hbar')}
            className={segmentTab(activeForm === 'hbar') + (canUseHbar ? '' : ' cursor-not-allowed opacity-40')}
          >
            {t(chartLang, 'chart.form.hbar')}
          </button>
          <button
            ref={tableTabRef}
            type="button"
            role="tab"
            aria-selected={activeForm === 'table'}
            aria-controls={panelId}
            tabIndex={activeForm === 'table' ? 0 : -1}
            onClick={() => selectForm('table')}
            className={segmentTab(activeForm === 'table')}
          >
            {t(chartLang, 'chart.tabTable')}
          </button>
        </div>
        {/* Reachable via the disabled Lijn tab's aria-describedby above — a
          * plain `title` (kept, for pointer users) is invisible to a screen
          * reader, and a disabled control still needs its reason available
          * to whoever reaches it by keyboard/AT. */}
        {!canUseLine ? (
          <span id={`${domId}-line-reason`} className="sr-only">
            {t(chartLang, 'chart.lineDisabledReason')}
          </span>
        ) : null}
        {!canUseArea ? (
          <span id={`${domId}-area-reason`} className="sr-only">
            {areaDisabledReason}
          </span>
        ) : null}
        {!canUseHbar ? (
          <span id={`${domId}-hbar-reason`} className="sr-only">
            {hbarDisabledReason}
          </span>
        ) : null}
        {/* Review fix (chart-panel-layout, option A): the "Opmaak" trigger
          * renders directly here as a row-mate of the Weergave tablist — no
          * portal, no placeholder node. Final-review fix: table form gets NO
          * frame and NO Style panel (as before the Frame-tab feature) — a
          * framed table would need its own export path, so the trigger stays
          * gated on `state.form !== 'table'` exactly like the ChartConfigPanel
          * mount further down. */}
        {state.form !== 'table' ? (
          <ChartConfigTrigger
            open={styleOpen}
            onToggle={toggleStylePanel}
            controlsId={styleControlsId}
            triggerId={styleTriggerId}
            lang={chartLang}
          />
        ) : null}
        {/* Story mode (session 92): the colourful trigger sits in the same
          * row as Opmaak — a code-built story is offered whenever there is
          * one (storyAvailable, computed above next to styleControlsId). */}
        {storyAvailable ? (
          <ChartStoryTrigger
            open={storyOpen}
            onToggle={toggleStory}
            controlsId={storyControlsId}
            triggerId={storyTriggerId}
            lang={chartLang}
          />
        ) : null}
      </div>
      {zoomAvailable ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label htmlFor={`${domId}-from`}>{t(chartLang, 'chart.from')}</label>
          <select
            id={`${domId}-from`}
            aria-label={t(chartLang, 'chart.from')}
            value={state.periodRange?.[0] ?? allPeriodCodes[0]}
            disabled={storyOpen}
            title={storyLockedTitle}
            aria-describedby={storyOpen ? storyLockId : undefined}
            onChange={(e) => {
              const [from, clampedTo] = clampVanafChange(
                e.target.value,
                state.periodRange?.[1] ?? allPeriodCodes[allPeriodCodes.length - 1],
              );
              dispatch({
                type: 'setPeriodRange',
                range:
                  from === allPeriodCodes[0] && clampedTo === allPeriodCodes[allPeriodCodes.length - 1]
                    ? null
                    : [from, clampedTo],
              });
            }}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {allPeriodCodes.map((code) => (
              <option key={code} value={code}>
                {periodLabelByCode.get(code)}
              </option>
            ))}
          </select>
          <label htmlFor={`${domId}-to`}>{t(chartLang, 'chart.to')}</label>
          <select
            id={`${domId}-to`}
            aria-label={t(chartLang, 'chart.to')}
            value={state.periodRange?.[1] ?? allPeriodCodes[allPeriodCodes.length - 1]}
            disabled={storyOpen}
            title={storyLockedTitle}
            aria-describedby={storyOpen ? storyLockId : undefined}
            onChange={(e) => {
              const [clampedFrom, to] = clampTotChange(
                state.periodRange?.[0] ?? allPeriodCodes[0],
                e.target.value,
              );
              dispatch({
                type: 'setPeriodRange',
                range:
                  clampedFrom === allPeriodCodes[0] && to === allPeriodCodes[allPeriodCodes.length - 1]
                    ? null
                    : [clampedFrom, to],
              });
            }}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {allPeriodCodes.map((code) => (
              <option key={code} value={code}>
                {periodLabelByCode.get(code)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {state.form === 'table' ? (
        <div id={panelId} role="tabpanel" aria-label={t(chartLang, 'chart.tabTable')} className="mt-2 overflow-x-auto">
          <table className="w-full text-sm" aria-label={table.caption}>
            <thead>
              <tr>
                {table.header.map((h) => (
                  <th key={h} scope="col" className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.label} className="border-b border-border">
                  <th scope="row" className="px-2 py-1 text-left font-normal text-foreground">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td
                      key={table.header[i + 1] ?? i}
                      className="px-2 py-1 text-right text-foreground"
                      data-label-for={cell.resultId ?? undefined}
                    >
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
      /* touch-pan-y: the tooltip's press-and-drag must not fight vertical
       * page scrolling on a phone. Task 3 (design §C2): ChartFrame wraps
       * THIS div — and only this div, the export container — so the frame
       * is decoration around the chart, never inside the export SVG/PNG
       * itself (chart-download.tsx only ever reads the live <svg> inside
       * chartContainerRef, unaffected by this wrapper). */
      <ChartFrame frame={pres} image={frameImage}>
      <div
        id={panelId}
        role="tabpanel"
        aria-label={t(chartLang, 'chart.graphPanelLabel')}
        ref={chartContainerRef}
        className={
          // ADR 042: a 300 ms fade/rise of the export CONTAINER on mount —
          // outside the exported <svg>, so a download can never capture it;
          // Recharts' own animation stays off (the recorded refusal).
          // motion-reduce: honours prefers-reduced-motion.
          'animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none mt-2 w-full touch-pan-y ' +
          // The combined chart's ResponsiveContainer sizes to 100% of a
          // fixed-height parent; small multiples lays out its own h-24
          // panels in a grid and needs the parent to grow with them
          // instead — a fixed h-64 clips anything past ~4 series (found in
          // the 2026-09-05 final review). With a frame aspect ratio set,
          // ChartFrame's own inner area (min-h-0 flex-1) is what sizes the
          // box now, so this container grows to fill it (h-full) instead of
          // claiming a fixed height of its own. Final-review fix: small
          // multiples lays out its own grid and must keep growing with it
          // (h-auto) even when a frame aspect ratio is set — h-full would
          // instead force the small-multiples grid into the frame's fixed
          // aspect box, clipping panels past a handful of series exactly
          // like the original h-64 bug this comment describes. ADR 042:
          // once the card's own width is measured, `autoHeightPx` sets an
          // explicit height (below) and no class needs to claim one here —
          // until then (SSR/jsdom, or unmeasured) the h-64 floor stands.
          (pres.frameAspect !== 'auto' && !(smallMultiples && smallMultiplesAvailable)
            ? 'h-full'
            : smallMultiples && smallMultiplesAvailable
              ? 'h-auto'
              : autoHeightPx !== null
                ? ''
                : 'h-64')
        }
        data-tooltip-trigger={tooltipTrigger}
        // WP218: SVG <text> inherits font-family via CSS, so setting it once
        // on this container reaches every axis tick/point/end/bar label
        // drawn below; chart-download.tsx's inlineComputedPaint writes the
        // computed family onto every text node, so the PNG/SVG export
        // carries it too. undefined (the stock look: no font override)
        // leaves the page's own font untouched, same as today. ADR 042:
        // merged with the auto height (also undefined when absent, so the
        // stock DOM stays attribute-identical when neither applies).
        style={Object.keys(containerStyle).length > 0 ? containerStyle : undefined}
      >
        {smallMultiples && smallMultiplesAvailable ? (
          <ChartSmallMultiples
            spec={displaySpec}
            hiddenKeys={state.hiddenKeys}
            axisMode={axisMode}
            presentation={pres}
            lang={chartLang}
          />
        ) : (
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 256 }}>
          {activeForm === 'line' ? (
            <LineChart
              data={rows}
              margin={{ top: 8, right: rightMargin, left: leftMargin, bottom: 8 }}
              desc={t(chartLang, 'chart.keyboardHint')}
              aria-label={accessibleName}
            >
              {/* ADR 042 designed default (2026-09-11): the grid honours
                * `pres.grid` (horizontal/vertical/none, WP218) and the
                * category axis line follows `baselineAxisLine` — hidden by
                * default with a hairline baseline in its place — all in
                * theme colours (AXIS_COLOR/GRID_COLOR: dark mode). The
                * session-87 "basic Recharts look" survives only as the
                * Classic look; only the honesty-bound custom ticks and
                * labels below are ours. */}
              {pres.grid !== 'none' ? (
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={GRID_COLOR}
                  // Always true: this element only renders inside the
                  // `pres.grid !== 'none'` branch above, and GridMode has no
                  // vertical-only option — 'both'/'horizontal' both want it.
                  horizontal
                  vertical={pres.grid === 'both'}
                />
              ) : null}
              <XAxis
                dataKey="periodLabel"
                stroke={AXIS_COLOR}
                tick={{ fill: AXIS_COLOR }}
                axisLine={baselineAxisLine(pres)}
                tickLine={pres.axisLines === 'shown'}
                angle={pres.xLabels === 'tilted' ? -45 : 0}
                textAnchor={pres.xLabels === 'tilted' ? 'end' : 'middle'}
                {...(xAxisHeightPx !== undefined ? { height: xAxisHeightPx } : {})}
              />
              {/* #197 idea 6: axis ticks come from the full spec (valueLabelPlan
                * doesn't know about hiddenKeys) and are NOT recomputed when a
                * series is hidden — an accepted v1 limitation, not a bug: the
                * Tabel view and the un-hidden chart remain the source of exact
                * values. */}
              <YAxis
                ticks={plan.axisTicks.map((t) => t.value)}
                interval={0}
                tick={plan.axisTicks.length > 0 ? AxisTick(tickByValue) : false}
                width={yAxisWidth}
                domain={pres.zeroBaseline === 'zero' ? [0, 'auto'] : yAxisDomain(effectiveKind)}
                stroke={AXIS_COLOR}
                axisLine={pres.axisLines === 'shown'}
                tickLine={pres.axisLines === 'shown'}
              />
              {/* ADR 042: a faint SOLID crosshair — never dashed, so it can't be read as the dashed event marker or the dashed story ring; the export drops it anyway (chart-download.tsx). */}
              <Tooltip
                trigger={tooltipTrigger}
                content={<ChartTooltip seriesMeta={seriesMeta} />}
                cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeOpacity: 0.35 }}
              />
              {/* #170(4): curated event markers — drawn before the series so
                * they sit visually behind the data (paint order = JSX order
                * in Recharts' own layering). No inline Recharts label: the
                * always-visible text lives in the footer below (a rotated or
                * inline label risks colliding with point values at this
                * chart's typical width), matching the choice documented in
                * src/chart/render.ts for the static SVG renderer. */}
              {markers.map((m) => (
                <ReferenceLine
                  key={m.periodLabel}
                  x={m.periodLabel}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="3 3"
                />
              ))}
              {seriesMeta
                .filter((s) => !state.hiddenKeys.has(s.key))
                .map((s) => {
                  const dimmed = state.highlightedKey !== null && state.highlightedKey !== s.key;
                  return (
                    <Line
                      key={s.key}
                      type="linear"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={LINE_WIDTH_PX[pres.lineWidth]}
                      strokeOpacity={dimmed ? 0.25 : 1}
                      data-series-dimmed={dimmed ? 'true' : undefined}
                      connectNulls={false}
                      dot={SeriesDot(
                        s.key,
                        pres.valueLabels === 'shown' ? endLabelByKey.get(s.key) : undefined,
                        dimmed ? 0.25 : 1,
                        s.label,
                        (p) => setPendingPoint(p),
                        { ...dotGeometry(pres.lineWidth), markers: pres.markers, ends: endpointsByKey.get(s.key) ?? null },
                        chartLang,
                        activeStoryStep?.point?.seriesKey === s.key ? activeStoryStep.point.periodCode : null,
                      )}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  );
                })}
            </LineChart>
          ) : activeForm === 'area' ? (
            // WP218 phase 5 (Global Constraints): area is offered only for a
            // single time series, so this is the SAME data model as the Lijn
            // branch above (rows/plan/markers all built from `displaySpec`
            // once, near the top of this component) with grid/axes/tooltip/
            // reference lines copied verbatim — only the drawn element
            // differs (a filled Area instead of a Line). The Y domain reads
            // `pres.zeroBaseline` exactly like Lijn's — never a literal
            // [0, 'auto'] here — so the render can never drift from the
            // resolver's lock (LOCK_REASONS.zeroBaselineArea forces it to
            // 'zero' for this form, chart-presentation.ts).
            <AreaChart
              data={rows}
              margin={{ top: 8, right: rightMargin, left: leftMargin, bottom: 8 }}
              desc={t(chartLang, 'chart.keyboardHint')}
              aria-label={accessibleName}
            >
              {/* ADR 042: a vertical gradient fill per series (colour at the
                * top, almost nothing at the zero baseline). The <defs> ride
                * inside the exported <svg>, so the PNG/SVG keeps it; `url(#…)`
                * needs no paint resolution (chart-download.tsx). */}
              <defs>
                {seriesMeta.map((s) => (
                  <linearGradient key={s.key} id={`fill-${domId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              {pres.grid !== 'none' ? (
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal vertical={pres.grid === 'both'} />
              ) : null}
              <XAxis
                dataKey="periodLabel"
                stroke={AXIS_COLOR}
                tick={{ fill: AXIS_COLOR }}
                axisLine={baselineAxisLine(pres)}
                tickLine={pres.axisLines === 'shown'}
                angle={pres.xLabels === 'tilted' ? -45 : 0}
                textAnchor={pres.xLabels === 'tilted' ? 'end' : 'middle'}
                {...(xAxisHeightPx !== undefined ? { height: xAxisHeightPx } : {})}
              />
              <YAxis
                ticks={plan.axisTicks.map((t) => t.value)}
                interval={0}
                tick={plan.axisTicks.length > 0 ? AxisTick(tickByValue) : false}
                width={yAxisWidth}
                domain={pres.zeroBaseline === 'zero' ? [0, 'auto'] : yAxisDomain(effectiveKind)}
                stroke={AXIS_COLOR}
                axisLine={pres.axisLines === 'shown'}
                tickLine={pres.axisLines === 'shown'}
              />
              <Tooltip
                trigger={tooltipTrigger}
                content={<ChartTooltip seriesMeta={seriesMeta} />}
                cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeOpacity: 0.35 }}
              />
              {markers.map((m) => (
                <ReferenceLine key={m.periodLabel} x={m.periodLabel} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
              ))}
              {seriesMeta
                .filter((s) => !state.hiddenKeys.has(s.key))
                .map((s) => {
                  const dimmed = state.highlightedKey !== null && state.highlightedKey !== s.key;
                  return (
                    <Area
                      key={s.key}
                      type="linear"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
                      fill={pres.areaFill === 'gradient' ? `url(#fill-${domId}-${s.key})` : s.color}
                      fillOpacity={pres.areaFill === 'gradient' ? (dimmed ? 0.4 : 1) : dimmed ? 0.1 : 0.25}
                      strokeWidth={LINE_WIDTH_PX[pres.lineWidth]}
                      strokeOpacity={dimmed ? 0.25 : 1}
                      data-series-dimmed={dimmed ? 'true' : undefined}
                      connectNulls={false}
                      dot={SeriesDot(
                        s.key,
                        pres.valueLabels === 'shown' ? endLabelByKey.get(s.key) : undefined,
                        dimmed ? 0.25 : 1,
                        s.label,
                        (p) => setPendingPoint(p),
                        { ...dotGeometry(pres.lineWidth), markers: pres.markers, ends: endpointsByKey.get(s.key) ?? null },
                        chartLang,
                        activeStoryStep?.point?.seriesKey === s.key ? activeStoryStep.point.periodCode : null,
                      )}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  );
                })}
            </AreaChart>
          ) : activeForm === 'hbar' ? (
            // WP218 phase 5 (Global Constraints): hbar is offered only for a
            // comparison — one bar per REGION in the spec's own order (R6:
            // never sorted), region label on the category axis, the number
            // axis from zero with no invented ticks (tick={false}), the
            // value label at the bar's end. `regionChartRowsAll`/
            // `visibleRegionRows`/etc. are computed once, near the top of
            // this component, from `buildRegionRows` (Task 1) — independent
            // of `rows` (the period x series model every other form uses).
            <BarChart
              layout="vertical"
              data={visibleRegionRows}
              margin={{ top: 8, right: rightMarginForLabels, left: 8, bottom: 8 }}
              desc={t(chartLang, 'chart.keyboardHint')}
              aria-label={accessibleName}
            >
              <defs>
                {seriesMeta.map((s) => (
                  <pattern
                    key={s.key}
                    id={`hatch-${domId}-${s.key}`}
                    patternUnits="userSpaceOnUse"
                    width={6}
                    height={6}
                    patternTransform="rotate(45)"
                  >
                    <rect width={6} height={6} fill="var(--card)" />
                    <line x1={0} y1={0} x2={0} y2={6} stroke={s.color} strokeWidth={2} />
                  </pattern>
                ))}
              </defs>
              {/* WP218 phase 5: grid/vertical swap meaning here relative to
                * the vertical forms above — the NUMBER axis is now X, so the
                * gridlines that make values easy to read run VERTICAL
                * (always on when grid !== 'none', keeping "Alleen
                * horizontaal"/"Beide" semantic to the reader rather than
                * literal); the category (region) axis's own gridlines are
                * the extra ones, only in 'both' mode. */}
              {pres.grid !== 'none' ? (
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical horizontal={pres.grid === 'both'} />
              ) : null}
              <XAxis
                type="number"
                domain={[0, 'auto']}
                tick={false}
                stroke={AXIS_COLOR}
                axisLine={pres.axisLines === 'shown'}
                tickLine={pres.axisLines === 'shown'}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={hbarYAxisWidth}
                interval={0}
                tick={RegionAxisTick}
                stroke={AXIS_COLOR}
                axisLine={baselineAxisLine(pres)}
                tickLine={pres.axisLines === 'shown'}
              />
              <Tooltip
                trigger={tooltipTrigger}
                content={<RegionTooltip periodLabel={regionPeriodLabel} />}
                cursor={{ fill: 'var(--muted)', fillOpacity: 0.6 }}
              />
              <Bar
                dataKey="value"
                isAnimationActive={false}
                shape={RegionBar(regionPeriodLabel, hbarLabelsShown, (p) => setPendingPoint(p), chartLang)}
              />
            </BarChart>
          ) : (
            <BarChart
              data={rows}
              margin={{ top: 16, right: 8, left: leftMargin, bottom: 8 }}
              desc={t(chartLang, 'chart.keyboardHint')}
              aria-label={accessibleName}
            >
              <defs>
                {seriesMeta.map((s) => (
                  <pattern
                    key={s.key}
                    id={`hatch-${domId}-${s.key}`}
                    patternUnits="userSpaceOnUse"
                    width={6}
                    height={6}
                    patternTransform="rotate(45)"
                  >
                    <rect width={6} height={6} fill="var(--card)" />
                    <line x1={0} y1={0} x2={0} y2={6} stroke={s.color} strokeWidth={2} />
                  </pattern>
                ))}
              </defs>
              {/* ADR 042 designed default (2026-09-11): the grid honours
                * `pres.grid` (horizontal/vertical/none, WP218) and the
                * category axis line follows `baselineAxisLine` — hidden by
                * default with a hairline baseline in its place — all in
                * theme colours (AXIS_COLOR/GRID_COLOR: dark mode). The
                * session-87 "basic Recharts look" survives only as the
                * Classic look; only the honesty-bound custom ticks and
                * labels below are ours. WP218: grid/axis props mirror the
                * line branch above; the Y domain stays unconditionally
                * zero-based here (bar honesty rule, never overridden by
                * zeroBaseline). */}
              {pres.grid !== 'none' ? (
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={GRID_COLOR}
                  // Always true: this element only renders inside the
                  // `pres.grid !== 'none'` branch above, and GridMode has no
                  // vertical-only option — 'both'/'horizontal' both want it.
                  horizontal
                  vertical={pres.grid === 'both'}
                />
              ) : null}
              <XAxis
                dataKey="periodLabel"
                stroke={AXIS_COLOR}
                tick={{ fill: AXIS_COLOR }}
                axisLine={baselineAxisLine(pres)}
                tickLine={pres.axisLines === 'shown'}
                angle={pres.xLabels === 'tilted' ? -45 : 0}
                textAnchor={pres.xLabels === 'tilted' ? 'end' : 'middle'}
                {...(xAxisHeightPx !== undefined ? { height: xAxisHeightPx } : {})}
              />
              <YAxis
                tick={false}
                width={16}
                domain={yAxisDomain(effectiveKind)}
                stroke={AXIS_COLOR}
                axisLine={pres.axisLines === 'shown'}
                tickLine={pres.axisLines === 'shown'}
              />
              <Tooltip
                trigger={tooltipTrigger}
                content={<ChartTooltip seriesMeta={seriesMeta} />}
                cursor={{ fill: 'var(--muted)', fillOpacity: 0.6 }}
              />
              {seriesMeta
                .filter((s) => !state.hiddenKeys.has(s.key))
                .map((s) => {
                  const dimmed = state.highlightedKey !== null && state.highlightedKey !== s.key;
                  return (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label}
                      fill={s.color}
                      fillOpacity={dimmed ? 0.25 : 1}
                      data-series-dimmed={dimmed ? 'true' : undefined}
                      isAnimationActive={false}
                      shape={SeriesBar(
                        s.key,
                        s.color,
                        `hatch-${domId}-${s.key}`,
                        barLabelsByKey.get(s.key) ?? new Map<string, PointLabel>(),
                        dimmed ? 0.25 : 1,
                        s.label,
                        (p) => setPendingPoint(p),
                        chartLang,
                        activeStoryStep?.point?.seriesKey === s.key ? activeStoryStep.point.periodCode : null,
                      )}
                    />
                  );
                })}
            </BarChart>
          )}
        </ResponsiveContainer>
        )}
      </div>
      </ChartFrame>
      )}
      {/* Story mode (session 92): the same slot as the Opmaak region — chart
        * first, the story under it — and, like ChartNotes, OUTSIDE
        * chartContainerRef so no caption can ever enter an export. */}
      {storyAvailable ? (
        <ChartStoryPanel
          steps={storySteps}
          index={storyIndex}
          onIndexChange={onStoryIndexChange}
          open={storyOpen}
          onClose={closeStory}
          triggerId={storyTriggerId}
          idPrefix={domId}
          lang={chartLang}
        />
      ) : null}
      {/* Review fix (controller decision): the ONE reason every locked
        * control's aria-describedby points at — legend buttons, the
        * Vanaf/Tot selects, the small-multiples toggle. Rendered once here,
        * near the panel it explains, rather than duplicated per control.
        * Final-review fix: every `aria-describedby` that points at this id
        * is already gated on `storyOpen` (undefined when closed), so the
        * span itself only needs to exist while the story is open too — a
        * stray `sr-only` node with a stale id otherwise sits in the DOM
        * permanently, described by nothing. */}
      {storyOpen ? (
        <span id={storyLockId} className="sr-only">
          {t(chartLang, 'chart.story.controlsLocked')}
        </span>
      ) : null}
      {/* Task 6 (chart frame plan): ChartConfigPanel now portals its dialog
        * into `document.body` itself, so mounting it HERE no longer decides
        * where in the DOM it lands — only the Story panel still keeps the
        * under-chart slot. This mount point is kept anyway: it's still
        * where `styleOpen`/`chartEpoch`/every other prop below is already in
        * scope, and moving the mount elsewhere would change nothing about
        * what renders. `key={chartEpoch}` is unchanged: a spec swap still
        * fully remounts the panel, resetting its colour-draft/brand-status
        * state exactly as it always has — `open` itself is `styleOpen`
        * above, reset separately in the spec-swap block instead of via this
        * remount. */}
      {/* Final-review fix: table form gets no Style panel at all (as before
        * the Frame-tab feature) — a framed table would need its own export
        * path, so the mount stays gated on `state.form !== 'table'`. */}
      {state.form !== 'table' ? (
        <ChartConfigPanel
          key={chartEpoch}
          resolved={resolved}
          seriesMeta={seriesMeta}
          lang={chartLang}
          open={styleOpen}
          onOpenChange={setStyleOpen}
          triggerId={styleTriggerId}
          frameImage={frameImage}
          onFrameImage={setFrameImage}
          onChange={(patch) => {
            // Final-review fix (Fix 5): ChartConfigPanel now refuses a
            // frame background/inset change UP FRONT (its own contrast
            // guard, before ever calling this onChange) whenever it would
            // make a series colour illegible — so there is nothing left for
            // this callback to silently drop or adjust afterwards. Series
            // colours are never changed by the frame feature.
            dispatch({ type: 'setPresentation', patch });
            trackChartStyleEvent('option_changed');
            // Task 5: every frame control change ALSO counts as its own
            // frame_changed event, in addition to (never instead of) the
            // option_changed every panel change already fires.
            if (Object.keys(patch).some((key) => key.startsWith('frame'))) {
              trackChartStyleEvent('frame_changed');
            }
          }}
          onApplyTemplate={(id) => {
            // ADR 043: a template REPLACES the reader's per-chart tweaks (a
            // look is a whole, not a layer), then applies as ordinary
            // overrides — every honesty lock re-runs per render exactly as
            // for a hand-picked value. The uploaded frame image is cleared
            // like the full reset does. Owner decision E is untouched: this
            // chart only; the account default is the only persistence.
            dispatch({ type: 'resetPresentation' });
            dispatch({ type: 'setPresentation', patch: templateById(id).overrides });
            setFrameImage(null);
            trackChartStyleEvent(`template_${id}`);
          }}
          onReset={() => {
            dispatch({ type: 'resetPresentation' });
            // Final-review fix: "Standaardkleuren" (a partial reset) goes
            // through onChange and was already counted; "Standaard" (the
            // full reset) fired nothing, so the #220 usage counter — whose
            // whole point is telling the owner which options readers
            // actually touch — systematically under-counted resets.
            trackChartStyleEvent('option_changed');
            // Fix: clear the uploaded frame image when doing a full reset
            setFrameImage(null);
          }}
          idPrefix={domId}
          account={
            signedIn
              ? {
                  hasDefault: accountStyle !== null,
                  onSave: async () => {
                    // The EFFECTIVE values (base + whatever per-chart tweaks
                    // are currently showing) become the new account default —
                    // "what's on screen" is what "Bewaar als mijn standaard"
                    // promises to save — EXCEPT the keys the resolver LOCKED
                    // for this form (P2 task-4 review): saving while a bar
                    // chart is on screen must not bake the bar-forced zero
                    // baseline into every future line chart. A locked value
                    // was never the reader's choice, so it is not saved AS
                    // THE LOCK'S VALUE — but final-review fix: it must still
                    // be saved as whatever `base` (the account default
                    // already in scope) already held for that key, not
                    // dropped outright. Omitting the key made
                    // `saveUserChartStyle`'s full-row REPLACE (never a merge)
                    // silently erase an earlier saved preference for that key
                    // — e.g. turning off "Waarden tonen" on a line chart,
                    // saving, then only changing the font on a bar/hbar/area
                    // chart and saving again wiped the earlier valueLabels
                    // choice because bar forms lock it. Writing back
                    // `base[key]` keeps both properties: a form-forced value
                    // is never persisted, and a value the reader chose on a
                    // DIFFERENT chart form survives an unrelated save on this
                    // one.
                    const chosen = { ...resolved.values } as Partial<typeof resolved.values>;
                    for (const key of Object.keys(resolved.locks) as (keyof typeof resolved.values)[]) {
                      (chosen as Record<string, unknown>)[key] = base[key];
                    }
                    // Task 5 (design §C2): an "Own image" background is a
                    // data URL held only in THIS component's `frameImage`
                    // state, never written to the account-default row — so
                    // it never rides along with a save. Saved as 'none'
                    // instead of the image kind (never simply omitted,
                    // matching the locked-key precedent just above: a key
                    // this save cannot honour still gets an explicit,
                    // digit-free stock value written back, not a silent gap).
                    const droppedImage = chosen.frameBackground !== undefined && chosen.frameBackground !== 'none' && chosen.frameBackground.kind === 'image';
                    if (droppedImage) chosen.frameBackground = 'none';
                    // WP218 phase 3 (owner B): the last brand applied on any
                    // chart shown by THIS MOUNTED ChartView (not just
                    // whichever chart is on screen right now — see
                    // lastAppliedBrand's own comment) rides along as the
                    // account-default save's `brandApplied` argument, so the
                    // persisted default can record which brand it came from.
                    const r = await saveMyChartStyle(chosen, lastAppliedBrand ?? undefined);
                    if (r.ok) {
                      setAccountStyle(chosen);
                      trackChartStyleEvent('default_saved');
                    }
                    if (!r.ok) return r.reason === 'unavailable' ? 'unavailable' : 'error';
                    return droppedImage ? 'savedImageDropped' : 'saved';
                  },
                  onForget: async () => {
                    const r = await forgetMyChartStyle();
                    if (r.ok) {
                      setAccountStyle(null);
                      trackChartStyleEvent('default_forgotten');
                    }
                    return r.ok ? 'forgotten' : 'error';
                  },
                }
              : undefined
          }
          // WP218 phase 3 (owner B): same signedIn gate as `account` —
          // Ontdek/trial gets no Merkkleuren block at all.
          brand={signedIn ? { lookup: (website) => lookupBrand(website) } : undefined}
          onBrandApplied={(applied) => {
            setLastAppliedBrand(applied);
            trackChartStyleEvent('brand_applied');
          }}
        />
      ) : null}
      {state.form !== 'table' && !state.periodRange && spec.attribution.trendHeadline !== undefined ? (
        <p data-testid="trend-headline" className="mt-1 text-sm text-foreground">
          {spec.attribution.trendHeadline}
        </p>
      ) : null}
      {state.form !== 'table' && seriesMeta.length > 1 ? (
        <>
          <SeriesLegend
            seriesMeta={seriesMeta}
            hiddenKeys={state.hiddenKeys}
            highlightedKey={state.highlightedKey}
            onToggle={(key) => dispatch({ type: 'toggleSeries', key })}
            onHighlight={(key) => dispatch({ type: 'setHighlight', key })}
            lang={chartLang}
            disabled={storyOpen}
            disabledReasonId={storyLockId}
          />
          {state.hiddenKeys.size > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(chartLang, 'chart.hiddenSeriesDisclosure', { n: state.hiddenKeys.size, m: seriesMeta.length })}
            </p>
          ) : null}
        </>
      ) : null}
      {/* Task 4: shown whenever a period-range zoom is active, independent of
        * the series-legend block above (which only renders for >1 series) —
        * a single-series chart can be zoomed too. */}
      {zoomDisclosure ? <p className="mt-1 text-xs text-muted-foreground">{zoomDisclosure.trim()}</p> : null}
      {state.form !== 'table' && smallMultiplesAvailable ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={smallMultiples}
            disabled={storyOpen}
            title={storyLockedTitle}
            aria-describedby={storyOpen ? storyLockId : undefined}
            onClick={() => setSmallMultiples((v) => !v)}
            className={tabClass(smallMultiples) + (storyOpen ? ' cursor-not-allowed opacity-60' : '')}
          >
            {t(chartLang, 'chart.smallMultiplesToggle')}
          </button>
          {smallMultiples ? (
            <div role="group" aria-label={t(chartLang, 'chart.axisGroupLabel')} className="flex gap-2">
              <button
                type="button"
                aria-pressed={axisMode === 'shared'}
                onClick={() => setAxisMode('shared')}
                className={tabClass(axisMode === 'shared')}
              >
                {t(chartLang, 'chart.sharedAxes')}
              </button>
              <button
                type="button"
                aria-pressed={axisMode === 'own'}
                onClick={() => setAxisMode('own')}
                className={tabClass(axisMode === 'own')}
              >
                {t(chartLang, 'chart.ownAxes')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {/* #197: the hollow marker needs a key a lay reader can decode without
        * reading the note first; rendered exactly when the spec says a
        * provisional point exists (R11's provisionalNote is present iff). */}
      {spec.provisionalNote ? (
        <p className="mt-1 text-xs text-muted-foreground">{t(chartLang, 'chart.provisionalMarkerNote')}</p>
      ) : null}
      {/* WP23 (#92): caveats read like caveats — warn and a step larger than
        * the source credit, which stays smallest/lightest (photo-credit
        * style). Content untouched: same strings from the same one builder
        * (R4); only presentation changes here. */}
      {spec.provisionalNote ? <p className="mt-2 text-sm text-warning">{spec.provisionalNote}</p> : null}
      {spec.nullNotes.map((note) => (
        <p key={note} className="text-sm text-warning">
          {note}
        </p>
      ))}
      {spec.definitionLine ? <p className="mt-2 text-xs text-muted-foreground">{spec.definitionLine}</p> : null}
      {/* #170(4): curated event markers, always-visible text (never
        * hover-only — see the ReferenceLine comment above). Neutral tone
        * (text-muted-foreground), distinct from the #92 amber caveats above: this
        * is contextual metadata, not a data-quality warning. */}
      {markers.map((m) => (
        <p key={m.label} className="text-xs text-muted-foreground">
          {t(chartLang, 'chart.markedInChart', { label: m.label })}
        </p>
      ))}
      {/* Task 6 (#212 click-to-annotate): mounted as a SIBLING here, entirely
        * outside the chartContainerRef-wrapped block above — that placement
        * is the whole safety property. ChartDownloadMenu (PNG/SVG export)
        * only ever reads the live <svg> inside chartContainerRef, so a note
        * rendered here can never be scanned as chart data or exported by
        * construction, with no separate exemption to maintain. Only offered
        * for chart forms (state.form !== 'table'): notes anchor to a clicked
        * chart point, not a table cell. */}
      {state.form !== 'table' ? (
        <ChartNotes
          notes={notes}
          pendingPoint={pendingPoint}
          idPrefix={domId}
          lang={chartLang}
          onSave={(text) => {
            if (!pendingPoint) return;
            setNotes((prev) => [...prev, { id: `${pendingPoint.resultId}-${noteIdCounter.current++}`, ...pendingPoint, text }]);
            setPendingPoint(null);
          }}
          onCancelPending={() => setPendingPoint(null)}
          onDelete={(id) => setNotes((prev) => prev.filter((n) => n.id !== id))}
        />
      ) : null}
      {/* #170(1): the R4 prose credit keeps its photo-credit size (#92); the
        * badge is the same attribution made SCANNABLE — table id + measured
        * sync date + deep link, from spec.attribution only (the source key is
        * derived from the table id inside the badge; ChartAttribution carries
        * none). Ontdek reuses this component, so the homepage charts get the
        * identical badge for free. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xs text-muted-foreground">{displayAttributionLine}</p>
        <SourceBadge tableId={spec.attribution.tableId} syncedAt={spec.attribution.syncedAt} />
        {/* #170(3): download-as-image, PNG or SVG, attribution baked into
          * the file itself — not just shown on this page — via the SAME
          * displayAttributionLine string shown above (R4: one builder, one
          * sentence, never re-derived here; WP218 phase 4: translated once,
          * shared between the on-screen text and the export). Not offered in
          * small-multiples view (idea 8): ChartDownloadMenu grabs the first
          * <svg> under the container, which in that view is just one
          * series' own mini panel — exporting it under the full chart's
          * filename/attribution would silently misrepresent what's shown,
          * the same risk #46(c) already names for exports. Same precedent
          * as the Tabel view below, which has never offered a download
          * either. */}
        {/* Final-review fix: gated on the SAME compound the container/render
          * branch use (`smallMultiples && smallMultiplesAvailable`), not on
          * `smallMultiples` alone — leaving small multiples on in Lijn form
          * and then switching to Staaf (or Vlak) makes
          * `smallMultiplesAvailable` false while `smallMultiples` state is
          * still true, so the old `!smallMultiples` guard hid Download on
          * an ordinary bar/area chart with no way back except returning to
          * Lijn and toggling small multiples off. */}
        {state.form !== 'table' && !(smallMultiples && smallMultiplesAvailable) ? (
          <ChartDownloadMenu
            containerRef={chartContainerRef}
            attributionText={`${displayAttributionLine} checkdecijfers.nl${viewDisclosure}`}
            filenameBase={`checkdecijfers-${spec.attribution.tableId}`}
            lang={chartLang}
            frame={pres}
            frameImage={frameImage}
          />
        ) : null}
      </div>
    </div>
  );
}
