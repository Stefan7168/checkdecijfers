// The dumb renderer (R6; ADR 007): ChartSpec in, SVG string out. Pure and
// dependency-free — no DOM, no library, no I/O, no clock — so it runs
// identically in Node, tests and CI, and doubles as the server-side SVG seam
// ADR 008 reserves for future static-image rendering. The client wrapper
// (Recharts, ADR 008) arrives with the chat UI and renders the SAME spec.
//
// The honesty contract this file lives under:
//   - It may compute LAYOUT (pixel positions) — that is rendering.
//   - It may NOT compute DATA: every number the viewer can read (point
//     labels, axis text, footnotes) is a string carried by the spec. The
//     renderer never formats, rounds, aggregates or re-orders values, and
//     never invents axis-tick numbers — gridlines are unlabeled.
//   - It may NOT omit: every point renders a marker; null-valued points
//     render an honest gap marker ('×') plus the spec's nullNotes line, and
//     line paths break at the gap rather than interpolating through it.
//   - Provisional points render visibly distinct (open marker, '*' suffix)
//     with the spec's provisionalNote (R11); the attribution sentence always
//     renders (R4).
//   - Every value label is emitted with a data-label-for binding to its
//     point's resultId, so a label drifting to another point's position is
//     machine-detectable and test-enforced (adversarial-review finding,
//     2026-07-03: an unbound label swap passed the whole original suite).
//   - The categorical x-axis is sorted chronologically (CBS period codes
//     within one grain sort lexicographically = chronologically; mixed
//     grains cannot reach one result — invalid_intent refuses them). Trusting
//     first-seen order across series would misplace periods when series
//     carry disjoint period sets (adversarial-review finding, 2026-07-03).
//
// Verified by tests/chart/render-svg.test.ts: every numeric token in the
// SVG's text nodes must occur verbatim in the spec's own strings, marker
// count must equal point count, and marker positions must be exact affine
// images of the point values.
import type { ChartAnnotation, ChartPoint, ChartSeries, ChartSpec } from './types.ts';

export interface RenderChartOptions {
  /** Total SVG width in px (default 640). */
  width?: number;
  /** Plot-area height in px (default 220); total height grows with footers. */
  plotHeight?: number;
}

/** WP-LOOK part (a2) round 2 (session 144): the forms this renderer can draw
 * for a time series. `line` is the spec's own line; `area` fills under it;
 * `bar` draws one bar per period (grouped per series) on a zero baseline.
 * A comparison spec (`kind: 'bar'`, one period across regions) always draws
 * its bars — a "form" only re-shapes a time series. */
export type RenderForm = 'line' | 'area' | 'bar';

/** One piece of text the plot-only mode HANDS BACK instead of embedding —
 * coordinates in the plot SVG's own pixel space, `y` the text baseline. Every
 * `text` is a spec string (the honesty contract in the file header). */
export interface RenderedText {
  x: number;
  y: number;
  text: string;
  size: number;
  weight: 'normal' | 'bold';
  anchor: 'start' | 'middle' | 'end';
  color: string;
  role: 'x-label' | 'value' | 'y-tick' | 'null';
}

export interface RenderPlotOptions {
  /** Total SVG width in px. */
  width: number;
  /** Plot-area height in px. */
  plotHeight: number;
  /** Requested form for a time series; ignored (spec default) for a comparison spec. */
  form?: RenderForm;
  /** Series colours (index-cycled). Default: the file's own palette. */
  colors?: readonly string[];
  /** Font size the returned texts are meant for (drives label thinning). */
  fontSize?: number;
  /** Which points get a value label: every point (the renderer's default and
   * its download contract), or the ends + extremes only (a preview picture,
   * where twenty-four labels cannot be read). Never a label that is not a
   * spec string. */
  valueLabels?: 'all' | 'ends';
}

export interface RenderedPlot {
  /** Marks only — gridlines, series, markers, gap crosses. No `<text>`. */
  svg: string;
  width: number;
  height: number;
  texts: RenderedText[];
  /** Series legend entries in series order, for the caller to draw. */
  legend: { label: string; color: string }[];
}

