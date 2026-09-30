// #357 defect 4 (owner decision 2026-09-30, "Join the notes"): one registry
// helper builds the provisional note for every status, and the four display
// sites (Dutch template, R11 validator, refusal text, English suffix) resolve
// through it. Combined Eurostat flags join their letters' approved notes in
// letter order, '; '-joined inside one pair of brackets; ANY unknown letter
// keeps each site's pre-existing fallback. Every single-letter and CBS status
// is pinned byte-identical to the outputs captured BEFORE the change.
import { describe, expect, it } from 'vitest';
import { provisionalSuffix } from '../../src/answer/compose/template.ts';
import { statusSuffixNl } from '../../src/answer/respond/refusals.ts';
import { statusSuffixEn } from '../../src/answer/respond/english.ts';
import { isEurostatBreakFlag } from '../../src/query/derivations.ts';
import {
  joinProvisionalNotes,
  provisionalNoteFor,
  provisionalNoteParts,
  SOURCES,
} from '../../src/sources/registry.ts';
import type { ResultCell } from '../../src/query/index.ts';

const TABLE = { cbs: '03759ned', eurostat: 'eurostat:une_rt_q' } as const;

function templateSuffix(source: keyof typeof TABLE, status: string, provisional = true): string {
  return provisionalSuffix({ provisional, tableId: TABLE[source], status } as unknown as ResultCell);
}

describe('#357 defect 4: byte-identical for every single-letter and CBS status (snapshot taken before the change)', () => {
  // [source, status, template (provisional cell), statusSuffixNl, statusSuffixEn]
  const BEFORE: [keyof typeof TABLE, string, string, string, string][] = [
    ['cbs', 'Definitief', ' (voorlopig cijfer)', '', ''],
    ['cbs', 'Voorlopig', ' (voorlopig cijfer)', ' (voorlopig cijfer)', ' (provisional figure)'],
    ['cbs', 'NaderVoorlopig', ' (nader voorlopig cijfer)', ' (nader voorlopig cijfer)', ' (revised provisional figure)'],
    ['cbs', 'Onbekend', ' (voorlopig cijfer)', '', ''],
    ['cbs', '', ' (voorlopig cijfer)', '', ''],
    // A CBS table never splits letters, even for a Eurostat-looking code.
    ['cbs', 'p', ' (voorlopig cijfer)', '', ''],
    ['cbs', 'bu', ' (voorlopig cijfer)', '', ''],
    ['eurostat', 'Published', ' (voorlopig cijfer)', '', ''],
    ['eurostat', 'p', ' (voorlopig cijfer)', ' (voorlopig cijfer)', ' (provisional figure)'],
    ['eurostat', 'e', ' (schatting)', ' (schatting)', ' (estimate)'],
    ['eurostat', 's', ' (schatting door Eurostat)', ' (schatting door Eurostat)', ' (estimate by Eurostat)'],
    ['eurostat', 'f', ' (prognose)', ' (prognose)', ' (forecast)'],
    ['eurostat', 'b', ' (methodebreuk)', ' (methodebreuk)', ' (break in series)'],
    ['eurostat', 'c', ' (vertrouwelijk)', ' (vertrouwelijk)', ' (confidential)'],
    ['eurostat', 'd', ' (afwijkende definitie)', ' (afwijkende definitie)', ' (different definition)'],
    ['eurostat', 'u', ' (lage betrouwbaarheid)', ' (lage betrouwbaarheid)', ' (low reliability)'],
    ['eurostat', 'n', ' (niet significant)', ' (niet significant)', ' (not significant)'],
    ['eurostat', ':', ' (voorlopig cijfer)', '', ''],
    ['eurostat', 'z', ' (voorlopig cijfer)', '', ''],
    ['eurostat', 'x', ' (voorlopig cijfer)', '', ''],
    ['eurostat', 'PB', ' (voorlopig cijfer)', '', ''],
    ['eurostat', '', ' (voorlopig cijfer)', '', ''],
  ];

  it.each(BEFORE)('%s %j', (source, status, template, nl, en) => {
    expect(templateSuffix(source, status)).toBe(template);
    expect(templateSuffix(source, status, false)).toBe('');
    expect(statusSuffixNl(status, source)).toBe(nl);
    expect(statusSuffixEn(status, source)).toBe(en);
  });

  it('the CBS default (no source key) is unchanged', () => {
    expect(statusSuffixNl('Voorlopig')).toBe(' (voorlopig cijfer)');
    expect(statusSuffixNl('bu')).toBe('');
    expect(statusSuffixEn('NaderVoorlopig')).toBe(' (revised provisional figure)');
  });
});

