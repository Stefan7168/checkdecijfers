// ADR 058 (English answers, Task 2): glossaryForResult/periodLabelPairs, per
// the task-2 brief's Step 2 — moved here (not tests/registry/english-names
// .test.ts) per the controller ruling that these two functions and
// GlossaryEntry live in src/answer/translate/glossary.ts, not in the pure
// table module src/registry/english-names.ts. Same test content as the
// brief, with the import path adjusted accordingly.
import { describe, expect, it } from 'vitest';
import { glossaryForResult, periodLabelPairs } from '../../../src/answer/translate/glossary.ts';
import type { ValidatedResult } from '../../../src/query/index.ts';

const cell = (over: Record<string, unknown>) => ({
  resultId: 'r', tableId: '37296ned', measure: 'm', measureTitle: 'Werkloosheidspercentage',
  regionCode: 'PV27', regionLabel: 'Noord-Holland (PV)', periodCode: '2023KW01', periodLabel: '2023 1e kwartaal',
  grain: 'KW', dims: {}, dimLabels: {}, value: 1, unit: '%', decimals: 1, status: 'Definitief',
  provisional: false, valueAttribute: 'None', batchId: 1, ...over,
});

const result = {
  cells: [cell({}), cell({ regionLabel: 'Utrecht (PV)', periodLabel: '2023 2e kwartaal', periodCode: '2023KW02' })],
  attribution: { tableTitle: 'Onbekende tabel' },
} as unknown as ValidatedResult;

describe('glossaryForResult', () => {
  it('builds a glossary with translated flags', () => {
    const g = glossaryForResult(result);
    expect(g).toContainEqual({ dutch: 'Werkloosheidspercentage', english: 'Unemployment rate', kind: 'measure', translated: true });
    expect(g).toContainEqual({ dutch: 'Noord-Holland', english: 'North Holland', kind: 'region', translated: true });
    expect(g).toContainEqual({ dutch: 'Utrecht', english: 'Utrecht', kind: 'region', translated: false });
    expect(g).toContainEqual({ dutch: 'Onbekende tabel', english: 'Onbekende tabel', kind: 'table', translated: false });
  });
});

describe('periodLabelPairs', () => {
  it('pairs period labels', () => {
    expect(periodLabelPairs(result)).toEqual([
      { dutch: '2023 1e kwartaal', english: '2023 Q1' },
      { dutch: '2023 2e kwartaal', english: '2023 Q2' },
    ]);
  });
});
