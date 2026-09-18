// The co-pilot's digit guard (session 113, co-pilot phase 2). A title,
// caption or note the model wrote may only contain numbers that are
// ACTUALLY on the chart — H1's boundary applied to free text: the model
// never computes, so a number it produced that is not plotted is a
// fabricated number and the command is refused.
import { describe, expect, it } from 'vitest';
import { unplottedDigits } from '../../src/attachments/copilot/text-guard.ts';
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

  it('is clean for text with no digits at all', () => {
    expect(unplottedDigits('Omzet per stad', CHART_FIXTURE)).toEqual([]);
  });

  it('reports every offending run, once each', () => {
    expect(unplottedDigits('7 en 8 en 7 weer', CHART_FIXTURE)).toEqual(['7', '8']);
  });
});
