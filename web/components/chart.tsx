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

import { useEffect, useId, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import {
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
  dotGeometry,
  findFont,
  fontStack,
  LINE_WIDTH_PX,
  RECHARTS_PALETTE,
  resolvePresentation,
  seriesColor,
  withAccountDefault,
  xAxisHeight,
  xLabelOverhang,
} from '../lib/chart-presentation.ts';
import { useChartStyle } from '../lib/chart-style-context.tsx';
import { trackChartStyleEvent } from '../lib/chart-usage-client.ts';
import {
  translateAttributionLine,
  translateMeasureTitle,
  translatePeriodLabel,
  translateRegion,
  translateUnit,
} from '../lib/i18n/cbs-words.ts';
import { useLang } from '../lib/i18n/lang-provider.tsx';
import { t, type Lang } from '../lib/i18n/messages.ts';
// WP218 phase 2 (owner C): the account-default Server Actions live in their
// OWN tiny-import-graph file, never web/app/actions.ts — see that file's own
// header for why (the usage-actions.ts precedent this mirrors).
import { forgetMyChartStyle, lookupBrand, saveMyChartStyle } from '../app/chart-style-actions.ts';
import { ensureFontLoaded } from '../lib/font-loader.ts';
import { ChartConfigPanel } from './chart-config-panel.tsx';
import { ChartDownloadMenu } from './chart-download.tsx';
import { ChartNotes, type ChartNote, type PendingPoint } from './chart-notes.tsx';
import { ChartSmallMultiples } from './chart-small-multiples.tsx';
import { SourceBadge } from './source-badge.tsx';
import {
  chartViewReducer,
  initialViewState,
  lineFormAllowed,
  windowSpec,
  type ChartForm,
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

// Series palette — session 87 visual redesign (owner decision, docs/
// superpowers/specs/2026-09-07-chat-chart-visual-redesign-design.md): "use the
// basic Recharts style". Recharts has no built-in categorical palette (every
// series would default to the same #3182bd), so "basic Recharts" means the
// colours its own documentation examples use — the look everyone recognises
// as a stock Recharts chart. This supersedes the #197 colour-blind-safe token
// palette + dash patterns (session 69): the owner accepted that the default
// palette may be colour-blind-unsafe as a trade-off of this decision; the
// hollow/hatched provisional marker (R11) is untouched — that is honesty, not
// styling. The palette cycles for series nine and up; the Tabel view remains
// the honest surface for many series.
export { RECHARTS_PALETTE } from '../lib/chart-presentation.ts';

export function seriesStyle(index: number): { color: string } {
  return { color: RECHARTS_PALETTE[index % RECHARTS_PALETTE.length]! };
}

// Axis + grid colours (session 87 deep review): Recharts' own defaults are
// literal light-mode greys (#666 axis/ticks, #ccc grid) that it hardcodes on
// the SVG, so in dark mode the x-axis period labels rendered at ~3:1 against
// the card and the grid became the brightest thing on the chart. The
// geometry stays Recharts-default (the "basic Recharts look"); only the
// colours ride the theme tokens, like every other text in the product. One
// definition, reused by UserChartView and ChartSmallMultiples.
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
}: {
  seriesMeta: SeriesMeta[];
  hiddenKeys: Set<string>;
  highlightedKey: string | null;
  onToggle: (key: string) => void;
  onHighlight: (key: string | null) => void;
  lang: Lang;
}) {
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
              onClick={() => onToggle(s.key)}
              className={
                'inline-flex min-h-6 items-center gap-1.5 rounded-md px-1.5 text-xs hover:bg-muted ' +
                (hidden ? 'text-muted-foreground line-through' : 'text-foreground')
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
              disabled={hidden}
              onClick={() => onHighlight(highlighted ? null : s.key)}
              title={t(lang, 'chart.highlightTitle', { label: s.label })}
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
  // WP218 (ADR 039) Phase 0: r/ring follow the resolved line width (R11: the
  // hollow ring must stay legible at every stroke width — see `dotGeometry`)
  // and `hideFinal` draws every NON-provisional marker invisible
  // (opacity 0, never removed from the DOM) when the "alleen voorlopig"
  // marker mode is chosen, so the `[data-point]` count, keyboard walking
  // (#212) and click-to-annotate all keep working identically either way.
  // Defaulted to today's literal geometry (r 4, ring 2, hideFinal false) so
  // every existing call site/test keeps its current arity and rendering.
  geometry: { r: number; ring: number; hideFinal: boolean } = { ...dotGeometry('normal'), hideFinal: false },
  lang: Lang = 'nl',
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
    const hiddenFinal = geometry.hideFinal && !provisional;
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
            fontSize={11}
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
            fontSize={11}
            fill="var(--foreground)"
            textAnchor="middle"
            data-role="bar-label"
            data-label-for={label.resultId}
          >
            {label.text}
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

/** Approximate text width at the 11px label font — layout only, so the plot
 * leaves room for the end-of-line label instead of clipping it. */
function labelWidthPx(text: string): number {
  return Math.ceil(text.length * 6.5) + 12;
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
  const barTabRef = useRef<HTMLButtonElement>(null);
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
  // WP218 phase 3 (owner B): the last brand a signed-in visitor actually
  // applied via "Pas merkkleuren toe" — deliberately NOT reset by the spec-
  // swap block below (unlike notes/pendingPoint), because it describes
  // something about the ACCOUNT, not this one chart, exactly like
  // `accountStyle` itself. Handed to `saveMyChartStyle` as `brandApplied` on
  // the next "Bewaar als mijn standaard", whichever chart that happens on.
  const [lastAppliedBrand, setLastAppliedBrand] = useState<{
    domain: string;
    name: string;
    fetchedAt: string;
  } | null>(null);
  if (specIdentity !== lastSpecIdentity) {
    setLastSpecIdentity(specIdentity);
    setChartEpoch((n) => n + 1);
    dispatch({ type: 'reset', initialForm: state.form });
    setSmallMultiples(false);
    setAxisMode('shared');
    setNotes([]);
    setPendingPoint(null);
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
  const activeForm: ChartForm = state.form === 'line' && !canUseLine ? 'bar' : state.form;
  const effectiveKind: ChartSpec['kind'] = activeForm === 'table' ? spec.kind : activeForm;

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
  // This is the one Hook `pres` feeds, so it must run unconditionally on
  // every render — ABOVE the schemaVersion guard below, which a live spec
  // swap on this same mounted instance (see the specIdentity block above)
  // could otherwise flip between renders and skip this call on some of them.
  useEffect(() => {
    const font = findFont(pres.fontFamily);
    if (font && font.source === 'google') ensureFontLoaded(font);
  }, [pres.fontFamily]);
  // WP218 phase 4 (#219, design §4): the chart's own language. `useLang()`
  // is called UNCONDITIONALLY (its own statement, same reason as the Hook
  // above it) — writing `pres.language ?? useLang()` directly would only
  // call the hook when `pres.language` is null, a conditional Hook call that
  // breaks React's Rules of Hooks the moment a reader toggles the per-chart
  // select on/off. `pres.language` (null = follow the app) wins when set.
  const appLang = useLang();
  const chartLang: Lang = pres.language ?? appLang;

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
  const smallMultiplesAvailable = effectiveKind === 'line' && seriesMeta.length > 1;
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

  // Task 3: a real three-way Lijn/Staaf/Tabel switch. Lijn is skipped from
  // the keyboard order entirely when disabled (canUseLine === false) so
  // arrow-key navigation never lands on a control the pointer can't activate
  // either.
  const FORM_ORDER: ChartForm[] = canUseLine ? ['line', 'bar', 'table'] : ['bar', 'table'];
  const formTabRef: Record<ChartForm, typeof lineTabRef> = { line: lineTabRef, bar: barTabRef, table: tableTabRef };

  function selectForm(next: ChartForm): void {
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

  return (
    <div className={frameClass}>
      <div role="heading" aria-level={3} className="text-sm font-semibold text-foreground">
        {displaySpec.title}
      </div>
      {dimEntries.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          {dimEntries.map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </div>
      ) : null}
      <div className="text-xs text-muted-foreground">{displaySpec.unit}</div>
      {/* WP218 phase 1 (Task 7): the Weergave tablist and the Opmaak panel
        * share one row (the panel wraps under it via its own `basis-full` —
        * see ChartConfigPanel) — the tablist's own `mt-3` moved up onto this
        * wrapper so the row keeps its original top spacing regardless of
        * whether the panel is offered. */}
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
        {state.form !== 'table' ? (
          <ChartConfigPanel
            key={chartEpoch}
            resolved={resolved}
            seriesMeta={seriesMeta}
            lang={chartLang}
            onChange={(patch) => {
              dispatch({ type: 'setPresentation', patch });
              trackChartStyleEvent('option_changed');
            }}
            onReset={() => dispatch({ type: 'resetPresentation' })}
            onOpen={() => trackChartStyleEvent('panel_open')}
            idPrefix={domId}
            account={
              signedIn
                ? {
                    hasDefault: accountStyle !== null,
                    onSave: async () => {
                      // The EFFECTIVE values (base + whatever per-chart
                      // tweaks are currently showing) become the new
                      // account default — "what's on screen" is what
                      // "Bewaar als mijn standaard" promises to save —
                      // MINUS the keys the resolver LOCKED for this form
                      // (P2 task-4 review): saving while a bar chart is on
                      // screen must not bake the bar-forced zero baseline
                      // into every future line chart. A locked value was
                      // never the reader's choice, so it is not saved.
                      const chosen = Object.fromEntries(
                        Object.entries(resolved.values).filter(([key]) => !(key in resolved.locks)),
                      ) as Partial<typeof resolved.values>;
                      // WP218 phase 3 (owner B): the last brand applied on
                      // ANY chart (not just this one — see lastAppliedBrand's
                      // own comment) rides along as the account-default
                      // save's `brandApplied` argument, so the persisted
                      // default can record which brand it came from.
                      const r = await saveMyChartStyle(chosen, lastAppliedBrand ?? undefined);
                      if (r.ok) {
                        setAccountStyle(chosen);
                        trackChartStyleEvent('default_saved');
                      }
                      return r.ok ? 'saved' : r.reason === 'unavailable' ? 'unavailable' : 'error';
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
      </div>
      {zoomAvailable ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label htmlFor={`${domId}-from`}>{t(chartLang, 'chart.from')}</label>
          <select
            id={`${domId}-from`}
            aria-label={t(chartLang, 'chart.from')}
            value={state.periodRange?.[0] ?? allPeriodCodes[0]}
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
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground"
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
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground"
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
       * page scrolling on a phone. */
      <div
        id={panelId}
        role="tabpanel"
        aria-label={t(chartLang, 'chart.graphPanelLabel')}
        ref={chartContainerRef}
        className={
          'mt-2 w-full touch-pan-y ' +
          // The combined chart's ResponsiveContainer sizes to 100% of a
          // fixed-height parent; small multiples lays out its own h-24
          // panels in a grid and needs the parent to grow with them
          // instead — a fixed h-64 clips anything past ~4 series (found in
          // the 2026-09-05 final review).
          (smallMultiples && smallMultiplesAvailable ? 'h-auto' : 'h-64')
        }
        data-tooltip-trigger={tooltipTrigger}
        // WP218: SVG <text> inherits font-family via CSS, so setting it once
        // on this container reaches every axis tick/point/end/bar label
        // drawn below; chart-download.tsx's inlineComputedPaint writes the
        // computed family onto every text node, so the PNG/SVG export
        // carries it too. undefined (the stock look: no font override)
        // leaves the page's own font untouched, same as today.
        style={fontStack(pres.fontFamily) ? { fontFamily: fontStack(pres.fontFamily) } : undefined}
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
          {effectiveKind === 'line' ? (
            <LineChart
              data={rows}
              margin={{ top: 8, right: rightMargin, left: leftMargin, bottom: 8 }}
              desc={t(chartLang, 'chart.keyboardHint')}
              aria-label={accessibleName}
            >
              {/* Recharts' own default grid + axis geometry (session 87: the
                * "basic Recharts look") in theme colours (AXIS_COLOR/GRID_COLOR:
                * dark mode); only the honesty-bound custom ticks and labels
                * below are ours. WP218: horizontal/vertical/no-grid-at-all
                * follow `pres.grid`. */}
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
                axisLine={pres.axisLines === 'shown'}
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
              <Tooltip trigger={tooltipTrigger} content={<ChartTooltip seriesMeta={seriesMeta} />} />
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
                        { ...dotGeometry(pres.lineWidth), hideFinal: pres.markers === 'provisionalOnly' },
                        chartLang,
                      )}
                      isAnimationActive={false}
                    />
                  );
                })}
            </LineChart>
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
              {/* Recharts' own default grid + axis geometry (session 87: the
                * "basic Recharts look") in theme colours (AXIS_COLOR/GRID_COLOR:
                * dark mode); only the honesty-bound custom ticks and labels
                * below are ours. WP218: grid/axis props mirror the line
                * branch above; the Y domain stays unconditionally zero-based
                * here (bar honesty rule, never overridden by zeroBaseline). */}
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
                axisLine={pres.axisLines === 'shown'}
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
              <Tooltip trigger={tooltipTrigger} content={<ChartTooltip seriesMeta={seriesMeta} />} />
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
                      )}
                    />
                  );
                })}
            </BarChart>
          )}
        </ResponsiveContainer>
        )}
      </div>
      )}
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
            onClick={() => setSmallMultiples((v) => !v)}
            className={tabClass(smallMultiples)}
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
        {state.form !== 'table' && !smallMultiples ? (
          <ChartDownloadMenu
            containerRef={chartContainerRef}
            attributionText={`${displayAttributionLine} checkdecijfers.nl${viewDisclosure}`}
            filenameBase={`checkdecijfers-${spec.attribution.tableId}`}
            lang={chartLang}
          />
        ) : null}
      </div>
    </div>
  );
}
