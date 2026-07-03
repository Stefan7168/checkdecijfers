// R6, builder half (docs/05): chart specs are deterministic verbatim
// projections of validated results — same values, same order, nulls kept,
// attribution inside the spec (R4), provisional status carried (R11).
import { describe, expect, it } from 'vitest';
import { buildChartSpec, chartSpecSchema, PROVISIONAL_NOTE } from '../../src/chart/index.ts';
import { buildAttributionLine, formatValueNl } from '../../src/answer/compose/format.ts';
import { deepFreeze, makeCell, makeResult } from './helpers.ts';

const seriesCells = [
  makeCell({ periodCode: '2020JJ00', value: 1.3 }),
  makeCell({ periodCode: '2021JJ00', value: 2.7 }),
  makeCell({ periodCode: '2022JJ00', value: 10 }),
  makeCell({ periodCode: '2023JJ00', value: 3.8 }),
  makeCell({ periodCode: '2024JJ00', value: 3.3 }),
];

describe('buildChartSpec — shapes and policy', () => {
  it('series result → line chart whose points are the cells, verbatim and in order', () => {
    const result = makeResult('series', seriesCells);
    const spec = buildChartSpec(result);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe('line');
    expect(spec!.title).toBe('Testmaat');
    expect(spec!.unit).toBe('%');
    expect(spec!.series).toHaveLength(1);
    const points = spec!.series[0]!.points;
    expect(points.map((p) => p.resultId)).toEqual(result.cells.map((c) => c.resultId));
    expect(points.map((p) => p.value)).toEqual(result.cells.map((c) => c.value));
    expect(points.map((p) => p.periodCode)).toEqual(result.cells.map((c) => c.periodCode));
    for (const [i, point] of points.entries()) {
      expect(point.formattedValue).toBe(formatValueNl(result.cells[i]!.value!, result.cells[i]!.decimals));
      expect(point.status).toBe(result.cells[i]!.status);
    }
  });

  it('comparison result → bar chart, one single-point series per region, intent order preserved', () => {
    const cells = [
      makeCell({ regionCode: 'GM0363', periodCode: '2024JJ00', value: 931298, unit: 'aantal', decimals: 0 }),
      makeCell({ regionCode: 'GM0599', periodCode: '2024JJ00', value: 664311, unit: 'aantal', decimals: 0 }),
    ];
    const spec = buildChartSpec(makeResult('comparison', cells));
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe('bar');
    expect(spec!.series.map((s) => s.regionCode)).toEqual(['GM0363', 'GM0599']);
    expect(spec!.series.map((s) => s.label)).toEqual(['Regio GM0363', 'Regio GM0599']);
    for (const s of spec!.series) expect(s.points).toHaveLength(1);
  });

  it('multi-region series groups one line per region, cells never re-ordered within a region', () => {
    const cells = [
      makeCell({ regionCode: 'GM0363', periodCode: '2023JJ00', value: 1 }),
      makeCell({ regionCode: 'GM0599', periodCode: '2023JJ00', value: 2 }),
      makeCell({ regionCode: 'GM0363', periodCode: '2024JJ00', value: 3 }),
      makeCell({ regionCode: 'GM0599', periodCode: '2024JJ00', value: 4 }),
    ];
    const spec = buildChartSpec(makeResult('series', cells));
    expect(spec!.series.map((s) => s.regionCode)).toEqual(['GM0363', 'GM0599']);
    expect(spec!.series[0]!.points.map((p) => p.value)).toEqual([1, 3]);
    expect(spec!.series[1]!.points.map((p) => p.value)).toEqual([2, 4]);
  });

  it('single and derived results chart nothing (Phase 0 policy, ADR 014)', () => {
    expect(buildChartSpec(makeResult('single', [makeCell()]))).toBeNull();
    expect(buildChartSpec(makeResult('derived', seriesCells))).toBeNull();
  });

  it('mixed units across cells fail loudly — never charted', () => {
    const cells = [makeCell({ unit: '%' }), makeCell({ periodCode: '2021JJ00', unit: 'euro' })];
    expect(() => buildChartSpec(makeResult('series', cells))).toThrow(/mixed units/);
  });

  it('a duplicate period within one region fails loudly — never charted', () => {
    const cells = [makeCell({ periodCode: '2020JJ00', value: 1 }), makeCell({ periodCode: '2020JJ00', value: 2 })];
    expect(() => buildChartSpec(makeResult('series', cells))).toThrow(/duplicate period/);
  });

  it('the pinned dimension coordinates travel into the spec (contract audit 2026-07-03)', () => {
    const cells = [
      makeCell({ periodCode: '2023JJ00', dims: { Geslacht: '4000' }, dimLabels: { Geslacht: 'Vrouwen' } }),
      makeCell({ periodCode: '2024JJ00', dims: { Geslacht: '4000' }, dimLabels: { Geslacht: 'Vrouwen' } }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    expect(spec.dims).toEqual({ Geslacht: '4000' });
    expect(spec.dimLabels).toEqual({ Geslacht: 'Vrouwen' });
  });

  it('cells at differing dimension coordinates fail loudly — never charted', () => {
    const cells = [
      makeCell({ periodCode: '2023JJ00', dims: { Geslacht: '3000' }, dimLabels: { Geslacht: 'Mannen' } }),
      makeCell({ periodCode: '2024JJ00', dims: { Geslacht: '4000' }, dimLabels: { Geslacht: 'Vrouwen' } }),
    ];
    expect(() => buildChartSpec(makeResult('series', cells))).toThrow(/differing dimension coordinates/);
  });
});

describe('buildChartSpec — honesty fields', () => {
  it('R11: any provisional cell sets the note and marks exactly its point', () => {
    const cells = [
      makeCell({ periodCode: '2023JJ00', value: 3.8 }),
      makeCell({ periodCode: '2024JJ00', value: 3.3, status: 'Voorlopig', provisional: true }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    expect(spec.provisionalNote).toBe(PROVISIONAL_NOTE);
    expect(spec.series[0]!.points.map((p) => p.provisional)).toEqual([false, true]);

    const definitief = buildChartSpec(makeResult('series', seriesCells))!;
    expect(definitief.provisionalNote).toBeNull();
  });

  it('null-with-reason cells stay in the spec as points and produce an honest-gap note', () => {
    const cells = [
      makeCell({ periodCode: '2020JJ00', value: 1.3 }),
      makeCell({ periodCode: '2021JJ00', value: null, valueAttribute: 'Geheim' }),
      makeCell({ periodCode: '2022JJ00', value: 10 }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    const points = spec.series[0]!.points;
    expect(points).toHaveLength(3);
    expect(points[1]!.value).toBeNull();
    expect(points[1]!.formattedValue).toBeNull();
    expect(spec.nullNotes).toHaveLength(1);
    expect(spec.nullNotes[0]).toContain('2021');
    expect(spec.nullNotes[0]).toContain('Geheim');
  });

  it('R4: the attribution sentence is the same one answers display, plus the structured block', () => {
    const result = makeResult('series', seriesCells);
    const spec = buildChartSpec(result)!;
    expect(spec.attributionLine).toBe(buildAttributionLine(result));
    expect(spec.attribution.tableId).toBe(result.attribution.tableId);
    expect(spec.attribution.syncedAt).toBe(result.attribution.syncedAt);
    expect(spec.attribution.license).toBe('CC BY 4.0');
  });

  it('canonical-default transparency: definitionLabel becomes the definition line', () => {
    const withDefinition = buildChartSpec(
      makeResult('series', seriesCells, { definitionLabel: 'consumentenprijsindex, jaarmutatie' }),
    )!;
    expect(withDefinition.definitionLine).toBe('Definitie: consumentenprijsindex, jaarmutatie.');
    expect(buildChartSpec(makeResult('series', seriesCells))!.definitionLine).toBeNull();
  });
});

describe('buildChartSpec — contract discipline', () => {
  it('is deterministic: identical input → deep-equal spec', () => {
    const result = makeResult('series', seriesCells);
    expect(buildChartSpec(result)).toEqual(buildChartSpec(result));
  });

  it('does not mutate its input', () => {
    const result = deepFreeze(makeResult('series', seriesCells));
    expect(() => buildChartSpec(result)).not.toThrow();
  });

  it('every built spec passes the stored-spec zod schema (round-trip contract)', () => {
    const specs = [
      buildChartSpec(makeResult('series', seriesCells))!,
      buildChartSpec(
        makeResult('comparison', [
          makeCell({ regionCode: 'GM0363', value: 5, unit: 'aantal', decimals: 0 }),
          makeCell({ regionCode: 'GM0599', value: 3, unit: 'aantal', decimals: 0 }),
        ]),
      )!,
    ];
    for (const spec of specs) {
      expect(() => chartSpecSchema.parse(spec)).not.toThrow();
    }
  });

  it('the schema rejects tampered specs (unknown fields, broken null pairing)', () => {
    const spec = buildChartSpec(makeResult('series', seriesCells))!;
    expect(() => chartSpecSchema.parse({ ...spec, extra: 1 })).toThrow();
    const broken = JSON.parse(JSON.stringify(spec)) as typeof spec;
    broken.series[0]!.points[0]!.formattedValue = null;
    expect(() => chartSpecSchema.parse(broken)).toThrow(/formattedValue/);
  });
});
