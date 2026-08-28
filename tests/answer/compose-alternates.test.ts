// #39 (owner policy, 2026-07-04): the alternate-reading disclosure line.
// When a canonical default has registry-recorded alternates, the answer must
// STATE that a non-chosen reading exists — built by deterministic code
// (buildAlternatesLine) from validated Attribution data, never by the LLM
// (principle a / R2 / R3), outside the scanned body, and re-derived
// byte-identically at audit time (R8).
import { describe, expect, it } from 'vitest';
import { buildAlternatesLine, displayAlternateLabel } from '../../src/answer/compose/format.ts';
import { makeCell, makeResult, populationSingle } from '../helpers/synthetic-results.ts';

function housingResult(alternates?: { measure?: string; dims?: Record<string, string>; label: string }[]) {
  return makeResult({
    shape: 'single',
    definitionLabel: 'woningvoorraad per 1 januari',
    ...(alternates !== undefined ? { alternates } : {}),
    cells: [
      makeCell({
        table: '82235NED', measure: 'D002936', measureTitle: 'Beginstand voorraad',
        region: { code: 'NL01', label: 'Nederland' },
        periodCode: '2024JJ00', periodLabel: '2024', value: 8125500, unit: 'aantal',
      }),
    ],
  });
}

describe('buildAlternatesLine (#39)', () => {
  it('states the single non-chosen reading (the #39 housing example)', () => {
    const result = housingResult([
      { measure: 'D002968', label: 'stand per 31 december (Eindstand Voorraad)' },
    ]);
    expect(buildAlternatesLine(result)).toBe(
      'Er is ook een andere lezing beschikbaar: stand per 31 december (Eindstand Voorraad).',
    );
  });

  it('enumerates several alternates in one sentence, in registry order', () => {
    const result = housingResult([
      { measure: 'X1', label: 'bruto inkomen' },
      { measure: 'X2', label: 'gestandaardiseerd inkomen' },
      { measure: 'X3', label: 'primair inkomen' },
    ]);
    expect(buildAlternatesLine(result)).toBe(
      'Er zijn ook andere lezingen beschikbaar: bruto inkomen; gestandaardiseerd inkomen; primair inkomen.',
    );
  });

  it('returns null when the attribution carries no alternates key (pre-#39 rows, explicit targets) — A1', () => {
    // populationSingle carries no alternates key at all: `?? null` must treat
    // absence exactly like none (docs/13 present-only discipline).
    expect(buildAlternatesLine(populationSingle)).toBeNull();
  });

  it('returns null rather than an empty disclosure when every label cleans away', () => {
    const result = housingResult([{ label: 'eigen key: some_internal_key' }]);
    expect(buildAlternatesLine(result)).toBeNull();
  });

  it('is a pure function of the attribution — same input, same bytes (R8)', () => {
    const result = housingResult([
      { measure: 'D002968', label: 'stand per 31 december (Eindstand Voorraad)' },
    ]);
    expect(buildAlternatesLine(result)).toBe(buildAlternatesLine(result));
  });
});

describe('displayAlternateLabel: strips ONLY the registry-internal cross-reference', () => {
  // Real labels from src/registry/defaults.ts — the cleanup must read
  // naturally for every shape the registry actually contains, and must be a
  // pure REMOVAL of the internal "key" notation, never a rewording.
  const cases: [string, string][] = [
    // untouched: no internal notation
    ['stand per 31 december (Eindstand Voorraad)', 'stand per 31 december (Eindstand Voorraad)'],
    ['Gemiddelde bevolking (jaargemiddelde, geen standcijfer)', 'Gemiddelde bevolking (jaargemiddelde, geen standcijfer)'],
    ['CPI indexniveau (2025=100), geen mutatiepercentage', 'CPI indexniveau (2025=100), geen mutatiepercentage'],
    ['oorspronkelijke, ongecorrigeerde cijfers', 'oorspronkelijke, ongecorrigeerde cijfers'],
    ['totaal rechtsvormen (incl. particuliere faillissementen)', 'totaal rechtsvormen (incl. particuliere faillissementen)'],
    // "(eigen key: x)" as the whole parenthetical
    ['alleen supermarkten en warenhuizen (eigen key: supermarket_turnover_yoy)', 'alleen supermarkten en warenhuizen'],
    ['de invoerwaarde zelf in mln euro (eigen key: goods_imports_value)', 'de invoerwaarde zelf in mln euro'],
    ['de jaarmutatie in % (eigen key: goods_exports_yoy)', 'de jaarmutatie in %'],
    // "eigen key" after a semicolon inside a parenthetical
    ['groei t.o.v. een jaar eerder (de headline; eigen key: gdp_growth_yoy_volume)', 'groei t.o.v. een jaar eerder (de headline)'],
    // "key x" (no "eigen") after a colon inside a parenthetical
    [
      'de gemiddelde verkoopprijs in euro (landelijk actueel: key average_existing_home_sale_price)',
      'de gemiddelde verkoopprijs in euro (landelijk actueel)',
    ],
    // "key x" mid-sentence, table id retained (table ids are user-visible)
    [
      'de landelijke maandactuele lezing: key average_existing_home_sale_price (85773NED)',
      'de landelijke maandactuele lezing (85773NED)',
    ],
  ];
  for (const [input, expected] of cases) {
    it(`'${input}' -> '${expected}'`, () => {
      expect(displayAlternateLabel(input)).toBe(expected);
    });
  }
});
