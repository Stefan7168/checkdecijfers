// ADR 058 (English answers, Task 2): tests for the new registry-level
// converters added alongside the cbs-words.ts move (translateUnit/Region/
// MeasureTitle/PeriodLabel/AttributionLine are pinned by the pre-existing,
// unmodified web/lib/i18n/cbs-words.test.ts — this file covers only what's
// new here). glossaryForResult/periodLabelPairs live in
// src/answer/translate/glossary.ts (they need baseRegionLabel and
// ValidatedResult, which this file's module must not import — see
// english-names.ts's header) and are tested in
// tests/answer/translate/glossary.test.ts instead.
import { describe, expect, it } from 'vitest';
import { hasEnglishName, translateDimLabel, translateTableTitle } from '../../src/registry/english-names.ts';

describe('translateTableTitle', () => {
  it('returns the input for an unknown table title (TABLE_TITLES starts empty — never guess)', () => {
    expect(translateTableTitle('Onbekende tabel')).toBe('Onbekende tabel');
  });
});

describe('translateDimLabel', () => {
  it('returns the input for an unknown dim label (DIM_LABELS starts empty — never guess)', () => {
    expect(translateDimLabel('Seizoensgecorrigeerd')).toBe('Seizoensgecorrigeerd');
  });
});

describe('hasEnglishName', () => {
  it('is true for a seeded measure title and false for an unseeded one', () => {
    expect(hasEnglishName('measure', 'Werkloosheidspercentage')).toBe(true);
    expect(hasEnglishName('measure', 'Een onbekende titel')).toBe(false);
  });

  it('is true for a seeded region and false for one with no English exonym', () => {
    expect(hasEnglishName('region', 'Noord-Holland')).toBe(true);
    expect(hasEnglishName('region', 'Utrecht')).toBe(false);
  });

  it('is false for every table title and dim label (both lists start empty)', () => {
    expect(hasEnglishName('table', 'Onbekende tabel')).toBe(false);
    expect(hasEnglishName('dim', 'Seizoensgecorrigeerd')).toBe(false);
  });
});
