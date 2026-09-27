// Two-measure scatter (spec 2026-09-27), Task 2: the deterministic ScatterSpec.
// Task 3 (#296 part 2): self-sufficiency — scope, leftOut, notApplicableCount.
import { describe, expect, it } from 'vitest';
import { buildScatterSpec, defaultScale, scatterSpecSchema, SCATTER_MAX_LABELS } from '../../src/chart/index.ts';
import { pairRegions } from '../../src/query/index.ts';
import type { ResultCell, ValidatedResult } from '../../src/query/index.ts';

function cell(tableId: string, measureTitle: string, regionCode: string, value: number | null, extra: Partial<ResultCell> = {}): ResultCell {
  return {
    resultId: `${tableId}:M:${regionCode}:2024JJ00:-`,
    tableId,
    measure: 'M',
    measureTitle,
    regionCode,
    regionLabel: `${regionCode} (PV)`,
    periodCode: '2024JJ00',
    periodLabel: '2024',
    grain: 'JJ',
    dims: {},
    dimLabels: {},
    value,
    unit: tableId === 'Y' ? 'euro' : 'aantal',
    decimals: 0,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    batchId: 1,
    ...extra,
  };
}

interface LegOptions {
  complete?: boolean;
  /** Region codes with NO cell on this leg, added to `regionSet.missing` so
   * `pairRegions` discovers them (a code absent from every leg's cells AND
   * coverage lists never surfaces at all — src/query/pair.ts's own codes
   * collection). */
  missing?: string[];
  /** Region codes with NO cell on this leg that CBS says are not a member of
   * the class this period, added to `regionSet.notApplicable`. */
  notApplicable?: string[];
  /** Per-region `valueAttribute` override for a null-valued code (the CBS
   * marker on a withheld cell) — default cell() always carries 'None'. */
  attributes?: Record<string, string>;
}

function leg(tableId: string, measureTitle: string, values: Record<string, number | null>, opts: LegOptions = {}): ValidatedResult {
  const { complete = true, missing = [], notApplicable = [], attributes = {} } = opts;
  const cells = Object.entries(values).map(([code, v]) =>
    cell(tableId, measureTitle, code, v, v === null && attributes[code] !== undefined ? { valueAttribute: attributes[code] } : {}),
  );
  const withheld = cells.filter((c) => c.value === null).map((c) => c.regionCode!);
  return {
    ok: true,
    schemaVersion: 1,
    shape: 'region_set',
    cells,
    derivations: [],
    attribution: {
      tableId,
      tableTitle: `Tabel ${tableId}`,
      tableVersion: 1,
      syncedAt: '2026-09-01T00:00:00.000Z',
      coveredPeriods: { from: '2024JJ00', to: '2024JJ00' },
      license: 'CC BY 4.0',
      definitionLabel: null,
      definitionText: null,
    },
    intent: {} as never,
    regionSet: {
      scope: { kind: 'all_provincies' },
      rosterSize: cells.length + missing.length + notApplicable.length,
      notApplicable,
      withheld,
      missing,
      complete: complete && withheld.length === 0 && missing.length === 0 && notApplicable.length === 0,
    },
  } as unknown as ValidatedResult;
}

describe('defaultScale', () => {
  it('log when every value is positive and max/min >= 100', () => {
    expect(defaultScale([1_000, 50_000, 900_000])).toBe('log');
  });
  it('linear below a 100x spread', () => {
    expect(defaultScale([200_000, 450_000, 1_200_000])).toBe('linear');
  });
  it('linear when any value is zero or negative', () => {
    expect(defaultScale([0, 10, 100_000])).toBe('linear');
    expect(defaultScale([-5, 10, 100_000])).toBe('linear');
  });
});

