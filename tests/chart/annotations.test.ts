// #170(4): the curated event-annotation dataset and its pure selection
// function. Mirrors the rest of tests/chart/ — no LLM, no DB, deterministic
// input/output only.
import { describe, expect, it } from 'vitest';
import { CHART_ANNOTATIONS, selectAnnotations } from '../../src/chart/annotations.ts';

describe('CHART_ANNOTATIONS — the curated dataset itself', () => {
  it('is small (proof of mechanism, not an exhaustive timeline) and every entry is well-formed', () => {
    expect(CHART_ANNOTATIONS.length).toBeGreaterThanOrEqual(2);
    expect(CHART_ANNOTATIONS.length).toBeLessThanOrEqual(4);
    const slugs = new Set<string>();
    for (const def of CHART_ANNOTATIONS) {
      expect(def.slug.length).toBeGreaterThan(0);
      expect(slugs.has(def.slug), `duplicate slug '${def.slug}'`).toBe(false);
      slugs.add(def.slug);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.canonicalKeys.length).toBeGreaterThan(0);
      expect(Object.keys(def.periodCodes).length).toBeGreaterThan(0);
      for (const code of Object.values(def.periodCodes)) {
        expect(code).toMatch(/^\d{4}(JJ|KW|MM)\d{2}$/);
      }
    }
  });
});

describe('selectAnnotations', () => {
  it('returns the curated marker when the canonical key, grain and in-view period all match', () => {
    const corona = CHART_ANNOTATIONS.find((d) => d.slug === 'coronacrisis-start')!;
    const key = corona.canonicalKeys[0]!;
    const result = selectAnnotations(key, 'MM', ['2019MM12', '2020MM01', '2020MM02', '2020MM03', '2020MM04']);
    expect(result).toEqual([{ periodCode: '2020MM03', label: corona.label }]);
  });

  it('drops an annotation whose canonical key does not match', () => {
    const result = selectAnnotations('some_unrelated_measure_key', 'MM', ['2020MM03']);
    expect(result).toEqual([]);
  });

  it('drops an annotation whose period code is not literally in view — never an approximate placement', () => {
    const corona = CHART_ANNOTATIONS.find((d) => d.slug === 'coronacrisis-start')!;
    const key = corona.canonicalKeys[0]!;
    // The window brackets the event but does not include its exact period.
    const result = selectAnnotations(key, 'MM', ['2020MM01', '2020MM02', '2020MM04', '2020MM05']);
    expect(result).toEqual([]);
  });

  it('drops an annotation with no period code for the requested grain (safe no-op, not an error)', () => {
    const corona = CHART_ANNOTATIONS.find((d) => d.slug === 'coronacrisis-start')!;
    const key = corona.canonicalKeys[0]!;
    expect(corona.periodCodes.JJ).toBeUndefined();
    expect(() => selectAnnotations(key, 'JJ', ['2020JJ00'])).not.toThrow();
    expect(selectAnnotations(key, 'JJ', ['2020JJ00'])).toEqual([]);
  });

  it('reflects today\'s three curated events chronologically, oldest first, when all are in view', () => {
    const key = CHART_ANNOTATIONS[0]!.canonicalKeys[0]!;
    // A wide synthetic view spanning all three curated MM dates — every real
    // entry currently shares this canonical key (see the file's own header
    // note on why: broad macro shocks apply to every curated measure).
    const wideView = ['2008MM09', '2020MM03', '2022MM02'];
    const result = selectAnnotations(key, 'MM', wideView);
    expect(result.map((a) => a.periodCode)).toEqual(['2008MM09', '2020MM03', '2022MM02']);
  });

  it('never returns a duplicate result for the same in-view period across entries', () => {
    // Sanity check on the curated set: no two entries share both a
    // canonicalKey and an identical MM period code (would render two
    // overlapping markers at the same x-position).
    const seen = new Map<string, Set<string>>();
    for (const def of CHART_ANNOTATIONS) {
      for (const key of def.canonicalKeys) {
        const code = def.periodCodes.MM;
        if (code === undefined) continue;
        const set = seen.get(key) ?? new Set<string>();
        expect(set.has(code), `key '${key}' has two annotations at '${code}'`).toBe(false);
        set.add(code);
        seen.set(key, set);
      }
    }
  });
});
