import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkTranslation,
  dutchDirections,
  englishDirections,
  NL_CARDINAL_MORPHEMES,
  NL_NEGATION,
} from '../../../src/answer/translate/check.ts';
import { createMasker, hasDigitOutsidePlaceholders } from '../../../src/answer/translate/mask.ts';

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

// ---------------------------------------------------------------------------
// Final-review fix wave (ruling 17, CRITICAL 1): units, scale words and
// number words. Every fixture is built with the REAL masker — never a
// hand-counted placeholder id.
// ---------------------------------------------------------------------------

function maskOne(dutch: string, units: { dutch: string; english: string }[] = []) {
  const masker = createMasker({ periodLabels: [{ dutch: '2023', english: '2023' }], caveats: [], units });
  const masked = masker.mask(dutch);
  return { masked, entries: masker.entries };
}

describe('ruling 17a: a number and its directly-following unit/scale word are ONE placeholder', () => {
  it.each([
    ['De werkloosheid steeg met 0,5 procentpunt.', '0,5 procentpunt', '0.5 percentage points'],
    ['De werkloosheid steeg met 1 procentpunt.', '1 procentpunt', '1 percentage point'],
    ['De werkloosheid steeg met 2 procentpunten.', '2 procentpunten', '2 percentage points'],
    ['Het cijfer was 3,5%.', '3,5%', '3.5%'],
    ['Het cijfer was 3,8 %.', '3,8 %', '3.8%'],
    ['Het cijfer was 3,5 procent.', '3,5 procent', '3.5%'],
    ['De uitgaven waren 12,3 mln euro.', '12,3 mln', '12.3 million'],
    ['De uitgaven waren 12,3 mld euro.', '12,3 mld', '12.3 billion'],
    ['Het waren 17 miljoen mensen.', '17 miljoen', '17 million'],
    ['Het waren 2 miljard mensen.', '2 miljard', '2 billion'],
  ])('%s', (dutch, token, english) => {
    const { masked, entries } = maskOne(dutch);
    const numbers = entries.filter((e) => e.kind === 'number');
    expect(numbers).toHaveLength(1);
    expect(numbers[0]!.dutch).toBe(token);
    expect(numbers[0]!.english).toBe(english);
    expect(masked).not.toMatch(/procent|mln|mld|miljoen|miljard|%/);
  });

  it("a registered unit with an English name joins its number (longest first: 'mln euro' beats 'mln')", () => {
    const { masked, entries } = maskOne('De uitgaven waren 12,3 mln euro.', [{ dutch: 'mln euro', english: 'million euros' }]);
    const [n] = entries.filter((e) => e.kind === 'number');
    expect(n!.dutch).toBe('12,3 mln euro');
    expect(n!.english).toBe('12.3 million euros');
    expect(masked).toBe(`De uitgaven waren ${n!.placeholder}.`);
  });

  it('a registered unit that itself carries digits swallows them into the ONE placeholder', () => {
    const { masked, entries } = maskOne('Het cijfer was 12,3 per 1 000 inwoners in 2023.', [
      { dutch: 'per 1 000 inwoners', english: 'per 1 000 inhabitants' },
    ]);
    const numbers = entries.filter((e) => e.kind === 'number');
    expect(numbers.map((e) => [e.dutch, e.english])).toEqual([['12,3 per 1 000 inwoners', '12.3 per 1 000 inhabitants']]);
    expect(masked).toMatch(/^Het cijfer was ⟦N[a-z]+⟧ in ⟦P[a-z]+⟧\.$/);
  });

  it("a registered unit followed by an apostrophe (\"euro's\") is left as text, never half-joined", () => {
    const { masked, entries } = maskOne("Het kostte 450.985 euro's.", [{ dutch: 'euro', english: 'euros' }]);
    expect(entries.filter((e) => e.kind === 'number').map((e) => e.dutch)).toEqual(['450.985']);
    expect(masked).toMatch(/^Het kostte ⟦N[a-z]+⟧ euro's\.$/);
  });

  it('a unit word NOT directly after a number stays text', () => {
    const { masked } = maskOne('Het verschil in procentpunt was 0,5.');
    expect(masked).toMatch(/in procentpunt was ⟦N[a-z]+⟧\./);
  });

  it("adversarial: 'steeg met ⟦Na⟧ procentpunt' → 'rose by ⟦Na⟧ percent' fails", () => {
    const { masked } = maskOne('De werkloosheid steeg met 0,5 procentpunt.');
    const ph = masked.match(/⟦N[a-z]+⟧/)![0];
    const english = items(`Unemployment rose by ${ph} percent.`);
    expect(checkTranslation({ maskedDutch: items(masked), english, glossary: [] }).join()).toMatch(/C9/);
  });

  it("adversarial: '⟦Na⟧ mln euro' → '⟦Na⟧ billion euros' fails", () => {
    const { masked } = maskOne('De uitgaven waren 12,3 mln euro.', [{ dutch: 'mln euro', english: 'million euros' }]);
    const ph = masked.match(/⟦N[a-z]+⟧/)![0];
    const english = items(`Spending was ${ph} billion euros.`);
    expect(checkTranslation({ maskedDutch: items(masked), english, glossary: [] }).join()).toMatch(/C9/);
  });

  it('passing: the faithful rendering of a combined placeholder passes', () => {
    const { masked } = maskOne('De werkloosheid steeg met 0,5 procentpunt.');
    const ph = masked.match(/⟦N[a-z]+⟧/)![0];
    expect(checkTranslation({ maskedDutch: items(masked), english: items(`Unemployment rose by ${ph}.`), glossary: [] })).toEqual([]);
  });
});

describe('ruling 17b: C9 — number, scale, fraction, multiple and percent words need a Dutch counterpart', () => {
  it("adversarial: an added 'roughly double the level of ten years before' fails", () => {
    const { masked } = maskOne('Het aantal was 1.234 in 2023.');
    const [n, p] = [masked.match(/⟦N[a-z]+⟧/)![0], masked.match(/⟦P[a-z]+⟧/)![0]];
    const english = items(`The number was ${n} in ${p}, roughly double the level of ten years before.`);
    const problems = checkTranslation({ maskedDutch: items(masked), english, glossary: [] });
    expect(problems.join()).toMatch(/C9.*double/);
    expect(problems.join()).toMatch(/C9.*ten/);
  });

  it.each([
    ['half', 'Het aantal was 1.234 in 2023.', 'The number was {n} in {p}, half the peak.'],
    ['twice', 'Het aantal was 1.234 in 2023.', 'The number was {n} in {p}, twice as high.'],
    ['tripled', 'Het aantal was 1.234 in 2023.', 'The number tripled to {n} in {p}.'],
    ['a third', 'Het aantal was 1.234 in 2023.', 'The number was {n} in {p}, a third more.'],
    ['threefold', 'Het aantal was 1.234 in 2023.', 'The number was {n} in {p}, a threefold rise.'],
    ['million', 'Het aantal was 1.234 in 2023.', 'The number was {n} million in {p}.'],
    ['percentage points', 'Het aantal was 1.234 in 2023.', 'The number was {n} percentage points in {p}.'],
    ['%', 'Het aantal was 1.234 in 2023.', 'The number was {n}% in {p}.'],
    ['dozen', 'Het aantal was 1.234 in 2023.', 'The number was {n} in {p}, a dozen more.'],
  ])('adversarial: an added %s fails', (_word, dutch, template) => {
    const { masked } = maskOne(dutch);
    const english = template.replace('{n}', masked.match(/⟦N[a-z]+⟧/)![0]).replace('{p}', masked.match(/⟦P[a-z]+⟧/)![0]);
    expect(checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [] }).join()).toMatch(/C9/);
  });

  it.each([
    ['helft', 'De eerste helft van 2023 was rustig.', 'The first half of {p} was quiet.'],
    ['verdubbeld', 'Het aantal is verdubbeld tot 1.234.', 'The number has doubled to {n}.'],
    ['twee keer', 'Het is twee keer zo hoog: 1.234.', 'It is twice as high: {n}.'],
    ['procent (not after a number)', 'Het aandeel in procent was 1.234.', 'The share in percent was {n}.'],
    ['procentpunt (not after a number)', 'Het verschil in procentpunt was 1.234.', 'The difference in percentage points was {n}.'],
  ])('passing: an English %s counterpart the masked Dutch carries passes', (_word, dutch, template) => {
    const { masked } = maskOne(dutch);
    const english = template
      .replace('{n}', masked.match(/⟦N[a-z]+⟧/)?.[0] ?? '')
      .replace('{p}', masked.match(/⟦P[a-z]+⟧/)?.[0] ?? '');
    expect(checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [] })).toEqual([]);
  });

  it("'percent' is not satisfied by a Dutch 'procentpunt' (a unit swap, not a counterpart)", () => {
    const { masked } = maskOne('Het verschil in procentpunt was 1.234.');
    const n = masked.match(/⟦N[a-z]+⟧/)![0];
    expect(checkTranslation({ maskedDutch: items(masked), english: items(`The difference in percent was ${n}.`), glossary: [] }).join())
      .toMatch(/C9/);
  });

  it('ordinals inside period placeholders are unaffected (masked), and a plain ordinal word is not a number word', () => {
    const { masked } = maskOne('In 2023 was het aantal 1.234.');
    const [n, p] = [masked.match(/⟦N[a-z]+⟧/)![0], masked.match(/⟦P[a-z]+⟧/)![0]];
    expect(checkTranslation({ maskedDutch: items(masked), english: items(`In ${p} the number was ${n}.`), glossary: [] })).toEqual([]);
  });
});

