import { describe, expect, it } from 'vitest';
import { checkTranslation, dutchDirections, englishDirections } from '../../../src/answer/translate/check.ts';
import { createMasker } from '../../../src/answer/translate/mask.ts';

const items = (body: string, chips: string[] = []) => ({ body, chips, definition: null, alternates: [] });
const glossary = [{ dutch: 'Noord-Holland', english: 'North Holland', kind: 'region' as const, translated: true }];

const ok = {
  maskedDutch: items('Noord-Holland telde ⟦Na⟧ inwoners in ⟦Pb⟧, een stijging.', ['Hoe was het in ⟦Pc⟧?']),
  english: items('North Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, an increase.', ['What about ⟦Pc⟧?']),
  glossary,
};

describe('checkTranslation', () => {
  it('passes a faithful translation', () => {
    expect(checkTranslation(ok)).toEqual([]);
  });
  it('C1: a dropped placeholder', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had inhabitants in ⟦Pb⟧, an increase.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/^C1/);
  });
  it('C1: an invented placeholder', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had ⟦Na⟧ ⟦Nz⟧ inhabitants in ⟦Pb⟧, an increase.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/C1/);
  });
  it('C2: a digit written by the model', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, an increase of 5.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/C2/);
  });
  it('C3: a direction flip', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, a decrease.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/C3/);
  });
  it('C4: a dropped provisional word', () => {
    const d = items('Het cijfer is voorlopig: ⟦Na⟧.');
    expect(
      checkTranslation({ maskedDutch: d, english: items('The figure is ⟦Na⟧.'), glossary: [] }).join(),
    ).toMatch(/C4/);
  });
  it('C5: an improvised name', () => {
    expect(checkTranslation({ ...ok, english: items('North-Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, an increase.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/C5/);
  });
  it('C6: a lost chip', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, an increase.', []) }).join())
      .toMatch(/C6/);
  });
});

describe('directions', () => {
  it.each([
    ['De werkloosheid daalde.', 'Unemployment fell.', 'down'],
    ['Het aantal nam toe.', 'The number increased.', 'up'],
    ['Het bleef stabiel.', 'It remained stable.', 'flat'],
    ['Utrecht had meer inwoners dan Zeeland.', 'Utrecht had more inhabitants than Zeeland.', 'more'],
    ['Zeeland had minder inwoners dan Utrecht.', 'Zeeland had fewer inhabitants than Utrecht.', 'less'],
  ])('%s ~ %s', (nl, en, dir) => {
    expect([...dutchDirections(nl)]).toEqual([dir]);
    expect([...englishDirections(en)]).toEqual([dir]);
  });
});

describe('C7 and C8 checks (fix round 1)', () => {
  it('C7: swap within one sentence fails', () => {
    const swapped = {
      maskedDutch: items('Utrecht telde ⟦Na⟧ inwoners en Zeeland telde ⟦Nb⟧ inwoners.', []),
      english: items('Utrecht had ⟦Nb⟧ inhabitants and Zeeland had ⟦Na⟧ inhabitants.', []),
      glossary: [],
    };
    expect(checkTranslation(swapped).join()).toMatch(/C7/);
  });

  it('C8: periods swapped across sentences fails', () => {
    const swappedPeriods = {
      maskedDutch: items('Utrecht telde ⟦Na⟧ inwoners in ⟦Pb⟧. Zeeland telde ⟦Nc⟧ inwoners in ⟦Pd⟧.', []),
      english: items('Utrecht had ⟦Na⟧ inhabitants in ⟦Pd⟧. Zeeland had ⟦Nc⟧ inhabitants in ⟦Pb⟧.', []),
      glossary: [],
    };
    expect(checkTranslation(swappedPeriods).join()).toMatch(/C8/);
  });

  it('legitimate reorder passes', () => {
    const legitimateReorder = {
      maskedDutch: items('In ⟦Pb⟧ telde Utrecht ⟦Na⟧ inwoners.', []),
      english: items('Utrecht had ⟦Na⟧ inhabitants in ⟦Pb⟧.', []),
      glossary: [{ dutch: 'Utrecht', english: 'Utrecht', kind: 'region' as const, translated: true }],
    };
    expect(checkTranslation(legitimateReorder)).toEqual([]);
  });

  it('existing ok case still passes', () => {
    expect(checkTranslation(ok)).toEqual([]);
  });
});

describe('controller ruling 15 (Task 6b): C5/C8 read the masked Dutch', () => {
  it('C5: a digit-free glossary name masked away inside a ⟦G…⟧ placeholder is not double-required', () => {
    // Build the fixture with the REAL masker (never hand-count placeholder ids):
    // a digit-bearing name ('Bevolking op 1 januari') is masked whole, so the
    // digit-free glossary entry ('Bevolking') it happens to contain no longer
    // appears literally in the masked Dutch the model saw.
    const masker = createMasker({
      names: [{ dutch: 'Bevolking op 1 januari', english: 'Population on 1 January' }],
      periodLabels: [],
      caveats: [],
    });
    const maskedBody = masker.mask('Bevolking op 1 januari was hoog.');
    const [namePlaceholder] = masker.entries.map((e) => e.placeholder);
    expect(namePlaceholder).toMatch(/^⟦G[a-z]+⟧$/);
    expect(maskedBody).toBe(`${namePlaceholder} was hoog.`);

    const maskedDutch = items(maskedBody);
    // A SEPARATE, digit-free glossary entry that happens to share the same
    // Dutch word as (part of) the masked name — this is the entry C5 must
    // NOT demand here, because the model was never shown 'Bevolking' as
    // literal text.
    const glossaryWithBevolking = [{ dutch: 'Bevolking', english: 'Population', kind: 'measure' as const, translated: true }];
    // Faithful: the model kept the placeholder verbatim and never invented
    // the English word 'Population'.
    const faithfulEnglish = items(`${namePlaceholder} was high.`);

    expect(checkTranslation({ maskedDutch, english: faithfulEnglish, glossary: glossaryWithBevolking })).toEqual([]);
  });

  it('C8: a region mentioned only in the masked sentence still binds correctly', () => {
    // A caveat marker containing an internal 'abbreviation period' (a period
    // followed by whitespace) creates an extra sentence-split point in the
    // RAW Dutch that disappears once the caveat is masked to a single
    // placeholder — this is exactly the kind of masked/unmasked sentence-count
    // mismatch ruling 15 fixes by having C8 read ONLY the masked Dutch.
    const masker = createMasker({
      names: [],
      periodLabels: [{ dutch: '1e kwartaal 2023', english: 'Q1 2023' }],
      caveats: [{ dutch: '(voorl. resultaat)', english: '(provisional result)' }],
    });
    const rawDutch = '(voorl. resultaat) Zeeland telde 1.234 inwoners in 1e kwartaal 2023. Utrecht groeide.';
    const maskedBody = masker.mask(rawDutch);
    const [caveatPh, periodPh, numberPh] = masker.entries.map((e) => e.placeholder);
    expect(maskedBody).toBe(`${caveatPh} Zeeland telde ${numberPh} inwoners in ${periodPh}. Utrecht groeide.`);

    const maskedDutch = items(maskedBody);
    const regionGlossary = [{ dutch: 'Zeeland', english: 'Zeeland', kind: 'region' as const, translated: true }];

    // Faithful: Zeeland stays in the same (masked) sentence as its number.
    const faithful = items(`${caveatPh} Zeeland had ${numberPh} inhabitants in ${periodPh}. Utrecht grew.`);
    expect(checkTranslation({ maskedDutch, english: faithful, glossary: regionGlossary })).toEqual([]);

    // Unfaithful: the number is kept but its region companion is dropped —
    // a naive unmasked-sentence lookup would have missed this (the phantom
    // split from '(voorl.' pushes 'Zeeland' out of the aligned index), but
    // reading the masked sentence directly still catches it.
    const unfaithful = items(`${caveatPh} There were ${numberPh} inhabitants in ${periodPh}. Utrecht grew.`);
    expect(checkTranslation({ maskedDutch, english: unfaithful, glossary: regionGlossary }).join()).toMatch(/C8/);
  });
});
