// WP30c/E1 (ADR 048 D6): standalone unit tests on the JSON-stat 2.0 parser,
// proving the amendments the brief's own second adversarial review folded
// in — none of these need the conformance harness (per Amendment B4, the
// harness has no "expected to throw" mechanism at all).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CbsSlice } from '../../src/cbs-adapter/types.ts';
import { encodePeriodCode, parsePeriodCode } from '../../src/ingestion/periods.ts';
import {
  EU_EFTA_STAND_IN_GEO_CODES,
  eurostatBaseLabel,
  eurostatFactorUnit,
  mapEurostatPeriod,
  parseJsonStatCatalog,
  parseJsonStatDataset,
  SYNC_CELL_THRESHOLD,
} from '../../src/eurostat-adapter/jsonstat.ts';
import type { JsonStatDataset } from '../../src/eurostat-adapter/types.ts';
import { AsyncApiRequiredError, UnsupportedGrainError } from '../../src/eurostat-adapter/types.ts';

// A minimal, valid JSON-stat 2.0 dataset builder — every test below starts
// from this and overrides only what it needs, so each test reads as "what
// changed", not a wall of repeated boilerplate.
function dataset(overrides: Partial<JsonStatDataset> = {}): JsonStatDataset {
  return {
    version: '2.0',
    class: 'dataset',
    label: 'Test dataset',
    id: ['unit', 'geo', 'time'],
    size: [1, 1, 1],
    dimension: {
      unit: { category: { index: { NR: 0 }, label: { NR: 'Number' } } },
      geo: { category: { index: { NL: 0 }, label: { NL: 'Netherlands' } } },
      time: { category: { index: { 2024: 0 }, label: { 2024: '2024' } } },
    },
    value: [1],
    ...overrides,
  };
}

describe('mapEurostatPeriod (D6 period grammar)', () => {
  it('maps annual/quarterly/monthly natively and survives the canonical-grammar round-trip', () => {
    const cases: [string, string][] = [
      ['2024', '2024JJ00'],
      ['2024-Q1', '2024KW01'],
      ['2024-Q4', '2024KW04'],
      ['2024-M01', '2024MM01'],
      ['2024-M12', '2024MM12'],
    ];
    for (const [native, expected] of cases) {
      const mapped = mapEurostatPeriod(native);
      expect(mapped, native).toBe(expected);
      const parsed = parsePeriodCode(mapped);
      expect(parsed, mapped).not.toBeNull();
      expect(encodePeriodCode(parsed!)).toBe(mapped);
    }
  });

  it('refuses semester, weekly and daily grains (Amendment B4) — never silently mapped', () => {
    for (const [native, grain] of [
      ['2024-S1', 'semester'],
      ['2024-W01', 'weekly'],
      ['2024-01-15', 'daily'],
    ] as const) {
      let caught: unknown;
      try {
        mapEurostatPeriod(native);
      } catch (err) {
        caught = err;
      }
      expect(caught, native).toBeInstanceOf(UnsupportedGrainError);
      expect((caught as InstanceType<typeof UnsupportedGrainError>).grain).toBe(grain);
      expect((caught as InstanceType<typeof UnsupportedGrainError>).nativeCode).toBe(native);
    }
  });
});

describe('parseJsonStatDataset — period grammar over a full dataset', () => {
  it('refuses a semester-grain dataset by throwing, never mapping silently (Amendment B4)', () => {
    const raw = dataset({
      id: ['unit', 'geo', 'time'],
      size: [1, 1, 1],
      dimension: {
        unit: { category: { index: { NR: 0 } } },
        geo: { category: { index: { NL: 0 } } },
        time: { category: { index: { '2024-S1': 0 } } },
      },
      value: [42],
    });
    expect(() => parseJsonStatDataset(raw, 'eurostat:semester_test')).toThrow(UnsupportedGrainError);
  });
});

