// Breadth step 3, Task 2 — breakdown resolver. Pure module: picks CBS's own
// grand total for an unnamed breakdown dimension by the MEASURED conservative
// rule (docs/superpowers/plans/2026-09-28-breadth-step-3-breakdown-resolver.md
// Global Constraints, measured 2026-09-28 over all 2,330 breakdown
// dimensions of the 1,271 current tables), or returns a button question.
// Principle (c): never guess — every case below is either a real CBS member
// list (tests/fixtures/cbs-breakdowns/sample.json, fetched live by
// scripts/research/extract-breakdown-samples.ts) or a synthetic table built
// to isolate one resolveBreakdowns/statedDefaultsText behaviour.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BREAKDOWN_OPTION_CAP,
  classifyDimension,
  findGrandTotal,
  marginsValueMember,
  resolveBreakdowns,
  statedDefaultsText,
  type BreakdownDimension,
  type BreakdownMember,
} from '../../src/query/breakdowns.ts';

const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/cbs-breakdowns/sample.json', import.meta.url));
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  cases: {
    id: string;
    table: string;
    dimension: string;
    note: string;
    kind: string;
    title: string;
    totalMemberCount: number;
    members: BreakdownMember[];
  }[];
};

function caseById(id: string) {
  const found = FIXTURE.cases.find((c) => c.id === id);
  if (!found) throw new Error(`fixture is missing case '${id}' — re-run scripts/research/extract-breakdown-samples.ts`);
  return found;
}

// ---- findGrandTotal — the measured total rule, against REAL CBS data ------

describe('findGrandTotal — measured rule, real CBS member lists', () => {
  it('03759ned/Geslacht: single candidate, first member, T00 code -> T001038', () => {
    const c = caseById('geslacht_single_first_t00');
    const total = findGrandTotal(c.members);
    expect(total).toEqual({ code: 'T001038', title: 'Totaal mannen en vrouwen' });
  });

  it('85669NED/Klimaatsectoren: several "; totaal" candidates, but first is the ONLY T00 code -> T001616', () => {
    const c = caseById('klimaatsectoren_several_first_only_t00');
    const total = findGrandTotal(c.members);
    expect(total).toEqual({ code: 'T001616', title: 'Totaal klimaatsectoren' });
  });

  it('83842NED/KenmerkenVanHuishoudens: "Type: Paar, totaal" is a sub-total, not first -> null (refuse)', () => {
    const c = caseById('kenmerken_paar_trap');
    expect(findGrandTotal(c.members)).toBeNull();
  });

  it('82883NED/Watergebruikers: a T00 code exists but is not first -> null (refuse)', () => {
    const c = caseById('watergebruikers_t00_not_first');
    expect(findGrandTotal(c.members)).toBeNull();
  });

  it('84521NED/Leeftijd: "Totaal leeftijd" + "Totaal, gestandaardiseerd" — two statistics -> null (refuse)', () => {
    const c = caseById('leeftijd_two_totals');
    expect(findGrandTotal(c.members)).toBeNull();
  });

  it('83191NED/Nationaliteit: "Nederlands (totaal)" is a subgroup, not a candidate -> null (refuse)', () => {
    const c = caseById('nationaliteit_subgroup_totaal');
    expect(findGrandTotal(c.members)).toBeNull();
  });

  it('86116NED/Bedrijfsgrootte: no candidate at all -> null (refuse)', () => {
    const c = caseById('bedrijfsgrootte_no_total');
    expect(findGrandTotal(c.members)).toBeNull();
  });

  it('85245NED/VoertuigType: several "Totaal"-titled candidates, neither has a T00 code -> null (ask)', () => {
    const c = caseById('voertuigtype_several_first_not_t00');
    expect(findGrandTotal(c.members)).toBeNull();
  });

  it('findGrandTotal of an empty member list is null', () => {
    expect(findGrandTotal([])).toBeNull();
  });

  // ---- F1 (final review, session 139): tightened rule — the first member
  // must ITSELF qualify by a 'Totaal'-prefixed title or a T00 code, not
  // merely by the '; totaal' / ', totaal' suffix. ------------------------

  it('85004NED/BronEnTechniek: first member is a candidate ONLY via the ", totaal" suffix -> null (a solar sub-total in a solar+wind table)', () => {
    const members: BreakdownMember[] = [
      { code: 'E006590', title: 'Zonnestroom, totaal' },
      { code: 'A050176', title: 'Zonnestroom, klein vermogen' },
      { code: 'A050177', title: 'Zonnestroom, groot vermogen' },
      { code: 'E006637', title: 'Windenergie op land' },
    ];
    expect(findGrandTotal(members)).toBeNull();
  });

  // ---- F9: edge tests -----------------------------------------------------

  it('two T00-coded members, T00 first -> null (not the only T00 code)', () => {
    const members: BreakdownMember[] = [
      { code: 'T001', title: 'Totaal A' },
      { code: 'T002', title: 'Totaal B' },
      { code: 'X', title: 'Iets anders' },
    ];
    expect(findGrandTotal(members)).toBeNull();
  });

  it('first member is T00-coded (title does not start with "Totaal") and a later member is "Totaal …"-titled -> the first (clause b: only T00 code)', () => {
    const members: BreakdownMember[] = [
      { code: 'T001', title: 'Iets' },
      { code: 'X2', title: 'Totaal Y' },
    ];
    expect(findGrandTotal(members)).toEqual({ code: 'T001', title: 'Iets' });
  });
});

