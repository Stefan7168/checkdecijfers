// ADR 058 phase 2 (#332), Task 1: coverage + behaviour tests for the pure
// English parameter helpers (src/answer/respond/english.ts) and the hand-
// written English measure/topic labels (src/answer/respond/english-measure-
// labels.ts). No DB, no LLM — every case here is a pure function call.
import { describe, expect, it } from 'vitest';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import {
  ENGLISH_MEASURE_LABELS,
  ENGLISH_TOPIC_TERMS,
} from '../../src/answer/respond/english-measure-labels.ts';
import {
  axesEn,
  cardinalEn,
  englishMeasureLabel,
  FIXED_OPTION_EN,
  joinOfEn,
  loadedTopicsCompactEn,
  periodCodeToEn,
  regionLabelEn,
  statusSuffixEn,
} from '../../src/answer/respond/english.ts';

// A small, deliberately non-exhaustive list of Dutch words/particles that
// should never appear inside an English phrase — catches the "forgot to
// translate a fragment" class of mistake without trying to be a full
// Dutch-word detector.
const DUTCH_TELLS = [' van ', ' het ', ' de ', 'gemiddelde', 'aantal'];

describe('ENGLISH_MEASURE_LABELS / ENGLISH_TOPIC_TERMS coverage', () => {
  const canonicalKeys = new Set(CANONICAL_MEASURES.map((m) => m.key));

  it('has a non-empty entry for every CANONICAL_MEASURES key, in both maps', () => {
    for (const key of canonicalKeys) {
      expect(ENGLISH_MEASURE_LABELS[key], `ENGLISH_MEASURE_LABELS missing/empty for '${key}'`).toBeTruthy();
      expect(ENGLISH_TOPIC_TERMS[key], `ENGLISH_TOPIC_TERMS missing/empty for '${key}'`).toBeTruthy();
    }
  });

  it('carries no extra keys beyond CANONICAL_MEASURES in either map', () => {
    for (const key of Object.keys(ENGLISH_MEASURE_LABELS)) {
      expect(canonicalKeys.has(key), `ENGLISH_MEASURE_LABELS has orphan key '${key}'`).toBe(true);
    }
    for (const key of Object.keys(ENGLISH_TOPIC_TERMS)) {
      expect(canonicalKeys.has(key), `ENGLISH_TOPIC_TERMS has orphan key '${key}'`).toBe(true);
    }
  });

  it('never contains an obvious Dutch word/particle', () => {
    for (const [key, label] of Object.entries(ENGLISH_MEASURE_LABELS)) {
      for (const tell of DUTCH_TELLS) {
        expect(label.toLowerCase().includes(tell), `'${key}' label '${label}' contains Dutch tell '${tell}'`).toBe(
          false,
        );
      }
    }
    for (const [key, term] of Object.entries(ENGLISH_TOPIC_TERMS)) {
      for (const tell of DUTCH_TELLS) {
        expect(term.toLowerCase().includes(tell), `'${key}' term '${term}' contains Dutch tell '${tell}'`).toBe(
          false,
        );
      }
    }
  });

  it('topic terms never carry a digit', () => {
    for (const [key, term] of Object.entries(ENGLISH_TOPIC_TERMS)) {
      expect(/\d/.test(term), `'${key}' topic term '${term}' has a digit`).toBe(false);
    }
  });

  it('measure labels introduce no digit beyond what the Dutch definitionLabel already carries', () => {
    for (const measure of CANONICAL_MEASURES) {
      const label = ENGLISH_MEASURE_LABELS[measure.key]!;
      const englishHasDigit = /\d/.test(label);
      const dutchHasDigit = /\d/.test(measure.definitionLabel);
      if (englishHasDigit) {
        expect(
          dutchHasDigit,
          `'${measure.key}' English label '${label}' has a digit the Dutch definitionLabel '${measure.definitionLabel}' does not`,
        ).toBe(true);
      }
    }
  });
});

describe('periodCodeToEn', () => {
  it('renders a month code', () => {
    expect(periodCodeToEn('2026MM06')).toBe('June 2026');
  });

  it('renders a quarter code', () => {
    expect(periodCodeToEn('2025KW04')).toBe('the fourth quarter of 2025');
  });

  it('renders a year code', () => {
    expect(periodCodeToEn('2024JJ00')).toBe('2024');
  });

  it('renders an unparseable code verbatim', () => {
    expect(periodCodeToEn('not-a-code')).toBe('not-a-code');
    expect(periodCodeToEn('2024XX01')).toBe('2024XX01');
  });
});

