// R6, builder half (docs/05): chart specs are deterministic verbatim
// projections of validated results — same values, same order, nulls kept,
// attribution inside the spec (R4), provisional status carried (R11).
import { describe, expect, it } from 'vitest';
import { buildChartSpec, chartSpecSchema, PROVISIONAL_NOTE } from '../../src/chart/index.ts';
import { buildAttributionLine, formatValueNl } from '../../src/answer/compose/format.ts';
import { DERIVED_DATA_MARKING } from '../../src/query/index.ts';
import type { DerivationRecord, ValidatedResult } from '../../src/query/index.ts';
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

describe('buildChartSpec — the #64 non-contiguous enumeration gate', () => {
  it('draws NO chart for a series with a hole in its own periods (a line would imply the unseen year)', () => {
    const result = makeResult('series', [
      makeCell({ periodCode: '2020JJ00' }),
      makeCell({ periodCode: '2022JJ00' }),
    ]);
    expect(buildChartSpec(result)).toBeNull();
  });

  it('still charts a gap-free series (adjacent years, the B4/B8 class)', () => {
    const result = makeResult('series', [
      makeCell({ periodCode: '2020JJ00' }),
      makeCell({ periodCode: '2021JJ00' }),
      makeCell({ periodCode: '2022JJ00' }),
    ]);
    const spec = buildChartSpec(result);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe('line');
  });

  it('leaves comparisons untouched (one period, several regions — no period hole possible)', () => {
    const result = makeResult('comparison', [
      makeCell({ regionCode: 'GM0363' }),
      makeCell({ regionCode: 'GM0599' }),
    ]);
    expect(buildChartSpec(result)).not.toBeNull();
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

  // #170(4): buildChartSpec itself never sets `annotations` (only the Ontdek
  // curated path does, in src/chart/curated.ts) — this pins that a spec
  // built by the shared, chat-facing function is byte-identical to before
  // the field existed, and that the schema still treats it as OPTIONAL so
  // every spec stored before this PR (R8: those rows live forever) keeps
  // validating unchanged.
  it('annotations: buildChartSpec never sets it, and the schema accepts a spec both with and without it', () => {
    const spec = buildChartSpec(makeResult('series', seriesCells))!;
    expect(spec.annotations).toBeUndefined();
    expect(() => chartSpecSchema.parse(spec)).not.toThrow();
    const withAnnotations = { ...spec, annotations: [{ periodCode: '2020JJ00', label: 'Testgebeurtenis (2020).' }] };
    expect(() => chartSpecSchema.parse(withAnnotations)).not.toThrow();
  });

  it('annotations: the schema rejects a malformed entry (missing field, empty label, unknown key)', () => {
    const spec = buildChartSpec(makeResult('series', seriesCells))!;
    expect(() =>
      chartSpecSchema.parse({ ...spec, annotations: [{ periodCode: '2020JJ00' }] }),
    ).toThrow();
    expect(() =>
      chartSpecSchema.parse({ ...spec, annotations: [{ periodCode: '2020JJ00', label: '' }] }),
    ).toThrow();
    expect(() =>
      chartSpecSchema.parse({
        ...spec,
        annotations: [{ periodCode: '2020JJ00', label: 'x', extra: 1 }],
      }),
    ).toThrow();
  });
});

describe('trendHeadline (#197 idea 4)', () => {
  // 3 source points (I2, whole-branch review): a 2-point derivation is
  // trivially monotonic (one interval only) and must never earn "gestaag" —
  // this fixture uses 3 contiguous years so the "gestaag" case below stays a
  // real steady-trend test instead of silently degrading to a non-gestaag
  // string under an unchanged assertion.
  function seriesWithDirection() {
    const first = makeCell({ periodCode: '2023JJ00', value: 100 });
    const middle = makeCell({ periodCode: '2024JJ00', value: 110 });
    const last = makeCell({ periodCode: '2025JJ00', value: 120 });
    const direction: DerivationRecord = {
      kind: 'direction',
      explicit: false,
      sourceResultIds: [first.resultId, middle.resultId, last.resultId],
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      direction: 'up',
      monotonic: true,
      netChange: 20,
      firstResultId: first.resultId,
      lastResultId: last.resultId,
    };
    return makeResult('series', [first, middle, last], { definitionLabel: 'bevolking' }, [direction]);
  }

  it('sets attribution.trendHeadline when a direction derivation is registered', () => {
    const spec = buildChartSpec(seriesWithDirection())!;
    expect(spec.attribution.trendHeadline).toBe('Bevolking steeg gestaag sinds 2023.');
  });

  it('omits trendHeadline (no key at all, not undefined-valued) when there is no direction derivation', () => {
    const spec = buildChartSpec(makeResult('series', [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })]))!;
    expect('trendHeadline' in spec.attribution).toBe(false);
  });

  // C1 (whole-branch review, Critical): deriveDirection has no region guard
  // and cells are period-major/region-minor, so on a multi-region chart its
  // (first cell, last cell) pair silently diffs across DIFFERENT regions —
  // reproduced by the reviewer as Amsterdam 200→190 (falling) + Utrecht
  // 100→150 (rising) yielding a false, unqualified "daalde" headline. The
  // fix gates trendHeadline on single-region charts only, regardless of what
  // the (possibly cross-region) direction derivation itself says.
  it('suppresses trendHeadline on a multi-region chart even when a direction derivation is registered', () => {
    const cells = [
      makeCell({ regionCode: 'GM0363', periodCode: '2023JJ00', value: 200 }),
      makeCell({ regionCode: 'GM0344', periodCode: '2023JJ00', value: 100 }),
      makeCell({ regionCode: 'GM0363', periodCode: '2024JJ00', value: 190 }),
      makeCell({ regionCode: 'GM0344', periodCode: '2024JJ00', value: 150 }),
    ];
    const direction: DerivationRecord = {
      kind: 'direction',
      explicit: false,
      sourceResultIds: cells.map((c) => c.resultId),
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      // Exactly the reported shape: cells[0] (region GM0363) vs cells[3]
      // (region GM0344) — a cross-region diff, not a real trend.
      direction: 'down',
      monotonic: true,
      netChange: -50,
      firstResultId: cells[0]!.resultId,
      lastResultId: cells[3]!.resultId,
    };
    const spec = buildChartSpec(makeResult('series', cells, { definitionLabel: 'bevolking' }, [direction]))!;
    expect(spec.series).toHaveLength(2);
    expect('trendHeadline' in spec.attribution).toBe(false);
  });

  it('a spec with trendHeadline still validates against chartSpecSchema', () => {
    const spec = buildChartSpec(seriesWithDirection())!;
    expect(() => chartSpecSchema.parse(spec)).not.toThrow();
  });

  it('a spec without trendHeadline (every pre-existing stored spec) still validates unchanged', () => {
    const spec = buildChartSpec(makeResult('series', [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })]))!;
    expect(() => chartSpecSchema.parse(spec)).not.toThrow();
  });
});

