// Handcrafted ValidatedResult factories for chart unit tests. The builder
// only ever reads cells + attribution + shape, but the objects are complete
// and type-checked so the tests exercise the real contract, not a lookalike.
import type { Attribution, ResultCell, ValidatedResult } from '../../src/query/index.ts';

export function makeCell(overrides: Partial<ResultCell> = {}): ResultCell {
  const periodCode = overrides.periodCode ?? '2020JJ00';
  const regionCode = overrides.regionCode ?? null;
  return {
    resultId: `TESTNED:M1:${regionCode ?? '-'}:${periodCode}`,
    tableId: 'TESTNED',
    measure: 'M1',
    measureTitle: 'Testmaat',
    regionCode,
    regionLabel: regionCode === null ? null : `Regio ${regionCode}`,
    periodCode,
    periodLabel: periodCode.slice(0, 4),
    grain: 'JJ',
    dims: {},
    dimLabels: {},
    value: 1.5,
    unit: '%',
    decimals: 1,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    batchId: 1,
    ...overrides,
  };
}

export function makeResult(
  shape: ValidatedResult['shape'],
  cells: ResultCell[],
  attribution: Partial<Attribution> = {},
): ValidatedResult {
  const from = cells[0]!.periodCode;
  const to = cells[cells.length - 1]!.periodCode;
  return {
    ok: true,
    schemaVersion: 1,
    shape,
    cells,
    derivations: [],
    attribution: {
      tableId: 'TESTNED',
      tableTitle: 'Testtabel voor grafieken',
      tableVersion: 1,
      syncedAt: '2026-07-03T00:00:00.000Z',
      coveredPeriods: { from, to },
      license: 'CC BY 4.0',
      definitionLabel: null,
      periodSemantics: null,
      ...attribution,
    },
    intent: {
      schemaVersion: 1,
      target: { kind: 'explicit', tableId: 'TESTNED', measure: 'M1' },
      period: from === to ? { kind: 'codes', codes: [from] } : { kind: 'range', from, to },
      derivation: shape === 'series' ? 'series' : 'none',
    },
  };
}

/** Recursively freeze an object so any renderer/builder mutation throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
