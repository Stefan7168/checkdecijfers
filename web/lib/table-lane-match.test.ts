// Breadth step 5, Task 5: the typed-reply matcher for a table-lane breakdown
// question. Binding ruling (plan Global Constraints, verbatim): "A typed reply
// to a breakdown question is matched against ALL members of that dimension
// from `dimension_labels` (normalized exact title match, or exact code); no
// match → the same question again, free; never a nearest match."
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchBreakdownReply, normalizeReply, tableLaneEnabled } from './table-lane.ts';

const members = [
  { code: 'T001038', title: 'Totaal' },
  { code: '3000', title: 'Mannen' },
  { code: '4000', title: 'Vrouwen' },
  { code: 'A025', title: 'Café en bar' },
  { code: 'A026', title: 'Réunion  Française' },
  { code: 'X1', title: 'Overig' },
  { code: 'X2', title: 'overig' }, // two members share a normalized title
];

describe('matchBreakdownReply', () => {
  it('matches an exact title', () => {
    expect(matchBreakdownReply('Mannen', members)).toEqual({ code: '3000' });
  });

  it('matches case-insensitively and trims', () => {
    expect(matchBreakdownReply('  vROUWEN  ', members)).toEqual({ code: '4000' });
  });

  it('strips diacritics on both sides', () => {
    expect(matchBreakdownReply('cafe en bar', members)).toEqual({ code: 'A025' });
    expect(matchBreakdownReply('Café en bar', members)).toEqual({ code: 'A025' });
  });

  it('collapses inner whitespace on both sides', () => {
    expect(matchBreakdownReply('reunion francaise', members)).toEqual({ code: 'A026' });
    expect(matchBreakdownReply('Réunion   Française', members)).toEqual({ code: 'A026' });
  });

  it('matches an exact member code', () => {
    expect(matchBreakdownReply('T001038', members)).toEqual({ code: 'T001038' });
    expect(matchBreakdownReply(' 3000 ', members)).toEqual({ code: '3000' });
  });

  it('a title shared by several members is no match (never a pick)', () => {
    expect(matchBreakdownReply('Overig', members)).toBeNull();
  });

  it('never a nearest match: prefixes, substrings and typos are no match', () => {
    expect(matchBreakdownReply('Man', members)).toBeNull();
    expect(matchBreakdownReply('Mannen en vrouwen', members)).toBeNull();
    expect(matchBreakdownReply('Vrouwn', members)).toBeNull();
    expect(matchBreakdownReply('', members)).toBeNull();
    expect(matchBreakdownReply('   ', members)).toBeNull();
  });

  it('a code is matched exactly (case matters for codes)', () => {
    expect(matchBreakdownReply('t001038', members)).toBeNull();
  });

  it('a reply that is one member code AND another member title is no match', () => {
    const clash = [
      { code: 'Mannen', title: 'Iets anders' },
      { code: '3000', title: 'Mannen' },
    ];
    expect(matchBreakdownReply('Mannen', clash)).toBeNull();
  });

  it('an empty member list never matches', () => {
    expect(matchBreakdownReply('Mannen', [])).toBeNull();
  });
});

describe('normalizeReply', () => {
  it('trims, lowercases, collapses whitespace and strips diacritics', () => {
    expect(normalizeReply('  Ëën   Twéé\tDRIE ')).toBe('een twee drie');
  });
});

describe('tableLaneEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is on only for exactly '1'", () => {
    vi.stubEnv('TABLE_LANE_ENABLED', '1');
    expect(tableLaneEnabled()).toBe(true);
    vi.stubEnv('TABLE_LANE_ENABLED', 'true');
    expect(tableLaneEnabled()).toBe(false);
    vi.stubEnv('TABLE_LANE_ENABLED', '');
    expect(tableLaneEnabled()).toBe(false);
  });
});