describe('statusSuffixEn', () => {
  it('renders every CBS status that has a Dutch suffix', () => {
    expect(statusSuffixEn('Voorlopig')).toBe(' (provisional figure)');
    expect(statusSuffixEn('NaderVoorlopig')).toBe(' (revised provisional figure)');
  });

  it('renders every Eurostat status that has a Dutch suffix', () => {
    expect(statusSuffixEn('p', 'eurostat')).toBe(' (provisional figure)');
    expect(statusSuffixEn('e', 'eurostat')).toBe(' (estimate)');
    expect(statusSuffixEn('s', 'eurostat')).toBe(' (estimate by Eurostat)');
    expect(statusSuffixEn('f', 'eurostat')).toBe(' (forecast)');
    expect(statusSuffixEn('b', 'eurostat')).toBe(' (break in series)');
    expect(statusSuffixEn('c', 'eurostat')).toBe(' (confidential)');
    expect(statusSuffixEn('d', 'eurostat')).toBe(' (different definition)');
    expect(statusSuffixEn('u', 'eurostat')).toBe(' (low reliability)');
    expect(statusSuffixEn('n', 'eurostat')).toBe(' (not significant)');
  });

  it('returns empty string for a definitive/unknown status', () => {
    expect(statusSuffixEn('Definitief')).toBe('');
    expect(statusSuffixEn('SomethingUnknown')).toBe('');
  });
});

describe('englishMeasureLabel', () => {
  it('returns the hand-written label for a known canonical key', () => {
    expect(englishMeasureLabel('population_on_1_january')).toBe('the population on 1 January');
  });

  it('falls back to a lower-cased translateMeasureTitle for an unknown key with a measureTitle', () => {
    // 'Werkloosheidspercentage' is seeded in english-names (per
    // tests/registry/english-names.test.ts's hasEnglishName check).
    expect(englishMeasureLabel('some_future_key', 'Werkloosheidspercentage')).toMatch(/^[a-z]/);
  });

  it('falls back to "these figures" for an unknown key with no measureTitle', () => {
    expect(englishMeasureLabel('some_future_key')).toBe('these figures');
  });
});

describe('joinOfEn', () => {
  it('returns the single item unchanged', () => {
    expect(joinOfEn(['A'])).toBe('A');
  });

  it('joins two items with "or"', () => {
    expect(joinOfEn(['A', 'B'])).toBe('A or B');
  });

  it('joins three items with commas and a final "or"', () => {
    expect(joinOfEn(['A', 'B', 'C'])).toBe('A, B or C');
  });
});

describe('cardinalEn', () => {
  it('never returns a digit, across its whole mapped range', () => {
    for (let n = 1; n <= 12; n++) {
      const word = cardinalEn(n);
      expect(/\d/.test(word), `cardinalEn(${n}) = '${word}' contains a digit`).toBe(false);
    }
  });

  it('renders a couple of known values', () => {
    expect(cardinalEn(1)).toBe('one');
    expect(cardinalEn(12)).toBe('twelve');
  });

  it('throws for an out-of-range value, matching cardinalNl\'s contract', () => {
    expect(() => cardinalEn(13)).toThrow();
    expect(() => cardinalEn(0)).toThrow();
  });
});

describe('axesEn', () => {
  it('renders a single axis', () => {
    expect(axesEn(['measure'])).toBe('which topic or definition you mean');
  });

  it('merges two "for which" axes into one phrase', () => {
    expect(axesEn(['region', 'period'])).toBe('for which region and period');
  });

  it('joins a "for which" axis with a non-"for which" axis using "and"', () => {
    expect(axesEn(['measure', 'region'])).toBe('which topic or definition you mean and for which region');
  });
});

describe('loadedTopicsCompactEn', () => {
  it('lists every distinct English topic term, comma-separated with a final "and"', () => {
    const compact = loadedTopicsCompactEn();
    expect(compact).toContain('population');
    expect(compact).toContain('inflation');
    expect(compact.startsWith(', ')).toBe(false);
    expect(compact).toMatch(/ and [a-z ]+$/);
  });
});

describe('FIXED_OPTION_EN', () => {
  it('has an English label for the national/gemeente-or-provincie clarification options', () => {
    expect(FIXED_OPTION_EN['heel Nederland (landelijk cijfer)']).toBe(
      'the Netherlands as a whole (national figure)',
    );
    expect(FIXED_OPTION_EN['een specifieke gemeente of provincie — noem de naam']).toBe(
      'a specific municipality or province — name it',
    );
    expect(FIXED_OPTION_EN['heel Nederland']).toBe('the Netherlands as a whole');
  });
});

describe('regionLabelEn', () => {
  it('translates the gemeente qualifier', () => {
    expect(regionLabelEn('Utrecht (gemeente)')).toBe('Utrecht (municipality)');
  });

  it('translates the province qualifier', () => {
    expect(regionLabelEn('Utrecht (PV)')).toBe('Utrecht (province)');
  });

  it('passes an unqualified, translatable region straight through translateRegion', () => {
    expect(regionLabelEn('Nederland')).toBe('the Netherlands');
  });
});