// ---- marginsValueMember -----------------------------------------------

describe('marginsValueMember', () => {
  it('83052NED/Marges: resolves to the member titled exactly "Waarde" (MW00000)', () => {
    const c = caseById('marges');
    const value = marginsValueMember(c.members);
    expect(value).toEqual({ code: 'MW00000', title: 'Waarde' });
  });

  it('is null when no member is titled "Waarde"', () => {
    const members: BreakdownMember[] = [
      { code: 'A1', title: 'Ondergrens 95%-interval' },
      { code: 'A2', title: 'Bovengrens 95%-interval' },
    ];
    expect(marginsValueMember(members)).toBeNull();
  });

  it('matches case-insensitively and trims whitespace', () => {
    const members: BreakdownMember[] = [{ code: 'X', title: '  waarde  ' }];
    expect(marginsValueMember(members)).toEqual({ code: 'X', title: '  waarde  ' });
  });
});

// ---- classifyDimension --------------------------------------------------

describe('classifyDimension', () => {
  it('TimeDimension -> time (regardless of members)', () => {
    const d: BreakdownDimension = { name: 'Perioden', title: 'Perioden', kind: 'TimeDimension', members: [] };
    expect(classifyDimension(d)).toBe('time');
  });

  it('GeoDimension -> geo', () => {
    const d: BreakdownDimension = { name: 'RegioS', title: "Regio's", kind: 'GeoDimension', members: [] };
    expect(classifyDimension(d)).toBe('geo');
  });

  it('83052NED/Marges -> margins (named Marges)', () => {
    const c = caseById('marges');
    const d: BreakdownDimension = { name: c.dimension, title: c.title, kind: c.kind, members: c.members };
    expect(classifyDimension(d)).toBe('margins');
  });

  it('a dimension not named Marges but containing a "Waarde" member -> margins', () => {
    const d: BreakdownDimension = {
      name: 'SomeOtherName',
      title: 'Some other name',
      kind: 'Dimension',
      members: [{ code: 'MW00000', title: 'Waarde' }, { code: 'X', title: 'Iets anders' }],
    };
    expect(classifyDimension(d)).toBe('margins');
  });

  it('86211NED/AlleRegioIndelingen: kind Dimension, ~100% region-prefix codes -> geo_like', () => {
    const c = caseById('geo_like_alle_regio_indelingen');
    const d: BreakdownDimension = { name: c.dimension, title: c.title, kind: c.kind, members: c.members };
    expect(classifyDimension(d)).toBe('geo_like');
  });

  it('71476ned/Waterkwaliteitsbeheerders-shaped codes (mostly "WS..", below 80%) -> breakdown, NOT geo_like', () => {
    // Verified live 2026-09-28: only 1/30 (3.3%) of this real dimension's codes
    // match the geo-like regex — it must NOT be swept into region handling.
    const members: BreakdownMember[] = [
      { code: 'NL01', title: 'Nederland totaal' },
      ...Array.from({ length: 29 }, (_, i) => ({ code: `WS${String(i + 1).padStart(2, '0')}`, title: `Waterschap ${i + 1}` })),
    ];
    const d: BreakdownDimension = { name: 'Waterkwaliteitsbeheerders', title: 'Waterkwaliteitsbeheerders', kind: 'Dimension', members };
    expect(classifyDimension(d)).toBe('breakdown');
  });

  it('an ordinary breakdown dimension (Geslacht) -> breakdown', () => {
    const c = caseById('geslacht_single_first_t00');
    const d: BreakdownDimension = { name: c.dimension, title: c.title, kind: c.kind, members: c.members };
    expect(classifyDimension(d)).toBe('breakdown');
  });

  it('geo-like check does not apply when kind is already GeoDimension (no double-classification)', () => {
    const d: BreakdownDimension = {
      name: 'RegioS',
      title: "Regio's",
      kind: 'GeoDimension',
      members: [{ code: 'PV20', title: 'Groningen' }],
    };
    expect(classifyDimension(d)).toBe('geo');
  });
});

