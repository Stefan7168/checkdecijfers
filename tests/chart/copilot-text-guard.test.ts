// The CBS chart co-pilot's digit guard (session 114, co-pilot phase 3). A
// title, caption or note the model wrote may only contain numbers that are
// ACTUALLY on the chart — H1's boundary applied to free text, the
// selection-only sibling of tests/attachments/copilot-text-guard.test.ts.
import { describe, expect, it } from 'vitest';
import { stripDigits, unplottedDigits } from '../../src/chart/copilot/text-guard.ts';
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
