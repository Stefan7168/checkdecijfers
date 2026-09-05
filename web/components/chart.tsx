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

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
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
import { ChartDownloadMenu } from './chart-download.tsx';
import { ChartSmallMultiples } from './chart-small-multiples.tsx';
import { SourceBadge } from './source-badge.tsx';

export type Row = Record<string, string | number | boolean | null>;

export interface SeriesMeta {
  key: string;
  label: string;
  color: string;
  /** Non-colour encoding (#197): undefined = solid, else an SVG dash pattern.
   * Recharts' legend icon picks it up automatically. */
  dasharray: string | undefined;
}

// #197 series palette — the one sanctioned exception to the huisstijl's "one
// accent" rule (docs/12-huisstijl.md): data series need distinguishable hues.
// Tokens live in app/globals.css (`--series-1..4`: the accent for brand
// continuity, then Okabe-Ito vermillion / bluish green and Tol purple — a
// colour-blind-safe set, each ≥ 3:1 against both paper surfaces, measured
// 2026-09-02). The old palette reused the semantic --danger/--ok/--warn
// tokens as series colours: red-vs-green at 1.10:1 lightness contrast AND the
// hue pair deuteranopia collapses. Series five and beyond render in muted ink
// — the chart stops pretending to tell them apart by hue (the table view is
// the honest surface for many series) — and every series after the first
// carries a dash pattern so colour is never the only difference (WCAG 1.4.1).
const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const SERIES_DASHES = ['6 3', '2 2', '8 3 2 3', '1 3'];