// ---- resolveBreakdowns — synthetic 3-dimension tables --------------------

function member(code: string, title: string): BreakdownMember {
  return { code, title };
}

describe('resolveBreakdowns — synthetic tables', () => {
  it('all dimensions have a grand total -> ok, coordinates + defaults in table order', () => {
    const dims: BreakdownDimension[] = [
      {
        name: 'Geslacht',
        title: 'Geslacht',
        kind: 'Dimension',
        members: [member('T001038', 'Totaal mannen en vrouwen'), member('3000', 'Mannen'), member('4000', 'Vrouwen')],
      },
      {
        name: 'Leeftijdsklasse',
        title: 'Leeftijdsklasse',
        kind: 'Dimension',
        members: [member('T001', 'Totaal'), member('A1', '0 tot 20 jaar')],
      },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.coordinates).toEqual({ Geslacht: 'T001038', Leeftijdsklasse: 'T001' });
    expect(result.defaults).toEqual([
      { dimension: 'Geslacht', dimensionTitle: 'Geslacht', code: 'T001038', memberTitle: 'Totaal mannen en vrouwen' },
      { dimension: 'Leeftijdsklasse', dimensionTitle: 'Leeftijdsklasse', code: 'T001', memberTitle: 'Totaal' },
    ]);
  });

  it('one named + one total -> coordinates carry both, but defaults holds only the total', () => {
    const dims: BreakdownDimension[] = [
      {
        name: 'Geslacht',
        title: 'Geslacht',
        kind: 'Dimension',
        members: [member('T001038', 'Totaal mannen en vrouwen'), member('3000', 'Mannen')],
      },
      {
        name: 'Leeftijdsklasse',
        title: 'Leeftijdsklasse',
        kind: 'Dimension',
        members: [member('T001', 'Totaal'), member('A1', '0 tot 20 jaar')],
      },
    ];
    const result = resolveBreakdowns(dims, { Leeftijdsklasse: 'A1' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.coordinates).toEqual({ Geslacht: 'T001038', Leeftijdsklasse: 'A1' });
    expect(result.defaults).toEqual([
      { dimension: 'Geslacht', dimensionTitle: 'Geslacht', code: 'T001038', memberTitle: 'Totaal mannen en vrouwen' },
    ]);
  });

  it('a no-total dimension -> question with at most BREAKDOWN_OPTION_CAP options and the true totalOptions', () => {
    const manyMembers = Array.from({ length: 20 }, (_, i) => member(`C${i}`, `Categorie ${i}`));
    const dims: BreakdownDimension[] = [
      { name: 'Bedrijfsgrootte', title: 'Bedrijfsgrootte', kind: 'Dimension', members: manyMembers },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.question.dimension).toBe('Bedrijfsgrootte');
    expect(result.question.dimensionTitle).toBe('Bedrijfsgrootte');
    expect(result.question.options).toHaveLength(BREAKDOWN_OPTION_CAP);
    expect(result.question.options).toEqual(manyMembers.slice(0, BREAKDOWN_OPTION_CAP));
    expect(result.question.totalOptions).toBe(20);
  });

  it('the FIRST unresolvable breakdown in table order becomes the question, even if a later one would also fail', () => {
    const dims: BreakdownDimension[] = [
      { name: 'FirstBad', title: 'First bad', kind: 'Dimension', members: [member('A', 'Alpha'), member('B', 'Beta')] },
      { name: 'SecondBad', title: 'Second bad', kind: 'Dimension', members: [member('C', 'Gamma'), member('D', 'Delta')] },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.question.dimension).toBe('FirstBad');
  });

  it('margins dimension resolves to the Waarde member, included in defaults ("Marges: Waarde")', () => {
    const dims: BreakdownDimension[] = [
      {
        name: 'Marges',
        title: 'Marges',
        kind: 'Dimension',
        members: [member('MW00000', 'Waarde'), member('MOG0095', 'Ondergrens 95%-interval'), member('MBG0095', 'Bovengrens 95%-interval')],
      },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.coordinates).toEqual({ Marges: 'MW00000' });
    expect(result.defaults).toEqual([{ dimension: 'Marges', dimensionTitle: 'Marges', code: 'MW00000', memberTitle: 'Waarde' }]);
    expect(statedDefaultsText(result.defaults, 'nl')).toBe('Uitgangspunt: Marges: Waarde');
  });

  it('a margins-classified dimension with no Waarde member becomes a question (never guesses a margin)', () => {
    const dims: BreakdownDimension[] = [
      {
        name: 'Marges',
        title: 'Marges',
        kind: 'Dimension',
        members: [member('MOG0095', 'Ondergrens 95%-interval'), member('MBG0095', 'Bovengrens 95%-interval')],
      },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.question.dimension).toBe('Marges');
  });

  it('time, geo and geo_like dimensions are never resolved here — skipped entirely, absent from coordinates/defaults', () => {
    const dims: BreakdownDimension[] = [
      { name: 'Perioden', title: 'Perioden', kind: 'TimeDimension', members: [member('2024JJ00', '2024')] },
      { name: 'RegioS', title: "Regio's", kind: 'GeoDimension', members: [member('PV20', 'Groningen')] },
      {
        name: 'AlleRegioIndelingen',
        title: 'Alle regio-indelingen',
        kind: 'Dimension',
        members: [member('NL01', 'Nederland'), member('PV20', 'Groningen (PV)'), member('GM0014', 'Groningen (GM)')],
      },
      {
        name: 'Geslacht',
        title: 'Geslacht',
        kind: 'Dimension',
        members: [member('T001038', 'Totaal mannen en vrouwen'), member('3000', 'Mannen')],
      },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.coordinates).toEqual({ Geslacht: 'T001038' });
    expect(result.defaults).toEqual([
      { dimension: 'Geslacht', dimensionTitle: 'Geslacht', code: 'T001038', memberTitle: 'Totaal mannen en vrouwen' },
    ]);
  });

  it('a dimension already in `named` is never re-resolved, even if it has no total', () => {
    const dims: BreakdownDimension[] = [
      { name: 'Bedrijfsgrootte', title: 'Bedrijfsgrootte', kind: 'Dimension', members: [member('A', 'Klein'), member('B', 'Groot')] },
    ];
    const result = resolveBreakdowns(dims, { Bedrijfsgrootte: 'A' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.coordinates).toEqual({ Bedrijfsgrootte: 'A' });
    expect(result.defaults).toEqual([]);
  });

  // ---- F9: a single, non-total member still becomes a 1-option question ---

  it('a single member that is not a total -> question with exactly 1 option', () => {
    const dims: BreakdownDimension[] = [
      { name: 'Solo', title: 'Solo', kind: 'Dimension', members: [member('X1', 'Iets')] },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.question.dimension).toBe('Solo');
    expect(result.question.options).toEqual([member('X1', 'Iets')]);
    expect(result.question.totalOptions).toBe(1);
  });

  // ---- F2: `named` is checked, never silently trusted ----------------------

  describe('named input is checked (F2)', () => {
    const dims: BreakdownDimension[] = [
      {
        name: 'Geslacht',
        title: 'Geslacht',
        kind: 'Dimension',
        members: [member('T001038', 'Totaal mannen en vrouwen'), member('3000', 'Mannen'), member('4000', 'Vrouwen')],
      },
    ];

    it('an unknown key in `named` (not any dimension name) throws, naming the key', () => {
      expect(() => resolveBreakdowns(dims, { NotADimension: 'x' })).toThrow(/NotADimension/);
    });

    it('a wrong-case key ("geslacht" vs "Geslacht") throws — case must match exactly', () => {
      expect(() => resolveBreakdowns(dims, { geslacht: '3000' })).toThrow(/geslacht/);
    });

    it('a non-member code named on a breakdown dimension -> a question for that dimension, never a silent default', () => {
      const result = resolveBreakdowns(dims, { Geslacht: 'DOES-NOT-EXIST' });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.question.dimension).toBe('Geslacht');
      expect(result.question.options).toEqual(dims[0]!.members);
    });

    it('a valid named code on a breakdown dimension still works, and is not re-added to defaults', () => {
      const result = resolveBreakdowns(dims, { Geslacht: '3000' });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.coordinates).toEqual({ Geslacht: '3000' });
      expect(result.defaults).toEqual([]);
    });

    it('named time/geo/geo_like dimensions pass through unchecked — the caller owns them', () => {
      const mixedDims: BreakdownDimension[] = [
        { name: 'Perioden', title: 'Perioden', kind: 'TimeDimension', members: [] },
        { name: 'RegioS', title: "Regio's", kind: 'GeoDimension', members: [] },
      ];
      const result = resolveBreakdowns(mixedDims, { Perioden: 'anything-uncheckable', RegioS: 'also-uncheckable' });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.coordinates).toEqual({ Perioden: 'anything-uncheckable', RegioS: 'also-uncheckable' });
    });
  });

  // ---- F3: ok:true reports the caller's own dimensions ---------------------

  it('ok:true carries callerDimensions — time/geo/geo_like dims NOT in `named`, in table order', () => {
    const dims: BreakdownDimension[] = [
      { name: 'Perioden', title: 'Perioden', kind: 'TimeDimension', members: [] },
      { name: 'RegioS', title: "Regio's", kind: 'GeoDimension', members: [] },
      {
        name: 'Geslacht',
        title: 'Geslacht',
        kind: 'Dimension',
        members: [member('T001038', 'Totaal mannen en vrouwen'), member('3000', 'Mannen')],
      },
    ];
    const result = resolveBreakdowns(dims, { RegioS: 'PV20' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.callerDimensions).toEqual(['Perioden']);
  });

  it('ok:true carries an empty callerDimensions when there are no time/geo/geo_like dimensions at all', () => {
    const dims: BreakdownDimension[] = [
      {
        name: 'Geslacht',
        title: 'Geslacht',
        kind: 'Dimension',
        members: [member('T001038', 'Totaal mannen en vrouwen'), member('3000', 'Mannen')],
      },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.callerDimensions).toEqual([]);
  });

  // ---- F4: an empty dimension title falls back to the dimension name -------

  it('an empty dimension title falls back to the name in a stated default, and statedDefaultsText never shows a doubled ": "', () => {
    const dims: BreakdownDimension[] = [
      {
        name: 'Geslacht',
        title: '',
        kind: 'Dimension',
        members: [member('T001038', 'Totaal mannen en vrouwen'), member('3000', 'Mannen')],
      },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.defaults).toEqual([
      { dimension: 'Geslacht', dimensionTitle: 'Geslacht', code: 'T001038', memberTitle: 'Totaal mannen en vrouwen' },
    ]);
    expect(statedDefaultsText(result.defaults, 'nl')).toBe('Uitgangspunt: Geslacht: Totaal mannen en vrouwen');
  });

  it('an empty dimension title falls back to the name in a question, too', () => {
    const dims: BreakdownDimension[] = [
      { name: 'Bedrijfsgrootte', title: '  ', kind: 'Dimension', members: [member('A', 'Klein'), member('B', 'Groot')] },
    ];
    const result = resolveBreakdowns(dims, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.question.dimensionTitle).toBe('Bedrijfsgrootte');
  });
});