describe('ruling 17c: C2 and the digit gate see every Unicode number (\\p{N}), not just decimal digits', () => {
  it.each([['½'], ['²'], ['Ⅻ'], ['①']])('adversarial: a %s written by the model fails C2', (numeral) => {
    const { masked } = maskOne('Het aantal was 1.234.');
    const n = masked.match(/⟦N[a-z]+⟧/)![0];
    expect(checkTranslation({ maskedDutch: items(masked), english: items(`The number was ${n}, ${numeral} of it.`), glossary: [] }).join())
      .toMatch(/C2/);
  });

  it('hasDigitOutsidePlaceholders catches a non-decimal numeral', () => {
    expect(hasDigitOutsidePlaceholders('about ½')).toBe(true);
    expect(hasDigitOutsidePlaceholders('km²')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Final-review fix wave (ruling 18, IMPORTANT 1): same-sentence swaps and
// negation. Built with the REAL masker.
// ---------------------------------------------------------------------------

const region = (dutch: string, english = dutch) => ({ dutch, english, kind: 'region' as const, translated: dutch !== english });
const phs = (text: string, kind: 'N' | 'P') => text.match(new RegExp(`⟦${kind}[a-z]+⟧`, 'g')) ?? [];

function maskWithPeriods(dutch: string) {
  const masker = createMasker({
    periodLabels: [
      { dutch: '2022', english: '2022' },
      { dutch: '2023', english: '2023' },
    ],
    caveats: [],
  });
  return masker.mask(dutch);
}

describe('ruling 18: C7 — periods and regions keep their relative order per item', () => {
  it('adversarial: two periods swapped inside ONE sentence fail', () => {
    const masked = maskWithPeriods('In 2022 telde Utrecht 1.234 inwoners, in 2023 telde Utrecht 1.300 inwoners.');
    const [pa, pb] = phs(masked, 'P');
    const [na, nb] = phs(masked, 'N');
    const english = `In ${pb} Utrecht had ${na} inhabitants, in ${pa} Utrecht had ${nb} inhabitants.`;
    expect(checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [region('Utrecht')] }).join()).toMatch(/C7/);
  });

  it('adversarial: two regions swapped inside ONE sentence fail', () => {
    const masked = maskWithPeriods('Utrecht telde 1.234 inwoners en Zeeland telde 1.300 inwoners.');
    const [na, nb] = phs(masked, 'N');
    const english = `Zeeland had ${na} inhabitants and Utrecht had ${nb} inhabitants.`;
    expect(
      checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [region('Utrecht'), region('Zeeland')] }).join(),
    ).toMatch(/C7/);
  });

  it('passing: a legitimate English reordering that keeps each kind in order (adverb and period movement)', () => {
    const masked = maskWithPeriods('In 2022 telde Utrecht ook 1.234 inwoners en in 2023 telde Zeeland 1.300 inwoners.');
    const [pa, pb] = phs(masked, 'P');
    const [na, nb] = phs(masked, 'N');
    const english = `Utrecht also had ${na} inhabitants in ${pa}, and Zeeland had ${nb} inhabitants in ${pb}.`;
    expect(
      checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [region('Utrecht'), region('Zeeland')] }),
    ).toEqual([]);
  });

  it('a region nested inside a longer region name is not a separate first mention', () => {
    const masked = maskWithPeriods('Noord-Holland telde 1.234 inwoners en Holland telde 1.300 inwoners.');
    const [na, nb] = phs(masked, 'N');
    const english = `North Holland had ${na} inhabitants and Holland had ${nb} inhabitants.`;
    const glossaryNested = [region('Noord-Holland', 'North Holland'), region('Holland')];
    expect(checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: glossaryNested })).toEqual([]);
  });
});