// Chart co-pilot phase 5b (the verified whole): `regionScope` records WHICH
// region class (ValidatedResult.regionSet.scope, #253) produced a chart's
// series — provenance the pie/stacked guards read, never derive. Explicit
// null on every other chart; OPTIONAL in the schema (ADR 014 optional-v1-field
// rule) so every spec stored before the field existed still parses.
describe('regionScope (phase 5b task 2 — region-class provenance)', () => {
  const regionSetCells = [
    makeCell({ regionCode: 'PV20', periodCode: '2025JJ00', value: 600000, unit: 'aantal', decimals: 0 }),
    makeCell({ regionCode: 'PV21', periodCode: '2025JJ00', value: 500000, unit: 'aantal', decimals: 0 }),
  ];

  /** A region_set result carrying a coverage record — the shape runQuery
   * produces for a region-class intent (tests/chart/region-set.test.ts proves
   * the same against REAL results; this is the hand-built unit mirror). */
  function regionSetResult(scope: NonNullable<ValidatedResult['regionSet']>['scope']): ValidatedResult {
    return {
      ...makeResult('region_set', regionSetCells, { tableId: 'TESTNED' }),
      regionSet: { scope, rosterSize: 2, notApplicable: [], withheld: [], missing: [], complete: true },
    };
  }

  it('a region_set-built spec carries the real scope, for every one of the FOUR RegionScope variants', () => {
    const scopes: NonNullable<ValidatedResult['regionSet']>['scope'][] = [
      { kind: 'all_provincies' },
      { kind: 'all_landsdelen' },
      { kind: 'all_gemeenten' },
      { kind: 'gemeenten_in_provincie', parent: 'PV26' },
    ];
    for (const scope of scopes) {
      const spec = buildChartSpec(regionSetResult(scope))!;
      expect(spec.regionScope, scope.kind).toEqual(scope);
      // And the schema round-trips it — including `all_gemeenten`, which has
      // no verified-whole concept but IS a scope a chart can be built from
      // (the field is provenance, not a pre-filtered "verifiable" list).
      expect(() => chartSpecSchema.parse(spec), scope.kind).not.toThrow();
      expect(chartSpecSchema.parse(spec).regionScope).toEqual(scope);
    }
  });

  it('every non-region_set spec carries an explicit null (the key is PRESENT, not omitted)', () => {
    const specs = {
      series: buildChartSpec(makeResult('series', seriesCells))!,
      comparison: buildChartSpec(
        makeResult('comparison', [
          makeCell({ regionCode: 'GM0363', value: 5, unit: 'aantal', decimals: 0 }),
          makeCell({ regionCode: 'GM0599', value: 3, unit: 'aantal', decimals: 0 }),
        ]),
      )!,
      multiRegionSeries: buildChartSpec(
        makeResult('series', [
          makeCell({ regionCode: 'GM0363', periodCode: '2023JJ00', value: 1 }),
          makeCell({ regionCode: 'GM0599', periodCode: '2023JJ00', value: 2 }),
          makeCell({ regionCode: 'GM0363', periodCode: '2024JJ00', value: 3 }),
          makeCell({ regionCode: 'GM0599', periodCode: '2024JJ00', value: 4 }),
        ]),
      )!,
    };
    for (const [name, spec] of Object.entries(specs)) {
      expect('regionScope' in spec, name).toBe(true);
      expect(spec.regionScope, name).toBeNull();
      expect(() => chartSpecSchema.parse(spec), name).not.toThrow();
    }
  });

  it('a region_set result WITHOUT a coverage record (never produced by runQuery, but a present-only key) still yields null, never a throw', () => {
    const spec = buildChartSpec(makeResult('region_set', regionSetCells))!;
    expect(spec.regionScope).toBeNull();
  });

  it('an already-stored spec fixture predating this field (no key at all) still parses unchanged — the optional-field rule holds', () => {
    const spec = buildChartSpec(regionSetResult({ kind: 'all_provincies' }))!;
    const stored = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
    delete stored.regionScope;
    expect('regionScope' in stored).toBe(false);
    const parsed = chartSpecSchema.parse(stored);
    // Parsing neither invents the key nor changes anything else.
    expect('regionScope' in parsed).toBe(false);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(stored);
  });

  it('the schema rejects a malformed scope (unknown kind, missing parent, parent where none belongs, non-object)', () => {
    const spec = buildChartSpec(makeResult('series', seriesCells))!;
    expect(() => chartSpecSchema.parse({ ...spec, regionScope: { kind: 'all_countries' } })).toThrow();
    expect(() => chartSpecSchema.parse({ ...spec, regionScope: { kind: 'gemeenten_in_provincie' } })).toThrow();
    expect(() =>
      chartSpecSchema.parse({ ...spec, regionScope: { kind: 'gemeenten_in_provincie', parent: '' } }),
    ).toThrow();
    expect(() => chartSpecSchema.parse({ ...spec, regionScope: { kind: 'all_provincies', parent: 'PV26' } })).toThrow();
    expect(() => chartSpecSchema.parse({ ...spec, regionScope: 'all_provincies' })).toThrow();
    expect(() => chartSpecSchema.parse({ ...spec, regionScope: undefined })).not.toThrow();
  });
});
