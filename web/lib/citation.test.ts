// buildCitation (WP20, open-questions #78): the quote is the validated body
// VERBATIM plus structured attribution — full-string pins so no variant can
// silently drop the source, the provisional flag, or the CC BY marking.
import { describe, expect, it } from 'vitest';
import { DERIVED_DATA_MARKING } from '../backend/query/types.ts';
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';
import { buildCitation } from './citation.ts';

describe('buildCitation', () => {
  it('is the body verbatim plus table id and Dutch long sync date', () => {
    expect(buildCitation(fakeAnswerResponse())).toBe(
      'Nederland telt 18.044.027 inwoners. (CBS StatLine, tabel 86141NED, gesynchroniseerd 3 juli 2026)',
    );
  });

  it('binds to the actual attribution fields, not constants', () => {
    const response = fakeAnswerResponse({
      body: 'In 2023 telde Rotterdam 42.100 werklozen.',
      tableId: '82931NED',
      syncedAt: '2026-01-15T09:00:00.000Z',
    });
    expect(buildCitation(response)).toBe(
      'In 2023 telde Rotterdam 42.100 werklozen. (CBS StatLine, tabel 82931NED, gesynchroniseerd 15 januari 2026)',
    );
  });

  it('flags provisional figures whenever ANY quoted cell is provisional', () => {
    const response = fakeAnswerResponse({
      cells: [fakeCell(), fakeCell({ provisional: true })],
    });
    expect(buildCitation(response)).toContain(', voorlopige cijfers)');
  });

  it('adds the exact CC BY marking when derivations are present', () => {
    const response = fakeAnswerResponse({ derivations: [{ kind: 'difference' }] });
    const citation = buildCitation(response);
    expect(citation).toContain(DERIVED_DATA_MARKING);
    // Pin the user-visible copy too, not only equality with the constant.
    expect(citation).toContain('bewerking van CBS-gegevens door checkdecijfers.nl');
  });

  it('never adds flags on a plain definitive, underived answer', () => {
    const citation = buildCitation(fakeAnswerResponse({ cells: [fakeCell()] }));
    expect(citation).not.toContain('voorlopig');
    expect(citation).not.toContain('bewerking');
  });
});
