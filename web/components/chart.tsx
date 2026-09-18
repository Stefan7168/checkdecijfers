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

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import dynamic from 'next/dynamic';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  DefaultZIndexes,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useXAxisTicks,
  useYAxisScale,
  XAxis,
  YAxis,
  ZIndexLayer,
} from 'recharts';
import type { ChartPoint, ChartSpec } from '../backend/chart/types.ts';
import {
  CHART_MIN_HEIGHT_PX,
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
import type { ChartPresentation, MarkerMode, PresentationOverrides, SeriesEndpoints } from '../lib/chart-presentation.ts';
import { useElementWidth } from '../lib/use-element-width.ts';
import { useChartStyle } from '../lib/chart-style-context.tsx';
import { trackChartStyleEvent } from '../lib/chart-usage-client.ts';
import { templateById } from '../lib/chart-templates.ts';
import { lastPlottedPoint } from '../lib/chart-plotted-point.ts';
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
// Journalist chart-headline (session 105): own tiny-import-graph file,
// mirroring chart-insights-actions.ts / chart-style-actions.ts above.
import { draftChartHeadline, fetchChartHeadline, saveChartHeadline } from '../app/chart-headline-actions.ts';
// Final-review fix (Finding 3, minor): import the shared cap + the
// word-boundary-safe truncation from the store module rather than a
// hardcoded `140` literal and a second, independently re-implemented
// truncation — so the client-side optimistic update can never drift from
// what normalizeHeadlineText would actually store server-side.
import { CHART_HEADLINE_MAX_LENGTH, normalizeHeadlineText } from '../backend/chart/headline-store.ts';
import { Pencil } from 'lucide-react';
import { Button } from './ui/button.tsx';
// Chart co-pilot phase 1 (session 112, ADR 056): one command vocabulary,
// one history. Every READER edit below goes through `dispatchCommand`; the
// app moving the view itself (story steps, stage mode, the spec-swap reset,
// the embed `?form=` seed) goes through `dispatchRaw` and is never undoable.
import { CHART_CAPTION_MAX_LENGTH, CHART_TITLE_MAX_LENGTH, initialDocState, newCommandId } from '../lib/chart-commands.ts';
import { useChartHistory } from '../lib/use-chart-history.ts';
import { useChartEdits } from '../lib/use-chart-edits.ts';
import { ChartHistoryActions } from './chart-history-actions.tsx';
import { ChartEditableText } from './chart-editable-text.tsx';
import { ensureFontLoaded } from '../lib/font-loader.ts';
import { ChartConfigTrigger } from './chart-config-trigger.tsx';
// Co-pilot phase 2 (session 113 Task 5): the legend moved to its own file so
// the own-data card renders the SAME one — a pure move, no behaviour change.
import { SeriesLegend } from './chart-series-legend.tsx';
import { ChartFrame } from './chart-frame.tsx';
import { ChartDownloadMenu } from './chart-download.tsx';
import { APP_URL, ChartEmbedButton } from './chart-embed-dialog.tsx';
import { buildFindings } from '../lib/chart-insights.ts';
import { headlineFigure } from '../lib/chart-headline.ts';
import type { StoryStep } from '../lib/chart-story.ts';
import { ChartStoryTrigger } from './chart-story-trigger.tsx';
import { ChartStoryPanel } from './chart-story.tsx';
import type { PendingPoint } from './chart-notes.tsx';
import { ChartSmallMultiples } from './chart-small-multiples.tsx';
import { SourceBadge } from './source-badge.tsx';
import { Skeleton } from './ui/skeleton.tsx';
// Session 110 UX audit pass 4, row 6: `resolveSourceForTable`'s
// `nullReasonLabels` is the ALREADY owner-approved CBS/Eurostat-attribute →
// Dutch map (src/sources/registry.ts, also driving the answer body's
// `nullReasonText`, src/answer/compose/template.ts) — reused here rather
// than inventing a second, competing translation, and safe to import into
// this client bundle because sources/registry.ts is documented there as a
// pure leaf with no adapter-graph pull. See `humanizeNullNote` below.
import { resolveSourceForTable } from '../backend/sources/registry.ts';
import {
  activeReadingSpec,
  areaFormAllowed,
  // #229 (ADR 041 addendum): the >15-series default-form constant/predicate
  // now live canonically in chart-view-state.ts (not here) — see that
  // file's own comment for why (chart-embed-dialog.tsx needs the same
  // predicate and would otherwise create an import cycle). Re-exported below
  // so every existing `import { BAR_LABEL_MAX } from './chart.tsx'` call
  // site (chart.test.tsx) keeps working unchanged.
  BAR_LABEL_MAX,
  defaultFormFor,
  defaultFormIsTable,
  fallbackForm,
  // Session 110 pass 3 row 3: the hbar row-height floor — see its own
  // comment in chart-view-state.ts.
  hbarChartHeight,
  hbarFormAllowed,
  // Session 110 pass 3 row 11: which specs get a single palette colour for
  // every series — see the `colorFor` comment below.
  isComparisonShaped,
  lineFormAllowed,
  windowSpec,
  type ChartForm,
  type ChartViewState,
} from '../lib/chart-view-state.ts';

export { BAR_LABEL_MAX };

// Lazy-load applied (session 110, second attempt — docs/session-briefs/
// 2026-09-13-build-performance-diagnosis.md, "Landing bundle" section): the
// five interaction-only pieces below (the Style modal + panel, the Insights
// story panel + full-screen stage, and the click-to-annotate notes editor)
// are never needed for a chart's first paint — every one of them is either
// gated behind an explicit trigger click (Style, Insights/Present) or is
// itself a no-op until the reader clicks a point (Notes) or opens Insights
// (Story). `ssr: false` keeps them off the server-render path entirely (the
// gallery's own chart SVG — Recharts, `ChartView`'s own JSX below — stays a
// plain, statically-imported, server-rendered import; ONLY these five move).
//
// The trigger buttons themselves (ChartConfigTrigger, ChartStoryTrigger,
// imported above) had to move into their OWN tiny files
// (chart-config-trigger.tsx, chart-story-trigger.tsx) first: a static
// import of ANY binding from a module pulls the whole module — trigger
// button and 1900-line panel alike — into this file's chunk, which would
// silently defeat the split below. With the triggers gone, chart.tsx now
// holds zero static import edges into chart-config-panel.tsx,
// chart-edit-modal.tsx, chart-story-stage.tsx or
// chart-notes.tsx — only the dynamic() calls below reference them, each
// becoming its own on-demand chunk.
//
// Loading-fallback choice: all five of these are mounted UNCONDITIONALLY
// wherever the JSX below places them (gated only on things like
// `state.form !== 'table'` or `storyAvailable`, never on the open/closed
// state itself) and each already returns `null` internally whenever its own
// `open`/`pendingPoint` prop says there's nothing to show — that's how a
// closed Style modal or an un-clicked Notes editor renders nothing today.
// A dynamic() `loading` fallback is shown purely because the CHUNK hasn't
// arrived yet, before that internal open-check ever runs — so for
// ChartEditModal, ChartStoryPanel, ChartStoryStage and ChartNotes, `loading:
// () => null` is not a placeholder cop-out, it is the ONLY choice that
// exactly reproduces today's default (closed) appearance instead of
// introducing a brand-new flash of visible content on charts nobody has
// interacted with yet. ChartConfigPanel is the one exception: it is only
// ever reached once its parent ChartEditModal has already loaded AND is
// open (see the mount site further down), so a reader is already looking
// at an open, empty-on-the-right modal at that point — a tiny, digit-free
// Skeleton there is a real improvement over a blank pane, with no risk of
// flashing on a chart the reader hasn't touched.
const ChartEditModal = dynamic(() => import('./chart-edit-modal.tsx').then((m) => m.ChartEditModal), {
  ssr: false,
  loading: () => null,
});
const ChartConfigPanel = dynamic(() => import('./chart-config-panel.tsx').then((m) => m.ChartConfigPanel), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full rounded-lg" />,
});
// ChartStoryPanel stays a STATIC import (parent decision, session 110): the
// landing's first gallery card pre-opens it (`initialPanel="story"`), so a
// lazy chunk would drop the insights text from the server HTML and add a
// layout shift on every landing view — the one place a first paint needs it.
// It is 300 lines; the ~1900-line style panel, the modal, the stage and the
// notes editor are the weight, and those stay dynamic.
const ChartStoryStage = dynamic(() => import('./chart-story-stage.tsx').then((m) => m.ChartStoryStage), {
  ssr: false,
  loading: () => null,
});
const ChartNotes = dynamic(() => import('./chart-notes.tsx').then((m) => m.ChartNotes), {
  ssr: false,
  loading: () => null,
});

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
/** Session 110 UX audit pass 3, row 10: which rows of an hbar chart carry a
 * value label. 'all' (the pre-existing rule, <= BAR_LABEL_MAX plotted rows)
 * labels every row; 'extremesOnly' (> BAR_LABEL_MAX) labels only the first
 * and last PLOTTED row so the chart is never left with zero numbers; 'none'
 * is the pre-existing empty case (no plotted rows at all). */
type HbarLabelMode = 'all' | 'extremesOnly' | 'none';

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

/** Task 3 (Story-stage plan, ADR 044): stage mode's legend — the same
 * swatch/label pairing as `SeriesLegend` above, but plain `<span>` chips with
 * no `aria-pressed`, no handlers, no highlight button: the stage offers no
 * hide/highlight controls, so nothing here is interactive. */
