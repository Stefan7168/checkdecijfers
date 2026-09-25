import { describe, expect, it } from 'vitest';
import { checkTranslation, dutchDirections, englishDirections } from '../../../src/answer/translate/check.ts';

const items = (body: string, chips: string[] = []) => ({ body, chips, definition: null, alternates: [] });
const glossary = [{ dutch: 'Noord-Holland', english: 'North Holland', kind: 'region' as const, translated: true }];

const ok = {
  maskedDutch: items('Noord-Holland telde ⟦Na⟧ inwoners in ⟦Pb⟧, een stijging.', ['Hoe was het in ⟦Pc⟧?']),
  dutch: items('Noord-Holland telde 1.234 inwoners in 2023, een stijging.', ['Hoe was het in 2022?']),
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
      checkTranslation({ maskedDutch: d, dutch: items('Het cijfer is voorlopig: 3.'), english: items('The figure is ⟦Na⟧.'), glossary: [] }).join(),
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
      dutch: items('Utrecht telde 1.234 inwoners en Zeeland telde 5.678 inwoners.', []),
      english: items('Utrecht had ⟦Nb⟧ inhabitants and Zeeland had ⟦Na⟧ inhabitants.', []),
      glossary: [],
    };
    expect(checkTranslation(swapped).join()).toMatch(/C7/);
  });

  it('C8: periods swapped across sentences fails', () => {
    const swappedPeriods = {
      maskedDutch: items('Utrecht telde ⟦Na⟧ inwoners in ⟦Pb⟧. Zeeland telde ⟦Nc⟧ inwoners in ⟦Pd⟧.', []),
      dutch: items('Utrecht telde 1.234 inwoners in 2023. Zeeland telde 5.678 inwoners in 2024.', []),
      english: items('Utrecht had ⟦Na⟧ inhabitants in ⟦Pd⟧. Zeeland had ⟦Nc⟧ inhabitants in ⟦Pb⟧.', []),
      glossary: [],
    };
    expect(checkTranslation(swappedPeriods).join()).toMatch(/C8/);
  });

  it('legitimate reorder passes', () => {
    const legitimateReorder = {
      maskedDutch: items('In ⟦Pb⟧ telde Utrecht ⟦Na⟧ inwoners.', []),
      dutch: items('In 2023 telde Utrecht 1.234 inwoners.', []),
      english: items('Utrecht had ⟦Na⟧ inhabitants in ⟦Pb⟧.', []),
      glossary: [{ dutch: 'Utrecht', english: 'Utrecht', kind: 'region' as const, translated: true }],
    };
    expect(checkTranslation(legitimateReorder)).toEqual([]);
  });

  it('existing ok case still passes', () => {
    expect(checkTranslation(ok)).toEqual([]);
  });
});
