// splitDefinitionForDisplay (#115 residual): presentation SELECTION only —
// short definitions stay fully inline (seed answers unchanged), long CBS
// paragraphs fold behind the expander with their verbatim scale sentence
// kept visible. Never rewording (principle a) — every assertion here is
// substring-of-the-input by construction.
import { describe, expect, it } from 'vitest';
import { DEFINITION_INLINE_MAX_CHARS, splitDefinitionForDisplay } from './definition-display.ts';

// The real shape that drove #115: CBS's consumentenvertrouwen Description —
// a preamble, method sentences, then the scale (the sentence the owner needs
// visible). Same structure, condensed wording, well over the fold threshold.
const LONG_DEFINITION =
  'Definitie: Het consumentenvertrouwen geeft weer hoe consumenten het economisch klimaat en hun ' +
  'eigen financiële situatie beoordelen. Het cijfer komt uit het Consumenten Conjunctuuronderzoek, ' +
  'waarin een steekproef van huishoudens maandelijks vragen beantwoordt over de economische situatie. ' +
  'Het consumentenvertrouwen is het gemiddelde saldo van de positieve en negatieve antwoorden op de deelvragen. ' +
  'De indicator kan een waarde aannemen van -100 (iedereen antwoordt negatief) tot +100 (iedereen antwoordt positief). ' +
  'Bij een waarde van 0 is het aandeel pessimisten gelijk aan het aandeel optimisten.';

describe('splitDefinitionForDisplay', () => {
  it('keeps a short curated definition fully inline (no fold — seed answers unchanged)', () => {
    const line = 'Definitie: inwoners op 1 januari, gemeente volgens de huidige indeling.';
    expect(line.length).toBeLessThanOrEqual(DEFINITION_INLINE_MAX_CHARS);
    expect(splitDefinitionForDisplay(line)).toEqual({ inline: line, folded: null });
  });

  it('folds a long CBS definition and keeps the verbatim SCALE sentence visible', () => {
    expect(LONG_DEFINITION.length).toBeGreaterThan(DEFINITION_INLINE_MAX_CHARS);
    const display = splitDefinitionForDisplay(LONG_DEFINITION);
    expect(display.inline).toBe(
      'De indicator kan een waarde aannemen van -100 (iedereen antwoordt negatief) tot +100 (iedereen antwoordt positief).',
    );
    // The fold carries the WHOLE definition (prefix stripped), byte-exact.
    expect(display.folded).toBe(LONG_DEFINITION.slice('Definitie: '.length));
    // Selection, never generation: the visible sentence is a substring of the input.
    expect(LONG_DEFINITION).toContain(display.inline!);
  });

  it('a long definition without a scale sentence folds with nothing inline', () => {
    const line =
      'Definitie: ' +
      'Deze maat beschrijft de samenstelling van de woningvoorraad naar eigendom en bouwjaar. '.repeat(4);
    const display = splitDefinitionForDisplay(line);
    expect(display.inline).toBeNull();
    expect(display.folded).toBe(line.slice('Definitie: '.length));
  });

  it('an ordinary year-range sentence is NOT mistaken for a scale', () => {
    const line =
      'Definitie: ' +
      'De reeks is beschikbaar van 2015 tot 2023 en wordt jaarlijks herzien wanneer nieuwe bronnen beschikbaar komen. '.repeat(
        3,
      );
    // Range pattern present, but no waarde/schaal/score noun — stays folded-only.
    expect(splitDefinitionForDisplay(line).inline).toBeNull();
  });

  it('dots inside grouped numbers never split the scale sentence', () => {
    const filler = 'Het onderzoek beschrijft de huishoudens in Nederland en hun uitgavenpatroon per maand. '.repeat(3);
    const line = `Definitie: ${filler}De score kan een waarde aannemen van 0 tot 18.044.027 personen.`;
    expect(splitDefinitionForDisplay(line).inline).toBe(
      'De score kan een waarde aannemen van 0 tot 18.044.027 personen.',
    );
  });
});