describe('parseJsonStatDataset — per-unit measure synthesis (D6)', () => {
  it('splits a dataset with 2 unit codes into 2 measures, each pinned to its own unit', () => {
    const raw = dataset({
      label: 'Energy balance',
      id: ['unit', 'geo', 'time'],
      size: [2, 1, 2],
      dimension: {
        unit: {
          category: {
            index: { GWH: 0, KTOE: 1 },
            label: { GWH: 'Gigawatt-hour', KTOE: 'Thousand tonnes of oil equivalent' },
          },
        },
        geo: { category: { index: { NL: 0 }, label: { NL: 'Netherlands' } } },
        time: { category: { index: { 2022: 0, 2023: 1 }, label: { 2022: '2022', 2023: '2023' } } },
      },
      value: [123.4, 130.25, 45, 46.1],
    });

    const parsed = parseJsonStatDataset(raw, 'eurostat:nrg_bal_c');

    expect(parsed.schema.measures.map((m) => m.code).sort()).toEqual(['nrg_bal_c|GWH', 'nrg_bal_c|KTOE']);
    const gwh = parsed.schema.measures.find((m) => m.code === 'nrg_bal_c|GWH')!;
    const ktoe = parsed.schema.measures.find((m) => m.code === 'nrg_bal_c|KTOE')!;
    expect(gwh.unit).toBe('Gigawatt-hour');
    expect(gwh.title).toBe('Energy balance — Gigawatt-hour');
    expect(gwh.decimals).toBe(2); // 123.4 / 130.25
    expect(ktoe.unit).toBe('Thousand tonnes of oil equivalent');
    expect(ktoe.decimals).toBe(1); // 45 / 46.1

    // 'unit' is absorbed into the measure identity — never a schema dimension.
    expect(parsed.schema.dimensions.map((d) => d.name)).not.toContain('unit');
    expect(parsed.codeLists.unit).toBeUndefined();

    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.filter((r) => r.measure === 'nrg_bal_c|GWH')).toHaveLength(2);
    expect(parsed.rows.filter((r) => r.measure === 'nrg_bal_c|KTOE')).toHaveLength(2);
    // 'unit' never rides on the stored coordinates either (only geo/time).
    for (const row of parsed.rows) {
      expect(Object.keys(row.coordinates).sort()).toEqual(['geo', 'time']);
    }
  });

  it('slice dimensionEquals on "unit" pins to one measure (D6: "unit pinned in the slice")', () => {
    const raw = dataset({
      id: ['unit', 'geo', 'time'],
      size: [2, 1, 2],
      dimension: {
        unit: { category: { index: { GWH: 0, KTOE: 1 } } },
        geo: { category: { index: { NL: 0 } } },
        time: { category: { index: { 2022: 0, 2023: 1 } } },
      },
      value: [1, 2, 3, 4],
    });
    const slice: CbsSlice = { dimensionEquals: { unit: 'GWH' } };
    const parsed = parseJsonStatDataset(raw, 'eurostat:nrg_bal_c', slice);
    expect(parsed.schema.measures.map((m) => m.code)).toEqual(['nrg_bal_c|GWH']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.every((r) => r.measure === 'nrg_bal_c|GWH')).toBe(true);
  });
});

describe('parseJsonStatDataset — flags ride verbatim into valueAttribute (Amendment B1)', () => {
  it('a null-reason flag on a NULL cell reaches valueAttribute', () => {
    const raw = dataset({
      id: ['unit', 'geo', 'time'],
      size: [1, 1, 1],
      dimension: {
        unit: { category: { index: { CLV_PCH_PRE: 0 } } },
        geo: { category: { index: { NL: 0 } } },
        time: { category: { index: { '2023-Q3': 0 } } },
      },
      value: [null],
      status: { '0': ':' },
    });
    const parsed = parseJsonStatDataset(raw, 'eurostat:namq_10_gdp');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.value).toBeNull();
    expect(parsed.rows[0]!.valueAttribute).toBe(':');
  });

  it('a flag on a NON-null cell ALSO rides verbatim — this is not a per-cell provisional mechanism, ' +
    'just a verbatim carry (Amendment B1: pipeline.ts has no per-cell status path; the registry\'s own ' +
    '"definitiveStatuses: []" is what actually keeps every Eurostat cell provisional, not this field)', () => {
    const raw = dataset({
      id: ['unit', 'geo', 'time'],
      size: [1, 1, 1],
      dimension: {
        unit: { category: { index: { CLV_PCH_PRE: 0 } } },
        geo: { category: { index: { DE: 0 } } },
        time: { category: { index: { '2023-Q2': 0 } } },
      },
      value: [0.2],
      status: { '0': 'b' },
    });
    const parsed = parseJsonStatDataset(raw, 'eurostat:namq_10_gdp');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.value).toBe(0.2);
    expect(parsed.rows[0]!.valueAttribute).toBe('b');
  });

  it('an unflagged cell carries valueAttribute "None" (the CBS convention, reused verbatim)', () => {
    const raw = dataset(); // default: 1 cell, value 1, no status
    const parsed = parseJsonStatDataset(raw, 'eurostat:plain_test');
    expect(parsed.rows[0]!.valueAttribute).toBe('None');
  });
});