// ---- statedDefaultsText ---------------------------------------------------

describe('statedDefaultsText', () => {
  it('is null when there are no defaults', () => {
    expect(statedDefaultsText([], 'nl')).toBeNull();
    expect(statedDefaultsText([], 'en')).toBeNull();
  });

  it('nl: one default -> "Uitgangspunt: <title>: <member>"', () => {
    const defaults = [{ dimension: 'Geslacht', dimensionTitle: 'Geslacht', code: 'T001038', memberTitle: 'Totaal mannen en vrouwen' }];
    expect(statedDefaultsText(defaults, 'nl')).toBe('Uitgangspunt: Geslacht: Totaal mannen en vrouwen');
  });

  it('en: one default -> "Assumed: <title>: <member>"', () => {
    const defaults = [{ dimension: 'Geslacht', dimensionTitle: 'Geslacht', code: 'T001038', memberTitle: 'Totaal mannen en vrouwen' }];
    expect(statedDefaultsText(defaults, 'en')).toBe('Assumed: Geslacht: Totaal mannen en vrouwen');
  });

  it('multiple defaults are joined with "; ", CBS titles verbatim in both languages', () => {
    const defaults = [
      { dimension: 'Geslacht', dimensionTitle: 'Geslacht', code: 'T001038', memberTitle: 'Totaal mannen en vrouwen' },
      { dimension: 'Marges', dimensionTitle: 'Marges', code: 'MW00000', memberTitle: 'Waarde' },
    ];
    expect(statedDefaultsText(defaults, 'nl')).toBe('Uitgangspunt: Geslacht: Totaal mannen en vrouwen; Marges: Waarde');
    expect(statedDefaultsText(defaults, 'en')).toBe('Assumed: Geslacht: Totaal mannen en vrouwen; Marges: Waarde');
  });
});