describe('buildScatterSpec', () => {
  const y = leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000, B: 500_000, C: 400_000, D: 350_000 });
  const x = leg('X', 'Bevolking op 1 januari', { A: 1_000, B: 900_000, C: 50_000, D: 20_000 });

  it('builds one point per paired region with formatted strings and both result ids', () => {
    const spec = buildScatterSpec(y, x);
    expect(spec.kind).toBe('scatter');
    expect(spec.points.map((p) => p.regionCode)).toEqual(['A', 'B', 'C', 'D']);
    const b = spec.points[1];
    expect(b).toMatchObject({ y: 500_000, x: 900_000, xResultId: 'X:M:B:2024JJ00:-', yResultId: 'Y:M:B:2024JJ00:-' });
    expect(b.label).toBe('B (PV)');
    expect(b.yFormatted).toBe('500.000');
    expect(b.xFormatted).toBe('900.000');
    expect(spec.title).toBe('Gemiddelde verkoopprijs tegenover bevolking op 1 januari, 2024');
    expect(spec.y.tableId).toBe('Y');
    expect(spec.x.tableId).toBe('X');
  });

  it('opens the wide-spread axis on a log scale, the narrow one linear', () => {
    const spec = buildScatterSpec(y, x);
    expect(spec.x.defaultScale).toBe('log');
    expect(spec.y.defaultScale).toBe('linear');
  });

  it('labels the extremes (highest y, lowest y, highest x, lowest x), de-duplicated, at most 4', () => {
    const spec = buildScatterSpec(y, x);
    // y: max B, min A; x: max B (dup), min A (dup) → [B, A]
    expect(spec.labelled).toEqual(['B', 'A']);
    expect(spec.labelled.length).toBeLessThanOrEqual(SCATTER_MAX_LABELS);
  });

  it('labels nothing when either leg is incomplete (a withheld value could be the extreme)', () => {
    const yGap = leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000, B: 500_000, C: 400_000, D: null });
    const spec = buildScatterSpec(yGap, x);
    expect(spec.points).toHaveLength(3);
    expect(spec.labelled).toEqual([]);
  });

  it('flags provisional points and sets the provisional note', () => {
    const yProv = leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000, B: 500_000, C: 400_000, D: 350_000 });
    yProv.cells[2] = { ...yProv.cells[2], provisional: true, status: 'Voorlopig' };
    const spec = buildScatterSpec(yProv, x);
    expect(spec.points[2].provisional).toBe(true);
    expect(spec.provisionalNote).not.toBeNull();
  });

  it('validates against its own strict schema', () => {
    expect(scatterSpecSchema.safeParse(buildScatterSpec(y, x)).success).toBe(true);
    expect(scatterSpecSchema.safeParse({ ...buildScatterSpec(y, x), extra: 1 }).success).toBe(false);
  });

  it('the schema rejects a labelled code that is not the regionCode of any point', () => {
    const spec = buildScatterSpec(y, x);
    const bad = { ...spec, labelled: [...spec.labelled, 'NOT-A-POINT'] };
    const result = scatterSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('throws an explicit error, not a TypeError, when the pair has no cells', () => {
    const yEmpty = leg('Y', 'Gemiddelde verkoopprijs', {});
    const xEmpty = leg('X', 'Bevolking op 1 januari', {});
    expect(() => buildScatterSpec(yEmpty, xEmpty)).toThrow(
      /buildScatterSpec: Y has no cells — a scatter needs at least one paired region/,
    );
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildScatterSpec(y, x))).toBe(JSON.stringify(buildScatterSpec(y, x)));
  });
});

describe('buildScatterSpec: self-sufficiency (#296 part 2 — scope, leftOut, notApplicableCount)', () => {
  const y = leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000, B: 500_000, C: 400_000, D: 350_000 });
  const x = leg('X', 'Bevolking op 1 januari', { A: 1_000, B: 900_000, C: 50_000, D: 20_000 });

  it("carries the y leg's regionSet.scope", () => {
    const spec = buildScatterSpec(y, x);
    expect(spec.scope).toEqual(y.regionSet!.scope);
  });

  it('discloses every left-out region, in pairRegions order, with each side stated', () => {
    const yLeg = leg(
      'Y',
      'Gemiddelde verkoopprijs',
      { A: 300_000, B: 500_000, E: null, F: 450_000 },
      { attributes: { E: 'Secret' }, missing: ['G'] },
    );
    const xLeg = leg('X', 'Bevolking op 1 januari', { A: 1_000, B: 900_000, E: 800 });

    const spec = buildScatterSpec(yLeg, xLeg);
    const pairing = pairRegions(yLeg, xLeg);

    expect(spec.leftOut.map((r) => r.regionCode)).toEqual(pairing.leftOut.map((r) => r.regionCode));
    expect(spec.leftOut).toEqual([
      {
        regionCode: 'E',
        label: 'E (PV)',
        y: { state: 'withheld', valueAttribute: 'Secret' },
        x: { state: 'value', valueAttribute: null },
      },
      {
        regionCode: 'F',
        label: 'F (PV)',
        y: { state: 'value', valueAttribute: null },
        x: { state: 'missing', valueAttribute: null },
      },
      {
        // Neither leg ever named G (no cell on either side) — label falls
        // back to the bare region code.
        regionCode: 'G',
        label: 'G',
        y: { state: 'missing', valueAttribute: null },
        x: { state: 'missing', valueAttribute: null },
      },
    ]);
  });

  it('notApplicableCount equals pairRegions(...).notApplicable.length', () => {
    const yLeg = leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000 }, { notApplicable: ['H'] });
    const xLeg = leg('X', 'Bevolking op 1 januari', { A: 1_000 });
    const spec = buildScatterSpec(yLeg, xLeg);
    expect(spec.notApplicableCount).toBe(pairRegions(yLeg, xLeg).notApplicable.length);
    expect(spec.notApplicableCount).toBe(1);
  });

  it('throws an explicit error when the y leg has no regionSet', () => {
    const yNoRegionSet = { ...leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000 }), regionSet: undefined };
    expect(() => buildScatterSpec(yNoRegionSet, x)).toThrow(
      /buildScatterSpec: the y leg has no regionSet — a scatter is only built from region-set legs/,
    );
  });

  it('validates the extended fields (scope, leftOut, notApplicableCount) against the strict schema', () => {
    const yLeg = leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000, E: null, F: 450_000 }, { attributes: { E: 'Secret' } });
    const xLeg = leg('X', 'Bevolking op 1 januari', { A: 1_000, E: 800 });
    const spec = buildScatterSpec(yLeg, xLeg);
    expect(scatterSpecSchema.safeParse(spec).success).toBe(true);
  });
});