describe('#357 defect 4: combined Eurostat flags join the approved single-letter notes', () => {
  const COMBINED: [string, string, string][] = [
    ['bu', ' (methodebreuk; lage betrouwbaarheid)', ' (break in series; low reliability)'],
    ['ep', ' (schatting; voorlopig cijfer)', ' (estimate; provisional figure)'],
    [
      'bdep',
      ' (methodebreuk; afwijkende definitie; schatting; voorlopig cijfer)',
      ' (break in series; different definition; estimate; provisional figure)',
    ],
    ['bp', ' (methodebreuk; voorlopig cijfer)', ' (break in series; provisional figure)'],
    // Letter order is the code's own order, never re-sorted.
    ['pe', ' (voorlopig cijfer; schatting)', ' (provisional figure; estimate)'],
  ];

  it.each(COMBINED)('%s → Dutch and English, the same note at all four sites', (status, nl, en) => {
    expect(provisionalNoteFor('eurostat', status)).toBe(nl);
    expect(templateSuffix('eurostat', status)).toBe(nl);
    expect(statusSuffixNl(status, 'eurostat')).toBe(nl);
    expect(statusSuffixEn(status, 'eurostat')).toBe(en);
  });

  it.each(['bz', 'b:', ':b', 'bx', 'ub:', 'Bu', 'b u'])(
    'an unknown letter (%j) keeps each site\'s pre-existing fallback',
    (status) => {
      expect(provisionalNoteFor('eurostat', status)).toBeUndefined();
      expect(templateSuffix('eurostat', status)).toBe(' (voorlopig cijfer)');
      expect(statusSuffixNl(status, 'eurostat')).toBe('');
      expect(statusSuffixEn(status, 'eurostat')).toBe('');
    },
  );

  it('parts come from the registry map, in letter order; a single status is its own one part', () => {
    const eurostat = SOURCES.eurostat!;
    expect(provisionalNoteParts(eurostat, 'bu')).toEqual([eurostat.provisionalDisplay.b, eurostat.provisionalDisplay.u]);
    expect(provisionalNoteParts(eurostat, 'e')).toEqual([' (schatting)']);
    expect(provisionalNoteParts(SOURCES.cbs!, 'Voorlopig')).toEqual([' (voorlopig cijfer)']);
    expect(provisionalNoteParts(SOURCES.cbs!, 'bu')).toBeUndefined();
  });

  it('only Eurostat combines letters; CBS statuses are whole words', () => {
    expect(SOURCES.eurostat!.combinesFlagLetters).toBe(true);
    expect(SOURCES.cbs!.combinesFlagLetters).toBeUndefined();
  });

  it('joinProvisionalNotes: one note byte-identical, several joined, an off-shape note refused', () => {
    expect(joinProvisionalNotes([' (schatting)'])).toBe(' (schatting)');
    expect(joinProvisionalNotes([' (a)', ' (b)'])).toBe(' (a; b)');
    expect(joinProvisionalNotes([' (a)', 'b'])).toBeUndefined();
    expect(joinProvisionalNotes([])).toBeUndefined();
  });

  it('confidential and not-available keep their null-reason wording (nullReasonLabels untouched)', () => {
    expect(SOURCES.eurostat!.nullReasonLabels).toEqual({
      ':': 'door Eurostat (nog) niet beschikbaar gesteld',
      c: 'door Eurostat niet gepubliceerd (vertrouwelijk)',
      z: 'niet van toepassing volgens Eurostat',
    });
  });
});

describe('#357 defect 4: isEurostatBreakFlag still sees a break inside a combined flag', () => {
  it.each(['b', 'bu', 'bp', 'bdep', 'eb'])('%s → break', (status) => {
    expect(isEurostatBreakFlag(status)).toBe(true);
  });
  it.each(['Published', 'ep', 'u', 'p', ':', 'z', 'c'])('%s → no break', (status) => {
    expect(isEurostatBreakFlag(status)).toBe(false);
  });
});
