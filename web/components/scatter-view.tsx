// #296 part 2 Task 6: the two-measure scatter card — one dot per region, the
// asked-about measure (spec.y) on the vertical axis, the added measure
// (spec.x) on the horizontal one. A sibling of ChartView (chart.tsx), not a
// ChartForm inside it (spec D8): a scatter needs two measures, and none of
// ChartView's one-measure machinery (forms, co-pilot, story, style) applies.
//
// Honesty contract — the SAME one chart.tsx's header states: every numeric
// STRING a viewer can read is a point's own pre-formatted string
// (`yFormatted`/`xFormatted`), never Recharts' formatting of the raw number;
// the raw `x`/`y` are geometry only (where a dot sits, which dots are the
// axis extremes). Every displayed value is bound to its source cell via
// `data-label-for="<resultId>"`. Axis ticks follow chart.tsx's own rule (see
// `valueLabelPlan`/`AxisTick`) generalised: up to five ticks per axis, each a
// REAL plotted value labelled with that point's own string (`scatterTicks`) —
// no invented tick values, on a linear or a log axis alike. On an English card the strings go through
// the same notation swap an English line chart uses (`toEnglishNumberToken`,
// the one step `toEnglishChartSpec` applies to `formattedValue`) — the digits
// themselves never change.
//
// Log/swap/search/table are VIEW state only (spec: never saved to
// chart_edits): plain `useState`, reset by a remount.
'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  CartesianGrid,
  DefaultZIndexes,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
  ZIndexLayer,
} from 'recharts';
import {
  PROVISIONAL_NOTE,
  PROVISIONAL_NOTE_EN,
  SCATTER_SPEC_VERSION,
  type AxisScale,
  type ScatterAxis,
  type ScatterPoint,
  type ScatterSpec,
} from '../backend/chart/index.ts';
import { regionLabelEn } from '../backend/answer/respond/english.ts';
import { toEnglishNumberToken } from '../backend/answer/translate/mask.ts';
import { AXIS_COLOR, embedHeightValue, GRID_LINE_PROPS, labelWidthPx, type AxisTickLabel } from '../lib/chart-models.ts';
import { DEFAULT_PALETTE } from '../lib/chart-presentation.ts';
import { translateAttributionLine } from '../lib/i18n/cbs-words.ts';
import { useLang } from '../lib/i18n/lang-provider.tsx';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { scatterAxisTitle, scatterBodyEn, scatterLineEn, scatterTitleEn } from '../lib/scatter-text-en.ts';
import { useElementWidth } from '../lib/use-element-width.ts';
import { useCoarsePointer } from './chart-parts.tsx';
import { ChartDownloadMenu } from './chart-download.tsx';
import { APP_URL, ChartEmbedButton } from './chart-embed-dialog.tsx';
import { SourceBadge } from './source-badge.tsx';

/** The search lists (and labels on the chart) at most this many matches. */
export const SCATTER_SEARCH_LIST_MAX = 5;

/** Dot geometry. A highlighted (searched) dot is larger AND outlined — size
 * and outline are the non-colour channels, so a highlight never relies on
 * colour alone. */
const DOT_R = 4.5;
const DOT_R_HIGHLIGHT = 7;
/** Base dots are the designed palette's first colour, highlighted ones its
 * second (Okabe–Ito blue / vermillion — ≥ 3:1 on both card themes, pinned in
 * chart-presentation.ts). One palette for both themes, like every chart. */
const DOT_COLOR = DEFAULT_PALETTE[0]!;
const DOT_COLOR_HIGHLIGHT = DEFAULT_PALETTE[1]!;

const AXIS_TITLE_LINE_PX = 14;
const AXIS_TITLE_CHAR_PX = 6.6;
const X_AXIS_HEIGHT_PX = 22;
const LABEL_CHAR_PX = 6.5;
const LABEL_HEIGHT_PX = 12;

/** A square-ish plot reads best for two measures: height follows the
 * measured width (ADR 042's rule, a taller ratio than the line chart's 9:16),
 * never below 300 px (a phone) nor above 460 px. Unmeasured (SSR, jsdom) =
 * 320 px. */
export function scatterHeightForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 320;
  return Math.max(300, Math.min(460, Math.round(width * 0.72)));
}

/** Greedy word wrap for SVG text (which never wraps by itself), so a long
 * measure title stays inside the chart at phone width — and inside the
 * PNG/SVG export, which copies the live <svg>. */