describe('ruling 18: C3 — directions compared as an ORDERED sequence', () => {
  it('adversarial: two directions swapped between regions in ONE sentence fail', () => {
    const masked = maskWithPeriods('Utrecht steeg naar 1.234, Zeeland daalde naar 1.300.');
    const [na, nb] = phs(masked, 'N');
    const english = `Utrecht fell to ${na}, Zeeland rose to ${nb}.`;
    expect(
      checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [region('Utrecht'), region('Zeeland')] }).join(),
    ).toMatch(/C3/);
  });

  it('adversarial: a comparative interrupted by commas is still read (sentence-level, as the Dutch validator reads it)', () => {
    const masked = maskWithPeriods('Utrecht had meer inwoners, namelijk 1.234, dan Zeeland.');
    const [n] = phs(masked, 'N');
    const flipped = `Utrecht had fewer inhabitants, namely ${n}, than Zeeland.`;
    const faithful = `Utrecht had more inhabitants, namely ${n}, than Zeeland.`;
    const g = [region('Utrecht'), region('Zeeland')];
    expect(checkTranslation({ maskedDutch: items(masked), english: items(flipped), glossary: g }).join()).toMatch(/C3/);
    expect(checkTranslation({ maskedDutch: items(masked), english: items(faithful), glossary: g })).toEqual([]);
  });

  it('passing: a repeated direction phrased once in English (consecutive duplicates collapse)', () => {
    const masked = maskWithPeriods('De bevolking groeide naar 1.234, een groei van 1.300.');
    const [na, nb] = phs(masked, 'N');
    expect(
      checkTranslation({ maskedDutch: items(masked), english: items(`The population grew to ${na}, growth of ${nb}.`), glossary: [] }),
    ).toEqual([]);
  });
});