export function seriesStyle(index: number): { color: string; dasharray: string | undefined } {
  const color = index < SERIES_COLORS.length ? SERIES_COLORS[index] : 'var(--ink-muted)';
  const dasharray = index === 0 ? undefined : SERIES_DASHES[(index - 1) % SERIES_DASHES.length];
  return { color, dasharray };
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

export function buildRows(spec: ChartSpec): { rows: Row[]; seriesMeta: SeriesMeta[] } {
  const periodCodes = new Set<string>();
  for (const series of spec.series) {
    for (const point of series.points) periodCodes.add(point.periodCode);
  }
  const sortedCodes = Array.from(periodCodes).sort((a, b) => a.localeCompare(b));

  const seriesMeta: SeriesMeta[] = spec.series.map((series, i) => ({
    key: `s${i}`,
    label: series.label,
    ...seriesStyle(i),
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

function pointLabelText(point: ChartPoint): string {
  return `${point.formattedValue ?? ''}${point.provisional ? '*' : ''}`;
}

export function valueLabelPlan(spec: ChartSpec): ValueLabelPlan {
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
  const tick = (entry: { point: ChartPoint }): AxisTickLabel => ({
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

export function tableModel(spec: ChartSpec): TableModel {
  const caption = `${spec.title} (${spec.unit})`;
  if (spec.kind === 'bar') {
    const periodLabels = new Set(spec.series.flatMap((s) => s.points.map((p) => p.periodLabel)));
    const periodHeader = periodLabels.size === 1 ? [...periodLabels][0] : 'Waarde';
    return {
      caption,
      header: ['Regio', periodHeader],
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
    header: ['Periode', ...spec.series.map((s) => s.label)],
    rows: codes.map((code) => ({
      label: labelByCode.get(code) ?? code,
      cells: spec.series.map((series) => {
        const point = series.points.find((p) => p.periodCode === code);
        return point ? { text: tableCellText(point), resultId: point.resultId } : EMPTY_CELL;
      }),
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
      className="rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm shadow-sm"
    >
      <div className="font-medium text-ink">{label}</div>
      {payload.map((entry) => {
        const display = entry.payload[`${entry.dataKey}_display`];
        if (display == null) return null;
        const provisional = entry.payload[`${entry.dataKey}_provisional`];
        const resultId = entry.payload[`${entry.dataKey}_resultId`];
        return (
          <div
            key={entry.dataKey}
            style={{ color: entry.color }}
            data-label-for={resultId == null ? undefined : String(resultId)}
          >
            {labelByKey.get(entry.dataKey)}: {String(display)}
            {provisional ? ' *' : ''}
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
 * (open-questions #46(b)). */
function SeriesLegend({
  seriesMeta,
  hiddenKeys,
  onToggle,
}: {
  seriesMeta: SeriesMeta[];
  hiddenKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div role="group" aria-label="Reeksen" className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {seriesMeta.map((s) => {
        const hidden = hiddenKeys.has(s.key);
        return (
          <button
            key={s.key}
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
              'inline-flex min-h-6 items-center gap-1.5 rounded px-1 text-xs ' +
              (hidden ? 'text-ink-muted line-through' : 'text-ink')
            }
          >
            <span
              aria-hidden="true"
              style={{ backgroundColor: hidden ? 'var(--ink-muted)' : s.color }}
              className="inline-block h-2.5 w-2.5 rounded-full"
            />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/** Line-chart point marker: filled in the series colour, hollow when
 * provisional (R11, same convention as render.ts), plus the #197 end-of-line
 * label on the series' last plotted point. Recharts passes the Line's own
 * `stroke` into a custom dot's props, so the marker follows the series colour
 * without a second palette lookup. */
function SeriesDot(seriesKey: string, endLabel: PointLabel | undefined) {
  return function Dot(props: { cx?: number; cy?: number; payload?: Row; stroke?: string }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    const value = payload[seriesKey];
    if (value == null) return null;
    const provisional = payload[`${seriesKey}_provisional`];
    const resultId = payload[`${seriesKey}_resultId`];
    const color = props.stroke ?? 'currentColor';
    const isEnd = endLabel !== undefined && payload.periodCode === endLabel.periodCode;
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill={provisional ? 'var(--paper-raised)' : color}
          stroke={color}
          strokeWidth={2}
          data-point="value"
          data-result-id={resultId == null ? undefined : String(resultId)}
        />
        {isEnd ? (
          <text
            x={cx + 8}
            y={cy + 4}
            fontSize={11}
            fill="var(--ink)"
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
 * one — only the prose note said so), plus the #197 value label. */
function SeriesBar(seriesKey: string, color: string, patternId: string, labelByPeriod: Map<string, PointLabel>) {
  return function Shape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
    const { x, y, width, height, payload } = props;
    if (x == null || y == null || width == null || height == null || !payload) return null;
    const value = payload[seriesKey];
    if (value == null) return null;
    const provisional = Boolean(payload[`${seriesKey}_provisional`]);
    const resultId = payload[`${seriesKey}_resultId`];
    const label = labelByPeriod.get(String(payload.periodCode));
    const negative = typeof value === 'number' && value < 0;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={provisional ? `url(#${patternId})` : color}
          stroke={provisional ? color : undefined}
          strokeWidth={provisional ? 1 : undefined}
          data-point="value"
          data-result-id={resultId == null ? undefined : String(resultId)}
        />
        {label ? (
          <text
            x={x + width / 2}
            y={negative ? y + height + 12 : y - 4}
            fontSize={11}
            fill="var(--ink)"
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
 * ever asked for another one, rendering nothing beats inventing a number. */
function AxisTick(tickByValue: Map<number, AxisTickLabel>) {
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
        fill="var(--ink-muted)"
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

const KEYBOARD_HINT = 'Gebruik de pijltjestoetsen om de punten van de grafiek te doorlopen.';

/** Approximate text width at the 11px label font — layout only, so the plot
 * leaves room for the end-of-line label instead of clipping it. */
function labelWidthPx(text: string): number {
  return Math.ceil(text.length * 6.5) + 12;
}

export function ChartView({ spec }: { spec: ChartSpec }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rawId = useId();
  const domId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const coarsePointer = useCoarsePointer();
  // #197 step 2: chart or table. A comparison with more bars than the chart
  // can label opens on the table — the idea bank's >15-categories rule, the
  // honest view for many series.
  const [view, setView] = useState<'chart' | 'table'>(spec.series.length > BAR_LABEL_MAX ? 'table' : 'chart');
  const chartTabRef = useRef<HTMLButtonElement>(null);
  const tableTabRef = useRef<HTMLButtonElement>(null);

  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [smallMultiples, setSmallMultiples] = useState(false);
  const [axisMode, setAxisMode] = useState<'shared' | 'own'>('shared');

  // Stable per-chart identity, not object identity: a fresh spec object can
  // represent the exact same chart across a re-render. Resets the three
  // presentation states above when the viewer is shown a genuinely DIFFERENT
  // chart without ChartView remounting — both the visual dock
  // (visual-dock.tsx) and the Ontdek reading toggle (chart-toggle.tsx) swap
  // `spec` on the same mounted instance (no `key` at either call site), so a
  // useState initializer only runs once and would otherwise leak state
  // across charts. `view` (chart/table, above) is exempt on purpose: it is
  // presentationally valid for ANY spec, so leaking it is harmless. These
  // three are not: a stale hiddenKeys entry that happens to collide with a
  // different chart's own series key can silently drop a real line with no
  // visible disclosure (open-questions #46(a)) or bake a false "N van M
  // reeksen verborgen" claim into an export (#46(c)) — found reachable via
  // ordinary dock-tab switching in the 2026-09-05 final review of this file.
  // React's own documented pattern for this ("adjusting state when a prop
  // changes", no Effect): compare against the last-seen identity and, if it
  // changed, call the setters directly during render.
  const specIdentity = JSON.stringify(spec);
  const [lastSpecIdentity, setLastSpecIdentity] = useState(specIdentity);
  if (specIdentity !== lastSpecIdentity) {
    setLastSpecIdentity(specIdentity);
    setHiddenKeys(new Set());
    setSmallMultiples(false);
    setAxisMode('shared');
  }

  function toggleSeries(key: string): void {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (spec.schemaVersion !== 1) {
    // Renderers dispatch on the schema version (ADR 007); this one only
    // speaks v1 and must say so rather than misrender a future spec — the
    // guard src/chart/render.ts has always had, and this wrapper lacked
    // until #197 (a v2 spec would have rendered silently, possibly wrong).
    return (
      <div className="mt-3 rounded-lg border border-line bg-paper-raised p-3">
        <div role="heading" aria-level={3} className="text-sm font-semibold text-ink">
          {spec.title}
        </div>
        <p className="mt-2 text-sm text-warn">
          Deze grafiek is gemaakt in een nieuwere versie dan deze pagina kan tonen. De cijfers staan in het
          antwoord zelf.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-xs text-ink-muted">{spec.attributionLine}</p>
          <SourceBadge tableId={spec.attribution.tableId} syncedAt={spec.attribution.syncedAt} />
        </div>
      </div>
    );
  }

  const { rows, seriesMeta } = buildRows(spec);
  const dimEntries = Object.entries(spec.dimLabels);
  const markers = annotationMarkers(spec, rows);
  const plan = valueLabelPlan(spec);
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
  const accessibleName = `Grafiek: ${spec.title} (${spec.unit})`;
  const smallMultiplesAvailable = spec.kind === 'line' && seriesMeta.length > 1;
  const hiddenDisclosure =
    hiddenKeys.size > 0 ? ` ${hiddenKeys.size} van ${seriesMeta.length} reeksen verborgen.` : '';
  const tooltipTrigger = coarsePointer ? 'click' : 'hover';
  const table = tableModel(spec);
  const panelId = `${domId}-panel`;

  function selectView(next: 'chart' | 'table'): void {
    setView(next);
    (next === 'chart' ? chartTabRef : tableTabRef).current?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      selectView(view === 'chart' ? 'table' : 'chart');
    }
  }

  const tabClass = (active: boolean): string =>
    'min-h-6 rounded-full border px-2.5 py-1 text-xs ' +
    (active ? 'border-line-strong bg-paper-sunken text-ink' : 'border-line-strong text-ink-soft hover:bg-paper-sunken');

  return (
    <div className="mt-3 rounded-lg border border-line bg-paper-raised p-3">
      <div role="heading" aria-level={3} className="text-sm font-semibold text-ink">
        {spec.title}
      </div>
      {dimEntries.length > 0 ? (
        <div className="text-xs text-ink-muted">
          {dimEntries.map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </div>
      ) : null}
      <div className="text-xs text-ink-muted">{spec.unit}</div>
      <div role="tablist" aria-label="Weergave" onKeyDown={onTabKeyDown} className="mt-2 flex flex-wrap gap-2">
        <button
          ref={chartTabRef}
          type="button"
          role="tab"
          aria-selected={view === 'chart'}
          aria-controls={panelId}
          tabIndex={view === 'chart' ? 0 : -1}
          onClick={() => selectView('chart')}
          className={tabClass(view === 'chart')}
        >
          Grafiek
        </button>
        <button
          ref={tableTabRef}
          type="button"
          role="tab"
          aria-selected={view === 'table'}
          aria-controls={panelId}
          tabIndex={view === 'table' ? 0 : -1}
          onClick={() => selectView('table')}
          className={tabClass(view === 'table')}
        >
          Tabel
        </button>
      </div>
      {view === 'table' ? (
        <div id={panelId} role="tabpanel" aria-label="Tabel" className="mt-2 overflow-x-auto">
          <table className="w-full text-sm" aria-label={table.caption}>
            <thead>
              <tr>
                {table.header.map((h) => (
                  <th key={h} scope="col" className="border-b border-line-strong px-2 py-1 text-left font-medium text-ink-soft">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.label} className="border-b border-line">
                  <th scope="row" className="px-2 py-1 text-left font-normal text-ink">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td
                      key={table.header[i + 1] ?? i}
                      className="px-2 py-1 text-right text-ink"
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
        aria-label="Grafiek"
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
      >
        {smallMultiples && smallMultiplesAvailable ? (
          <ChartSmallMultiples spec={spec} hiddenKeys={hiddenKeys} axisMode={axisMode} />
        ) : (
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 256 }}>
          {spec.kind === 'line' ? (
            <LineChart
              data={rows}
              margin={{ top: 8, right: rightMargin, left: 8, bottom: 8 }}
              desc={KEYBOARD_HINT}
              aria-label={accessibleName}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="periodLabel" tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} />
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
                domain={yAxisDomain(spec.kind)}
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
                  stroke="var(--ink-muted)"
                  strokeDasharray="3 3"
                />
              ))}
              {seriesMeta
                .filter((s) => !hiddenKeys.has(s.key))
                .map((s) => (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dasharray}
                    connectNulls={false}
                    dot={SeriesDot(s.key, endLabelByKey.get(s.key))}
                    isAnimationActive={false}
                  />
                ))}
            </LineChart>
          ) : (
            <BarChart
              data={rows}
              margin={{ top: 16, right: 8, left: 8, bottom: 8 }}
              desc={KEYBOARD_HINT}
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
                    <rect width={6} height={6} fill="var(--paper-raised)" />
                    <line x1={0} y1={0} x2={0} y2={6} stroke={s.color} strokeWidth={2} />
                  </pattern>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="periodLabel" tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} />
              <YAxis tick={false} width={16} domain={yAxisDomain(spec.kind)} />
              <Tooltip trigger={tooltipTrigger} content={<ChartTooltip seriesMeta={seriesMeta} />} />
              {seriesMeta
                .filter((s) => !hiddenKeys.has(s.key))
                .map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={s.color}
                    isAnimationActive={false}
                    shape={SeriesBar(
                      s.key,
                      s.color,
                      `hatch-${domId}-${s.key}`,
                      barLabelsByKey.get(s.key) ?? new Map<string, PointLabel>(),
                    )}
                  />
                ))}
            </BarChart>
          )}
        </ResponsiveContainer>
        )}
      </div>
      )}
      {view === 'chart' && seriesMeta.length > 1 ? (
        <>
          <SeriesLegend seriesMeta={seriesMeta} hiddenKeys={hiddenKeys} onToggle={toggleSeries} />
          {hiddenKeys.size > 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              {hiddenKeys.size} van {seriesMeta.length} reeksen verborgen
            </p>
          ) : null}
        </>
      ) : null}
      {view === 'chart' && smallMultiplesAvailable ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={smallMultiples}
            onClick={() => setSmallMultiples((v) => !v)}
            className={tabClass(smallMultiples)}
          >
            Kleine grafieken
          </button>
          {smallMultiples ? (
            <div role="group" aria-label="Gelijke assen of eigen assen" className="flex gap-2">
              <button
                type="button"
                aria-pressed={axisMode === 'shared'}
                onClick={() => setAxisMode('shared')}
                className={tabClass(axisMode === 'shared')}
              >
                Gelijke assen
              </button>
              <button
                type="button"
                aria-pressed={axisMode === 'own'}
                onClick={() => setAxisMode('own')}
                className={tabClass(axisMode === 'own')}
              >
                Eigen assen
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {/* #197: the hollow marker needs a key a lay reader can decode without
        * reading the note first; rendered exactly when the spec says a
        * provisional point exists (R11's provisionalNote is present iff). */}
      {spec.provisionalNote ? <p className="mt-1 text-xs text-ink-muted">○ = voorlopig cijfer</p> : null}
      {/* WP23 (#92): caveats read like caveats — warn and a step larger than
        * the source credit, which stays smallest/lightest (photo-credit
        * style). Content untouched: same strings from the same one builder
        * (R4); only presentation changes here. */}
      {spec.provisionalNote ? <p className="mt-2 text-sm text-warn">{spec.provisionalNote}</p> : null}
      {spec.nullNotes.map((note) => (
        <p key={note} className="text-sm text-warn">
          {note}
        </p>
      ))}
      {spec.definitionLine ? <p className="mt-2 text-xs text-ink-muted">{spec.definitionLine}</p> : null}
      {/* #170(4): curated event markers, always-visible text (never
        * hover-only — see the ReferenceLine comment above). Neutral tone
        * (text-ink-muted), distinct from the #92 amber caveats above: this
        * is contextual metadata, not a data-quality warning. */}
      {markers.map((m) => (
        <p key={m.label} className="text-xs text-ink-muted">
          Gemarkeerd in de grafiek: {m.label}
        </p>
      ))}
      {/* #170(1): the R4 prose credit keeps its photo-credit size (#92); the
        * badge is the same attribution made SCANNABLE — table id + measured
        * sync date + deep link, from spec.attribution only (the source key is
        * derived from the table id inside the badge; ChartAttribution carries
        * none). Ontdek reuses this component, so the homepage charts get the
        * identical badge for free. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xs text-ink-muted">{spec.attributionLine}</p>
        <SourceBadge tableId={spec.attribution.tableId} syncedAt={spec.attribution.syncedAt} />
        {/* #170(3): download-as-image, PNG or SVG, attribution baked into
          * the file itself — not just shown on this page — via the SAME
          * spec.attributionLine string shown above (R4: one builder, one
          * sentence, never re-derived here). Not offered in small-multiples
          * view (idea 8): ChartDownloadMenu grabs the first <svg> under the
          * container, which in that view is just one series' own mini panel
          * — exporting it under the full chart's filename/attribution would
          * silently misrepresent what's shown, the same risk #46(c) already
          * names for exports. Same precedent as the Tabel view below, which
          * has never offered a download either. */}
        {view === 'chart' && !smallMultiples ? (
          <ChartDownloadMenu
            containerRef={chartContainerRef}
            attributionText={`${spec.attributionLine} checkdecijfers.nl${hiddenDisclosure}`}
            filenameBase={`checkdecijfers-${spec.attribution.tableId}`}
          />
        ) : null}
      </div>
    </div>
  );
}