export function wrapWords(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= maxChars) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/** Case- and accent-insensitive search key ("Fryslân" ~ "fryslan"). */
function searchKey(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function displayNumber(formatted: string, lang: Lang): string {
  return lang === 'en' ? toEnglishNumberToken(formatted) : formatted;
}

function displayRegion(label: string, lang: Lang): string {
  return lang === 'en' ? regionLabelEn(label) : label;
}

function starred(text: string, provisional: boolean): string {
  return provisional ? `${text}*` : text;
}

function logCapable(axis: ScatterAxis, values: number[]): boolean {
  return axis.defaultScale === 'log' || (values.length > 0 && values.every((v) => v > 0));
}

/** A padded domain around the plotted values, so no dot sits on the frame.
 * Geometry only — never shown as a number. */
function domainFor(values: number[], log: boolean): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (log) {
    const factor = hi === lo ? 1.2 : Math.min(1.5, Math.max(1.05, (hi / lo) ** 0.05));
    return [lo / factor, hi * factor];
  }
  const pad = hi === lo ? Math.abs(hi) * 0.1 || 1 : (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

interface ScatterRow {
  code: string;
  point: ScatterPoint;
  /** The region name as displayed (translated on an English card). */
  label: string;
  /** Horizontal / vertical value after an axis swap — geometry only. */
  h: number;
  v: number;
  highlighted: boolean;
  dimmed: boolean;
}

type AxisSide = 'y' | 'x';

interface ShownAxis {
  side: AxisSide;
  axis: ScatterAxis;
  values: number[];
  log: boolean;
  title: string;
  ticks: AxisTickLabel[];
  domain: [number, number];
}

/** At most this many ticks per axis (fix round 1: min/max alone left the
 * spread unreadable). */
export const SCATTER_MAX_TICKS = 5;

/** The axis ticks: up to SCATTER_MAX_TICKS REAL plotted values — never an
 * invented round number, so every digit on the chart stays a point's own
 * formatted string bound to its cell (chart.tsx's convention, generalised
 * from min/max). The plotted values nearest to evenly spaced positions
 * between the minimum and the maximum, measured IN THE AXIS'S CURRENT SCALE
 * (log positions on a log axis), de-duplicated, ascending; min and max are
 * always among them. Ties go to the first point in spec order —
 * deterministic. Then a label-collision pass over the approximate axis
 * length (`lengthPx`): a middle tick whose label would touch a kept
 * neighbour is dropped (min and max always stay), so a clustered pick or a
 * phone-width axis never prints overlapping numbers. */
export function scatterTicks(
  points: ScatterPoint[],
  side: AxisSide,
  log: boolean,
  lang: Lang,
  orientation: 'vertical' | 'horizontal',
  lengthPx: number,
): AxisTickLabel[] {
  if (points.length === 0) return [];
  const tf = (v: number): number => (log ? Math.log10(v) : v);
  const tvals = points.map((p) => tf(p[side]));
  const lo = Math.min(...tvals);
  const hi = Math.max(...tvals);
  const picked: ScatterPoint[] = [];
  const steps = lo === hi ? 1 : SCATTER_MAX_TICKS;
  for (let i = 0; i < steps; i++) {
    const target = steps === 1 ? lo : lo + ((hi - lo) * i) / (steps - 1);
    let best = 0;
    for (let j = 1; j < points.length; j++) {
      if (Math.abs(tvals[j]! - target) < Math.abs(tvals[best]! - target)) best = j;
    }
    const p = points[best]!;
    if (!picked.some((q) => q[side] === p[side])) picked.push(p);
  }
  picked.sort((a, b) => a[side] - b[side]);
  const tick = (p: ScatterPoint): AxisTickLabel => ({
    value: p[side],
    display: displayNumber(side === 'y' ? p.yFormatted : p.xFormatted, lang),
    resultId: side === 'y' ? p.yResultId : p.xResultId,
  });
  const ticks = picked.map(tick);
  if (ticks.length <= 2 || hi === lo) return ticks;
  // Collision pass, in pixels along the axis.
  const pos = (tk: AxisTickLabel): number => ((tf(tk.value) - lo) / (hi - lo)) * lengthPx;
  const extent = (tk: AxisTickLabel): number =>
    orientation === 'horizontal' ? tk.display.length * LABEL_CHAR_PX + 8 : LABEL_HEIGHT_PX + 4;
  const first = ticks[0]!;
  const last = ticks[ticks.length - 1]!;
  const kept: AxisTickLabel[] = [first];
  for (const tk of ticks.slice(1, -1)) {
    const prev = kept[kept.length - 1]!;
    const clearsPrev = pos(tk) - pos(prev) >= (extent(tk) + extent(prev)) / 2;
    const clearsLast = pos(last) - pos(tk) >= (extent(tk) + extent(last)) / 2;
    if (clearsPrev && clearsLast) kept.push(tk);
  }
  kept.push(last);
  return kept;
}

/** chart-parts.tsx's `AxisTick` contract (a tick shows only a point's own
 * display string, bound to its cell, or nothing), with an anchor per axis
 * orientation — the horizontal axis's tick sits centred under its value. */
function ScatterAxisTick(tickByValue: Map<number, AxisTickLabel>, orientation: 'vertical' | 'horizontal') {
  return function Tick(props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
    const value = props.payload?.value;
    const tick = typeof value === 'number' ? tickByValue.get(value) : undefined;
    if (!tick || props.x == null || props.y == null) return null;
    return (
      <text
        x={props.x}
        y={props.y}
        dy={orientation === 'vertical' ? 4 : 12}
        fontSize={11}
        fill={AXIS_COLOR}
        textAnchor={orientation === 'vertical' ? 'end' : 'middle'}
        data-role="axis-tick"
        data-axis={orientation}
        data-label-for={tick.resultId}
      >
        {tick.display}
      </text>
    );
  };
}

/** Both axis titles, drawn INSIDE the svg so the PNG/SVG export carries them:
 * the vertical one horizontally at the top-left (readable without tilting
 * your head, and wrappable), the horizontal one right-aligned under the
 * x-axis ticks. */
function AxisTitles({ vertical, horizontal }: { vertical: string[]; horizontal: string[] }) {
  const plot = usePlotArea();
  if (!plot) return null;
  const xTitleTop = plot.y + plot.height + X_AXIS_HEIGHT_PX + 10;
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g>
        <text x={2} y={12} fontSize={12} fontWeight={500} fill="var(--foreground)" textAnchor="start" data-role="axis-title" data-axis="vertical">
          {vertical.map((line, i) => (
            <tspan key={i} x={2} dy={i === 0 ? 0 : AXIS_TITLE_LINE_PX}>
              {line}
            </tspan>
          ))}
        </text>
        <text
          x={plot.x + plot.width}
          y={xTitleTop}
          fontSize={12}
          fontWeight={500}
          fill="var(--foreground)"
          textAnchor="end"
          data-role="axis-title"
          data-axis="horizontal"
        >
          {horizontal.map((line, i) => (
            <tspan key={i} x={plot.x + plot.width} dy={i === 0 ? 0 : AXIS_TITLE_LINE_PX}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </ZIndexLayer>
  );
}

interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Region names next to the labelled extremes (spec D7) and the searched
 * dots. Names, never numbers. Each label tries right, left, above, below its
 * dot and takes the first spot that overlaps no label already placed and
 * stays inside the plot; with no free spot it still goes right — a name is
 * never silently dropped. A card-coloured halo keeps it legible over dots. */
function PointLabels({ rows }: { rows: ScatterRow[] }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot || rows.length === 0) return null;
  const placed: Array<LabelBox & { row: ScatterRow; anchor: 'start' | 'end' | 'middle'; tx: number; ty: number }> = [];
  for (const row of rows) {
    const cx = Number(xScale(row.h));
    const cy = Number(yScale(row.v));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    const text = starred(row.label, row.point.provisional);
    const w = text.length * LABEL_CHAR_PX;
    const gap = (row.highlighted ? DOT_R_HIGHLIGHT : DOT_R) + 3;
    const candidates = [
      { anchor: 'start' as const, tx: cx + gap, ty: cy + 4, box: { x: cx + gap, y: cy - 6, w, h: LABEL_HEIGHT_PX } },
      { anchor: 'end' as const, tx: cx - gap, ty: cy + 4, box: { x: cx - gap - w, y: cy - 6, w, h: LABEL_HEIGHT_PX } },
      { anchor: 'middle' as const, tx: cx, ty: cy - gap - 2, box: { x: cx - w / 2, y: cy - gap - 12, w, h: LABEL_HEIGHT_PX } },
      { anchor: 'middle' as const, tx: cx, ty: cy + gap + 10, box: { x: cx - w / 2, y: cy + gap, w, h: LABEL_HEIGHT_PX } },
    ];
    const inside = (b: LabelBox) => b.x >= plot.x && b.x + b.w <= plot.x + plot.width && b.y >= plot.y - 4 && b.y + b.h <= plot.y + plot.height + 4;
    const choice = candidates.find((c) => inside(c.box) && !placed.some((p) => overlaps(p, c.box))) ?? candidates.find((c) => inside(c.box)) ?? candidates[0]!;
    placed.push({ ...choice.box, row, anchor: choice.anchor, tx: choice.tx, ty: choice.ty });
  }
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g pointerEvents="none">
        {placed.map((p) => (
          <text
            key={p.row.code}
            x={p.tx}
            y={p.ty}
            fontSize={11}
            fontWeight={p.row.highlighted ? 600 : 400}
            fill="var(--foreground)"
            stroke="var(--card)"
            strokeWidth={3}
            paintOrder="stroke"
            textAnchor={p.anchor}
            data-role="point-label"
            data-region={p.row.code}
          >
            {starred(p.row.label, p.row.point.provisional)}
          </text>
        ))}
      </g>
    </ZIndexLayer>
  );
}

function ScatterDot(props: { cx?: number; cy?: number; payload?: ScatterRow }): ReactElement {
  const { cx, cy, payload: row } = props;
  if (cx == null || cy == null || !row) return <g />;
  const provisional = row.point.provisional;
  const color = row.highlighted ? DOT_COLOR_HIGHLIGHT : DOT_COLOR;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={row.highlighted ? DOT_R_HIGHLIGHT : DOT_R}
      // R11: a provisional point is drawn HOLLOW (the SeriesDot convention),
      // on top of the '*' its name carries everywhere it is written.
      fill={provisional ? 'var(--card)' : color}
      fillOpacity={provisional ? 1 : row.highlighted ? 0.95 : 0.65}
      stroke={row.highlighted ? 'var(--foreground)' : color}
      strokeWidth={row.highlighted || provisional ? 2 : 1}
      opacity={row.dimmed ? 0.3 : 1}
      data-point="value"
      data-region={row.code}
      data-highlighted={row.highlighted ? 'true' : 'false'}
      data-provisional={provisional ? 'true' : undefined}
    />
  );
}

/** The dot tooltip: the region, then the vertical-measure (y) line and the
 * horizontal-measure (x) line, each value the point's own string bound to its
 * cell, then — for a provisional point — its '*' and the provisional note.
 * A polite live region, like ChartTooltip, so keyboard navigation through
 * the dots is announced. Exported for direct testing (the tooltip only mounts
 * on hover in a real browser). */
export function ScatterTooltip({
  active,
  payload,
  spec,
  lang,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: { point?: ScatterPoint } }>;
  spec: ScatterSpec;
  lang: Lang;
}) {
  const point = payload?.[0]?.payload?.point;
  if (!active || !point) return null;
  const lines: Array<{ side: AxisSide; axis: ScatterAxis; value: string; resultId: string }> = [
    { side: 'y', axis: spec.y, value: point.yFormatted, resultId: point.yResultId },
    { side: 'x', axis: spec.x, value: point.xFormatted, resultId: point.xResultId },
  ];
  return (
    <div
      role="status"
      aria-live="polite"
      className="max-w-72 min-w-44 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
    >
      <div className="mb-1 font-medium">{starred(displayRegion(point.label, lang), point.provisional)}</div>
      {lines.map((line) => (
        <div key={line.side} className="flex items-baseline gap-2" data-label-for={line.resultId}>
          <span className="text-xs text-muted-foreground">{scatterAxisTitle(line.axis, lang, false)}:</span>
          <span className="ml-auto font-medium tabular-nums">{displayNumber(line.value, lang)}</span>
        </div>
      ))}
      {point.provisional ? (
        <div className="mt-1 text-xs text-warning">{lang === 'en' ? PROVISIONAL_NOTE_EN : PROVISIONAL_NOTE}</div>
      ) : null}
    </div>
  );
}

