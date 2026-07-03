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
import type { ChartPoint, ChartSeries, ChartSpec } from './types.ts';

export interface RenderChartOptions {
  /** Total SVG width in px (default 640). */
  width?: number;
  /** Plot-area height in px (default 220); total height grows with footers. */
  plotHeight?: number;
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

export function renderChartSvg(spec: ChartSpec, options: RenderChartOptions = {}): string {
  if (spec.schemaVersion !== 1) {
    // Renderers dispatch on the schema version (ADR 007); this one only
    // speaks v1 and must say so rather than misrender a future spec.
    throw new Error(`chart renderer for spec v1 received v${String(spec.schemaVersion)}`);
  }

  const width = options.width ?? 640;
  const plotHeight = options.plotHeight ?? 220;
  const padX = 48;
  const plotLeft = padX;
  const plotRight = width - padX;
  const plotWidth = plotRight - plotLeft;

  const hasLegend = spec.series.length > 1;
  // Coordinate subtitle: the Dutch labels of the dims every cell is pinned
  // at — spec strings, so two same-measure charts at different coordinates
  // stay distinguishable in the render too.
  const subtitle = Object.values(spec.dimLabels).join(' · ');
  const subtitleHeight = subtitle.length > 0 ? 15 : 0;
  const titleY = 20;
  const legendY = 40 + subtitleHeight;
  const plotTop = (hasLegend ? 56 : 40) + subtitleHeight;
  const plotBottom = plotTop + plotHeight;
  const xLabelY = plotBottom + 18;

  const parts: string[] = [];
  const footer: string[] = [
    ...(spec.provisionalNote === null ? [] : [spec.provisionalNote]),
    ...spec.nullNotes,
    ...(spec.definitionLine === null ? [] : [spec.definitionLine]),
    ...wrap(spec.attributionLine, 100),
  ];
  const footerTop = xLabelY + 16;
  const height = footerTop + footer.length * 15 + 8;

  // Title (measure + unit — both spec strings), then the coordinate subtitle.
  parts.push(
    `<text x="${px(plotLeft)}" y="${px(titleY)}" font-family="${FONT}" font-size="14" font-weight="bold" fill="#111">${escapeXml(`${spec.title} (${spec.unit})`)}</text>`,
  );
  if (subtitle.length > 0) {
    parts.push(
      `<text x="${px(plotLeft)}" y="${px(titleY + 15)}" font-family="${FONT}" font-size="11" fill="#555">${escapeXml(subtitle)}</text>`,
    );
  }

  // Legend for multi-series charts.
  if (hasLegend) {
    let legendX = plotLeft;
    spec.series.forEach((series, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
      parts.push(
        `<rect x="${px(legendX)}" y="${px(legendY - 9)}" width="10" height="10" fill="${color}"/>`,
        `<text x="${px(legendX + 14)}" y="${px(legendY)}" font-family="${FONT}" font-size="11" fill="#333">${escapeXml(series.label)}</text>`,
      );
      legendX += 14 + series.label.length * 7 + 18;
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
  const scale = values.length > 0 ? makeScale(values, spec.kind, plotTop, plotBottom) : null;

  if (spec.kind === 'line') {
    // Shared categorical x-axis over all series' periods, sorted
    // chronologically (lexicographic = chronological within one grain).
    const seen = new Set<string>();
    for (const series of spec.series) {
      for (const point of series.points) seen.add(point.periodCode);
    }
    const categories = [...seen].sort();
    const xFor = (code: string): number => {
      const i = categories.indexOf(code);
      return categories.length === 1
        ? plotLeft + plotWidth / 2
        : plotLeft + (i * plotWidth) / (categories.length - 1);
    };

    // X labels once per category, from the first point that carries it.
    const labelByCode = new Map<string, string>();
    for (const series of spec.series) {
      for (const point of series.points) {
        if (!labelByCode.has(point.periodCode)) labelByCode.set(point.periodCode, point.periodLabel);
      }
    }
    for (const code of categories) {
      parts.push(
        `<text x="${px(xFor(code))}" y="${px(xLabelY)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#333">${escapeXml(labelByCode.get(code)!)}</text>`,
      );
    }

    spec.series.forEach((series, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
      // Line segments: consecutive non-null runs; a null breaks the path —
      // interpolating across the gap would draw a value that does not exist.
      let run: string[] = [];
      const flush = () => {
        if (run.length >= 2) {
          parts.push(
            `<polyline points="${run.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`,
          );
        }
        run = [];
      };
      for (const point of series.points) {
        if (point.value === null || scale === null) {
          flush();
        } else {
          run.push(`${px(xFor(point.periodCode))},${px(scale.toY(point.value))}`);
        }
      }
      flush();

      for (const point of series.points) {
        const x = xFor(point.periodCode);
        if (point.value === null || scale === null) {
          parts.push(
            `<text x="${px(x)}" y="${px(plotBottom - 4)}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#9ca3af" data-point="null" data-result-id="${escapeXml(point.resultId)}">×</text>`,
          );
          continue;
        }
        const y = scale.toY(point.value);
        const marker = point.provisional
          ? `<circle cx="${px(x)}" cy="${px(y)}" r="3.5" fill="#ffffff" stroke="${color}" stroke-width="2" data-point="value" data-result-id="${escapeXml(point.resultId)}"/>`
          : `<circle cx="${px(x)}" cy="${px(y)}" r="3.5" fill="${color}" data-point="value" data-result-id="${escapeXml(point.resultId)}"/>`;
        parts.push(marker);
        const labelY = y - 8 < plotTop ? y + 16 : y - 8;
        parts.push(
          `<text x="${px(x)}" y="${px(labelY)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#111" data-label-for="${escapeXml(point.resultId)}">${escapeXml(pointLabel(point))}</text>`,
        );
      }
    });
  } else {
    // Bar chart: one bar per series (single-period comparison); the category
    // label is the series (region) label.
    const n = spec.series.length;
    const bandWidth = plotWidth / n;
    const barWidth = bandWidth * 0.6;
    spec.series.forEach((series, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
      const point = series.points[0]!;
      const cx = plotLeft + bandWidth * (i + 0.5);
      parts.push(
        `<text x="${px(cx)}" y="${px(xLabelY)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#333">${escapeXml(series.label)}</text>`,
      );
      if (point.value === null || scale === null) {
        parts.push(
          `<text x="${px(cx)}" y="${px(plotBottom - 4)}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#9ca3af" data-point="null" data-result-id="${escapeXml(point.resultId)}">×</text>`,
        );
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
      parts.push(
        `<text x="${px(cx)}" y="${px(labelY)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#111" data-label-for="${escapeXml(point.resultId)}">${escapeXml(pointLabel(point))}</text>`,
      );
    });
  }

  // Footnotes: R11 provisional note, honest-gap lines, definition, R4
  // attribution — always rendered, never optional for a rendering path.
  footer.forEach((line, i) => {
    parts.push(
      `<text x="${px(plotLeft)}" y="${px(footerTop + i * 15)}" font-family="${FONT}" font-size="11" fill="#555">${escapeXml(line)}</text>`,
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(width)} ${px(height)}" width="${px(width)}" height="${px(height)}" role="img"><title>${escapeXml(spec.title)}</title>` +
    parts.join('') +
    `</svg>`
  );
}
