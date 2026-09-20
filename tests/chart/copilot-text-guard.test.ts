// The CBS chart co-pilot's digit guard (session 114, co-pilot phase 3). A
// title, caption or note the model wrote may only contain numbers that are
// ACTUALLY on the chart — H1's boundary applied to free text, the
// selection-only sibling of tests/attachments/copilot-text-guard.test.ts.
import { describe, expect, it } from 'vitest';
import { goalLineValueInMessage, stripDigits, unplottedDigits } from '../../src/chart/copilot/text-guard.ts';
import { CHART_SPEC_FIXTURE } from './copilot-fixtures.ts';

describe('unplottedDigits', () => {
  it('accepts a sentence whose numbers are all plotted values or period labels', () => {
    expect(unplottedDigits('Bevolking steeg naar 150 in 2021', CHART_SPEC_FIXTURE)).toEqual([]);
  });

  it('flags a number that appears nowhere on the chart', () => {
    expect(unplottedDigits('ongeveer 99 procent', CHART_SPEC_FIXTURE)).toEqual(['99']);
  });

  it('matches a formatted value with thousands and decimal separators', () => {
    expect(unplottedDigits('Rotterdam piekt op 1.234,5', CHART_SPEC_FIXTURE)).toEqual([]);
  });

  it('trims trailing punctuation before judging a run', () => {
    expect(unplottedDigits('De piek ligt in 2021.', CHART_SPEC_FIXTURE)).toEqual([]);
  });

  it('accepts the number inside a negative formatted value', () => {
    expect(unplottedDigits('Rotterdam viel met 24', CHART_SPEC_FIXTURE)).toEqual([]);
  });

  it('accepts a period code digit run (the coveredPeriods bounds)', () => {
    expect(unplottedDigits('van 2020JJ00 tot 2022JJ00', CHART_SPEC_FIXTURE)).toEqual([]);
  });

  it('is clean for text with no digits at all', () => {
    expect(unplottedDigits('Bevolking per stad', CHART_SPEC_FIXTURE)).toEqual([]);
  });

  it('reports every offending run, once each', () => {
    expect(unplottedDigits('7 en 8 en 7 weer', CHART_SPEC_FIXTURE)).toEqual(['7', '8']);
  });
});

describe('stripDigits', () => {
  it('replaces every digit run with a space, whitespace collapsed', () => {
    expect(stripDigits('Groei van 12%')).toBe('Groei van %');
  });
});

// Co-pilot phase 6 (Task 5): a goal line's value is the one bare NUMBER
// the model writes on this tier. Its reference set is NOT the chart (a
// target is deliberately not a plotted value) but the reader's own raw
// message: the value must appear there as a digit run, separators
// ignored on both sides. Anything else is, by construction, a number the
// model produced itself — refused, never guessed.
describe('goalLineValueInMessage', () => {
  it('accepts a value typed digit-for-digit, even though it is on no chart', () => {
    expect(goalLineValueInMessage(900000, 'Voeg een doellijn toe op 900000')).toBe(true);
  });

  it('accepts a Dutch thousands-separated spelling of the same value', () => {
    expect(goalLineValueInMessage(900000, 'Voeg een doellijn toe op 900.000')).toBe(true);
  });

  it('accepts an English thousands-separated spelling too — separators are ignored, not interpreted', () => {
    expect(goalLineValueInMessage(900000, 'goal line at 900,000')).toBe(true);
  });

  it('accepts a decimal typed with a Dutch comma or an English point', () => {
    expect(goalLineValueInMessage(2.5, 'doellijn op 2,5')).toBe(true);
    expect(goalLineValueInMessage(2.5, 'goal line at 2.5')).toBe(true);
  });

  it('ignores sentence punctuation trailing the number', () => {
    expect(goalLineValueInMessage(900000, 'Zet een doellijn op 900000.')).toBe(true);
    expect(goalLineValueInMessage(900000, 'Zet een doellijn op 900.000.')).toBe(true);
  });

  it('finds the value among several numbers in the message', () => {
    expect(goalLineValueInMessage(900000, 'Vanaf 2020 een doellijn op 900000 graag')).toBe(true);
  });

  it('refuses a value when the message contains no number at all', () => {
    expect(goalLineValueInMessage(12345, 'Voeg een doellijn toe')).toBe(false);
  });

  it('refuses a value that differs from every number typed', () => {
    expect(goalLineValueInMessage(12345, 'Voeg een doellijn toe op 900000')).toBe(false);
  });

  it('refuses a value that is only part of a longer digit run — runs are maximal, never sliced', () => {
    expect(goalLineValueInMessage(900000, 'doellijn op 1900000')).toBe(false);
    expect(goalLineValueInMessage(90000, 'doellijn op 900000')).toBe(false);
  });

  it('refuses a value whose digits are split across runs — runs are never stitched together', () => {
    expect(goalLineValueInMessage(900000, 'doellijn op 900 000')).toBe(false);
  });

  it('refuses a non-finite value whatever the message says', () => {
    expect(goalLineValueInMessage(Number.NaN, 'doellijn op 5')).toBe(false);
    expect(goalLineValueInMessage(Number.POSITIVE_INFINITY, 'doellijn op Infinity')).toBe(false);
  });

  it('refuses a value JS would print in exponent form — no digit run can spell it', () => {
    expect(goalLineValueInMessage(1e21, 'doellijn op 1000000000000000000000')).toBe(false);
  });

  it('refuses a negative value — a digit run never carries a sign, so the refusal is conservative', () => {
    expect(goalLineValueInMessage(-5, 'doellijn op -5')).toBe(false);
  });
});