const SERIES_COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];
const FONT = 'system-ui, sans-serif';

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Deterministic pixel formatting: 2 decimals, no negative zero. */
function px(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Word-boundary wrap — never splits inside a token, so numeric tokens in
 * wrapped footer lines stay scannable. */
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

interface Scale {
  min: number;
  max: number;
  toY(value: number): number;
}

function makeScale(values: number[], kind: 'line' | 'bar', top: number, bottom: number): Scale {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (kind === 'bar') {
    // Bars encode length: the baseline is always 0 (a non-zero baseline
    // visually lies about ratios).
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  let pad = (max - min) * 0.08;
  if (pad === 0) pad = Math.max(1, Math.abs(max) * 0.1);
  const dMin = kind === 'bar' && min === 0 ? 0 : min - pad;
  const dMax = max + pad;
  return {
    min: dMin,
    max: dMax,
    toY: (value: number) => bottom - ((value - dMin) / (dMax - dMin)) * (bottom - top),
  };
}

function pointLabel(point: ChartPoint): string {
  return `${point.formattedValue}${point.provisional ? '*' : ''}`;
}

/** Which x-axis categories get a label when only `fontSize`-sized text that
 * does not overlap is allowed: every `step`-th one from the first, plus the
 * last (the previous one dropped if the two would collide). Pure layout —
 * the labels themselves are untouched spec strings. */
export function thinXLabels(labels: string[], bandWidth: number, fontSize: number): Set<number> {
  const n = labels.length;
  if (n === 0) return new Set();
  const widest = Math.max(...labels.map((l) => l.length)) * fontSize * 0.58;
  const step = Math.max(1, Math.ceil((widest + fontSize) / Math.max(bandWidth, 1)));
  const shown = new Set<number>();
  for (let i = 0; i < n; i += step) shown.add(i);
  if (!shown.has(n - 1)) {
    const prev = Math.max(...shown);
    if ((n - 1 - prev) * bandWidth < widest + fontSize) shown.delete(prev);
    shown.add(n - 1);
  }
  return shown;
}

interface DrawConfig {
  width: number;
  plotHeight: number;
  /** Title, subtitle, legend and footer in the SVG (the download contract). */
  chrome: boolean;
  /** 'svg': `<text>` nodes in the markup; 'collect': hand them back. */
  textMode: 'svg' | 'collect';
  form: RenderForm;
  colors: readonly string[];
  fontSize: number;
  valueLabels: 'all' | 'ends';
  xLabels: 'all' | 'fit';
  yTicks: boolean;
}

interface TextOpts {
  size: number;
  weight?: 'normal' | 'bold';
  anchor?: 'start' | 'middle' | 'end';
  color: string;
  role: RenderedText['role'];
  /** Extra SVG attributes (svg mode only; the collect mode has no markup to carry them). */
  attrs?: string;
}

function draw(spec: ChartSpec, cfg: DrawConfig): RenderedPlot {
  if (spec.schemaVersion !== 1) {
    // Renderers dispatch on the schema version (ADR 007); this one only
    // speaks v1 and must say so rather than misrender a future spec.
    throw new Error(`chart renderer for spec v1 received v${String(spec.schemaVersion)}`);
  }

  const { width, plotHeight, chrome, colors, fontSize } = cfg;
  const padX = 48;
  // Plot-only mode sizes its side paddings to the text it hands back: the
  // widest y-axis tick on the left, the last point's label (set beside the
  // point, as the on-screen chart does) on the right.
  const textWidth = (t: string): number => t.length * fontSize * 0.58;
  const nonNull = spec.series.flatMap((s) => s.points.filter((p) => p.value !== null));
  const tickWidth = nonNull.length === 0 ? 0 : Math.max(...nonNull.map((p) => textWidth(pointLabel(p))));
  const lastLabels = spec.series.map((s) => [...s.points].reverse().find((p) => p.value !== null)).filter((p) => p !== undefined);
  const endWidth = lastLabels.length === 0 ? 0 : Math.max(...lastLabels.map((p) => textWidth(pointLabel(p))));
  const plotOnly = !chrome;
  const sideLabels = plotOnly && spec.kind === 'line' && cfg.form !== 'bar' && cfg.valueLabels === 'ends';
  const plotLeft = plotOnly ? Math.max(padX, Math.ceil(tickWidth) + 14) : padX;
  const plotRight = width - (sideLabels ? Math.max(padX, Math.ceil(endWidth) + 16) : padX);
  const plotWidth = plotRight - plotLeft;
  const markerR = plotOnly ? Math.max(3.5, fontSize * 0.25) : 3.5;
  const markerStroke = plotOnly ? Math.max(2, fontSize * 0.14) : 2;

  const hasLegend = chrome && spec.series.length > 1;
  // Coordinate subtitle: the Dutch labels of the dims every cell is pinned
  // at — spec strings, so two same-measure charts at different coordinates
  // stay distinguishable in the render too.
  const subtitle = chrome ? Object.values(spec.dimLabels).join(' · ') : '';
  const subtitleHeight = subtitle.length > 0 ? 15 : 0;
  const titleY = 20;
  const legendY = 40 + subtitleHeight;
  // Plot-only mode leaves one label's worth of headroom above the top point.
  const plotTop = chrome ? (hasLegend ? 56 : 40) + subtitleHeight : fontSize + 6;
  const plotBottom = plotTop + plotHeight;
  const xLabelY = plotBottom + (chrome ? 18 : fontSize + 8);

  const parts: string[] = [];
  const texts: RenderedText[] = [];
  const text = (x: number, y: number, content: string, o: TextOpts): void => {
    if (cfg.textMode === 'collect') {
      texts.push({ x, y, text: content, size: o.size, weight: o.weight ?? 'normal', anchor: o.anchor ?? 'start', color: o.color, role: o.role });
      return;
    }
    const anchor = o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : '';
    const weight = o.weight === 'bold' ? ' font-weight="bold"' : '';
    const attrs = o.attrs ? ` ${o.attrs}` : '';
    parts.push(
      `<text x="${px(x)}" y="${px(y)}"${anchor} font-family="${FONT}" font-size="${String(o.size)}"${weight} fill="${o.color}"${attrs}>${escapeXml(content)}</text>`,
    );
  };

  // #170(4): curated event markers. Metadata, not data (never touches the
  // R1/R3 numeric-token machinery — docs/05's R1/R8 scope note) — kept only
  // when its period code is literally one of THIS chart's own plotted
  // categories (R6 discipline extended to metadata: never an approximate or
  // interpolated placement), and only for line charts: a bar/comparison
  // result is one period across regions, so a "reference line over time"
  // has no meaning there. Always-visible text goes in the footer below
  // (small multi-line SVG text has no good way to lay out a long label
  // rotated alongside a thin plotted line without colliding with point
  // labels — the file's existing footer mechanism already IS this renderer's
  // "always visible, never hover-only" surface, so annotations use it too);
  // the reference line itself additionally carries a native <title> tooltip
  // with the same text for a renderer that supports hover.
  const plottedPeriodCodes = new Set(spec.series.flatMap((s) => s.points.map((p) => p.periodCode)));
  const annotations: ChartAnnotation[] =
    spec.kind === 'line' ? (spec.annotations ?? []).filter((a) => plottedPeriodCodes.has(a.periodCode)) : [];

  const footer: string[] = chrome
    ? [
        ...(spec.provisionalNote === null ? [] : [spec.provisionalNote]),
        ...spec.nullNotes,
        ...(spec.definitionLine === null ? [] : [spec.definitionLine]),
        ...wrap(spec.attributionLine, 100),
        ...annotations.flatMap((a) => wrap(`Gemarkeerd in de grafiek: ${a.label}.`, 100)),
      ]
    : [];
  const footerTop = xLabelY + 16;
  const height = chrome ? footerTop + footer.length * 15 + 8 : xLabelY + 6;

  // Title (measure + unit — both spec strings), then the coordinate subtitle.
  if (chrome) {
    parts.push(
      `<text x="${px(plotLeft)}" y="${px(titleY)}" font-family="${FONT}" font-size="14" font-weight="bold" fill="#111">${escapeXml(`${spec.title} (${spec.unit})`)}</text>`,
    );
    if (subtitle.length > 0) {
      parts.push(
        `<text x="${px(plotLeft)}" y="${px(titleY + 15)}" font-family="${FONT}" font-size="11" fill="#555">${escapeXml(subtitle)}</text>`,
      );
    }
  }

  // Legend for multi-series charts.
  const legend = spec.series.map((series, i) => ({ label: series.label, color: colors[i % colors.length]! }));
  if (hasLegend) {
    let legendX = plotLeft;
    legend.forEach((entry) => {
      parts.push(
        `<rect x="${px(legendX)}" y="${px(legendY - 9)}" width="10" height="10" fill="${entry.color}"/>`,
        `<text x="${px(legendX + 14)}" y="${px(legendY)}" font-family="${FONT}" font-size="11" fill="#333">${escapeXml(entry.label)}</text>`,
      );
      legendX += 14 + entry.label.length * 7 + 18;
    });
  }

  // Unlabeled gridlines — layout furniture, deliberately number-free.
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const y = plotTop + f * plotHeight;
    parts.push(
      `<line x1="${px(plotLeft)}" y1="${px(y)}" x2="${px(plotRight)}" y2="${px(y)}" stroke="#e5e7eb" stroke-width="1"/>`,
    );
  }

  const values = spec.series.flatMap((s) => s.points.flatMap((p) => (p.value === null ? [] : [p.value])));
  // A time series drawn as bars gets the zero baseline bars must have.
  const scaleKind: 'line' | 'bar' = spec.kind === 'bar' || cfg.form === 'bar' ? 'bar' : 'line';
  const scale = values.length > 0 ? makeScale(values, scaleKind, plotTop, plotBottom) : null;

  // Preview mode: the lowest and highest plotted values as y-axis ticks —
  // two spec strings, never a computed tick.
  if (cfg.yTicks && scale !== null) {
    const all = spec.series.flatMap((s) => s.points.filter((p) => p.value !== null));
    const lo = all.reduce((a, b) => (b.value! < a.value! ? b : a));
    const hi = all.reduce((a, b) => (b.value! > a.value! ? b : a));
    for (const p of lo === hi ? [lo] : [lo, hi]) {
      text(plotLeft - 8, scale.toY(p.value!) + fontSize * 0.35, pointLabel(p), { size: fontSize, anchor: 'end', color: '#6b7280', role: 'y-tick' });
    }
  }

  /** Which points of a series carry a value label under the policy. */
  const labelled = (series: ChartSeries): Set<number> => {
    if (cfg.valueLabels === 'all') return new Set(series.points.map((_, i) => i));
    const idx = series.points.map((p, i) => (p.value === null ? -1 : i)).filter((i) => i >= 0);
    if (idx.length === 0) return new Set();
    const first = idx[0]!;
    const last = idx[idx.length - 1]!;
    let lo = first;
    let hi = first;
    for (const i of idx) {
      if (series.points[i]!.value! < series.points[lo]!.value!) lo = i;
      if (series.points[i]!.value! > series.points[hi]!.value!) hi = i;
    }
    // The y-axis ticks (plot-only mode) already state the lowest and the
    // highest value, so the extremes need no label of their own; the first
    // point gets one unless it IS an extreme (the tick sits right there),
    // the last point always (beside it, as on screen).
    const ends = new Set([last]);
    if (!cfg.yTicks || (first !== lo && first !== hi)) ends.add(first);
    if (!cfg.yTicks) {
      ends.add(lo);
      ends.add(hi);
    }
    return ends;
  };

  if (spec.kind === 'line') {
    // Shared categorical x-axis over all series' periods, sorted
    // chronologically (lexicographic = chronological within one grain).
    const seen = new Set<string>();
    for (const series of spec.series) {
      for (const point of series.points) seen.add(point.periodCode);
    }
    const categories = [...seen].sort();
    const bars = cfg.form === 'bar';
    const bandWidth = bars ? plotWidth / categories.length : categories.length === 1 ? plotWidth : plotWidth / (categories.length - 1);
    const xFor = (code: string): number => {
      const i = categories.indexOf(code);
      if (bars) return plotLeft + bandWidth * (i + 0.5);
      return categories.length === 1 ? plotLeft + plotWidth / 2 : plotLeft + (i * plotWidth) / (categories.length - 1);
    };

    // #170(4): a dashed vertical reference line per curated annotation,
    // drawn before the axis labels/series so it sits visually BEHIND the
    // data (paint order = source order in SVG). `annotations` is already
    // filtered to this chart's own plotted period codes, so `xFor` always
    // resolves.
    for (const a of annotations) {
      const x = xFor(a.periodCode);
      parts.push(
        `<line x1="${px(x)}" y1="${px(plotTop)}" x2="${px(x)}" y2="${px(plotBottom)}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="3 3" data-annotation="marker" data-annotation-period="${escapeXml(a.periodCode)}"><title>${escapeXml(a.label)}</title></line>`,
      );
    }

    // X labels once per category, from the first point that carries it.
    const labelByCode = new Map<string, string>();
    for (const series of spec.series) {
      for (const point of series.points) {
        if (!labelByCode.has(point.periodCode)) labelByCode.set(point.periodCode, point.periodLabel);
      }
    }
    const shownX =
      cfg.xLabels === 'fit'
        ? thinXLabels(
            categories.map((c) => labelByCode.get(c)!),
            bandWidth,
            fontSize,
          )
        : null;
    categories.forEach((code, i) => {
      if (shownX !== null && !shownX.has(i)) return;
      text(xFor(code), xLabelY, labelByCode.get(code)!, { size: fontSize, anchor: 'middle', color: '#333', role: 'x-label' });
    });

    spec.series.forEach((series, i) => {
      const color = colors[i % colors.length]!;
      const labels = labelled(series);
      if (bars) {
        // One bar per period, series side by side inside the period's band.
        const groupWidth = bandWidth * 0.7;
        const barWidth = groupWidth / spec.series.length;
        const yZero = scale === null ? plotBottom : scale.toY(0);
        series.points.forEach((point, j) => {
          const cx = xFor(point.periodCode) - groupWidth / 2 + barWidth * (i + 0.5);
          if (point.value === null || scale === null) {
            text(cx, plotBottom - 4, '×', { size: 13, anchor: 'middle', color: '#9ca3af', role: 'null', attrs: `data-point="null" data-result-id="${escapeXml(point.resultId)}"` });
            return;
          }
          const yValue = scale.toY(point.value);
          const barTop = Math.min(yValue, yZero);
          const barHeight = Math.abs(yZero - yValue);
          const fill = point.provisional ? `fill="${color}" fill-opacity="0.55"` : `fill="${color}"`;
          parts.push(
            `<rect x="${px(cx - barWidth / 2)}" y="${px(barTop)}" width="${px(Math.max(barWidth - 1, 1))}" height="${px(barHeight)}" ${fill} data-point="value" data-result-id="${escapeXml(point.resultId)}"/>`,
          );
          if (labels.has(j)) {
            const labelY = point.value >= 0 ? barTop - 6 : barTop + barHeight + fontSize + 2;
            text(cx, labelY, pointLabel(point), { size: fontSize, anchor: 'middle', color: '#111', role: 'value', attrs: `data-label-for="${escapeXml(point.resultId)}"` });
          }
        });
        return;
      }
      // Line segments: consecutive non-null runs; a null breaks the path —
      // interpolating across the gap would draw a value that does not exist.
      let run: string[] = [];
      let runX: number[] = [];
      const flush = () => {
        if (run.length >= 2) {
          if (cfg.form === 'area' && scale !== null) {
            const baseY = px(plotBottom);
            parts.push(
              `<polygon points="${px(runX[0]!)},${baseY} ${run.join(' ')} ${px(runX[runX.length - 1]!)},${baseY}" fill="${color}" fill-opacity="0.15" stroke="none"/>`,
            );
          }
          parts.push(
            `<polyline points="${run.join(' ')}" fill="none" stroke="${color}" stroke-width="${px(markerStroke)}"/>`,
          );
        }
        run = [];
        runX = [];
      };
      for (const point of series.points) {
        if (point.value === null || scale === null) {
          flush();
        } else {
          run.push(`${px(xFor(point.periodCode))},${px(scale.toY(point.value))}`);
          runX.push(xFor(point.periodCode));
        }
      }
      flush();

      series.points.forEach((point, j) => {
        const x = xFor(point.periodCode);
        if (point.value === null || scale === null) {
          text(x, plotBottom - 4, '×', { size: 13, anchor: 'middle', color: '#9ca3af', role: 'null', attrs: `data-point="null" data-result-id="${escapeXml(point.resultId)}"` });
          return;
        }
        const y = scale.toY(point.value);
        const marker = point.provisional
          ? `<circle cx="${px(x)}" cy="${px(y)}" r="${px(markerR)}" fill="#ffffff" stroke="${color}" stroke-width="${px(markerStroke)}" data-point="value" data-result-id="${escapeXml(point.resultId)}"/>`
          : `<circle cx="${px(x)}" cy="${px(y)}" r="${px(markerR)}" fill="${color}" data-point="value" data-result-id="${escapeXml(point.resultId)}"/>`;
        parts.push(marker);
        if (!labels.has(j)) return;
        const isLast = sideLabels && j === series.points.length - 1;
        if (isLast) {
          // The end label sits to the right of its point, as on screen.
          text(x + markerR + 6, y + fontSize * 0.35, pointLabel(point), { size: fontSize, anchor: 'start', color: '#111', role: 'value', attrs: `data-label-for="${escapeXml(point.resultId)}"` });
          return;
        }
        const labelY = y - 8 < plotTop ? y + fontSize + 5 : y - 8;
        text(x, labelY, pointLabel(point), { size: fontSize, anchor: 'middle', color: '#111', role: 'value', attrs: `data-label-for="${escapeXml(point.resultId)}"` });
      });
    });
  } else {
    // Bar chart: one bar per series (single-period comparison); the category
    // label is the series (region) label.
    const n = spec.series.length;
    const bandWidth = plotWidth / n;
    const barWidth = bandWidth * 0.6;
    spec.series.forEach((series, i) => {
      const color = colors[i % colors.length]!;
      const point = series.points[0]!;
      const cx = plotLeft + bandWidth * (i + 0.5);
      text(cx, xLabelY, series.label, { size: fontSize, anchor: 'middle', color: '#333', role: 'x-label' });
      if (point.value === null || scale === null) {
        text(cx, plotBottom - 4, '×', { size: 13, anchor: 'middle', color: '#9ca3af', role: 'null', attrs: `data-point="null" data-result-id="${escapeXml(point.resultId)}"` });
        return;
      }
      const yValue = scale.toY(point.value);
      const yZero = scale.toY(0);
      const barTop = Math.min(yValue, yZero);
      const barHeight = Math.abs(yZero - yValue);
      parts.push(
        `<rect x="${px(cx - barWidth / 2)}" y="${px(barTop)}" width="${px(barWidth)}" height="${px(barHeight)}" fill="${color}" data-point="value" data-result-id="${escapeXml(point.resultId)}"/>`,
      );
      const labelY = point.value >= 0 ? barTop - 6 : barTop + barHeight + 12;
      text(cx, labelY, pointLabel(point), { size: fontSize, anchor: 'middle', color: '#111', role: 'value', attrs: `data-label-for="${escapeXml(point.resultId)}"` });
    });
  }

  // Footnotes: R11 provisional note, honest-gap lines, definition, R4
  // attribution — always rendered, never optional for a rendering path.
  footer.forEach((line, i) => {
    parts.push(
      `<text x="${px(plotLeft)}" y="${px(footerTop + i * 15)}" font-family="${FONT}" font-size="11" fill="#555">${escapeXml(line)}</text>`,
    );
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(width)} ${px(height)}" width="${px(width)}" height="${px(height)}" role="img"><title>${escapeXml(spec.title)}</title>` +
    parts.join('') +
    `</svg>`;
  return { svg, width, height, texts, legend };
}

/** The complete SVG: title, subtitle, legend, plot with every value
 * labelled, footer — the download and the server-side seam (ADR 008). */
export function renderChartSvg(spec: ChartSpec, options: RenderChartOptions = {}): string {
  return draw(spec, {
    width: options.width ?? 640,
    plotHeight: options.plotHeight ?? 220,
    chrome: true,
    textMode: 'svg',
    form: 'line',
    colors: SERIES_COLORS,
    fontSize: 11,
    valueLabels: 'all',
    xLabels: 'all',
    yTicks: false,
  }).svg;
}

/** WP-LOOK part (a2) round 2: the plot alone, marks in the SVG and every
 * piece of text handed back for the caller to set in its own typeface
 * (the share-preview image tool cannot see fonts inside a nested SVG).
 * X labels are thinned to what fits, value labels go on the ends and the
 * extremes only, the lowest and highest values become the y-axis ticks.
 * Everything readable is still a spec string. */
export function renderChartPlot(spec: ChartSpec, options: RenderPlotOptions): RenderedPlot {
  return draw(spec, {
    width: options.width,
    plotHeight: options.plotHeight,
    chrome: false,
    textMode: 'collect',
    form: options.form ?? 'line',
    colors: options.colors ?? SERIES_COLORS,
    fontSize: options.fontSize ?? 11,
    valueLabels: options.valueLabels ?? 'ends',
    xLabels: 'fit',
    yTicks: true,
  });
}
