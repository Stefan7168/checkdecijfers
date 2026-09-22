// The co-pilot's digit guard (session 113, co-pilot phase 2). A title,
// caption or note the model wrote may only contain numbers that are
// ACTUALLY on the chart — H1's boundary applied to free text: the model
// never computes, so a number it produced that is not plotted is a
// fabricated number and the command is refused.
import { describe, expect, it } from 'vitest';
import { goalLineValueInMessage, unplottedDigits } from '../../src/attachments/copilot/text-guard.ts';
import { CHART_FIXTURE } from './copilot-fixtures.ts';

describe('unplottedDigits', () => {
  it('accepts a sentence whose numbers are all plotted values or x labels', () => {
    expect(unplottedDigits('Omzet steeg naar 150 in 2021', CHART_FIXTURE)).toEqual([]);
  });

  it('flags a number that appears nowhere on the chart', () => {
    expect(unplottedDigits('ongeveer 12 procent', CHART_FIXTURE)).toEqual(['12']);
  });

  it('matches a formatted value with thousands and decimal separators', () => {
    expect(unplottedDigits('Rotterdam piekt op 1.234,5', CHART_FIXTURE)).toEqual([]);
  });

  it('trims trailing punctuation before judging a run', () => {
    expect(unplottedDigits('De piek ligt in 2021.', CHART_FIXTURE)).toEqual([]);
  });

  it('accepts a number that only appears in a column header', () => {
    // The y header is 'Revenue (x 1.000 euro)' — a unit the reader may quote.
    expect(unplottedDigits('Bedragen x 1.000 euro', CHART_FIXTURE)).toEqual([]);
  });

  it('accepts a raw source text that was never formatted for display', () => {
    expect(unplottedDigits('De bron zegt 1234,5', CHART_FIXTURE)).toEqual([]);
  });

  it('accepts the number inside a negative formatted value', () => {
    // formattedValue is '-24': the minus sign is not part of the digits.
    expect(unplottedDigits('Rotterdam fell by 24', CHART_FIXTURE)).toEqual([]);
  });

  it('accepts a number the source cell shows with a currency symbol', () => {
    // sourceText is '€ -24,00'.
    expect(unplottedDigits('De cel zegt 24,00', CHART_FIXTURE)).toEqual([]);
  });

  it('is clean for text with no digits at all', () => {
    expect(unplottedDigits('Omzet per stad', CHART_FIXTURE)).toEqual([]);
  });

  it('reports every offending run, once each', () => {
    expect(unplottedDigits('7 en 8 en 7 weer', CHART_FIXTURE)).toEqual(['7', '8']);
  });
});

// Own-data wiring of the CBS tier's co-pilot phase 6 addGoalLine primitive:
// a goal line's value is the one bare NUMBER the model writes on this tier.
// Its reference set is NOT the chart (a target is deliberately not a
// plotted value) but the reader's own raw message: the value must EQUAL,
// numerically, a number the reader spelled there — each digit run read both
// ways a Dutch or English reader could have written it. Reusing the
// reader's digits with a moved decimal or a different sign is not the
// reader's number; anything else is, by construction, a number the model
// produced itself — refused, never guessed. Ported verbatim (adversarial
// cases included) from tests/chart/copilot-text-guard.test.ts, which pins
// the identical logic for the CBS tier — this function has no chart-shaped
// input at all, so the two suites exercise the exact same code path.
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

  it('compares numbers, not spellings — a value JS prints in exponent form still equals the digits the reader typed', () => {
    expect(goalLineValueInMessage(1e21, 'doellijn op 1000000000000000000000')).toBe(true);
  });

  it('reads a trailing-zero decimal and a leading zero for the number they spell', () => {
    expect(goalLineValueInMessage(900000.5, 'doellijn op 900.000,50')).toBe(true);
    expect(goalLineValueInMessage(5, 'doellijn op 05')).toBe(true);
  });

  // ADVERSARIAL CASES (pitfall #2 — the CBS build's first version of this
  // guard compared separator-stripped digit STRINGS, not parsed numbers, and
  // would have wrongly ACCEPTED every one of these: a value 10x/1000x off, a
  // sign-flipped value, and a value with a shifted decimal. Executed here
  // against the actual function, not just read — confirming the CURRENT,
  // fixed numeric-comparison logic correctly rejects all of them.
  it('refuses the reader\'s digits with a shifted decimal — "25" does not vouch for 2.5', () => {
    expect(goalLineValueInMessage(2.5, 'Zet een doellijn op 25')).toBe(false);
    expect(goalLineValueInMessage(15, 'doellijn op 1,5 procent')).toBe(false);
    expect(goalLineValueInMessage(12.5, 'doellijn op 125')).toBe(false);
    expect(goalLineValueInMessage(25, 'doellijn op 2,5')).toBe(false);
  });

  it('refuses a value 10x off from what the reader typed', () => {
    expect(goalLineValueInMessage(900, 'doellijn op 9000')).toBe(false);
    expect(goalLineValueInMessage(9000, 'doellijn op 900')).toBe(false);
  });

  it('refuses a value 1000x off from what the reader typed', () => {
    expect(goalLineValueInMessage(900, 'doellijn op 900000')).toBe(false);
    expect(goalLineValueInMessage(900000, 'doellijn op 900')).toBe(false);
  });

  // Same finding, the sign half: a minus directly before the digits is the
  // reader's sign, so a correctly negative target is accepted and the same
  // digits with the sign dropped or added are not.
  it('accepts a negative target the reader typed with its sign', () => {
    expect(goalLineValueInMessage(-5, 'doellijn op -5')).toBe(true);
    expect(goalLineValueInMessage(-900000, 'doellijn op -900.000')).toBe(true);
  });

  it("refuses the reader's digits with the sign dropped or added", () => {
    expect(goalLineValueInMessage(5, 'doellijn op -5')).toBe(false);
    expect(goalLineValueInMessage(-5, 'doellijn op 5')).toBe(false);
  });

  it('takes a dash between two numbers as a range, not as a sign', () => {
    expect(goalLineValueInMessage(2022, 'doellijn tussen 2020-2022')).toBe(true);
    expect(goalLineValueInMessage(-2022, 'doellijn tussen 2020-2022')).toBe(false);
  });

  it('reads a spelling that is well-formed both ways under either reading — the locale is not known here', () => {
    expect(goalLineValueInMessage(900000, 'doel van 900,000 euro')).toBe(true);
    expect(goalLineValueInMessage(900, 'doel van 900,000 euro')).toBe(true);
  });

  it('refuses a spelling that is well-formed under neither reading', () => {
    expect(goalLineValueInMessage(1234.5, 'doellijn op 1,234,5')).toBe(false);
    expect(goalLineValueInMessage(12345, 'doellijn op 1,234,5')).toBe(false);
    expect(goalLineValueInMessage(123, 'doellijn op 1.2.3')).toBe(false);
  });
});