describe('ruling 18: C10 — negation of each direction must match', () => {
  it("adversarial: 'niet gedaald' → 'has fallen' fails", () => {
    const masked = maskWithPeriods('Het aantal is sinds 2022 niet gedaald en was 1.234.');
    const [p] = phs(masked, 'P');
    const [n] = phs(masked, 'N');
    const english = `The number has fallen since ${p} and was ${n}.`;
    expect(checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [] }).join()).toMatch(/C10/);
  });

  it("adversarial: an added negation ('gedaald' → 'has not fallen') fails", () => {
    const masked = maskWithPeriods('Het aantal is sinds 2022 gedaald en was 1.234.');
    const [p] = phs(masked, 'P');
    const [n] = phs(masked, 'N');
    const english = `The number has not fallen since ${p} and was ${n}.`;
    expect(checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [] }).join()).toMatch(/C10/);
  });

  it.each([
    ['Het aantal is sinds 2022 niet gedaald en was 1.234.', 'The number has not fallen since {p} and was {n}.'],
    ['Het aantal is sinds 2022 niet gedaald en was 1.234.', "The number hasn't fallen since {p} and was {n}."],
    ['Het aantal groeide gestaag tot 1.234 in 2022, zonder tussentijdse dalingen.', 'The number grew steadily to {n} in {p}, without interim declines.'],
  ])('passing: %s ~ %s', (dutch, template) => {
    const masked = maskWithPeriods(dutch);
    const english = template.replace('{p}', phs(masked, 'P')[0]!).replace('{n}', phs(masked, 'N')[0]!);
    expect(checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [] })).toEqual([]);
  });
});

describe('fold-in 4: region/name mentions match on word boundaries', () => {
  it("C5: 'Ede' is not satisfied by 'exceeded'", () => {
    const masked = maskWithPeriods('Ede telde 1.234 inwoners.');
    const [n] = phs(masked, 'N');
    const english = `The count exceeded ${n} inhabitants.`;
    expect(checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: [region('Ede')] }).join()).toMatch(/C5/);
  });

  it("C5: 'Ede' is not required by a Dutch 'Nederland'", () => {
    const masked = maskWithPeriods('Nederland telde 1.234 inwoners.');
    const [n] = phs(masked, 'N');
    const english = `The Netherlands had ${n} inhabitants.`;
    const g = [region('Nederland', 'the Netherlands'), region('Ede')];
    expect(checkTranslation({ maskedDutch: items(masked), english: items(english), glossary: g })).toEqual([]);
  });
});

describe('copies of the Dutch validator rules stay in sync (validate.ts is not edited, so it is read as source)', () => {
  const validateSource = readFileSync(new URL('../../../src/answer/compose/validate.ts', import.meta.url), 'utf8');

  it("NL_NEGATION is validate.ts's NEGATION_WORDS, verbatim", () => {
    expect(validateSource).toContain(`const NEGATION_WORDS = ${NL_NEGATION.toString()};`);
  });

  it("NL_CARDINAL_MORPHEMES is exactly validate.ts's CARDINAL_WORD_FORMS morpheme list", () => {
    const line = validateSource.split('\n').find((l) => l.includes('(?:(?:twee|drie|'))!;
    const list = /\(\?:\(\?:([a-z|]+)\)/.exec(line)![1]!.split('|');
    expect([...NL_CARDINAL_MORPHEMES].sort()).toEqual([...list].sort());
  });
});
