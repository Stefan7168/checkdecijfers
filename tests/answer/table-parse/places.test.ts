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
  placeKindAllowsCode,
  readerPlaceKey,
  readerPlaceKinds,
} from '../../../src/answer/table-parse/places.ts';
import { regionKindForCode } from '../../../src/answer/intent/resolve.ts';

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

// ---------------------------------------------------------------------------
// Final-review C1 (breadth step 4b fix wave): the reader's place KIND is a
// code-prefix constraint used only to reject — never discarded by the key.
// ---------------------------------------------------------------------------

describe('readerPlaceKinds', () => {
  it('reads the stripped leading kind word', () => {
    expect(readerPlaceKinds('provincie Utrecht', 'onbekend')).toEqual(['provincie']);
    expect(readerPlaceKinds('gemeente Utrecht', 'onbekend')).toEqual(['gemeente']);
    expect(readerPlaceKinds('Regio Utrecht', 'onbekend')).toEqual(['regio']);
    expect(readerPlaceKinds('landsdeel Noord-Nederland', 'onbekend')).toEqual(['landsdeel']);
  });

  it('reads a trailing parenthetical (CBS code style or Dutch word)', () => {
    expect(readerPlaceKinds('Utrecht (PV)', 'onbekend')).toEqual(['provincie']);
    expect(readerPlaceKinds('Utrecht (provincie)', 'onbekend')).toEqual(['provincie']);
    expect(readerPlaceKinds('Utrecht (gemeente)', 'onbekend')).toEqual(['gemeente']);
    expect(readerPlaceKinds('Utrecht (GM)', 'onbekend')).toEqual(['gemeente']);
    expect(readerPlaceKinds('Noord-Nederland (LD)', 'onbekend')).toEqual(['landsdeel']);
    expect(readerPlaceKinds('Noord-Nederland (landsdeel)', 'onbekend')).toEqual(['landsdeel']);
    expect(readerPlaceKinds('Groningen (ES)', 'onbekend')).toEqual(['ES']);
    expect(readerPlaceKinds('Groningen (ET)', 'onbekend')).toEqual(['ET']);
  });

  it("reads the model's stated kind unless it is 'onbekend'", () => {
    expect(readerPlaceKinds('Utrecht', 'gemeente')).toEqual(['gemeente']);
    expect(readerPlaceKinds('Nederland', 'land')).toEqual(['land']);
    expect(readerPlaceKinds('Utrecht', 'onbekend')).toEqual([]);
  });

  it('an unrecognized trailing parenthetical states no kind (ignored, as before)', () => {
    expect(readerPlaceKinds('Utrecht (xyz)', 'onbekend')).toEqual([]);
  });

  it('agreeing sources collapse to one kind; disagreeing sources return every kind (a conflict)', () => {
    expect(readerPlaceKinds('provincie Utrecht (PV)', 'provincie')).toEqual(['provincie']);
    expect(readerPlaceKinds('provincie Groningen', 'gemeente').sort()).toEqual(['gemeente', 'provincie']);
    expect(readerPlaceKinds('gemeente Utrecht (PV)', 'onbekend').sort()).toEqual(['gemeente', 'provincie']);
    expect(readerPlaceKinds('regio Utrecht', 'provincie').sort()).toEqual(['provincie', 'regio']);
  });
});

describe('placeKindAllowsCode', () => {
  it('maps each kind to its CBS region-code prefix', () => {
    expect(placeKindAllowsCode('provincie', 'PV26')).toBe(true);
    expect(placeKindAllowsCode('provincie', 'GM0344')).toBe(false);
    expect(placeKindAllowsCode('gemeente', 'GM0344')).toBe(true);
    expect(placeKindAllowsCode('gemeente', 'PV26')).toBe(false);
    expect(placeKindAllowsCode('landsdeel', 'LD01')).toBe(true);
    expect(placeKindAllowsCode('land', 'NL01')).toBe(true);
    expect(placeKindAllowsCode('ES', 'ES01')).toBe(true);
    expect(placeKindAllowsCode('ES', 'ET0101')).toBe(false);
    expect(placeKindAllowsCode('ET', 'ET0101')).toBe(true);
  });

  it("'regio' allows every region-code prefix EXCEPT province (PV) and municipality (GM)", () => {
    for (const prefix of ['NL', 'LD', 'CR', 'WK', 'BU', 'CN', 'ES', 'ET']) {
      expect(placeKindAllowsCode('regio', `${prefix}01`)).toBe(true);
    }
    expect(placeKindAllowsCode('regio', 'PV26')).toBe(false);
    expect(placeKindAllowsCode('regio', 'GM0344')).toBe(false);
  });

  it('REGION_MEMBER_CODE accepts exactly the ten region-code prefixes the kind map is built from', () => {
    expect(REGION_MEMBER_CODE.source).toBe('^(NL|PV|GM|LD|CR|WK|BU|CN|ES|ET)\\d');
  });

  it('a code that is not region-coded fits no kind', () => {
    expect(placeKindAllowsCode('regio', '1012600')).toBe(false);
    expect(placeKindAllowsCode('land', 'T001019')).toBe(false);
  });

  it("agrees with the curated resolver's prefix table (resolve.ts regionKindForCode) for its four kinds", () => {
    for (const prefix of ['NL', 'PV', 'GM', 'LD', 'CR', 'WK', 'BU', 'CN', 'ES', 'ET']) {
      const code = `${prefix}01`;
      for (const kind of ['land', 'landsdeel', 'provincie', 'gemeente'] as const) {
        expect(placeKindAllowsCode(kind, code)).toBe(regionKindForCode(code) === kind);
      }
    }
  });
});