function StageLegend({ seriesMeta, lang }: { seriesMeta: SeriesMeta[]; lang: Lang }) {
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
interface EndLabelSpec {
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
function EndLabelsOverlay({ specs }: { specs: EndLabelSpec[] }) {
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
function humanizeNullNote(note: string, tableId: string): string {
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

export function ChartView({
  spec,
  alternates = [],
  frameless = false,
  embed,
  embedMode = false,
  embedFooter,
  headlineText,
  initialFormOverride,
  stage,
  initialPresentation,
  initialPanel,
}: {
  spec: ChartSpec;
  /** #254: every registry-recorded ALTERNATE READING of the same answered
   * measure, each already built server-side by the same deterministic
   * pipeline as `spec` and over the PRIMARY's own resolved coordinates and
   * the identical period window (src/chart/alternate-reading.ts). The
   * reading control below switches which of these the chart draws its DATA
   * from; `spec` itself — and therefore the spec-identity reset block above
   * — is never touched by that switch, so a reading swap is a lightweight
   * view tweak (like Lijn→Staaf), not a new chart. Defaulted to `[]`, so
   * every call site that passes no alternates renders exactly as before
   * this feature existed. */
  alternates?: { label: string; spec: ChartSpec }[];
  /** Session 87 (purely presentational): drop the component's own card frame
   * when the mount point already IS a card (the visual dock) — a card inside a
   * card is the one thing the shadcn direction says not to do. Inline in the
   * conversation and on Ontdek the frame stays. */
  frameless?: boolean;
  /** Spec Part B1: when present, the card footer shows an Embed button next
   * to Download for THIS answer's own audit row. Never combine with
   * embedMode=true (the public embed page never re-offers its own embed
   * button) — ChartEmbedButton's own render guard enforces this too. */
  embed?: { auditId: number };
  /** Spec Part B3: true ONLY for the /embed/[token] public route's own
   * render. Strips the Weergave tablist, the Opmaak/Verhaal (Style/Story)
   * triggers, the zoom selects, the small-multiples toggle, the
   * click-to-annotate affordance, Download and Embed, replacing them with
   * `embedFooter`. The chart, its title/unit, the R4 attribution line and
   * SourceBadge are UNCHANGED — and SeriesLegend's hide/highlight buttons
   * intentionally STAY interactive (a reading aid; the spec only bars the
   * embed URL from ENCODING a hide/highlight selection, not disabling one
   * during viewing). An embed is the same honest card, minus the controls
   * a third-party page has no business exposing. */
  embedMode?: boolean;
  /** Spec Part B3: the embed page's own footer sentence, built by the
   * ROUTE (it alone knows frozen-vs-live and the relevant date) — e.g.
   * "Frozen on 10 September 2026 ·" or "Live · data as of 26 August
   * 2026 ·". ChartView appends the checkdecijfers.nl backlink itself, so
   * every embed footer has byte-identical link markup. Ignored unless
   * embedMode is true. */
  embedFooter?: string;
  /** Journalist chart-headline (Task 6): a server-resolved headline for the
   * /embed/[token] public page (Task 7 resolves it once, server-side, and
   * hands it in). `undefined` (the chat context — every other call site)
   * means "not yet known": ChartView fetches it lazily itself via
   * fetchChartHeadline, but only when `embed.auditId` is present (an
   * unsaved/anonymous chart has nothing to fetch). `null` means "known and
   * there isn't one yet" — distinct from "not yet known". */
  headlineText?: string | null;
  /** Fix round (Task 5 review, Piece 3): a one-shot override for the
   * INITIAL form, set only by the /embed/[token] route (its own `?form=`,
   * already emitted by Task 4's embed dialog for "As shown" but never wired
   * anywhere until now) — honours the reader's own on-screen form at the
   * moment they generated the embed code. Applied once, on mount, and ONLY
   * when the spec's own lineFormAllowed/areaFormAllowed/hbarFormAllowed
   * guards allow it — an invalid request (e.g. `hbar` on a non-comparison
   * spec) is silently ignored, same as every other stale/disallowed-form
   * fallback in this file; it never forces a form the honesty rules forbid.
   * A new, independent, additive prop — deliberately does not touch any of
   * the six embedMode gating sites elsewhere in this component (those hide
   * CONTROLS; this only ever seeds the initial VALUE those controls would
   * otherwise start from). Ignored (no effect at all) when absent. */
  initialFormOverride?: ChartForm;
  /** Task 3 (ADR 044): when present, this instance renders in stage mode —
   * chrome-less (no tablist/triggers/selects/toggles/panels/notes/legend
   * buttons/download), driven purely by `stage.step`, wearing
   * `stage.overrides` instead of the reader's own per-chart tweaks. See
   * `ChartStageMode` above. */
  stage?: ChartStageMode;
  /** #237/ADR 046: the chart's initial per-chart presentation overrides —
   * e.g. a gallery story's template (`templateById(look).overrides`) — so it
   * mounts already wearing that look. "Standaard" (`onReset`) still clears
   * to `{}` exactly as before; only the SPEC-SWAP reset path (a fresh spec
   * on this same mounted instance) falls back to this value instead of `{}`
   * when it is provided. Omitted everywhere else in the app — behaviour
   * there is unchanged. */
  initialPresentation?: PresentationOverrides;
  /** #237/ADR 046: mount with a panel already open. Only 'story' exists
   * today — opens the Insights panel at step 0, as if the reader had
   * clicked its trigger, so a gallery story shows its caption without an
   * extra click. Applied once, on mount, never re-applied on a later spec
   * swap. */
  initialPanel?: 'story';
}) {
  // Stage mode (Task 3, ADR 044): a single `inStage` boolean gates every
  // piece of chat-chart chrome below (one `!inStage`/`inStage` check per
  // site, no per-gate comment) — the stage renders the same spec through
  // the same component, minus every control a full-screen, step-driven view
  // has no use for. See `ChartStageMode` above for what stage mode is.
  const inStage = stage !== undefined;
  const chartContainerRef = useRef<HTMLDivElement>(null);
  // Chart-card polish (2026-09-15): p-5 / sm:p-6 (was p-4) — the reference card the owner compared against breathes; the dock keeps its own p-4 (visual-dock.tsx), a narrow side panel.
  // Row 10/#p2-10 recheck (session 110 UX audit pass 5, PARTIAL): making
  // the chart's own height frame-relative (embedHeightValue above) was not
  // enough at 320x240 — the title/headline/reading-select chrome ABOVE the
  // chart still pushed its top past the fold. Below a `max-height: 300px`
  // frame (a small embed sidebar unit, never triggered by an ordinary
  // in-app card), embedMode switches this wrapper to a flex column so the
  // `order-*` utilities below can push the reading select (chart-controls-
  // embed) to the end — after the chart — while everything else keeps its
  // default order. Never applied outside embedMode; a non-embed card is
  // never flex here regardless of viewport height.
  const embedCompactClass = embedMode ? '[@media(max-height:300px)]:flex [@media(max-height:300px)]:flex-col' : '';
  const frameClass = `${frameless || inStage ? '' : 'mt-3 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6'} ${embedCompactClass}`.trim();
  const rawId = useId();
  const domId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const coarsePointer = useCoarsePointer();
  // #197 step 2: chart or table. A comparison with more bars than the chart
  // can label opens on the table — the idea bank's >15-categories rule, the
  // honest view for many series — UNLESS it is a many-region comparison
  // that still fits readably as a horizontal bar (session 110,
  // defaultFormFor's own COMPARISON_HBAR_MAX carve-out).
  // Fix round 2 (item 10): the >15-series table rule is a CHAT-chart rule.
  // The stage has no form tabs, so a many-series story that opened on the
  // table showed a presentation with no chart in it at all — no highlight,
  // no ring, no spotlight, nothing for a step to drive. In stage mode the
  // spec's own kind always wins.
  const initialForm = inStage ? spec.kind : defaultFormFor(spec);
  const {
    state,
    history,
    canUndo,
    canRedo,
    dispatch: dispatchCommand,
    dispatchRaw,
    undo,
    redo,
    seal: sealHistory,
    replace: replaceHistory,
  } = useChartHistory(initialDocState(initialForm, initialPresentation));
  // #254: WHICH reading's data the chart draws — the primary `spec` prop, or
  // one of `alternates`. Computed here, above every derivation that reads
  // series/cell VALUES, so one substitution (`viewSpec` below, plus the
  // handful of per-reading FACTS listed at their own call sites) covers the
  // whole card.
  //
  // The single most important property of this line: `spec` itself is NOT
  // reassigned and `specIdentity` (further down) keeps hashing the PROP.
  // Routing a reading switch through the `spec` prop instead — e.g. a wrapper
  // swapping which object it hands in — would trip that block's reset and
  // wipe the reader's form, zoom, presentation, notes and open panels on
  // every toggle. A reading switch is a view tweak of the same weight as
  // Lijn→Staaf; only a genuinely DIFFERENT chart resets (and its `reset`
  // action clears `selectedReading` back to the primary, which is correct:
  // the new chart's alternates are a different set).
  //
  // Identity-shaped reads deliberately stay on `spec`: the form guards
  // (canUseLine/canUseArea/canUseHbar/effectiveKind — the chart's TRUE
  // shape), `allPeriodCodes`/`zoomAvailable`/the Vanaf-Tot options and the
  // zoom disclosure's covered range (every alternate is built over the
  // identical window, so switching reading must never change what periods
  // are selectable), and the embed button's table id (an embed republishes
  // the stored PRIMARY answer, which carries no reading selection).
  const activeSpec = activeReadingSpec(spec, alternates, state.selectedReading);
  // Fix round (Task 5 review, Piece 3): applies `initialFormOverride` exactly
  // once, on mount — never on a later spec swap (that's the `specIdentity`
  // block further down, and `reset` there deliberately preserves state.form
  // instead of re-reading this prop, so a reader's own subsequent tab choice
  // is never clobbered by a stale query-string value). Guarded by the SAME
  // allow functions the tablist below uses, so this can never render a form
  // the honesty rules forbid for this spec.
  useEffect(() => {
    if (initialFormOverride === undefined) return;
    const allowed =
      initialFormOverride === 'line'
        ? lineFormAllowed(spec, spec.series.length)
        : initialFormOverride === 'area'
          ? areaFormAllowed(spec, spec.series.length)
          : initialFormOverride === 'hbar'
            ? hbarFormAllowed(spec)
            : true; // 'bar' and 'table' are never gated (fallbackForm's own convention, chart-view-state.ts).
    if (allowed) dispatchRaw({ type: 'setForm', form: initialFormOverride });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once-on-mount only: initialFormOverride is a one-shot prop from the embed route, never expected to change on a live instance, and a later spec swap is this component's own `reset` action's job (below), not this effect re-firing.
  }, []);
  const lineTabRef = useRef<HTMLButtonElement>(null);
  const areaTabRef = useRef<HTMLButtonElement>(null);
  const barTabRef = useRef<HTMLButtonElement>(null);
  const hbarTabRef = useRef<HTMLButtonElement>(null);
  const tableTabRef = useRef<HTMLButtonElement>(null);

  const [smallMultiples, setSmallMultiples] = useState(false);
  const [axisMode, setAxisMode] = useState<'shared' | 'own'>('shared');

  // Task 6 (#212 click-to-annotate): session-only — never persisted, never
  // sent anywhere, never touches ChartSpec or the audit record. The notes
  // themselves now live in the command history's doc state (`state.notes`,
  // co-pilot phase 1) so adding/removing one is undoable like every other
  // reader edit; the PENDING click (an editor that is merely open) is not an
  // edit at all and stays plain component state. Both are reset by the same
  // specIdentity guard below — a new chart's clicks must not carry over
  // another chart's notes.
  const [pendingPoint, setPendingPoint] = useState<PendingPoint | null>(null);

  // Task 5 (co-pilot phase 1, ADR 056): the reader's own title and caption.
  // The VALUES live in the command document (`state.title` / `state.caption`,
  // undoable like every other edit); only "is an editor open, and what is
  // typed in it so far" is plain component state, the same split as
  // `pendingPoint` above. `titleCancelledRef` lets Escape close the title
  // editor without the unmount-time blur committing the draft behind it (the
  // caption editor commits on Save only, so it needs no such guard).
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleCancelledRef = useRef(false);

  // Journalist chart-headline (Task 6): named `chartHeadline`, deliberately
  // NOT `headline` — that identifier is already taken below by
  // `headlineFigure`'s result (the big NUMBER a chart leads with, an
  // unrelated feature). This is the sentence headline a reader can draft,
  // edit and save.
  const [chartHeadline, setChartHeadline] = useState<string | null>(headlineText ?? null);
  const [headlineEditing, setHeadlineEditing] = useState(false);
  const [headlineDraftText, setHeadlineDraftText] = useState('');
  const [headlineBusy, setHeadlineBusy] = useState(false);
  const [headlineError, setHeadlineError] = useState<string | null>(null);

  // Lazy fetch-on-mount for the chat context only: the embed page already
  // resolved `headlineText` server-side (undefined means "not yet known"
  // here, never "known absent" — that's `null`), and there's nothing to
  // fetch without a saved audit row to key off of.
  useEffect(() => {
    if (headlineText !== undefined) return;
    if (embed?.auditId === undefined) return;
    let cancelled = false;
    void fetchChartHeadline(embed.auditId).then((result) => {
      if (!cancelled && result.ok) setChartHeadline(result.headline);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mounted chart, keyed by auditId identity below
  }, [embed?.auditId]);

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
  const [openPanel, setOpenPanel] = useState<'style' | 'story' | 'embed' | null>(null);
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
  // Task 3 (chart-visual-embed-pass plan): Embed shares the same discriminated
  // `openPanel` slot as Style/Story. Review fix: opening Embed while a story
  // is showing must restore the reader's own snapshot FIRST (closeStory) —
  // the same guard `toggleStylePanel` and `selectForm` already apply before
  // ever landing on a non-story `openPanel` value — otherwise the snapshot
  // taken by `openStory` is never restored or cleared (it is only ever
  // consumed by `closeStory`), silently stranding it. `closeStory` is a
  // function declaration further down this component, so JS hoists it
  // before this component body runs — calling it here, ahead of its own
  // textual definition, is safe (same reasoning as `setStyleOpen` above).
  const embedOpen = openPanel === 'embed';
  const setEmbedOpen = (open: boolean): void => {
    if (open && openPanel === 'story') closeStory();
    setOpenPanel(open ? 'embed' : null);
  };
  // Review fix (spec Part B3): hoisted once so every SeriesDot/SeriesBar/
  // RegionBar call site shares the SAME handler, rather than each of the
  // four sites re-deriving its own `embedMode ? undefined : ...` ternary.
  // A truthy onPointClick is what makes those components render
  // role="button"/tabIndex/the note aria-label/a pointer cursor (see each
  // function's own ternaries) — undefined here removes all of that at
  // once. Without this, embedMode still left every chart point a
  // focusable, ARIA-labeled phantom control with nothing to open, since
  // ChartNotes (the panel, gated below) is a different thing from the
  // per-point click/focus affordance built into the markers themselves.
  // Task 3 (ADR 044): also undefined in stage mode — the full-viewport
  // stage is a step-driven presentation surface, not a note-taking one.
  // Task 3 (chart-visual-embed-pass, review fix): also undefined while the
  // Embed preview is open — the same "read-only preview" reasoning as
  // notesNode's own `!embedMode` gate below, just applied to the OTHER
  // "read-only preview" surface this file now has. Without this, clicking a
  // point inside the embed modal's chart set `pendingPoint` as if starting a
  // note, but the note composer (`notesNode`) is deliberately not rendered
  // there, so the click silently did nothing visible until the dialog closed
  // and the stale pending point's composer appeared back in the dock —
  // confusing, and the composer is not the right fix (an embed preview is
  // meant to show exactly what gets published, not double as a scratchpad).
  // Declared here (after `embedOpen`, not up by `pendingPoint` where it used
  // to live) purely because `embedOpen` is derived from `openPanel`, which
  // isn't in scope any earlier in this component.
  const onPointClick = embedMode || inStage || embedOpen ? undefined : (p: PendingPoint) => setPendingPoint(p);
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
  // Final-review finding I1: closing the Style panel ENDS the gesture. The
  // colour picker's blur is the only other seal, and the browser skips it
  // when the panel (a portaled modal) unmounts under the cursor — leaving the
  // drag merged-and-open, so the reader's very next colour tweak would fold
  // into the same undo step. Sealing here is idempotent (`seal` returns the
  // same history when the top entry is already sealed, and the hook then
  // keeps the same snapshot), so the mount pass costs nothing.
  useEffect(() => {
    if (!styleOpen) sealHistory();
  }, [styleOpen, sealHistory]);
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
  // Task 5 (Story-stage plan): whether the full-viewport Story stage
  // (ChartStoryStage) is open — a separate boolean from `openPanel`/
  // `storyOpen` because the compact panel stays open (and its index shared)
  // while the stage is up; declared here, above the schemaVersion guard,
  // like every other Hook in this component.
  const [stageOpen, setStageOpen] = useState(false);
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
    // Raw, never a command: a genuinely different chart is not a reader
    // edit — `dispatchRaw`'s own `reset` branch empties the history too, so
    // the new chart starts with nothing to undo (and no way to "undo" into
    // the previous chart's view). It also clears `state.notes`, which is
    // why the old `setNotes([])` line is gone from this block.
    dispatchRaw({ type: 'reset', initialForm: state.form, initialPresentation });
    setSmallMultiples(false);
    setAxisMode('shared');
    setPendingPoint(null);
    // Task 5: a different chart is a different title/caption — `reset`
    // already clears the stored values, so any open editor must close too
    // rather than commit the previous chart's draft onto the new one. The
    // caption's editor now lives inside ChartEditableText, which the
    // `key={chartEpoch}` at its mount below remounts for exactly this.
    setTitleEditing(false);
    setOpenPanel(null);
    setStoryIndex(0);
    setStageOpen(false);
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
  // #254: the ACTIVE reading's own points — a reading whose cells are
  // provisional must get the honesty-locked hollow-marker defaults even when
  // the primary's are all final (and vice versa). `kind`/`seriesCount` below
  // stay on `spec`: those are the chart's SHAPE, which every alternate
  // shares by construction and which `activeForm`/`canUseLine` above already
  // derive from the primary.
  const hasProvisional = activeSpec.series.some((s) => s.points.some((p) => p.provisional));
  // WP218 phase 2 (owner C): the signed-in account's saved style is the
  // `base` every chart resolves ON TOP OF — `withAccountDefault` degrades
  // anything invalid/absent to the stock look, so a logged-out visitor
  // (useChartStyle()'s no-provider default) or an account with no saved
  // default both resolve exactly as before this task. Per-chart overrides
  // (`state.presentation`) still win over the account default (owner E is
  // untouched: a spec swap resets `state.presentation` to `{}` — or to
  // `initialPresentation` when the chart was given one, #237/ADR 046 — never
  // to `accountStyle`, so "Standaard" and a fresh chart both fall back to
  // THIS base, not stock).
  const { accountStyle, signedIn, setAccountStyle, brandLookupAvailable } = useChartStyle();

  // Task 7 (co-pilot phase 1, ADR 056, #274): the reader's command log,
  // saved per account against the chart's own audit row and replayed when
  // they come back to it. The hydrate/save mechanism itself — and every
  // review finding behind it — lives in `useChartEdits` (session 113
  // Task 4), shared verbatim with the own-data card.
  //
  // ONE key decides whether this feature is live at all for this card: a
  // signed-in, in-app chat card with a saved answer behind it. Never in embed
  // mode (a published card is read-only and its viewer is not the author),
  // never in the stage (a story presentation drives the view itself), never
  // signed out (there is no account to key a row off), never without an
  // audit id (nothing to key on at all — a gallery/preview chart).
  const editsKey = !embedMode && !inStage && signedIn && embed?.auditId !== undefined ? embed.auditId : null;
  useChartEdits({
    editsKey: editsKey === null ? null : { kind: 'answer', id: editsKey },
    history,
    replaceHistory,
    ctx: { spec, alternatesCount: alternates.length },
    initial: initialDocState(initialForm, initialPresentation),
  });

  const base = withAccountDefault(accountStyle);
  const resolved = resolvePresentation(
    { kind: spec.kind, form: activeForm, seriesCount: spec.series.length, hasProvisional },
    inStage ? stage.overrides : state.presentation,
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
  const widthHeightPx = autoHeight && measuredWidth > 0 ? chartHeightForWidth(measuredWidth) : null;
  // Session 110 pass 3 row 3: the hbar form draws one category (region) row
  // per series at a roughly fixed pitch, so a chart height that only
  // follows the card's WIDTH leaves that pitch shrinking as more regions
  // are added — the exact collision the session-110 UX audit found at 26
  // gemeenten (row 3). `hbarChartHeight` only ever GROWS whatever the
  // width-based rule already produced (or its unmeasured 256px floor), so a
  // comparison with few regions is unaffected; every other form (bar, line,
  // area) passes straight through as `widthHeightPx`, completely unchanged.
  // Deliberately keyed on the unmeasured 256px floor too (not only once
  // `widthHeightPx` is non-null) so a many-region hbar chart never flashes
  // a cramped default height for one paint before the first
  // ResizeObserver callback lands.
  const autoHeightPx = !autoHeight
    ? null
    : activeForm === 'hbar'
      ? hbarChartHeight(spec.series.length, widthHeightPx ?? CHART_MIN_HEIGHT_PX)
      : widthHeightPx;
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
  // Stage mode (Task 3, ADR 044): the stage's own view state (highlight,
  // never hidden/zoomed) follows the given step directly — no reducer
  // action from any control, since stage mode offers none. Must run
  // unconditionally, same reason as the font Effect above it: ABOVE the
  // schemaVersion guard below. Re-runs on spec swap because step ids
  // repeat across specs (e.g. 'overview', 'high-s0'), so the step Effect
  // must re-fire to re-apply the highlight when a mounted stage instance
  // receives a new spec (whose `reset` clears the highlight).
  useEffect(() => {
    if (stage) {
      dispatchRaw({ type: 'setView', view: { hiddenKeys: new Set(), highlightedKey: stage.step?.highlight ?? null, periodRange: null } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage?.step?.id, specIdentity]);
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
  // #254: the ACTIVE reading — every Insights caption quotes plotted numbers,
  // so findings built from the primary while an alternate is on screen would
  // put digits on the card that no rendered cell backs (R1/R6).
  const findings = useMemo(
    () => buildFindings(translateSpecForDisplay(activeSpec, chartLang), chartLang),
    [activeSpec, chartLang],
  );
  // The AI-phrased upgrade, keyed by finding id — null until openStory's
  // generateInsights call resolves (or is never attempted, or fails). Reset
  // whenever `findings` itself changes (a new spec/language means the old
  // phrasing no longer applies to anything on screen). A finding id absent
  // from this map simply keeps its own deterministic caption below — never
  // an error state, never a loading placeholder that could read as "no
  // number" (R3): the panel is always complete from the first open.
  const [phrasedCaptions, setPhrasedCaptions] = useState<Map<string, string> | null>(null);
  // R5.3 (journey WP-C): true once a `generateInsights` call comes back
  // `{ ok: false, reason: 'unauthenticated' }` — an anonymous visitor
  // opened Insights. Reset alongside `phrasedCaptions` on a findings change
  // so a signed-out visitor who logs in and reopens a fresh chart doesn't
  // keep seeing a stale login line.
  const [insightsUnauthenticated, setInsightsUnauthenticated] = useState(false);
  useEffect(() => {
    setPhrasedCaptions(null);
    setInsightsUnauthenticated(false);
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
  // `viewSpec`; every IDENTITY read (spec.kind, spec.title, spec.unit) stays
  // on the raw `spec`. (#254 refines this: the window is now applied to
  // `activeSpec`, and the per-reading FACTS — attribution, dimLabels,
  // definitionLine, provisionalNote, nullNotes, trendHeadline — follow the
  // active reading too, since they describe the cells actually plotted. What
  // stays on the primary is listed at `activeSpec`'s own declaration above.)
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
  // #254: `allPeriodCodes`/`periodLabelByCode`/`zoomAvailable` above stay on
  // the PRIMARY `spec` on purpose — every alternate reading is built over the
  // identical period window, so what is SELECTABLE must not shift under the
  // reader when they switch reading. What is PLOTTED does: the window is
  // applied to `activeSpec`, and `displaySpec` below (hence buildRows,
  // annotationMarkers, valueLabelPlan, tableModel, buildRegionRows, the
  // headline figure, the end/axis labels and the accessible name) follows it.
  const viewSpec = zoomAvailable ? windowSpec(activeSpec, state.periodRange) : activeSpec;
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
  // #254: the ACTIVE reading's own R4 sentence — it names the table, version
  // and sync date the numbers on screen actually came from, which is a
  // per-reading fact (an alternate can live in another table entirely).
  const displayAttributionLine =
    chartLang === 'en' ? translateAttributionLine(activeSpec.attributionLine) : activeSpec.attributionLine;

  // WP218 (ADR 039) Phase 0: `pres` (canUseLine/activeForm/effectiveKind
  // included) is computed above, ahead of the schemaVersion guard — see the
  // comment there. `colorFor` feeds buildRows so every legend swatch,
  // tooltip swatch and hatch pattern reads the SAME effective colour.
  // Session 110 UX audit pass 3, row 11: a comparison-shaped `displaySpec`
  // (isComparisonShaped — every series one point, >= 2 series; a region-set
  // answer is the canonical example) passes `paletteIndex: 0` for every
  // series, so every un-overridden bar/row shares the palette's FIRST
  // colour instead of cycling through 8 and repeating from the 9th region
  // on — the region is the axis and the measure is the same, so colour was
  // never carrying information there. An explicit per-series `seriesColors`
  // override (the Style panel) still wins: `seriesColor` looks that up on
  // `i`, never on `paletteIndex` (see its own comment). A genuine time
  // series (any line/area, or a multi-point `kind: 'bar'`) is never
  // comparison-shaped and keeps the unchanged per-series cycling palette.
  const comparisonPalette = isComparisonShaped(displaySpec);
  const colorFor = (i: number) => seriesColor(pres, i, comparisonPalette ? 0 : i);
  const { rows, seriesMeta } = buildRows(displaySpec, colorFor);
  // #254: the ACTIVE reading's own pinned coordinates. This is the subtitle
  // that NAMES the reading (e.g. "SeizoensCorrectie: Niet gecorrigeerd") —
  // showing the primary's coordinates over an alternate's data would
  // mislabel every plotted cell.
  const dimEntries = Object.entries(activeSpec.dimLabels);
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
  // Chart-card polish (2026-09-15): the headline figure — the DISPLAYED
  // spec's last plotted point (single time series only; see
  // chart-headline.ts). Read from `displaySpec`, like the end label, so a
  // Vanaf/Tot window leads with its own last point and an English chart
  // shows the translated period/unit; the value/resultId fields are
  // untouched by translation (translateSpecForDisplay).
  const headline = headlineFigure(displaySpec);
  const tickByValue = new Map(plan.axisTicks.map((t) => [t.value, t]));
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
  // Session 110 UX audit pass 4, row 2: both margins used to cap at
  // absolute pixel ceilings (80px / 140px) regardless of the chart's own
  // measured width, so a narrow card (375px viewport, a sidebar, an embed)
  // could lose almost its entire plot area to them — measured at 211px
  // container width, a 6-region line chart's plot area was 20px wide and
  // no x-axis tick had room to render at all. Both caps now scale with the
  // MEASURED container width (`measuredWidth`, 0 until the first
  // ResizeObserver callback lands — see useElementWidth — in which case the
  // old absolute ceilings are kept as the best available fallback, exactly
  // what SSR/jsdom's unmeasured first paint already rendered before this
  // fix). When even the fraction-capped margins would leave less than
  // END_LABEL_MIN_PLOT_FRACTION of the container for the plot itself, the
  // end-of-line labels are the part that gives way — never the plot, never
  // the axis: `pres.valueLabels === 'shown'` below already gates them
  // behind a presentation choice, so dropping them here for width is the
  // same kind of "optional over essential" call, just width-driven.
  const Y_AXIS_WIDTH_MAX_FRACTION = 0.25;
  const RIGHT_MARGIN_MAX_FRACTION = 0.35;
  const END_LABEL_MIN_PLOT_FRACTION = 0.45;
  const yAxisWidthCap = measuredWidth > 0 ? Math.round(measuredWidth * Y_AXIS_WIDTH_MAX_FRACTION) : 80;
  const yAxisWidth =
    plan.axisTicks.length > 0
      ? Math.min(yAxisWidthCap, Math.max(24, labelWidthPx(plan.axisTicks.reduce((w, t) => (t.display.length > w.length ? t.display : w), ''))))
      : 16;
  // WP218: reserved x-axis height for tilted labels (xAxisHeight) needs the
  // longest label actually plotted — `rows`, never a re-derivation, so a
  // zoomed viewSpec's shorter label set reserves less height too. Moved
  // above the margin-fraction block (row 2) so `leftMargin` — the OTHER
  // horizontal reservation a real render makes, on top of `yAxisWidth` — is
  // known before deciding whether the end labels still fit.
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
  const rightMarginCap = measuredWidth > 0 ? Math.round(measuredWidth * RIGHT_MARGIN_MAX_FRACTION) : 140;
  const rightMarginForEndLabels =
    plan.endLabels.length > 0
      ? Math.min(rightMarginCap, plan.endLabels.reduce((w, l) => Math.max(w, labelWidthPx(l.text)), 0))
      : 8;
  // The real reservation a render makes on each side: `leftMargin` (outer
  // margin) plus `yAxisWidth` on the left, `rightMarginForEndLabels` (outer
  // margin) on the right — never approximated, so this decision matches
  // what actually gets drawn.
  const suppressEndLabels =
    measuredWidth > 0 &&
    plan.endLabels.length > 0 &&
    measuredWidth - leftMargin - yAxisWidth - rightMarginForEndLabels < measuredWidth * END_LABEL_MIN_PLOT_FRACTION;
  const rightMargin = suppressEndLabels ? 8 : rightMarginForEndLabels;
  // Session 110 UX audit pass 4 row 3: `EndLabelsOverlay` computes its own
  // pixel positions from Recharts' settled scales (see its doc comment
  // above), so it only needs each label's own VALUE and period LABEL
  // (looked up here from `rows`, the same period x series model the chart
  // itself renders from) plus the text/resultId `valueLabelPlan` already
  // built. Hidden series (no Line/Area rendered for them at all) and the
  // width-driven suppression above both drop out here, never inside the
  // overlay, so the overlay itself stays a pure "place what it's given"
  // renderer.
  // Row 14: mirrors valueLabelPlan's own "every last point shares one
  // period" check (≥2 endLabels, same periodCode) so EndLabelsOverlay knows
  // WHICH labels had their prefix dropped for that reason — never a
  // re-derivation of the VALUE, just of which of the plan's own labels
  // qualified, from the plan's own periodCode field.
  const sharedEndPeriodCode =
    plan.endLabels.length >= 2 && plan.endLabels.every((l) => l.periodCode === plan.endLabels[0]!.periodCode)
      ? plan.endLabels[0]!.periodCode
      : null;
  const endLabelSpecs: EndLabelSpec[] =
    pres.valueLabels === 'shown' && !suppressEndLabels
      ? plan.endLabels.flatMap((l) => {
          if (state.hiddenKeys.has(l.seriesKey)) return [];
          const row = rows.find((r) => r.periodCode === l.periodCode);
          const value = row?.[l.seriesKey];
          if (row == null || typeof value !== 'number') return [];
          return [
            {
              resultId: l.resultId,
              periodLabel: String(row.periodLabel),
              value,
              text: l.text,
              periodOmitted: l.periodCode === sharedEndPeriodCode,
            },
          ];
        })
      : [];
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
  const hbarPlottedRows = regionChartRowsAll.filter((r) => r.value !== null && r.value_display !== null);
  const hbarPlottedCount = hbarPlottedRows.length;
  // Session 110 UX audit pass 3, row 10 (decided by the parent session): a
  // 16-40-bar hbar (above BAR_LABEL_MAX, still within COMPARISON_HBAR_MAX)
  // kept "no invented ticks" (the x-axis draws no ticks by design, below)
  // AND the >BAR_LABEL_MAX thinning rule, leaving the chart with ZERO
  // numbers anywhere. Fix: keep both rules, but ALWAYS label the extremes —
  // the first and last PLOTTED row, in the spec's own order (R6: never
  // re-sorted here). When a ranking record sorted the series (ADR 054),
  // those are the ranking's top and bottom member; otherwise they are
  // simply the first/last rows. Computed over EVERY region
  // (regionChartRowsAll/hbarPlottedRows), matching hbarPlottedCount above,
  // so hiding a region can never change which rows are the labelled
  // extremes. The vertical bar form (SeriesBar/valueLabelPlan's barLabels)
  // keeps its OWN unchanged all-or-nothing rule — its labels sit ABOVE each
  // bar and collide horizontally as bars narrow; hbar rows have the
  // chart's full width to themselves, so two lone extreme labels never
  // collide with the unlabelled rows between them.
  const hbarLabelMode: HbarLabelMode =
    hbarPlottedCount === 0 ? 'none' : hbarPlottedCount <= BAR_LABEL_MAX ? 'all' : 'extremesOnly';
  const hbarExtremeKeys = new Set<string>(
    hbarPlottedRows.length > 0 ? [hbarPlottedRows[0]!.key, hbarPlottedRows[hbarPlottedRows.length - 1]!.key] : [],
  );
  const longestRegionLabel = regionChartRowsAll.reduce(
    (longest, r) => (r.label.length > longest.length ? r.label : longest),
    '',
  );
  const hbarYAxisWidth = Math.min(160, Math.max(48, labelWidthPx(longestRegionLabel)));
  const longestRegionValueText = regionChartRowsAll.reduce((longest, r) => {
    const text = `${r.value_display ?? ''}${r.value_provisional ? '*' : ''}`;
    return text.length > longest.length ? text : longest;
  }, '');
  const rightMarginForLabels = hbarLabelMode !== 'none' && longestRegionValueText ? labelWidthPx(longestRegionValueText) : 8;
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
    dispatchCommand({ kind: 'setForm', form: next }, 'panel');
    formTabRef[next].current?.focus();
  }

  /** Chart co-pilot phase 1 (session 112, ADR 056): ⌘Z / ⇧⌘Z (and the
   * Windows Ctrl+Z / Ctrl+Y) on the card itself. Never in embed or stage
   * mode — neither offers an edit to undo. A text field's OWN native undo
   * always wins inside an input/textarea/contenteditable.
   *
   * Fix round 1: ALSO inert while the story is open. Every other reader
   * control that could contradict the active step's caption is already
   * `disabled={storyOpen}` (the legend, the Vanaf/Tot selects, small
   * multiples) — an undo that silently put a hidden series back would walk
   * straight through that lock. (`storyOpen` is declared further down; this
   * is a function declaration, only ever called from an event handler after
   * the render that defines it, so there is no TDZ read here.) */
  function onHistoryKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (embedMode || inStage || storyOpen) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && event.shiftKey) {
      event.preventDefault();
      redo();
      return;
    }
    if (key === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if (key === 'y' && event.ctrlKey) {
      event.preventDefault();
      redo();
    }
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
  // Stage mode (Task 3, ADR 044): the stage has no story panel/index of its
  // own — the given step drives the ring directly, in place of the compact
  // Insights story's own active step.
  const ringStep: StoryStep | null = inStage ? stage.step : activeStoryStep;
  // Review fix (controller decision): while the story is open, every reader
  // view control that could contradict its active caption — the legend's
  // hide/highlight buttons, the Vanaf/Tot zoom selects, the small-multiples
  // toggle — gets disabled with ONE shared, digit-free reason exposed via
  // both `title` (pointer) and `aria-describedby` (screen reader), pointing
  // at the single hidden span rendered once near the panel below.
  const storyLockId = `${domId}-story-lock`;
  const storyLockedTitle = storyOpen ? t(chartLang, 'chart.story.controlsLocked') : undefined;

  // Task 5 (co-pilot phase 1): in-place title and caption editing.
  //
  // `titleEditable` mirrors every other reader control on this card: never in
  // embed mode (the published card is read-only) and never in the stage. The
  // story lock applies too — the same `disabled` / `title` /
  // `aria-describedby` trio the Undo button uses — because a retitle while a
  // step's caption is on screen would contradict it.
  const titleEditable = !embedMode && !inStage;
  /** What the heading shows: the reader's own title if they set one, the
   * (display-language) spec title otherwise. */
  const shownTitle = state.title ?? displaySpec.title;
  function startTitleEdit() {
    if (!titleEditable || storyOpen) return;
    titleCancelledRef.current = false;
    setTitleDraft(shownTitle);
    setTitleEditing(true);
  }
  function commitTitle() {
    // Final-review finding M4: the story lock covers the COMMIT too, not only
    // the buttons that open the editor — exactly like ChartEditableText's
    // own commit (the caption's, lifted out in session 113).
    // An editor already open when the story starts must not be able to write
    // a title through the lock (Enter, or the blur the story's own click
    // causes in a real browser).
    if (storyOpen) return;
    const trimmed = titleDraft.trim();
    // Only the reader's OWN words are ever stored: an empty box, or the spec
    // title typed back unchanged, means "no override" (null), never a copy of
    // CBS's measure name masquerading as a reader edit.
    const next = trimmed === '' || trimmed === displaySpec.title ? null : trimmed;
    // No history entry for a no-op — pressing Enter on an unchanged title
    // must not put a do-nothing step in the undo stack.
    if (next !== state.title) dispatchCommand({ kind: 'setTitle', title: next }, 'canvas');
    setTitleEditing(false);
  }
  function cancelTitleEdit() {
    titleCancelledRef.current = true;
    setTitleEditing(false);
  }

  // #237/ADR 046 fix-wave finding 1: `initialPanel="story"` auto-opens the
  // panel on mount via THIS function — unconditionally counting that as a
  // `story_open` would fire the site-wide `countChartStyleEvent` server
  // action (an unauthenticated DB write, `web/app/usage-actions.ts`) once
  // per gallery card per anonymous page view, inflating the owner's usage
  // counter with opens nobody clicked and doing exactly the per-card
  // server-action call this WP's zero-server-action-calls rule exists to
  // avoid. `track` defaults to true (every OTHER call site — the trigger
  // click, toggleStory — is a real reader action and keeps counting).
  function openStory(opts?: { track?: boolean }): void {
    storySnapshot.current = { hiddenKeys: state.hiddenKeys, highlightedKey: state.highlightedKey, periodRange: state.periodRange };
    // setView BEFORE setOpenPanel: so the first render of the OPEN story
    // already shows the first step's own highlight/full-range view, never a
    // stray frame with the reader's own state still showing.
    dispatchRaw({ type: 'setView', view: { hiddenKeys: new Set(), highlightedKey: storySteps[0]?.highlight ?? null, periodRange: null } });
    setStoryIndex(0);
    setOpenPanel('story');
    if (opts?.track !== false) trackChartStyleEvent('story_open');
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
      // #237/ADR 046: on a public page (ChartStyleContext's no-provider
      // default, `signedIn === false`) `generateInsights` would only ever
      // come back `{ ok: false, reason: 'unauthenticated' }` — a wasted
      // server-action round trip for a result already known ahead of time.
      // A gallery page mounts ~10 charts, so unconditionally firing this
      // would be ten anonymous server-action calls per page load, which is
      // exactly the cost this WP's zero-server-action-calls rule for public
      // pages exists to avoid. Set the same R5.3 honest line directly
      // instead; the deterministic captions still render underneath either
      // way.
      if (!signedIn) {
        setInsightsUnauthenticated(true);
      } else {
        // #254: the ACTIVE reading — `findings` (the ids this phrasing is
        // keyed by, and the numbers it re-words) are built from it too.
        void generateInsights(activeSpec).then((result) => {
          if (result.ok) setPhrasedCaptions(new Map(Object.entries(result.phrased)));
          // R5.3: an anonymous visitor gets one honest line in the panel
          // instead of a silently-failed phrasing attempt — the
          // deterministic captions still render underneath regardless.
          else if (result.reason === 'unauthenticated') setInsightsUnauthenticated(true);
        });
      }
    }
  }

  // #237/ADR 046: `initialPanel="story"` opens the Insights panel at step 0
  // on mount, as if the reader had clicked its trigger — the gallery's own
  // caption is this panel, never a separate copy. Guarded by a ref so it
  // fires ONCE per mounted instance, never again on a later spec swap (a
  // gallery page never swaps specs on a mounted ChartView, but the guard
  // costs nothing and keeps this honest for any future reuse).
  const openedInitialPanelRef = useRef(false);
  useEffect(() => {
    if (openedInitialPanelRef.current) return;
    if (initialPanel !== 'story' || !storyAvailable) return;
    openedInitialPanelRef.current = true;
    openStory({ track: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPanel, storyAvailable]);

  function closeStory(): void {
    const snapshot = storySnapshot.current;
    storySnapshot.current = null;
    if (snapshot) dispatchRaw({ type: 'setView', view: snapshot });
    setOpenPanel(null);
    // Task 5 (Story-stage plan): closing the compact story also closes the
    // stage — there is no "story closed, stage still up" state.
    setStageOpen(false);
  }

  function toggleStory(): void {
    if (storyOpen) closeStory();
    else openStory();
  }

  // Task 5 (Story-stage plan): the Present button (chart-story.tsx) opens
  // this. The stage shares `storyIndex`/`onStoryIndexChange` with the
  // compact panel — presenting never resets or forks the step.
  function openStage(): void {
    setStageOpen(true);
    trackChartStyleEvent('stage_open');
  }

  function closeStage(): void {
    setStageOpen(false);
  }

  function onStoryIndexChange(next: number): void {
    setStoryIndex(next);
    dispatchRaw({ type: 'setHighlight', key: storySteps[next]?.highlight ?? null });
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

  // Journalist chart-headline (Task 6): draft (AI, signed-in only) / edit
  // (no AI call — reopens the existing saved text) / save / cancel. Mirrors
  // the Insights `openStory` pattern above: an unauthenticated visitor gets
  // an honest inline message, never a silently-failed server-action call.
  function startHeadlineDraft(): void {
    setHeadlineError(null);
    if (chartHeadline !== null) {
      setHeadlineDraftText(chartHeadline);
      setHeadlineEditing(true);
      return;
    }
    if (!signedIn) {
      setHeadlineError(t(chartLang, 'chart.headline.unauthenticated'));
      return;
    }
    setHeadlineBusy(true);
    // #254: the ACTIVE reading — a drafted headline describes the numbers
    // the reader is looking at, not a reading they switched away from.
    void draftChartHeadline(activeSpec).then((result) => {
      setHeadlineBusy(false);
      if (result.ok) {
        setHeadlineDraftText(result.headline);
        setHeadlineEditing(true);
      } else if (result.reason === 'unauthenticated') {
        setHeadlineError(t(chartLang, 'chart.headline.unauthenticated'));
      } else {
        // #6 (session 110 UX audit pass 2): this is the DRAFT failure path
        // — nothing has been saved yet, so it must not use the save-error
        // string (chart.headline.error, used by saveHeadlineDraft below).
        setHeadlineError(t(chartLang, 'chart.headline.draftError'));
      }
    });
  }

  function saveHeadlineDraft(): void {
    if (embed?.auditId === undefined) return;
    setHeadlineBusy(true);
    void saveChartHeadline(embed.auditId, headlineDraftText).then((result) => {
      setHeadlineBusy(false);
      if (result.ok) {
        // Finding 3 (minor): reuse normalizeHeadlineText's word-boundary-safe
        // truncation instead of a raw `.slice()` re-implementation, so the
        // optimistic client-side update can never drift from — or cut a
        // number in half differently than — what the DB actually stored.
        setChartHeadline(normalizeHeadlineText(headlineDraftText));
        setHeadlineEditing(false);
      } else {
        setHeadlineError(t(chartLang, 'chart.headline.error'));
      }
    });
  }

  function cancelHeadlineDraft(): void {
    setHeadlineEditing(false);
    setHeadlineError(null);
  }

  // Session 87 (mockup Option B): the Grafiek/Tabel switch is a shadcn-style
  // segment (muted track, raised active segment); the small-multiples and
  // axis toggles are quiet pills.
  // R9.1 (#238): at 375px these tabs measured only 24px tall — well under
  // the 44px minimum tap target. `min-h-11 sm:min-h-6` widens the tap target
  // only below the `sm` breakpoint, so the desktop (1280px) control stays
  // pixel-identical to before.
  // Chart-card polish (2026-09-15): the Weergave tabs are quiet underline
  // tabs (the dock's own house pattern, 12-huisstijl §Layout) — no filled
  // track, no raised segment; the active tab is a 2 px underline in the
  // foreground colour. R9.1 (#238): `min-h-11 sm:min-h-6` keeps the 44 px
  // phone tap target, pinned by test.
  const quietTab = (active: boolean): string =>
    'min-h-11 sm:min-h-6 border-b-2 px-1.5 py-1 text-xs transition-colors disabled:cursor-not-allowed ' +
    (active ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground');
  const tabClass = (active: boolean): string =>
    'min-h-11 sm:min-h-6 rounded-full border px-2.5 py-1 text-xs ' +
    (active
      ? 'border-transparent bg-secondary text-foreground'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground');
  // ADR 042: the export container's font override and auto height merged
  // into one style object — `undefined` (not `{}`) when neither applies, so
  // the stock DOM stays attribute-identical to before this task.
  //
  // Row 10 (session 110 UX audit pass 2): in embedMode, both branches below
  // route through `embedHeightValue` instead of the plain px number —
  // whether the width has already been measured (`autoHeightPx`) or not yet
  // (still on the `CHART_MIN_HEIGHT_PX` floor `autoHeight` implies before
  // the first ResizeObserver callback fires) — so there is no flash of an
  // unrelaxed 256px height in a small embed frame before measurement
  // settles. Non-embed behaviour is byte-identical to before this row: the
  // `autoHeightPx !== null` branch still sets the plain number, and the
  // unmeasured/non-auto case still sets no height at all (the `h-64`
  // className floor stands, exactly as ADR 042 left it).
  const containerStyle: CSSProperties = {
    ...(fontStack(pres.fontFamily) ? { fontFamily: fontStack(pres.fontFamily) } : {}),
    ...(autoHeightPx !== null
      ? { height: embedMode ? embedHeightValue(autoHeightPx) : autoHeightPx }
      : embedMode && autoHeight
        ? { height: embedHeightValue(CHART_MIN_HEIGHT_PX) }
        : {}),
  };


  // Session 101 (2026-09-13, owner present): canvasNode/legendNode/notesNode
  // are the exact same chart-experience JSX that used to sit inline at these
  // three spots, just lifted into local consts so the SAME element tree can
  // be placed in ONE of two positions depending on `styleOpen` — its normal
  // dock slot below, or ChartEditModal's `chartSlot` further down — never
  // both at once, so there is no double-mount, no duplicate DOM id, and no
  // independent copy of ChartView's own state to drift out of sync; moving
  // a value between two possible output positions in the same render is
  // ordinary React reconciliation (mount here XOR mount there), not a new
  // mechanism (see ChartEditModal's own header comment for why this design
  // beats duplicating the canvas into a second live instance).
  const canvasNode = state.form === 'table' ? (
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
        // Fix round 2 (item 10): a `tabpanel` with no tablist is a broken
        // ARIA relationship — stage mode renders no form tabs, so the export
        // container is a plain div there and a screen reader is not told to
        // look for tabs that do not exist.
        role={inStage ? undefined : 'tabpanel'}
        aria-label={inStage ? undefined : t(chartLang, 'chart.graphPanelLabel')}
        ref={chartContainerRef}
        // Task 5 (co-pilot phase 1): the ONE stable hook a test can use to
        // assert that a reader's own words (title editor, caption) sit
        // OUTSIDE the export container. The div carried only a generated
        // `id` before, which a test cannot address.
        data-testid="chart-container"
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
                  {...GRID_LINE_PROPS}
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
                        dimmed ? 0.25 : 1,
                        s.label,
                        onPointClick,
                        { ...dotGeometry(pres.lineWidth), markers: pres.markers, ends: endpointsByKey.get(s.key) ?? null },
                        chartLang,
                        ringStep?.point?.seriesKey === s.key ? ringStep.point.periodCode : null,
                      )}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  );
                })}
              {/* Row 3 (session 110 UX audit pass 4): the LAST child, so it
                * paints after every Line above — see EndLabelsOverlay's own
                * doc comment. */}
              <EndLabelsOverlay specs={endLabelSpecs} />
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
                <CartesianGrid {...GRID_LINE_PROPS} horizontal vertical={pres.grid === 'both'} />
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
                        dimmed ? 0.25 : 1,
                        s.label,
                        onPointClick,
                        { ...dotGeometry(pres.lineWidth), markers: pres.markers, ends: endpointsByKey.get(s.key) ?? null },
                        chartLang,
                        ringStep?.point?.seriesKey === s.key ? ringStep.point.periodCode : null,
                      )}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  );
                })}
              {/* Row 3 (session 110 UX audit pass 4): see the LineChart
                * branch above — same overlay, same reasoning. */}
              <EndLabelsOverlay specs={endLabelSpecs} />
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
                <CartesianGrid {...GRID_LINE_PROPS} vertical horizontal={pres.grid === 'both'} />
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
                shape={RegionBar(regionPeriodLabel, hbarLabelMode, hbarExtremeKeys, onPointClick, chartLang)}
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
                  {...GRID_LINE_PROPS}
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
                        onPointClick,
                        chartLang,
                        ringStep?.point?.seriesKey === s.key ? ringStep.point.periodCode : null,
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
      );

  const legendNode = state.form !== 'table' && seriesMeta.length > 1 ? (
        inStage ? (
          <StageLegend seriesMeta={seriesMeta} lang={chartLang} />
        ) : (
          <>
            <SeriesLegend
              seriesMeta={seriesMeta}
              hiddenKeys={state.hiddenKeys}
              highlightedKey={state.highlightedKey}
              onToggle={(key) => dispatchCommand({ kind: 'toggleSeries', key }, 'canvas')}
              onHighlight={(key) => dispatchCommand({ kind: 'setHighlight', key }, 'canvas')}
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
        )
      ) : null;

  // Task 5 (co-pilot phase 1): the reader's own caption under the chart.
  // Rendered at the same slots as `notesNode`, just before it, and — like
  // the notes — ALWAYS outside chartContainerRef, so a reader's own words
  // can never be scanned as chart data or baked into a PNG/SVG export.
  // Unlike the notes it is offered in the table form too: a caption is about
  // the card, not about a clicked chart point.
  const captionNode = !embedMode && !inStage ? (
        <ChartEditableText
          key={chartEpoch}
          value={state.caption}
          commandKind="setCaption"
          placeholder={t(chartLang, 'chart.caption.placeholder')}
          editLabel={t(chartLang, 'chart.caption.edit')}
          addLabel={t(chartLang, 'chart.caption.add')}
          saveLabel={t(chartLang, 'chart.caption.save')}
          cancelLabel={t(chartLang, 'chart.caption.cancel')}
          maxLength={CHART_CAPTION_MAX_LENGTH}
          onCommit={(next) => dispatchCommand({ kind: 'setCaption', caption: next }, 'canvas')}
          locked={storyOpen ? { title: storyLockedTitle!, describedBy: storyLockId } : undefined}
          testId="chart-caption"
          as="p"
          className="text-sm text-muted-foreground"
        />
      ) : null;

  const notesNode = state.form !== 'table' && !embedMode && !inStage ? (
        <ChartNotes
          notes={state.notes}
          pendingPoint={pendingPoint}
          idPrefix={domId}
          lang={chartLang}
          onSave={(text) => {
            if (!pendingPoint) return;
            // `newCommandId()` (random + time-based), not a counter: the id
            // must be unique across the whole session regardless of delete
            // order — the old ref-backed counter's job, now covered by the
            // command vocabulary's own id minting.
            dispatchCommand({ kind: 'addNote', note: { id: `${pendingPoint.resultId}-${newCommandId()}`, ...pendingPoint, text } }, 'canvas');
            setPendingPoint(null);
          }}
          onCancelPending={() => setPendingPoint(null)}
          onDelete={(id) => dispatchCommand({ kind: 'removeNote', noteId: id }, 'canvas')}
        />
      ) : null;

  return (
    <div
      className={`${frameClass} outline-none`.trim()}
      /* Fix round 1, finding 6: `onHistoryKeyDown` sits on THIS div, so ⌘Z
       * only ever reached it while focus was already inside the card —
       * a reader who had clicked nothing focusable got no shortcut at all.
       * `tabIndex={-1}` makes the card itself click-focusable (and
       * programmatically focusable) without adding a stop to the tab order;
       * `outline-none` keeps that from drawing a focus ring around the whole
       * card, since this is never a keyboard-reachable control in its own
       * right — every real control inside it keeps its own visible focus
       * style. */
      tabIndex={-1}
      onKeyDown={onHistoryKeyDown}
    >
      {/* Chart-card polish (2026-09-15): title + subtitle on the left, the
        * card's two actions (Inzichten, Opmaak) top-right — the universal
        * card-actions idiom. The heading's next sibling stays the subtitle
        * (tests read the header by that relationship). Gating is byte-
        * identical to the old control row: no actions in embed or stage
        * mode; Opmaak never in Tabel form; Inzichten only when a story
        * exists. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Row 10/#p2-10 recheck (pass 5): title compacts to text-xs below
            * a 300px-tall embed frame — the chart itself is the point of a
            * tiny sidebar embed, not a full title. */}
          {/* Task 5 (co-pilot phase 1): the title editor REPLACES the heading
            * element while it is open, so the subtitle below stays the
            * heading's next element sibling either way (several tests read
            * the header by exactly that relationship). The editor lives
            * here, outside chartContainerRef, like the caption and the
            * notes: a reader's own words never enter a PNG/SVG export. */}
          {titleEditing ? (
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                // Escape already closed the editor; the unmount must not
                // commit the draft it just discarded.
                if (titleCancelledRef.current) {
                  titleCancelledRef.current = false;
                  return;
                }
                commitTitle();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelTitleEdit();
                }
              }}
              placeholder={t(chartLang, 'chart.title.placeholder')}
              aria-label={t(chartLang, 'chart.title.edit')}
              maxLength={CHART_TITLE_MAX_LENGTH}
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-base font-semibold leading-snug"
              autoFocus
            />
          ) : (
            <div
              role="heading"
              aria-level={3}
              onDoubleClick={titleEditable ? startTitleEdit : undefined}
              className={
                embedMode
                  ? 'flex items-center gap-1 text-base font-semibold leading-snug text-foreground [@media(max-height:300px)]:text-xs [@media(max-height:300px)]:leading-tight'
                  : 'flex items-center gap-1 text-base font-semibold leading-snug text-foreground'
              }
            >
              {shownTitle}
              {/* The pencil sits INSIDE the heading (it carries no text of
                * its own, so `heading.textContent` is still just the title)
                * rather than after it — the subtitle must remain the
                * heading's next sibling. Story lock: same
                * disabled/title/aria-describedby trio as Undo. */}
              {titleEditable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-command-kind="setTitle"
                  onClick={startTitleEdit}
                  disabled={storyOpen}
                  aria-label={t(chartLang, 'chart.title.edit')}
                  title={storyLockedTitle ?? t(chartLang, 'chart.title.edit')}
                  aria-describedby={storyOpen ? storyLockId : undefined}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          )}
          {/* ADR 042: one muted subtitle line — the unit first, then the pinned
            * dimensions — as separate spans (tests and the digit scan read them
            * per text node). */}
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {/* Task 5: with a reader's own title on the heading, the OFFICIAL
              * measure name moves here — first span, so it never leaves the
              * card (R4-adjacent: what the numbers actually measure stays
              * visible next to them). Still a spec string, so the whole-card
              * digit scan is unaffected. */}
            {state.title !== null ? (
              <>
                {/* Task 5 review polish: the `title` attribute is a mouse-only
                  * affordance — a screen reader gets the bare measure name with
                  * no hint that it is the ORIGINAL title the reader replaced.
                  * The visible span keeps its tooltip; this sr-only sibling
                  * says the same thing out loud. */}
                <span title={t(chartLang, 'chart.title.original', { title: displaySpec.title })}>{displaySpec.title}</span>
                <span className="sr-only">{t(chartLang, 'chart.title.original', { title: displaySpec.title })}</span>
              </>
            ) : null}
            <span>{displaySpec.unit}</span>
            {/* #18 (session 110 UX audit): human labels only — the raw CBS
              * dimension KEY (e.g. "Bestedingscategorieen") used to prefix
              * every value here (`${k}: ${v}`), putting a camelCase machine
              * identifier in the reader's face on every chart card,
              * homepage included. The key is still available where a reader
              * actually needs it: the proof panel's cell table shows it as
              * its own column header (answer-proof.tsx's CellTable). Every
              * value here is still a spec string (dimLabels), so R6/#254's
              * digit-scan exemption is unaffected — only the machine-key
              * prefix is dropped, never the label itself. */}
            {dimEntries.length > 0 ? <span>{dimEntries.map(([, v]) => v).join(' · ')}</span> : null}
          </div>
        </div>
        {/* Fix round 1 (Minor 5): the two right-hand groups share ONE
          * wrapper — the header row is `justify-between` and a third bare
          * child would be centred — and the wrapper itself is gated, so
          * embed/stage mode render no empty box at all. */}
        {!embedMode && !inStage ? (
          <div className="flex shrink-0 items-start gap-1">
            <ChartHistoryActions
              undo={undo}
              redo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              history={history}
              lang={chartLang}
              locked={storyOpen ? { title: storyLockedTitle!, describedBy: storyLockId } : undefined}
            />
            {storyAvailable || state.form !== 'table' ? (
              <div className="flex shrink-0 items-center gap-1" data-slot="chart-card-actions">
                {/* Story mode (session 92): the colourful trigger is offered
                  * whenever there is a code-built story (storyAvailable,
                  * computed above next to styleControlsId). */}
                {storyAvailable ? (
                  <ChartStoryTrigger
                    open={storyOpen}
                    onToggle={toggleStory}
                    controlsId={storyControlsId}
                    triggerId={storyTriggerId}
                    lang={chartLang}
                  />
                ) : null}
                {/* Review fix (chart-panel-layout, option A): table form gets NO
                  * frame and NO Style panel (as before the Frame-tab feature) — a
                  * framed table would need its own export path, so the trigger
                  * stays gated on `state.form !== 'table'` exactly like the
                  * ChartConfigPanel mount further down. */}
                {state.form !== 'table' ? (
                  <ChartConfigTrigger
                    open={styleOpen}
                    onToggle={toggleStylePanel}
                    controlsId={styleControlsId}
                    triggerId={styleTriggerId}
                    lang={chartLang}
                    compact
                  />
                ) : null}
                {/* Journalist chart-headline (Task 6): chat context only (the
                  * embed page never shows edit UI, per the spec — Task 7's own
                  * static render is the read-only counterpart) and only when
                  * there's something to draft from (mirrors the Insights
                  * trigger's own storyAvailable-from-findings gate above). */}
                {embed?.auditId !== undefined && findings.length > 0 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={startHeadlineDraft} disabled={headlineBusy}>
                    {headlineBusy
                      ? t(chartLang, 'chart.headline.drafting')
                      : t(chartLang, chartHeadline !== null ? 'chart.headline.edit' : 'chart.headline.suggest')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Journalist chart-headline (Task 6): the sentence headline leads,
        * the headlineFigure big-number block (below) follows. Named state
        * `chartHeadline`/`headlineEditing` throughout — deliberately not
        * `headline`, which is already the headlineFigure result just below. */}
      {headlineEditing ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            value={headlineDraftText}
            onChange={(e) => setHeadlineDraftText(e.target.value.slice(0, CHART_HEADLINE_MAX_LENGTH))}
            placeholder={t(chartLang, 'chart.headline.placeholder')}
            maxLength={CHART_HEADLINE_MAX_LENGTH}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <button type="button" onClick={saveHeadlineDraft} disabled={headlineBusy} className="text-xs font-medium text-foreground">
              {t(chartLang, 'chart.headline.save')}
            </button>
            <button type="button" onClick={cancelHeadlineDraft} disabled={headlineBusy} className="text-xs text-muted-foreground">
              {t(chartLang, 'chart.headline.cancel')}
            </button>
          </div>
          {/* #15 (session 110 UX audit pass 2): role="alert" so a screen
            * reader announces the failure — the paragraph used to render
            * silently. */}
          {headlineError !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {headlineError}
            </p>
          ) : null}
        </div>
      ) : chartHeadline !== null ? (
        <p className="mt-3 text-base font-semibold leading-snug text-foreground" data-testid="chart-headline-text">
          {chartHeadline}
        </p>
      ) : headlineError !== null ? (
        // startHeadlineDraft's unauthenticated/error paths set headlineError
        // WITHOUT entering edit mode (there's no draft to edit yet) — this
        // branch is the only place that message is ever shown.
        // #15 (session 110 UX audit pass 2): role="alert" — see the other
        // headlineError paragraph above for the same fix.
        <p role="alert" className="mt-3 text-xs text-destructive">
          {headlineError}
        </p>
      ) : null}
      {/* Chart-card polish (2026-09-15): the number leads, the chart is the
        * evidence. Outside the export container (chartContainerRef) by
        * construction — never in a PNG/SVG. Every token is a spec string
        * already covered by the whole-card digit scan (formattedValue,
        * unit, periodLabel); the value is bound to its cell via
        * data-label-for (R1). Not in the table form (it shows everything),
        * not in stage mode (ADR 044: the caption IS the sentence). */}
      {headline !== null && !inStage && state.form !== 'table' ? (
        <p
          className={
            embedMode
              ? 'mt-3 flex flex-wrap items-baseline gap-x-2 [@media(max-height:300px)]:hidden'
              : 'mt-3 flex flex-wrap items-baseline gap-x-2'
          }
          data-testid="headline-figure"
        >
          <span className="sr-only">{t(chartLang, 'chart.headline.label')}</span>
          <span className="text-3xl font-semibold leading-none tracking-tight text-foreground tabular-nums" data-label-for={headline.resultId}>
            {headline.value}
            {headline.provisional ? '*' : ''}
          </span>
          <span className="text-sm text-muted-foreground">
            {headline.unit} · {headline.periodLabel}
          </span>
        </p>
      ) : null}
      {/* #197 idea 4: the deterministic trend sentence, moved up under the
        * figure (chart-card polish, 2026-09-15) — number in a sentence, the
        * chart as evidence below. Gating unchanged: never in the stage
        * (fix round 2, item 9 — the stage's caption is the sentence), never
        * in the table, never under a zoom (it describes the full range). */}
      {/* #254: the ACTIVE reading's own trend sentence — it describes the
        * plotted line (and carries its own periods), so the primary's copy
        * must never survive a switch to an alternate reading. */}
      {!inStage && state.form !== 'table' && !state.periodRange && activeSpec.attribution.trendHeadline !== undefined ? (
        <p
          data-testid="trend-headline"
          className={
            embedMode
              ? 'mt-1 text-sm text-foreground [@media(max-height:300px)]:hidden'
              : 'mt-1 text-sm text-foreground'
          }
        >
          {activeSpec.attribution.trendHeadline}
        </p>
      ) : null}
      {/* Chart-card polish (2026-09-15): ONE quiet control row above the
        * plot — the Weergave tablist left, the Vanaf/Tot window right — in
        * place of the former two rows (tablist + Opmaak + Inzichten, then
        * Vanaf/Tot). Kept ABOVE the export container on purpose: DOM order
        * is keyboard order, and every SeriesDot/SeriesBar is a tab stop
        * (click-to-annotate), so a reader must reach the form switch before
        * the chart's own points — moving the row under the plot would have
        * cost a keyboard user one Tab per data point. Spec Part B3 + ADR
        * 044: the whole row is a viewer-only control surface, gated on both
        * `!embedMode` and `!inStage` exactly as before. */}
      {!embedMode && !inStage ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-slot="chart-controls">
          <div
            role="tablist"
            aria-label={t(chartLang, 'chart.weergaveLabel')}
            onKeyDown={onFormTabKeyDown}
            className="flex flex-wrap items-center gap-1"
          >
            <button
              ref={lineTabRef}
              type="button"
              role="tab"
              data-command-kind="setForm"
              aria-selected={activeForm === 'line'}
              aria-controls={panelId}
              aria-describedby={canUseLine ? undefined : `${domId}-line-reason`}
              tabIndex={activeForm === 'line' ? 0 : -1}
              disabled={!canUseLine}
              title={canUseLine ? undefined : t(chartLang, 'chart.lineDisabledReason')}
              onClick={() => selectForm('line')}
              className={quietTab(activeForm === 'line') + (canUseLine ? '' : ' cursor-not-allowed opacity-40')}
            >
              {t(chartLang, 'chart.tabLine')}
            </button>
            <button
              ref={areaTabRef}
              type="button"
              role="tab"
              data-command-kind="setForm"
              aria-selected={activeForm === 'area'}
              aria-controls={panelId}
              aria-describedby={canUseArea ? undefined : `${domId}-area-reason`}
              tabIndex={activeForm === 'area' ? 0 : -1}
              disabled={!canUseArea}
              title={canUseArea ? undefined : areaDisabledReason}
              onClick={() => selectForm('area')}
              className={quietTab(activeForm === 'area') + (canUseArea ? '' : ' cursor-not-allowed opacity-40')}
            >
              {t(chartLang, 'chart.form.area')}
            </button>
            <button
              ref={barTabRef}
              type="button"
              role="tab"
              data-command-kind="setForm"
              aria-selected={activeForm === 'bar'}
              aria-controls={panelId}
              tabIndex={activeForm === 'bar' ? 0 : -1}
              onClick={() => selectForm('bar')}
              className={quietTab(activeForm === 'bar')}
            >
              {t(chartLang, 'chart.tabBar')}
            </button>
            <button
              ref={hbarTabRef}
              type="button"
              role="tab"
              data-command-kind="setForm"
              aria-selected={activeForm === 'hbar'}
              aria-controls={panelId}
              aria-describedby={canUseHbar ? undefined : `${domId}-hbar-reason`}
              tabIndex={activeForm === 'hbar' ? 0 : -1}
              disabled={!canUseHbar}
              title={canUseHbar ? undefined : hbarDisabledReason}
              onClick={() => selectForm('hbar')}
              className={quietTab(activeForm === 'hbar') + (canUseHbar ? '' : ' cursor-not-allowed opacity-40')}
            >
              {t(chartLang, 'chart.form.hbar')}
            </button>
            <button
              ref={tableTabRef}
              type="button"
              role="tab"
              data-command-kind="setForm"
              aria-selected={activeForm === 'table'}
              aria-controls={panelId}
              tabIndex={activeForm === 'table' ? 0 : -1}
              onClick={() => selectForm('table')}
              className={quietTab(activeForm === 'table')}
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
          {/* #254: the reading toggle — same quiet <select> pattern as the
            * Vanaf/Tot pair right below it, and the same story lock (a story's
            * steps are built from the ACTIVE reading's findings, so switching
            * reading mid-story would change the captions under the reader).
            * Its options are the registry's OWN label strings, verbatim —
            * this component never invents copy describing a reading. The
            * value lives in the reducer (`state.selectedReading`), NOT in the
            * `spec` prop, which is what keeps a switch from tripping the
            * spec-identity reset. Rendered only when the answer actually
            * carried alternates; the whole row is already gated on
            * `!embedMode && !inStage` above. */}
          {alternates.length > 0 ? (
            <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <label htmlFor={`${domId}-reading`}>{t(chartLang, 'chart.reading.label')}</label>
              <select
                id={`${domId}-reading`}
                aria-label={t(chartLang, 'chart.reading.label')}
                value={state.selectedReading ?? 'primary'}
                disabled={storyOpen}
                title={storyLockedTitle}
                aria-describedby={storyOpen ? storyLockId : undefined}
                data-command-kind="setReading"
                onChange={(e) =>
                  dispatchCommand({ kind: 'setReading', index: e.target.value === 'primary' ? null : Number(e.target.value) }, 'panel')
                }
                className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="primary">{t(chartLang, 'chart.reading.primary')}</option>
                {/* Keyed by index on purpose: the index IS this list's
                  * identity (it is what `selectedReading` stores and what
                  * `activeReadingSpec` looks up), the array is never
                  * reordered or filtered, and two registry alternates could
                  * in principle carry the same label.
                  *
                  * These labels routinely CONTAIN DIGITS — the registry ships
                  * 'CPI indexniveau (2025=100), geen mutatiepercentage',
                  * 'stand per 31 december (Eindstand Voorraad)', '…(2021 =
                  * 100)' — and that is deliberate and allowed. A registry
                  * alternate label is curated config, hand-authored in
                  * src/registry/defaults.ts and code-reviewed, never derived
                  * from a CBS cell at runtime, and it NAMES a reading rather
                  * than stating a measured quantity (an index BASE is a
                  * definitional property of the measure, not a plotted
                  * value). Same class as ChartAnnotation's curated event-marker
                  * labels, whose own type comment (src/chart/types.ts) states
                  * the policy: "METADATA … never a data VALUE (R1/R3's
                  * numeric-token scanning never sees these)". chart.test.tsx's
                  * #254 scan test pins the exemption as NARROW — the card
                  * minus this one control must still scan clean with no
                  * exemption at all, so a label's digits can never leak into
                  * the chart, table, headline figure, axis or attribution. */}
                {alternates.map((alt, i) => (
                  <option key={i} value={i}>
                    {alt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {zoomAvailable ? (
            /* #254: `ml-auto` moves to the reading block above when one is
             * shown, so the right-hand group starts there and the two
             * <select> groups sit next to each other instead of being pushed
             * apart by two competing auto margins. With no alternates (every
             * call site before this feature) the class list is unchanged. */
            <div
              className={
                (alternates.length > 0 ? '' : 'ml-auto ') +
                'flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'
              }
            >
              <label htmlFor={`${domId}-from`}>{t(chartLang, 'chart.from')}</label>
              <select
                id={`${domId}-from`}
                aria-label={t(chartLang, 'chart.from')}
                data-command-kind="setPeriodRange"
                value={state.periodRange?.[0] ?? allPeriodCodes[0]}
                disabled={storyOpen}
                title={storyLockedTitle}
                aria-describedby={storyOpen ? storyLockId : undefined}
                onChange={(e) => {
                  const [from, clampedTo] = clampVanafChange(
                    e.target.value,
                    state.periodRange?.[1] ?? allPeriodCodes[allPeriodCodes.length - 1],
                  );
                  dispatchCommand(
                    {
                      kind: 'setPeriodRange',
                      range:
                        from === allPeriodCodes[0] && clampedTo === allPeriodCodes[allPeriodCodes.length - 1]
                          ? null
                          : [from, clampedTo],
                    },
                    'panel',
                  );
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
                data-command-kind="setPeriodRange"
                value={state.periodRange?.[1] ?? allPeriodCodes[allPeriodCodes.length - 1]}
                disabled={storyOpen}
                title={storyLockedTitle}
                aria-describedby={storyOpen ? storyLockId : undefined}
                onChange={(e) => {
                  const [clampedFrom, to] = clampTotChange(
                    state.periodRange?.[0] ?? allPeriodCodes[0],
                    e.target.value,
                  );
                  dispatchCommand(
                    {
                      kind: 'setPeriodRange',
                      range:
                        clampedFrom === allPeriodCodes[0] && to === allPeriodCodes[allPeriodCodes.length - 1]
                          ? null
                          : [clampedFrom, to],
                    },
                    'panel',
                  );
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
        </div>
      ) : null}
      {/* #262(c) (session 110): the public embed route (embedMode=true) hides
        * the WHOLE control row above (form tabs, Vanaf/Tot) by design — a
        * frozen embed never lets a reader change form or window — but ADR
        * 051's reading toggle is a narrower, additive case: every alternate
        * is already a complete, independently-built ChartSpec baked into the
        * audit row at answer time (D3), so switching reading here is exactly
        * as safe as it is in chat/dock — no re-query, no new query string
        * (the choice lives in local component state, `state.selectedReading`,
        * same as everywhere else), and every visible fact still flows through
        * `activeSpec` (D5) so R1/R6/R11 cover it the same way. Rendered ONLY
        * when the stored response actually carried alternates (embed pages
        * built before ADR 051, or answers whose measure has none, render
        * nothing here — same "absent means not built for this row" reading
        * as the rest of the envelope, docs/13-envelope-presence-grammar.md).
        * D7's Embed-button-disable-while-non-primary rule does not apply on
        * this route: there is no Embed button here (a page already reached
        * via a signed embed token never re-offers its own embed dialog). */}
      {embedMode && !inStage && alternates.length > 0 ? (
        <div
          className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground [@media(max-height:300px)]:order-last"
          data-slot="chart-controls-embed"
        >
          <label htmlFor={`${domId}-reading`}>{t(chartLang, 'chart.reading.label')}</label>
          <select
            id={`${domId}-reading`}
            aria-label={t(chartLang, 'chart.reading.label')}
            value={state.selectedReading ?? 'primary'}
            data-command-kind="setReading"
            onChange={(e) =>
              dispatchCommand({ kind: 'setReading', index: e.target.value === 'primary' ? null : Number(e.target.value) }, 'panel')
            }
            className="w-full min-w-0 max-w-full rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground"
          >
            <option value="primary">{t(chartLang, 'chart.reading.primary')}</option>
            {/* Same curated-label digit exemption as the non-embed dropdown
              * above (D6) — these strings are hand-authored registry config,
              * never a CBS cell read at runtime. */}
            {alternates.map((alt, i) => (
              <option key={i} value={i}>
                {alt.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {/* Task 3 (chart-visual-embed-pass): also suppressed while the Embed
        * dialog is open — the same canvasNode element is now ALSO passed
        * into ChartEmbedButton's chartSlot below, and the no-double-mount
        * invariant this node's own declaration documents (never both at
        * once) applies just as much to embed as it does to style. */}
      {!styleOpen && !embedOpen ? canvasNode : null}
      {/* Story mode (session 92): the same slot as the Opmaak region — chart
        * first, the story under it — and, like ChartNotes, OUTSIDE
        * chartContainerRef so no caption can ever enter an export. */}
      {!inStage && storyAvailable ? (
        <ChartStoryPanel
          steps={storySteps}
          index={storyIndex}
          // Fix round 2 (item 7): while the stage is open the compact panel
          // must not move the shared index. It is still mounted behind the
          // full-screen overlay, and its IntersectionObserver keeps firing
          // on any reflow there (a classic scrollbar appearing/disappearing
          // is enough) — each fire overwriting the step the presenter is
          // actually on. A no-op keeps the panel rendering, invisible and
          // inert, until the stage closes.
          onIndexChange={stageOpen ? () => {} : onStoryIndexChange}
          open={storyOpen}
          onClose={closeStory}
          triggerId={storyTriggerId}
          idPrefix={domId}
          lang={chartLang}
          onPresent={!inStage ? openStage : undefined}
          insightsUnauthenticated={insightsUnauthenticated}
        />
      ) : null}
      {/* Task 5 (Story-stage plan): the full Story stage — a portal, mounted
        * next to the compact panel and NEVER inside chartContainerRef (like
        * the panel above, its own text must never enter an svg export).
        * Never offered in stage mode itself: a stage never opens a stage.
        * #254: its `spec` is the ACTIVE reading — `steps` are built from that
        * reading's own findings, so the stage must plot what they describe. */}
      {storyAvailable && !inStage ? (
        <ChartStoryStage
          open={stageOpen}
          spec={activeSpec}
          steps={storySteps}
          index={storyIndex}
          onIndexChange={onStoryIndexChange}
          onClose={closeStage}
          triggerId={`${domId}-story-present`}
          overrides={state.presentation}
          lang={chartLang}
          onAutoplay={() => trackChartStyleEvent('stage_autoplay')}
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
      {!inStage && storyOpen ? (
        <span id={storyLockId} className="sr-only">
          {t(chartLang, 'chart.story.controlsLocked')}
        </span>
      ) : null}
      {/* Session 101 (2026-09-13, owner present): ChartConfigPanel now renders
        * inside ChartEditModal — a real popup, chart on the left (canvasNode/
        * legendNode/notesNode, the SAME lifted values rendered at their dock
        * slots above when `!styleOpen`) and this panel's tabs on the right —
        * replacing the plain `role="region"` inline card this used to be
        * (session 94; before that, a floating non-modal dialog, session 92;
        * see open-questions #243 and the ADR 039 addendum for the full
        * history). `key={chartEpoch}` is unchanged: a spec swap still fully
        * remounts the panel, resetting its colour-draft/brand-status state
        * exactly as it always has — `open` itself is `styleOpen` above,
        * reset separately in the spec-swap block instead of via this
        * remount. */}
      {/* Final-review fix: table form gets no Style panel at all (as before
        * the Frame-tab feature) — a framed table would need its own export
        * path, so the mount stays gated on `state.form !== 'table'`. */}
      {!inStage && state.form !== 'table' ? (
        <ChartEditModal
          open={styleOpen}
          onClose={() => {
            setStyleOpen(false);
            document.getElementById(styleTriggerId)?.focus();
          }}
          title={t(chartLang, 'chart.panel.regionLabel')}
          // Session 110 UX audit pass 3, row 7: resolved via chartLang,
          // matching `title` right above it — never the ambient
          // LangProvider this file's own `t(chartLang, …)` convention
          // deliberately doesn't depend on.
          closeLabel={t(chartLang, 'common.close')}
          chartSlot={
            <>
              {canvasNode}
              {legendNode}
              {captionNode}
              {notesNode}
            </>
          }
        >
        <ChartConfigPanel
          key={chartEpoch}
          resolved={resolved}
          seriesMeta={seriesMeta}
          lang={chartLang}
          open={styleOpen}
          onOpenChange={setStyleOpen}
          triggerId={styleTriggerId}
          // #6 (session 110 UX audit): this panel is always hosted inside
          // ChartEditModal here, whose Dialog already renders its own Close
          // (X) button — the panel's own "Sluiten" was a second, redundant
          // Close control in the same popup.
          hideCloseButton
          frameImage={frameImage}
          onFrameImage={setFrameImage}
          // R5.2 (ADR 043 decision 6 revisit): a chart with no per-chart
          // tweaks yet opens the Style panel on the Sjablonen gallery
          // instead of the raw Grafiek controls — `resolved.pristine`
          // already tracks exactly that (the overrides object passed in is
          // empty), evaluated once at the panel's own mount.
          // Strong-tier review MEDIUM-1: `pristine` tracks ONLY the per-chart
          // override, so a user with a SAVED ACCOUNT DEFAULT is pristine too
          // and used to land on Sjablonen — never seeing "Mijn standaard is
          // actief", which renders inside the Grafiek panel. A saved default
          // IS a deliberate look already chosen, so the gallery is not what
          // that reader needs first: open on Grafiek instead.
          openTemplatesWhenPristine={accountStyle === null}
          onChange={(patch, meta) => {
            // Final-review fix (Fix 5): ChartConfigPanel now refuses a
            // frame background/inset change UP FRONT (its own contrast
            // guard, before ever calling this onChange) whenever it would
            // make a series colour illegible — so there is nothing left for
            // this callback to silently drop or adjust afterwards. Series
            // colours are never changed by the frame feature.
            // Fix round 1 (Minor 2): the panel SAYS whether a change is a
            // mid-drag colour-picker move — no key-shape guessing here, so a
            // discrete action that happens to touch the same keys (e.g.
            // "Standaardkleuren") keeps its own undo entry. Transient
            // entries merge until sealed (`onSeal` below).
            dispatchCommand({ kind: 'setPresentation', patch }, 'panel', { transient: meta?.transient === true });
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
            // ONE command, not reset-then-patch: a template is a single
            // undoable step (its inverse is the full presentation it
            // replaced), and `applyCommand` resolves the template id to the
            // same `templateById(id).overrides` this used to inline.
            dispatchCommand({ kind: 'applyTemplate', templateId: id }, 'panel');
            setFrameImage(null);
            trackChartStyleEvent(`template_${id}`);
          }}
          onSeal={sealHistory}
          onReset={() => {
            dispatchCommand({ kind: 'resetPresentation' }, 'panel');
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
          brand={signedIn ? { lookup: (website) => lookupBrand(website), available: brandLookupAvailable } : undefined}
          onBrandApplied={(applied) => {
            setLastAppliedBrand(applied);
            trackChartStyleEvent('brand_applied');
          }}
        />
        {/* Owner punch-list item 1 (session 102): Download and Embed are
          * otherwise stranded behind the Style modal's backdrop while it's
          * open (a real, focus-trapped dialog) — unreachable even though
          * both controls still exist in the footer below. Rendered here as
          * a footer row after the panel, reusing the EXACT same props as
          * the footer's own copies further down this file. `ChartEmbedButton`
          * here reuses `onOpenChange={setEmbedOpen}` unchanged: `styleOpen`
          * and `embedOpen` are both derived from the SAME `openPanel`
          * discriminated state (see its declaration above), so a single
          * `setEmbedOpen(true)` call flips `openPanel` straight from
          * 'style' to 'embed' in one update — Style closes and Embed opens
          * atomically, with no separate "close Style" call needed and no
          * frame where both could be true at once. `state.form !== 'table'`
          * is already implied here (this whole modal is gated on it above —
          * TypeScript narrows `state.form` accordingly, so repeating the
          * check would be a type error), unlike the footer's own copy of
          * this gate further down, which sits outside that narrowing. */}
        {!(smallMultiples && smallMultiplesAvailable) && !embedMode && !inStage ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ChartDownloadMenu
              containerRef={chartContainerRef}
              attributionText={`${displayAttributionLine} checkdecijfers.nl${viewDisclosure}`}
              filenameBase={`checkdecijfers-${activeSpec.attribution.tableId}`}
              lang={chartLang}
              frame={pres}
              frameImage={frameImage}
              headlineText={chartHeadline}
              syncedAt={activeSpec.attribution.syncedAt}
            />
            {embed ? (
              /* #254: the PRIMARY's table id, deliberately — an embed
               * republishes the stored audit row (the primary answer), which
               * carries no reading selection, so labelling the published
               * iframe with an alternate's table would misname it. */
              <ChartEmbedButton
                auditId={embed.auditId}
                tableId={spec.attribution.tableId}
                lang={chartLang}
                currentForm={state.form}
                defaultIsTable={defaultFormIsTable(spec)}
                open={embedOpen}
                onOpenChange={setEmbedOpen}
                disabled={state.selectedReading !== null}
                chartSlot={
                  <>
                    {canvasNode}
                    {legendNode}
                  </>
                }
              />
            ) : null}
          </div>
        ) : null}
        </ChartEditModal>
      ) : null}
      {/* Task 3 (chart-visual-embed-pass): same no-double-mount reasoning as
        * canvasNode above — legendNode is also lifted into the Embed
        * dialog's chartSlot now. */}
      {!styleOpen && !embedOpen ? legendNode : null}
      {/* Task 4: shown whenever a period-range zoom is active, independent of
        * the series-legend block above (which only renders for >1 series) —
        * a single-series chart can be zoomed too. */}
      {zoomDisclosure ? <p className="mt-1 text-xs text-muted-foreground">{zoomDisclosure.trim()}</p> : null}
      {state.form !== 'table' && smallMultiplesAvailable && !embedMode && !inStage ? (
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
      {/* Audit pass 2, row 7 (2026-09-17): #197 used to render a SECOND,
        * UI-only legend line here ("○ = voorlopig cijfer") — gated on the
        * exact same condition as the backend `provisionalNote` prose right
        * below, so the two always appeared together, stating the same
        * provisional flag with two different symbols (a hollow ring vs. the
        * '*' the value itself already carries). `provisionalNote` is the
        * R8-reconstructed, DB-stored string (never edited on the UI side —
        * see `PROVISIONAL_NOTE` in src/chart/build.ts) and already tells
        * the reader the convention they see on the value; this line added a
        * second symbol to reconcile, not new information, so it is dropped
        * rather than kept in sync with a marker mode that, per
        * `markerVisible` in chart-presentation.ts, draws the hollow ring
        * for every provisional point regardless of mode anyway (there is no
        * "what the reader sees" that varies by mode to describe here).
        * #254: provisionalNote/nullNotes/definitionLine below all describe
        * the CELLS currently plotted (R11's "present iff" is per reading),
        * so they follow `activeSpec`, never the primary's own copies. */}
      {/* WP23 (#92): caveats read like caveats — warn and a step larger than
        * the source credit, which stays smallest/lightest (photo-credit
        * style). Content untouched: same strings from the same one builder
        * (R4); only presentation changes here. */}
      {activeSpec.provisionalNote ? <p className="mt-2 text-sm text-warning">{activeSpec.provisionalNote}</p> : null}
      {activeSpec.nullNotes.map((note) => (
        <p key={note} className="text-sm text-warning">
          {humanizeNullNote(note, activeSpec.attribution.tableId)}
        </p>
      ))}
      {/* Fix round 2 (item 9): the definition line is reference prose for a
        * chat answer, not something anyone reads off a presentation slide —
        * dropped in stage mode. The caveats that carry data-quality meaning
        * (nullNotes, the provisional sentence and its marker key, the event
        * markers) and the attribution stay, in the stage as everywhere. */}
      {!inStage && activeSpec.definitionLine ? <p className="mt-2 text-xs text-muted-foreground">{activeSpec.definitionLine}</p> : null}
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
        * chart point, not a table cell. Spec Part B3: also off in embedMode
        * — click-to-annotate is a viewer's own reading aid, session-only and
        * never part of the honest card an embed re-publishes elsewhere. */}
      {!styleOpen ? captionNode : null}
      {!styleOpen ? notesNode : null}
      {/* #170(1): the R4 prose credit keeps its photo-credit size (#92); the
        * badge is the same attribution made SCANNABLE — table id + measured
        * sync date + deep link, from spec.attribution only (the source key is
        * derived from the table id inside the badge; ChartAttribution carries
        * none). Ontdek reuses this component, so the homepage charts get the
        * identical badge for free. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xs text-muted-foreground">{displayAttributionLine}</p>
        {/* #254: the badge is `displayAttributionLine` made scannable, so it
          * follows the SAME (active) reading — a badge pointing at the
          * primary's table under an alternate's numbers would be a false
          * source claim (R4). */}
        <SourceBadge tableId={activeSpec.attribution.tableId} syncedAt={activeSpec.attribution.syncedAt} />
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
        {/* #10 (session 110 UX audit): Download and Embed used to be
          * independent flex-wrap items in this row (alongside the
          * attribution text and SourceBadge above) — under the dock's
          * narrower width Embed could wrap onto its own line, left-aligned,
          * while Download stayed inline with the source link, reading as
          * two unrelated controls. Grouped into ONE flex group that wraps as
          * a unit; `shrink-0` keeps the pair from being squeezed before the
          * attribution text wraps instead. */}
        {state.form !== 'table' && !(smallMultiples && smallMultiplesAvailable) && !embedMode && !inStage ? (
          <div className="flex shrink-0 items-center gap-2" data-slot="chart-footer-actions">
            <ChartDownloadMenu
              containerRef={chartContainerRef}
              attributionText={`${displayAttributionLine} checkdecijfers.nl${viewDisclosure}`}
              filenameBase={`checkdecijfers-${activeSpec.attribution.tableId}`}
              lang={chartLang}
              frame={pres}
              frameImage={frameImage}
              headlineText={chartHeadline}
              syncedAt={activeSpec.attribution.syncedAt}
            />
            {embed ? (
              /* #254: the PRIMARY's table id — same reasoning as the copy
               * inside ChartEditModal above (an embed republishes the
               * stored audit row, which carries no reading selection). */
              <ChartEmbedButton
                auditId={embed.auditId}
                tableId={spec.attribution.tableId}
                lang={chartLang}
                currentForm={state.form}
                defaultIsTable={defaultFormIsTable(spec)}
                open={embedOpen}
                onOpenChange={setEmbedOpen}
                disabled={state.selectedReading !== null}
                chartSlot={
                  <>
                    {canvasNode}
                    {legendNode}
                  </>
                }
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {embedMode && embedFooter ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {embedFooter}{' '}
          {/* Review fix: this link is the ONE way out of a third-party
            * <iframe> (the whole point of the embed feature) -- without
            * target="_blank" it would load checkdecijfers.nl INTO the
            * iframe box instead of the reader's top page, trapping the
            * site in a chart-sized frame. Same convention as SourceBadge's
            * own outbound link (source-badge.tsx).
            *
            * Final review (Important #1): `href` is the SAME resolved
            * `NEXT_PUBLIC_APP_URL` origin the embed dialog already uses for
            * its iframe `src` (chart-embed-dialog.tsx's exported `APP_URL`)
            * -- not a hardcoded `https://checkdecijfers.nl`, which today
            * resolves to Namecheap's parked nameservers, not this app. The
            * VISIBLE label stays the brand name regardless (same convention
            * as that dialog's own generated `title="checkdecijfers.nl —
            * ..."` attribute, independent of what APP_URL actually
            * resolves to). */}
          <a href={APP_URL} target="_blank" rel="noopener noreferrer" className="underline">
            checkdecijfers.nl
          </a>
        </p>
      ) : null}
    </div>
  );
}
