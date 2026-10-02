// #364 (session 153): the phrasing payload names WHAT was counted for a result
// without a curated definition — the any-table route's "In 2024 bedroeg het
// aantal 9.517" read nothing about vans because the model never saw it.
import { describe, expect, it } from 'vitest';
import { buildPhrasingPayload, phrasingSubject } from '../../src/answer/compose/prompt.ts';
import type { ValidatedResult } from '../../src/query/index.ts';

function cell(over: Record<string, unknown> = {}) {
  return {
    resultId: 'r1', tableId: '85245NED', measure: 'A047215', measureTitle: 'Voor sloop vrijgekomen voertuigen',
    regionCode: null, regionLabel: null, periodCode: '2024JJ00', periodLabel: '2024', grain: 'JJ',
    dims: {}, dimLabels: { Voertuigtype: 'Bestelauto', Brandstofsoort: 'Totaal brandstofsoort' },
    value: 9517, unit: 'aantal', decimals: 0, provisional: false, valueAttribute: null, ...over,
  };
}
function result(cells: unknown[], definitionLabel: string | null = null): ValidatedResult {
  return { shape: 'single', cells, derivations: [], attribution: { definitionLabel, periodSemantics: null } } as unknown as ValidatedResult;
}

describe('phrasing subject (#364)', () => {
  it('names the measure and the chosen members, never a "Totaal …" default', () => {
    expect(phrasingSubject(result([cell()]))).toEqual({ measureTitle: 'Voor sloop vrijgekomen voertuigen', selection: ['Bestelauto'] });
  });

  it('is absent with a curated definition — the curated payload stays byte-identical', () => {
    expect(phrasingSubject(result([cell()], 'werkloosheidspercentage'))).toBeNull();
    expect('subject' in buildPhrasingPayload(result([cell()], 'werkloosheidspercentage'))).toBe(false);
  });

  it('keeps only labels every cell shares; no subject when the cells measure different things', () => {
    const series = [cell(), cell({ periodLabel: '2023', dimLabels: { Voertuigtype: 'Personenauto', Brandstofsoort: 'Totaal brandstofsoort' } })];
    expect(phrasingSubject(result(series))?.selection).toEqual([]);
    expect(phrasingSubject(result([cell(), cell({ measureTitle: 'Actief' })]))).toBeNull();
  });
});
