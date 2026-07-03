// R6, renderer half (docs/05): the renderer is a pure function over the spec
// that may compute layout but never data — it adds no numbers of its own,
// omits no point, interpolates across no gap, and always renders the
// attribution (R4) and the provisional marking (R11).
import { describe, expect, it } from 'vitest';
import { buildChartSpec, renderChartSvg } from '../../src/chart/index.ts';
import type { ChartSpec } from '../../src/chart/index.ts';
import { findNumericTokens, normalizeForScan } from '../../src/answer/compose/format.ts';
import { deepFreeze, makeCell, makeResult } from './helpers.ts';

const seriesCells = [
  makeCell({ periodCode: '2019JJ00', value: 307978, unit: 'euro', decimals: 0 }),
  makeCell({ periodCode: '2020JJ00', value: 334488, unit: 'euro', decimals: 0 }),
  makeCell({ periodCode: '2021JJ00', value: 386714, unit: 'euro', decimals: 0 }),
  makeCell({ periodCode: '2022JJ00', value: 428591, unit: 'euro', decimals: 0 }),
  makeCell({
    periodCode: '2023JJ00',
    value: 416199,
    unit: 'euro',
    decimals: 0,
    status: 'Voorlopig',
    provisional: true,
  }),
];

function lineSpec(): ChartSpec {
  return buildChartSpec(makeResult('series', seriesCells))!;
}

function barSpec(): ChartSpec {
  return buildChartSpec(
    makeResult('comparison', [
      makeCell({ regionCode: 'GM0363', periodCode: '2024JJ00', value: 931298, unit: 'aantal', decimals: 0 }),
      makeCell({ regionCode: 'GM0599', periodCode: '2024JJ00', value: 664311, unit: 'aantal', decimals: 0 }),
    ]),
  )!;
}

/** All human-visible text in the SVG (text-node content between tags). */
function svgText(svg: string): string {
  return [...svg.matchAll(/>([^<]+)</g)].map((m) => m[1]!).join(' ');
}

/** Numeric tokens (as strings) occurring in any of the spec's own strings —
 * the complete set a render is allowed to show. */
function allowedTokens(spec: ChartSpec): Set<string> {
  const strings = [
    spec.title,
    spec.unit,
    spec.attributionLine,
    ...Object.values(spec.dimLabels),
    ...(spec.provisionalNote === null ? [] : [spec.provisionalNote]),
    ...spec.nullNotes,
    ...(spec.definitionLine === null ? [] : [spec.definitionLine]),
    ...spec.series.flatMap((s) => [
      s.label,
      ...s.points.flatMap((p) => [p.periodLabel, ...(p.formattedValue === null ? [] : [p.formattedValue])]),
    ]),
  ];
  const tokens = new Set<string>();
  for (const s of strings) {
    for (const t of findNumericTokens(normalizeForScan(s))) tokens.add(t.token);
  }
  return tokens;
}

describe('renderChartSvg — the renderer adds no data', () => {
  it('every numeric token in the rendered text comes verbatim from the spec', () => {
    for (const spec of [lineSpec(), barSpec()]) {
      const allowed = allowedTokens(spec);
      const shown = findNumericTokens(normalizeForScan(svgText(renderChartSvg(spec))));
      expect(shown.length).toBeGreaterThan(0);
      for (const token of shown) {
        expect(allowed, `renderer invented numeric token "${token.token}"`).toContain(token.token);
      }
    }
  });

  it('every point value renders as its exact spec string', () => {
    const spec = lineSpec();
    const text = svgText(renderChartSvg(spec));
    for (const point of spec.series[0]!.points) {
      expect(text).toContain(point.formattedValue!);
      expect(text).toContain(point.periodLabel);
    }
  });

  it('every value label is bound to its own point — a swapped label cannot pass', () => {
    // Adversarial-review finding (2026-07-03): without per-label binding, a
    // renderer that attached point A's value text to point B's marker passed
    // the whole suite. Each label now carries data-label-for=resultId and
    // must show exactly that point's display string.
    for (const spec of [lineSpec(), barSpec()]) {
      const svg = renderChartSvg(spec);
      for (const point of spec.series.flatMap((s) => s.points)) {
        if (point.value === null) continue;
        const escaped = point.resultId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const label = svg.match(new RegExp(`<text [^>]*data-label-for="${escaped}"[^>]*>([^<]+)</text>`));
        expect(label, `no value label bound to ${point.resultId}`).not.toBeNull();
        expect(label![1]).toBe(`${point.formattedValue}${point.provisional ? '*' : ''}`);
      }
    }
  });
});