describe('parseJsonStatDataset — D6 licence-exception geo restriction (Assumption 2 stand-in list)', () => {
  it('excludes a non-EU/EFTA geo (e.g. the US) structurally, from both rows and the geo code list', () => {
    expect(EU_EFTA_STAND_IN_GEO_CODES.has('US')).toBe(false);
    expect(EU_EFTA_STAND_IN_GEO_CODES.has('NL')).toBe(true);

    const raw = dataset({
      id: ['unit', 'geo', 'time'],
      size: [1, 3, 1],
      dimension: {
        unit: { category: { index: { NR: 0 } } },
        geo: { category: { index: { NL: 0, DE: 1, US: 2 } } },
        time: { category: { index: { 2024: 0 } } },
      },
      value: [1, 2, 3],
    });
    const parsed = parseJsonStatDataset(raw, 'eurostat:licence_test');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.map((r) => r.coordinates.geo).sort()).toEqual(['NL', 'DE'].sort());
    expect(parsed.codeLists.geo!.map((c) => c.code).sort()).toEqual(['NL', 'DE'].sort());
  });

  it('a caller-supplied slice can narrow further but can never widen past the structural restriction', () => {
    const raw = dataset({
      id: ['unit', 'geo', 'time'],
      size: [1, 2, 1],
      dimension: {
        unit: { category: { index: { NR: 0 } } },
        geo: { category: { index: { NL: 0, US: 1 } } },
        time: { category: { index: { 2024: 0 } } },
      },
      value: [1, 2],
    });
    // A slice that tries to explicitly ask for US still gets nothing — the
    // geo restriction is checked independently of, and before, the slice.
    const slice: CbsSlice = { dimensionEquals: { geo: 'US' } };
    const parsed = parseJsonStatDataset(raw, 'eurostat:licence_test2', slice);
    expect(parsed.rows).toHaveLength(0);
  });
});

describe('parseJsonStatDataset — slice periodFloor', () => {
  it('excludes periods before the floor, on the MAPPED (internal) period code', () => {
    const raw = dataset({
      id: ['unit', 'geo', 'time'],
      size: [1, 1, 3],
      dimension: {
        unit: { category: { index: { CLV_PCH_PRE: 0 } } },
        geo: { category: { index: { NL: 0 } } },
        time: { category: { index: { '2023-Q1': 0, '2023-Q2': 1, '2023-Q3': 2 } } },
      },
      value: [0.1, 0.2, 0.3],
    });
    const parsed = parseJsonStatDataset(raw, 'eurostat:floor_test', { periodFloor: '2023KW02' });
    expect(parsed.rows.map((r) => r.coordinates.time).sort()).toEqual(['2023KW02', '2023KW03']);
  });
});

describe('parseJsonStatDataset — synchronous-only cell threshold (D6)', () => {
  it('refuses a dataset whose declared cell count exceeds the sync threshold', () => {
    const raw = dataset({ id: ['a', 'b'], size: [1000, 501], dimension: {}, value: [] });
    expect(() => parseJsonStatDataset(raw, 'eurostat:too_big')).toThrow(AsyncApiRequiredError);
    expect(1000 * 501).toBeGreaterThan(SYNC_CELL_THRESHOLD);
  });
});

describe('Amendment 7 — parseFactorUnit/baseLabel wrappers fail open AND log on a mismatch', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('eurostatFactorUnit: an ordinary textual unit label (no digits) never logs — not a mismatch', () => {
    const result = eurostatFactorUnit('Number', 'test');
    expect(result).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('eurostatFactorUnit: a malformed unit string that LOOKS numeric but does not parse fails open and logs', () => {
    let result: number | null = null;
    expect(() => {
      result = eurostatFactorUnit('1 000 THS_T weird trailing text', 'unit:test');
    }).not.toThrow();
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toContain('factor-unit');
  });

  it('eurostatBaseLabel: an ordinary label with no parenthetical never logs, and returns it verbatim', () => {
    const result = eurostatBaseLabel('Percentage of GDP', 'test');
    expect(result).toBe('Percentage of GDP');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('eurostatBaseLabel: a malformed (empty) label fails open, logs, and returns the input verbatim', () => {
    let result: string | null = null;
    expect(() => {
      result = eurostatBaseLabel('', 'unit:test');
    }).not.toThrow();
    expect(result).toBe('');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toContain('base-label-empty');
  });

  it('eurostatBaseLabel: a CBS-shaped trailing parenthetical logs the observation but NEVER strips ' +
    '(D6 requires the unit label verbatim)', () => {
    const result = eurostatBaseLabel('Number (NR)', 'unit:test');
    expect(result).toBe('Number (NR)'); // verbatim, unchanged
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toContain('base-label-parenthetical');
  });
});

describe('parseJsonStatCatalog — provisional Catalogue API shape', () => {
  it('parses a link.item[] listing into prefixed CbsCatalogEntry rows', () => {
    const raw = {
      link: {
        item: [
          { code: 'demo_pjan', title: 'Population on 1 January', type: 'dataset', lastUpdate: '2026-01-15' },
        ],
      },
    };
    const entries = parseJsonStatCatalog(raw);
    expect(entries).toEqual([
      {
        tableId: 'eurostat:demo_pjan',
        title: 'Population on 1 January',
        summary: '',
        status: null,
        datasetType: 'dataset',
        language: 'en',
        modified: '2026-01-15',
      },
    ]);
  });

  it('throws loudly on a response missing link.item[] (never silently returns an empty catalog)', () => {
    expect(() => parseJsonStatCatalog({ nope: true })).toThrow();
  });
});