function provisionalNoteFor(spec: ScatterSpec, lang: Lang): string | null {
  if (spec.provisionalNote === null) return null;
  // Same rule as toEnglishChartSpec: only the ONE recognised Dutch constant
  // has an English sibling; anything else passes through unguessed.
  return lang === 'en' && spec.provisionalNote === PROVISIONAL_NOTE ? PROVISIONAL_NOTE_EN : spec.provisionalNote;
}

/** Both axes' R4 attribution sentences, in axis order (y, then x); one line
 * when both axes come from the same table and period (identical sentences). */
function attributionLinesFor(spec: ScatterSpec, lang: Lang): string[] {
  const lines = [...new Set([spec.y.attributionLine, spec.x.attributionLine])];
  return lang === 'en' ? lines.map(translateAttributionLine) : lines;
}

export function ScatterView({
  spec,
  body,
  scatterLine,
  extraLines = [],
  warningLines = [],
  frameless = false,
  embed,
  embedMode = false,
  embedFooter,
}: {
  spec: ScatterSpec;
  /** The stored Dutch body (`answer.body`, scatterBodyNl). Shown on a Dutch
   * card; on an English card its presence means "show the body" and the text
   * is `scatterBodyEn(spec)` instead. Absent = no body line. */
  body?: string;
  /** The stored Dutch coverage line (`answer.scatterLine`, scatterLineNl);
   * English: `scatterLineEn(spec)`, same presence rule as `body`. */
  scatterLine?: string;
  /** Structural lines the CALLER has already localized (the definition lines,
   * a staleness warning) — rendered under the coverage line, in order. */
  extraLines?: string[];
  /** Cautions the CALLER has already localized (the staleness lines, one per
   * stale table) — shown in the one-measure answer card's warning style
   * (text-sm text-warning), DIRECTLY under the coverage line and above
   * `extraLines`, never as muted fine print (#296 part 2 Task 7 fix I1).
   * Shown in embed mode too. */
  warningLines?: string[];
  /** Same as ChartView's: drop the card frame when the mount point already is
   * a card (the visual dock). */
  frameless?: boolean;
  /** Same as ChartView's: when present, the footer offers Embed for THIS
   * answer's own audit row. Never combined with embedMode. */
  embed?: { auditId: number } | null;
  /** Same as ChartView's: true only on the public /embed/[token] page —
   * strips every control (view tabs, search, log, swap, download, embed)
   * and shows `embedFooter` with the backlink instead. The plot, its titles
   * and both attributions are unchanged. */
  embedMode?: boolean;
  /** Same as ChartView's: the embed page's own footer sentence; the backlink
   * is appended here. Ignored unless embedMode. */
  embedFooter?: string;
}) {
  const lang = useLang();
  const rawId = useId();
  const domId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const chartTabRef = useRef<HTMLButtonElement>(null);
  const tableTabRef = useRef<HTMLButtonElement>(null);
  const coarsePointer = useCoarsePointer();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [swapped, setSwapped] = useState(false);
  const [scales, setScales] = useState<Record<AxisSide, AxisScale>>({ y: spec.y.defaultScale, x: spec.x.defaultScale });
  const [query, setQuery] = useState('');
  const [embedOpen, setEmbedOpen] = useState(false);
  const measuredWidth = useElementWidth(containerRef, view === 'chart');

  const matches = useMemo(() => {
    const q = searchKey(query.trim());
    if (q === '') return [];
    return spec.points.filter(
      (p) => searchKey(p.label).includes(q) || searchKey(displayRegion(p.label, lang)).includes(q),
    );
  }, [query, spec.points, lang]);
  const matchCodes = new Set(matches.map((p) => p.regionCode));
  const searching = query.trim() !== '';

  if (spec.schemaVersion !== SCATTER_SPEC_VERSION) {
    // Mirrors chart.tsx's schemaVersion guard: a spec from a newer builder is
    // refused, never half-drawn. The attribution still shows.
    return (
      <div className={frameless ? '' : 'mt-3 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6'}>
        <div role="heading" aria-level={3} className="text-sm font-semibold text-foreground">
          {spec.title}
        </div>
        <p className="mt-2 text-sm text-warning">{t(lang, 'chart.schemaRefusal')}</p>
        {attributionLinesFor(spec, lang).map((line) => (
          <p key={line} className="mt-1 text-xs text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
    );
  }

  const title = lang === 'en' ? scatterTitleEn(spec) : spec.title;
  const shownBody = body === undefined ? null : lang === 'en' ? scatterBodyEn(spec) : body;
  const shownLine = scatterLine === undefined ? null : lang === 'en' ? scatterLineEn(spec) : scatterLine;
  const provisionalNote = provisionalNoteFor(spec, lang);
  const attributionLines = attributionLinesFor(spec, lang);
  const tableIds = [...new Set([spec.y.tableId, spec.x.tableId])];
  // One badge per distinct table, with that table's own measured sync date
  // (like the one-measure chart's badge).
  const badges = tableIds.map((id) => ({ id, syncedAt: (spec.y.tableId === id ? spec.y : spec.x).syncedAt }));

  const values: Record<AxisSide, number[]> = { y: spec.points.map((p) => p.y), x: spec.points.map((p) => p.x) };
  const capable: Record<AxisSide, boolean> = { y: logCapable(spec.y, values.y), x: logCapable(spec.x, values.x) };
  const width = measuredWidth > 0 ? measuredWidth : 640;
  const height = scatterHeightForWidth(measuredWidth);
  const shownAxis = (side: AxisSide, orientation: 'vertical' | 'horizontal'): ShownAxis => {
    const axis = spec[side];
    // A log scale needs every value > 0; never draw one otherwise.
    const log = scales[side] === 'log' && values[side].length > 0 && values[side].every((v) => v > 0);
    // Approximate plotted length (the card minus the y-axis and margins) —
    // only the tick-label collision pass reads it, never a drawn number.
    const lengthPx = orientation === 'horizontal' ? Math.max(120, width - 96 - 28) : Math.max(120, height - 96);
    return {
      side,
      axis,
      values: values[side],
      log,
      title: scatterAxisTitle(axis, lang, log),
      ticks: scatterTicks(spec.points, side, log, lang, orientation, lengthPx),
      domain: values[side].length > 0 ? domainFor(values[side], log) : [0, 1],
    };
  };
  const vertical = shownAxis(swapped ? 'x' : 'y', 'vertical');
  const horizontal = shownAxis(swapped ? 'y' : 'x', 'horizontal');

  const rows: ScatterRow[] = spec.points
    .map((p) => ({
      code: p.regionCode,
      point: p,
      label: displayRegion(p.label, lang),
      h: p[horizontal.side],
      v: p[vertical.side],
      highlighted: matchCodes.has(p.regionCode),
      dimmed: matches.length > 0 && !matchCodes.has(p.regionCode),
    }))
    // Highlighted dots draw last, on top of the rest.
    .sort((a, b) => Number(a.highlighted) - Number(b.highlighted));
  const labelledCodes = new Set(spec.labelled);
  const labelRows = rows.filter(
    (r) => labelledCodes.has(r.code) || (r.highlighted && matches.length <= SCATTER_SEARCH_LIST_MAX),
  );

  const titleChars = Math.max(16, Math.floor((width - 8) / AXIS_TITLE_CHAR_PX));
  const verticalTitleLines = wrapWords(vertical.title, titleChars);
  const horizontalTitleLines = wrapWords(horizontal.title, titleChars);
  const yAxisWidth = Math.min(
    96,
    Math.max(24, labelWidthPx(vertical.ticks.reduce((w, tk) => (tk.display.length > w.length ? tk.display : w), ''))),
  );
  const tooltipTrigger = coarsePointer ? 'click' : 'hover';
  const panelId = `${domId}-panel`;
  const frameClass = frameless ? '' : 'mt-3 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6';

  const selectView = (next: 'chart' | 'table') => {
    setView(next);
    (next === 'chart' ? chartTabRef : tableTabRef).current?.focus();
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    selectView(view === 'chart' ? 'table' : 'chart');
  };

  // chart.tsx's quiet underline tabs and pill toggles, verbatim classes —
  // `min-h-11 sm:min-h-6` keeps the 44 px phone tap target (R9.1, #238).
  const quietTab = (isActive: boolean): string =>
    'min-h-11 sm:min-h-6 border-b-2 px-1.5 py-1 text-xs transition-colors ' +
    (isActive ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground');
  const pill = (isActive: boolean): string =>
    'min-h-11 sm:min-h-6 rounded-full border px-2.5 py-1 text-xs ' +
    (isActive
      ? 'border-transparent bg-secondary text-foreground'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground');

  const toggleScale = (side: AxisSide) =>
    setScales((current) => ({ ...current, [side]: current[side] === 'log' ? 'linear' : 'log' }));

  const tickByValue = (ticks: AxisTickLabel[]) => new Map(ticks.map((tk) => [tk.value, tk]));

  const canvasNode = (
    <div
      id={panelId}
      // Final-review fix M3: a tabpanel only where a tablist controls it —
      // embed mode renders no view tabs, so the canvas is a plain container.
      {...(embedMode ? {} : { role: 'tabpanel', 'aria-label': t(lang, 'chart.scatter.tabChart') })}
      ref={containerRef}
      data-testid="scatter-container"
      // touch-pan-y: a tap-to-pin tooltip must not fight vertical page
      // scrolling on a phone (chart.tsx's own reason).
      className="mt-2 w-full touch-pan-y"
      style={{ height: embedMode ? embedHeightValue(height) : height }}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 320 }}>
        <ScatterChart
          aria-label={t(lang, 'chart.scatter.ariaLabel', { title })}
          // Final-review fix M3: never promise arrow-key navigation (Recharts'
          // ScatterChart keyboard support is not verified) — point to the
          // Table view, the verified accessible way to read every value. Embed
          // mode has no Table view, so no such description there.
          desc={embedMode ? undefined : t(lang, 'chart.scatter.tableHint')}
          margin={{
            top: 8 + verticalTitleLines.length * AXIS_TITLE_LINE_PX,
            right: 24,
            bottom: 4 + horizontalTitleLines.length * AXIS_TITLE_LINE_PX,
            left: 4,
          }}
        >
          {/* Light gridlines exactly at the ticks (the grid follows the axis
            * ticks) — the shared grid token every chart uses. */}
          <CartesianGrid {...GRID_LINE_PROPS} />
          <XAxis
            type="number"
            dataKey="h"
            scale={horizontal.log ? 'log' : 'linear'}
            domain={horizontal.domain}
            allowDataOverflow
            ticks={horizontal.ticks.map((tk) => tk.value)}
            interval={0}
            tick={ScatterAxisTick(tickByValue(horizontal.ticks), 'horizontal')}
            tickLine={false}
            axisLine={{ stroke: AXIS_COLOR }}
            height={X_AXIS_HEIGHT_PX}
          />
          <YAxis
            type="number"
            dataKey="v"
            scale={vertical.log ? 'log' : 'linear'}
            domain={vertical.domain}
            allowDataOverflow
            ticks={vertical.ticks.map((tk) => tk.value)}
            interval={0}
            tick={ScatterAxisTick(tickByValue(vertical.ticks), 'vertical')}
            tickLine={false}
            axisLine={{ stroke: AXIS_COLOR }}
            width={yAxisWidth}
          />
          <Tooltip trigger={tooltipTrigger} cursor={false} content={<ScatterTooltip spec={spec} lang={lang} />} />
          <Scatter data={rows} shape={ScatterDot} isAnimationActive={false} />
          <PointLabels rows={labelRows} />
          <AxisTitles vertical={verticalTitleLines} horizontal={horizontalTitleLines} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );

  const yTitle = scatterAxisTitle(spec.y, lang, false);
  const xTitle = scatterAxisTitle(spec.x, lang, false);
  const tableNode = (
    <div id={panelId} role="tabpanel" aria-label={t(lang, 'chart.tabTable')} className="mt-2 max-h-[28rem] overflow-auto">
      <table className="w-full text-sm" aria-label={title}>
        <thead className="sticky top-0 bg-card">
          <tr>
            <th scope="col" className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground">
              {t(lang, 'chart.table.region')}
            </th>
            <th scope="col" className="border-b border-border px-2 py-1 text-right font-medium text-muted-foreground">
              {yTitle}
            </th>
            <th scope="col" className="border-b border-border px-2 py-1 text-right font-medium text-muted-foreground">
              {xTitle}
            </th>
          </tr>
        </thead>
        <tbody>
          {spec.points.map((p) => {
            const hit = matchCodes.has(p.regionCode);
            return (
              <tr
                key={p.regionCode}
                data-highlighted={hit ? 'true' : 'false'}
                className={`border-b border-border ${hit ? 'bg-muted font-medium' : ''}`}
              >
                <th scope="row" className={`px-2 py-1 text-left text-foreground ${hit ? 'font-semibold' : 'font-normal'}`}>
                  {starred(displayRegion(p.label, lang), p.provisional)}
                </th>
                <td className="px-2 py-1 text-right text-foreground tabular-nums" data-label-for={p.yResultId}>
                  {displayNumber(p.yFormatted, lang)}
                </td>
                <td className="px-2 py-1 text-right text-foreground tabular-nums" data-label-for={p.xResultId}>
                  {displayNumber(p.xFormatted, lang)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const searchId = `${domId}-search`;
  const shownMatches = matches.slice(0, SCATTER_SEARCH_LIST_MAX);

  return (
    <div className={frameClass} data-testid="scatter-view">
      <div role="heading" aria-level={3} className="text-base font-semibold leading-snug text-foreground">
        {title}
      </div>
      {shownBody !== null ? <p className="mt-1 text-sm text-foreground">{shownBody}</p> : null}

      {!embedMode ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-slot="scatter-controls">
          <div role="tablist" aria-label={t(lang, 'chart.weergaveLabel')} onKeyDown={onTabKeyDown} className="flex items-center gap-1">
            <button
              ref={chartTabRef}
              type="button"
              role="tab"
              aria-selected={view === 'chart'}
              aria-controls={panelId}
              tabIndex={view === 'chart' ? 0 : -1}
              onClick={() => selectView('chart')}
              className={quietTab(view === 'chart')}
            >
              {t(lang, 'chart.scatter.tabChart')}
            </button>
            <button
              ref={tableTabRef}
              type="button"
              role="tab"
              aria-selected={view === 'table'}
              aria-controls={panelId}
              tabIndex={view === 'table' ? 0 : -1}
              onClick={() => selectView('table')}
              className={quietTab(view === 'table')}
            >
              {t(lang, 'chart.tabTable')}
            </button>
          </div>
          <div className="w-full sm:w-56">
            <label htmlFor={searchId} className="sr-only">
              {t(lang, 'chart.scatter.searchLabel')}
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(lang, 'chart.scatter.searchPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              // text-base below sm: iOS zooms the page into any input under 16 px.
              className="min-h-11 w-full rounded-md border border-input bg-background px-2.5 py-1 text-base text-foreground placeholder:text-muted-foreground sm:min-h-7 sm:text-sm"
            />
          </div>
          {view === 'chart' ? (
            <div className="flex flex-wrap items-center gap-2">
              {(['vertical', 'horizontal'] as const).map((orientation) => {
                const shown = orientation === 'vertical' ? vertical : horizontal;
                if (!capable[shown.side]) return null;
                return (
                  <button
                    key={orientation}
                    type="button"
                    aria-pressed={shown.log}
                    title={t(lang, 'chart.scatter.logHint')}
                    onClick={() => toggleScale(shown.side)}
                    className={pill(shown.log)}
                  >
                    {t(lang, orientation === 'vertical' ? 'chart.scatter.logVertical' : 'chart.scatter.logHorizontal')}
                  </button>
                );
              })}
              <button type="button" onClick={() => setSwapped((s) => !s)} className={pill(false)}>
                {t(lang, 'chart.scatter.swapAxes')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!embedMode && searching ? (
        <div aria-live="polite" className="mt-2 text-sm">
          {matches.length === 0 ? (
            <p className="text-muted-foreground">{t(lang, 'chart.scatter.searchNoMatch', { query: query.trim() })}</p>
          ) : (
            <>
              <ul aria-label={t(lang, 'chart.scatter.searchResultsLabel')} className="flex flex-col gap-1">
                {shownMatches.map((p) => (
                  <li key={p.regionCode} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-medium text-foreground">{starred(displayRegion(p.label, lang), p.provisional)}</span>
                    <span className="text-xs text-muted-foreground">
                      {yTitle}:{' '}
                      <span className="font-medium text-foreground tabular-nums" data-label-for={p.yResultId}>
                        {displayNumber(p.yFormatted, lang)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {xTitle}:{' '}
                      <span className="font-medium text-foreground tabular-nums" data-label-for={p.xResultId}>
                        {displayNumber(p.xFormatted, lang)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {matches.length > SCATTER_SEARCH_LIST_MAX ? (
                <p className="mt-1 text-xs text-muted-foreground">{t(lang, 'chart.scatter.searchMore')}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {view === 'table' && !embedMode ? tableNode : embedOpen ? null : canvasNode}

      {shownLine !== null ? <p className="mt-2 text-sm text-muted-foreground">{shownLine}</p> : null}
      {warningLines.map((line, i) => (
        <p key={`w${i}`} className="mt-1 text-sm text-warning">
          {line}
        </p>
      ))}
      {extraLines.map((line, i) => (
        <p key={i} className="mt-1 text-sm text-muted-foreground">
          {line}
        </p>
      ))}
      {provisionalNote !== null ? <p className="mt-2 text-sm text-warning">{provisionalNote}</p> : null}

      <div className="mt-2 flex flex-col gap-1">
        {attributionLines.map((line) => (
          <p key={line} className="text-xs text-muted-foreground">
            {line}
          </p>
        ))}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {badges.map((b) => (
            <SourceBadge key={b.id} tableId={b.id} syncedAt={b.syncedAt} />
          ))}
          {!embedMode && view === 'chart' ? (
            <div className="flex shrink-0 items-center gap-2" data-slot="chart-footer-actions">
              <ChartDownloadMenu
                containerRef={containerRef}
                attributionText={`${attributionLines.join(' ')} graphmaker.studio`}
                filenameBase={`graphmaker-${tableIds.join('-')}`}
                lang={lang}
                titleText={title}
              />
              {embed ? (
                <ChartEmbedButton
                  auditId={embed.auditId}
                  tableId={spec.y.tableId}
                  lang={lang}
                  open={embedOpen}
                  onOpenChange={setEmbedOpen}
                  chartSlot={canvasNode}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {embedMode && embedFooter ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {embedFooter}{' '}
          {/* The one way out of a third-party <iframe> — target="_blank" so
            * it never loads the site inside the chart-sized frame
            * (chart.tsx's own embed footer, same APP_URL). */}
          <a href={APP_URL} target="_blank" rel="noopener noreferrer" className="underline">
            graphmaker.studio
          </a>
        </p>
      ) : null}
    </div>
  );
}