describe('renderChartSvg — the renderer omits nothing', () => {
  it('renders exactly one marker per point, keyed by resultId', () => {
    for (const spec of [lineSpec(), barSpec()]) {
      const svg = renderChartSvg(spec);
      const markers = [...svg.matchAll(/data-result-id="([^"]+)"/g)].map((m) => m[1]!);
      const points = spec.series.flatMap((s) => s.points.map((p) => p.resultId));
      expect(markers.sort()).toEqual([...points].sort());
    }
  });

  it('a null point renders an honest gap: × marker, broken line, note text — never interpolation', () => {
    const cells = [
      makeCell({ periodCode: '2020JJ00', value: 1.3 }),
      makeCell({ periodCode: '2021JJ00', value: 2.7 }),
      makeCell({ periodCode: '2022JJ00', value: null, valueAttribute: 'Geheim' }),
      makeCell({ periodCode: '2023JJ00', value: 3.8 }),
      makeCell({ periodCode: '2024JJ00', value: 3.3 }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    const svg = renderChartSvg(spec);
    expect(svg).toContain('data-point="null"');
    // Two polylines — one either side of the gap; a single polyline would
    // have drawn a line through a value that does not exist.
    expect(svg.match(/<polyline /g)).toHaveLength(2);
    expect(svgText(svg)).toContain('Geheim');
  });
});

describe('renderChartSvg — R11 and R4 render unconditionally', () => {
  it('provisional points render as open markers with * and the note renders', () => {
    const spec = lineSpec();
    const svg = renderChartSvg(spec);
    const provisional = spec.series[0]!.points.find((p) => p.provisional)!;
    expect(svg).toContain(`fill="#ffffff" stroke=`);
    expect(svgText(svg)).toContain(`${provisional.formattedValue}*`);
    expect(svgText(svg)).toContain(spec.provisionalNote!);
  });

  it('the attribution sentence always renders, wrapped but token-intact', () => {
    for (const spec of [lineSpec(), barSpec()]) {
      const text = svgText(renderChartSvg(spec));
      expect(text).toContain('Bron: CBS StatLine, tabel');
      expect(text).toContain(spec.attribution.tableId);
      expect(text).toContain('CC BY 4.0.');
    }
  });

  it('the definition line renders when the spec carries one', () => {
    const spec = buildChartSpec(
      makeResult('series', seriesCells, { definitionLabel: 'gemiddelde verkoopprijs, bestaande koopwoningen' }),
    )!;
    expect(svgText(renderChartSvg(spec))).toContain('Definitie: gemiddelde verkoopprijs');
  });

  it('the coordinate subtitle renders, and digit-bearing dim labels stay provenance-clean', () => {
    const dims = { Leeftijd: '53105' };
    const dimLabels = { Leeftijd: '25 tot 45 jaar' };
    const spec = buildChartSpec(
      makeResult('series', [
        makeCell({ periodCode: '2023JJ00', value: 3.1, dims, dimLabels }),
        makeCell({ periodCode: '2024JJ00', value: 3.4, dims, dimLabels }),
      ]),
    )!;
    const svg = renderChartSvg(spec);
    expect(svgText(svg)).toContain('25 tot 45 jaar');
    const allowed = allowedTokens(spec);
    for (const token of findNumericTokens(normalizeForScan(svgText(svg)))) {
      expect(allowed, `renderer invented numeric token "${token.token}"`).toContain(token.token);
    }
  });
});

describe('renderChartSvg — the x-axis cannot distort chronology', () => {
  it('series with disjoint period sets still render periods in chronological order', () => {
    // Adversarial-review finding (2026-07-03): first-seen category order
    // across series placed 2021 to the RIGHT of 2022 when one region carried
    // 2020+2022 and another only 2021. The axis must sort chronologically.
    const cells = [
      makeCell({ regionCode: 'GM0363', periodCode: '2020JJ00', value: 1 }),
      makeCell({ regionCode: 'GM0363', periodCode: '2022JJ00', value: 3 }),
      makeCell({ regionCode: 'GM0599', periodCode: '2021JJ00', value: 2 }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    const svg = renderChartSvg(spec);
    const cxOf = (resultId: string): number => {
      const escaped = resultId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return Number(svg.match(new RegExp(`<circle cx="([^"]+)"[^>]*data-result-id="${escaped}"`))![1]);
    };
    const [p2020, p2022, p2021] = cells.map((c) => c.resultId);
    expect(cxOf(p2020!)).toBeLessThan(cxOf(p2021!));
    expect(cxOf(p2021!)).toBeLessThan(cxOf(p2022!));
    // The axis labels themselves are emitted in chronological order too.
    expect(svg.indexOf('>2020<')).toBeLessThan(svg.indexOf('>2021<'));
    expect(svg.indexOf('>2021<')).toBeLessThan(svg.indexOf('>2022<'));
  });
});

describe('renderChartSvg — geometry is an exact affine image of the values', () => {
  it('line: vertical positions interpolate linearly between the extremes', () => {
    const spec = lineSpec();
    const svg = renderChartSvg(spec);
    const circles = [...svg.matchAll(/<circle [^>]*cy="([^"]+)"[^>]*data-result-id="([^"]+)"/g)].map(
      (m) => ({ cy: Number(m[1]), resultId: m[2]! }),
    );
    const valueById = new Map(
      spec.series[0]!.points.map((p) => [p.resultId, p.value!] as const),
    );
    expect(circles).toHaveLength(5);
    const [a, b, c] = circles;
    const va = valueById.get(a!.resultId)!;
    const vb = valueById.get(b!.resultId)!;
    const vc = valueById.get(c!.resultId)!;
    // Equal value ratios must map to equal pixel ratios (affine invariance).
    expect((a!.cy - c!.cy) / (b!.cy - c!.cy)).toBeCloseTo((va - vc) / (vb - vc), 3);
  });

  it('bar: baseline is zero, so bar heights are proportional to values', () => {
    const spec = barSpec();
    const svg = renderChartSvg(spec);
    const bars = [...svg.matchAll(/<rect [^>]*height="([^"]+)"[^>]*data-result-id="([^"]+)"/g)].map(
      (m) => ({ height: Number(m[1]), resultId: m[2]! }),
    );
    expect(bars).toHaveLength(2);
    const valueById = new Map(
      spec.series.map((s) => [s.points[0]!.resultId, s.points[0]!.value!] as const),
    );
    const [x, y] = bars;
    expect(x!.height / y!.height).toBeCloseTo(
      valueById.get(x!.resultId)! / valueById.get(y!.resultId)!,
      3,
    );
  });
});

describe('renderChartSvg — purity and safety', () => {
  it('is deterministic and does not mutate the spec', () => {
    const spec = deepFreeze(lineSpec());
    const first = renderChartSvg(spec);
    expect(renderChartSvg(spec)).toBe(first);
  });

  it('escapes markup in spec strings', () => {
    const spec = buildChartSpec(
      makeResult('series', [
        makeCell({ periodCode: '2020JJ00', measureTitle: 'Testmaat <script> & "quotes"' }),
        makeCell({ periodCode: '2021JJ00', measureTitle: 'Testmaat <script> & "quotes"' }),
      ]),
    )!;
    const svg = renderChartSvg(spec);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('refuses a spec version it does not speak', () => {
    const spec = { ...lineSpec(), schemaVersion: 2 as unknown as 1 };
    expect(() => renderChartSvg(spec)).toThrow(/v2/);
  });
});
