// Slice estimation (WP16 sub-part 2, ADR 026, design §4). Pure — no DB, no
// network: the estimator takes fetched schema + code lists + a $count and
// decides full-vs-sliced.
import { describe, expect, it } from 'vitest';
import type { CbsCode, CbsTableSchema } from '../../src/cbs-adapter/types.ts';
import {
  ONBOARDING_MAX_CELLS,
  ONBOARDING_SLICE_YEARS,
  cardinalityProduct,
  estimateSlice,
} from '../../src/ingestion/onboarding-slice.ts';

function code(c: string): CbsCode {
  return { code: c, title: c, dimensionGroup: null, status: null, index: null };
}

function periodCode(c: string): CbsCode {
  return { code: c, title: c, dimensionGroup: null, status: 'Definitief', index: null };
}

const NATIONAL_ONLY_SCHEMA: CbsTableSchema = {
  tableId: 'X',
  title: 'X',
  dimensions: [{ name: 'Perioden', kind: 'TimeDimension' }],
  measures: [{ code: 'M1', title: 'M1', unit: 'aantal', decimals: 0, description: '' }],
};

const GEO_SCHEMA: CbsTableSchema = {
  tableId: 'Y',
  title: 'Y',
  dimensions: [
    { name: 'RegioS', kind: 'GeoDimension' },
    { name: 'Perioden', kind: 'TimeDimension' },
  ],
  measures: [{ code: 'M1', title: 'M1', unit: 'aantal', decimals: 0, description: '' }],
};

describe('cardinalityProduct', () => {
  it('multiplies dimension cardinalities × measure count', () => {
    const codeLists = {
      RegioS: [code('NL'), code('PV20'), code('GM0003')],
      Perioden: [periodCode('2020JJ00'), periodCode('2021JJ00')],
    };
    // 3 regions × 2 periods × 1 measure = 6
    expect(cardinalityProduct(GEO_SCHEMA, codeLists)).toBe(6);
  });

  it('returns null when any dimension has no codes (cannot bound honestly)', () => {
    expect(cardinalityProduct(GEO_SCHEMA, { RegioS: [code('NL')], Perioden: [] })).toBeNull();
  });
});

describe('estimateSlice — under the cap', () => {
  it('uses $count when available and loads the full table', () => {
    const codeLists = { Perioden: [periodCode('2020JJ00'), periodCode('2021JJ00')] };
    const est = estimateSlice(NATIONAL_ONLY_SCHEMA, codeLists, 42);
    expect(est.estimatedCells).toBe(42);
    expect(est.source).toBe('count_endpoint');
    expect(est.slice).toBeNull();
    expect(est.note).toContain('Volledige tabel');
  });

  it('falls back to the cardinality product when $count is null', () => {
    const codeLists = {
      RegioS: [code('NL'), code('PV20')],
      Perioden: [periodCode('2020JJ00')],
    };
    const est = estimateSlice(GEO_SCHEMA, codeLists, null);
    expect(est.estimatedCells).toBe(2); // 2 regions × 1 period × 1 measure
    expect(est.source).toBe('cardinality_product');
    expect(est.slice).toBeNull();
  });
});

describe('estimateSlice — over the cap', () => {
  it('builds a national + last-N-years slice for a geo table', () => {
    // A huge count forces a slice; the code lists still anchor the period floor.
    const codeLists = {
      RegioS: [code('NL'), code('PV20'), code('GM0003')],
      Perioden: [periodCode('2000JJ00'), periodCode('2015JJ00'), periodCode('2024JJ00')],
    };
    const est = estimateSlice(GEO_SCHEMA, codeLists, ONBOARDING_MAX_CELLS + 1);
    expect(est.slice).not.toBeNull();
    // National region prefix pinned (drops PV/GM rows).
    expect(est.slice!.dimensionPrefixes).toEqual({ RegioS: ['NL'] });
    // Period floor = newest (2024) − (N − 1).
    expect(est.slice!.periodFloor).toBe(`${2024 - (ONBOARDING_SLICE_YEARS - 1)}JJ00`);
    expect(est.note).toContain('versmald');
  });

  it('floors the period even on a national-only (no geo) table over the cap', () => {
    const codeLists = {
      Perioden: [periodCode('1990JJ00'), periodCode('2025JJ00')],
    };
    const est = estimateSlice(NATIONAL_ONLY_SCHEMA, codeLists, ONBOARDING_MAX_CELLS + 1000);
    expect(est.slice).not.toBeNull();
    expect(est.slice!.dimensionPrefixes).toBeUndefined(); // no geo axis
    expect(est.slice!.periodFloor).toBe(`${2025 - (ONBOARDING_SLICE_YEARS - 1)}JJ00`);
  });

  it('loads the full table when it cannot be sliced (no geo AND no period dim)', () => {
    const measureOnly: CbsTableSchema = {
      tableId: 'Z',
      title: 'Z',
      dimensions: [{ name: 'SomeDim', kind: 'Dimension' }],
      measures: [{ code: 'M1', title: 'M1', unit: 'x', decimals: 0, description: '' }],
    };
    const codeLists = { SomeDim: Array.from({ length: 200_000 }, (_, i) => code(`c${i}`)) };
    const est = estimateSlice(measureOnly, codeLists, ONBOARDING_MAX_CELLS + 1);
    expect(est.slice).toBeNull();
    expect(est.note).toContain('kon niet worden versmald');
  });
});
