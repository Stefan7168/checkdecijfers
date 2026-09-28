// Breadth step 4b, Task 3 — direct unit coverage of the shared place-matching
// helpers (src/answer/table-parse/places.ts): the reader-side normalization
// rule (constraints.md) and the pre-filter's whole-word/alias-target matching
// rule (controller ruling). parse.test.ts and input.test.ts exercise these
// through the validator/pre-filter; this file pins the helpers themselves.
import { describe, expect, it } from 'vitest';
import {
  REGION_MEMBER_CODE,
  memberPlaceKey,
  normalizeQuestionForPlaceMatch,
  placeKeyNamedInQuestion,
  readerPlaceKey,
} from '../../../src/answer/table-parse/places.ts';

describe('readerPlaceKey', () => {
  it('keys the same as memberPlaceKey for a bare place name', () => {
    expect(readerPlaceKey('Groningen')).toBe(memberPlaceKey('Groningen (PV)'));
  });

  // The exact bug this task fixes: a reader typing the CBS-style title
  // verbatim, parenthetical included, must key the same as the bare name.
  it('strips a trailing parenthetical, so "Groningen (PV)" keys the same as "Groningen"', () => {
    expect(readerPlaceKey('Groningen (PV)')).toBe(readerPlaceKey('Groningen'));
    expect(readerPlaceKey('Groningen (PV)')).toBe('groningen');
  });

  it('strips one leading Dutch kind word, case-insensitively', () => {
    expect(readerPlaceKey('provincie Groningen')).toBe('groningen');
    expect(readerPlaceKey('Provincie Groningen')).toBe('groningen');
    expect(readerPlaceKey('gemeente Utrecht')).toBe(readerPlaceKey('Utrecht'));
    expect(readerPlaceKey('regio Achterhoek')).toBe(readerPlaceKey('Achterhoek'));
    expect(readerPlaceKey('landsdeel Noord-Nederland')).toBe(readerPlaceKey('Noord-Nederland'));
  });

  it('applies the shared alias map: "Den Haag" keys the same as "\'s-Gravenhage"', () => {
    expect(readerPlaceKey('Den Haag')).toBe(memberPlaceKey("'s-Gravenhage (GM)"));
    expect(readerPlaceKey('Den Haag')).toBe("'s-gravenhage");
  });

  it('is case- and diacritic-insensitive, same as normalizeRegionName', () => {
    expect(readerPlaceKey('DEN HAAG')).toBe(readerPlaceKey('den haag'));
    expect(readerPlaceKey('Fryslân')).toBe(readerPlaceKey('Fryslan'));
  });

  it('strips at most one leading kind word — a second occurrence is left alone', () => {
    // Not a realistic reader phrasing, but pins that the strip is single, not
    // a loop — matches the Global Constraints wording ("one leading word").
    expect(readerPlaceKey('gemeente gemeente Utrecht')).toBe('gemeente utrecht');
    expect(readerPlaceKey('gemeente gemeente Utrecht')).not.toBe(readerPlaceKey('Utrecht'));
  });
});

describe('REGION_MEMBER_CODE', () => {
  it('matches every CBS region code family the parser treats as a place', () => {
    for (const code of ['NL01', 'PV20', 'GM0518', 'LD01', 'CR10', 'WK001', 'BU001', 'CN01', 'ES01', 'ET0101']) {
      expect(REGION_MEMBER_CODE.test(code)).toBe(true);
    }
  });

  it('does not match a non-region member code (e.g. a birth-country code)', () => {
    expect(REGION_MEMBER_CODE.test('1012600')).toBe(false);
    expect(REGION_MEMBER_CODE.test('T001040')).toBe(false);
  });
});

describe('placeKeyNamedInQuestion — the pre-filter\'s whole-word/alias rule', () => {
  it('a member key is named when it occurs as a whole word in the normalized question', () => {
    const q = normalizeQuestionForPlaceMatch('Hoeveel inwoners had Groningen in 2022?');
    expect(placeKeyNamedInQuestion(q, 'groningen')).toBe(true);
  });

  it('a member key is NOT named when it only occurs as part of a longer word (whole-word boundary)', () => {
    const q = normalizeQuestionForPlaceMatch('Wat is de Groningenstad-index?');
    expect(placeKeyNamedInQuestion(q, 'groningen')).toBe(false);
  });

  // The alias-target rule: "Den Haag" never literally appears as
  // "'s-gravenhage" in a question, so the member key is found via the alias
  // KEY ("den haag") occurring as a whole word, mapped to its TARGET.
  it('an alias TARGET is named when the alias KEY occurs as a whole word in the question', () => {
    const q = normalizeQuestionForPlaceMatch('Hoeveel inwoners had Den Haag in 2022?');
    expect(placeKeyNamedInQuestion(q, "'s-gravenhage")).toBe(true);
    // The literal alias key itself is not a member key that would ever be
    // looked up (members key to "'s-gravenhage", never to "den haag"), but
    // the underlying whole-word check works the same for it too.
    expect(placeKeyNamedInQuestion(q, 'den haag')).toBe(true);
  });

  it('an unrelated key is not named', () => {
    const q = normalizeQuestionForPlaceMatch('Hoeveel inwoners had Den Haag in 2022?');
    expect(placeKeyNamedInQuestion(q, 'groningen')).toBe(false);
  });

  it('is diacritic/case-insensitive via the shared normalization', () => {
    const q = normalizeQuestionForPlaceMatch('Hoeveel inwoners heeft FRYSLÂN?');
    expect(placeKeyNamedInQuestion(q, 'fryslan')).toBe(true);
  });
});
