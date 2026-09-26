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

describe('glossaryForResult — translated flag (final-review fold-in 5)', () => {
  it("a name whose English equals its Dutch but IS on the list ('CPI') counts as translated", () => {
    const cpi = { cells: [cell({ measureTitle: 'CPI' })], attribution: { tableTitle: 'Onbekende tabel' } } as unknown as ValidatedResult;
    const g = glossaryForResult(cpi);
    expect(g).toContainEqual({ dutch: 'CPI', english: 'CPI', kind: 'measure', translated: true });
    expect(g).toContainEqual({ dutch: 'Onbekende tabel', english: 'Onbekende tabel', kind: 'table', translated: false });
  });
});

// Session 134 live recording, B6: the alternates line names a DIFFERENT CBS
// name ('stand per 31 december (Eindstand Voorraad)') than the result's
// own cells ('Beginstand voorraad'). With only the cells' names in the
// glossary the model reused 'Opening stock' for 'Eindstand Voorraad' (C12
// caught it, Dutch fallback on both attempts). A listed name found verbatim in
// an alternate label now joins the glossary, so the model is given — and C5
// requires — CBS's own English for it.
describe('glossaryForResult — names inside the alternates line', () => {
  const withAlternates = (labels: string[]) =>
    ({
      cells: [cell({ measureTitle: 'Beginstand voorraad', regionLabel: null })],
      attribution: { tableTitle: 'Onbekende tabel', alternates: labels.map((label) => ({ label })) },
    }) as unknown as ValidatedResult;

  it("adds a listed name found verbatim in an alternate label ('Eindstand Voorraad' → 'Closing stock')", () => {
    const g = glossaryForResult(withAlternates(['stand per 31 december (Eindstand Voorraad)']));
    expect(g).toContainEqual({ dutch: 'Beginstand voorraad', english: 'Opening stock', kind: 'measure', translated: true });
    expect(g).toContainEqual({ dutch: 'Eindstand Voorraad', english: 'Closing stock', kind: 'measure', translated: true });
  });

  it('adds nothing for an alternate label that contains no listed name, and matches case-sensitively', () => {
    const before = glossaryForResult(withAlternates([]));
    expect(glossaryForResult(withAlternates(['primair inkomen', 'eindstand voorraad']))).toEqual(before);
  });
});
