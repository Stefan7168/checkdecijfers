// Task 2 (chat polish batch): "Copy" now copies the WHOLE answer, not just
// the R4 citation — body, the structural disclosure lines, the attribution
// sentence, and the source deep link (hyperlinked in the HTML flavor when
// present). This module is a pure leaf (no React) so it can be unit-tested
// directly and reused unchanged by the CopyAnswerButton component.
import { describe, expect, it } from 'vitest';
import type { AnswerView } from './chat-message.ts';
import { buildAnswerCopy } from './copy-answer.ts';

function view(overrides: Partial<AnswerView> = {}): AnswerView {
  return {
    body: 'Nederland telt 18.044.027 inwoners.',
    assumptionLine: null,
    regionSetLine: null,
    regionSeriesLine: null,
    stalenessWarning: null,
    definitionLine: null,
    alternatesLine: null,
    markingLine: null,
    attribution: 'Bron: CBS StatLine, tabel 86141NED. Gesynchroniseerd 3 juli 2026.',
    tableId: '86141NED',
    syncedAt: '2026-07-03T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildAnswerCopy', () => {
  it('joins body + attribution + URL, skipping every null structural line', () => {
    const { text } = buildAnswerCopy(view(), 'https://opendata.cbs.nl/x');
    expect(text).toBe(
      [
        'Nederland telt 18.044.027 inwoners.',
        'Bron: CBS StatLine, tabel 86141NED. Gesynchroniseerd 3 juli 2026.',
        'https://opendata.cbs.nl/x',
      ].join('\n\n'),
    );
  });

  it('pins the order: body, assumption, region-set coverage, region-series coverage, staleness, definition, alternates, marking, attribution, URL', () => {
    const { text } = buildAnswerCopy(
      view({
        assumptionLine: 'Dit is het landelijke cijfer.',
        regionSetLine: 'Dekking: 26 van de 42 gemeenten hebben een cijfer.',
        regionSeriesLine: 'Dekking: Amsterdam ontbreekt in 2021 en 2022.',
        stalenessWarning: 'Dit cijfer kan verouderd zijn.',
        definitionLine: 'Dit betreft de standaardpopulatie.',
        alternatesLine: 'Er is ook een andere lezing beschikbaar.',
        markingLine: 'Bevat afgeleide cijfers (CC BY 4.0).',
      }),
      'https://opendata.cbs.nl/x',
    );
    expect(text).toBe(
      [
        'Nederland telt 18.044.027 inwoners.',
        'Dit is het landelijke cijfer.',
        'Dekking: 26 van de 42 gemeenten hebben een cijfer.',
        'Dekking: Amsterdam ontbreekt in 2021 en 2022.',
        'Dit cijfer kan verouderd zijn.',
        'Dit betreft de standaardpopulatie.',
        'Er is ook een andere lezing beschikbaar.',
        'Bevat afgeleide cijfers (CC BY 4.0).',
        'Bron: CBS StatLine, tabel 86141NED. Gesynchroniseerd 3 juli 2026.',
        'https://opendata.cbs.nl/x',
      ].join('\n\n'),
    );
  });

  it('omits regionSetLine when null (non-region-class answer, or a row stored before #253)', () => {
    const { text } = buildAnswerCopy(view(), 'https://opendata.cbs.nl/x');
    expect(text).not.toContain('Dekking:');
  });

  it('omits regionSeriesLine when null (complete series, or a row stored before MS1)', () => {
    const { text } = buildAnswerCopy(view(), 'https://opendata.cbs.nl/x');
    expect(text).not.toContain('Dekking:');
  });

  it('omits the URL line entirely when no source URL is available', () => {
    const { text } = buildAnswerCopy(view(), null);
    expect(text).toBe(
      [
        'Nederland telt 18.044.027 inwoners.',
        'Bron: CBS StatLine, tabel 86141NED. Gesynchroniseerd 3 juli 2026.',
      ].join('\n\n'),
    );
  });

  it('HTML-escapes every line, including a "<" in the body', () => {
    const { html } = buildAnswerCopy(view({ body: 'Inflatie < 3%.' }), null);
    expect(html).toContain('<p>Inflatie &lt; 3%.</p>');
    expect(html).not.toContain('Inflatie < 3%.');
  });

  it('renders the attribution as a hyperlink to the source URL when present', () => {
    const { html } = buildAnswerCopy(view(), 'https://opendata.cbs.nl/x');
    expect(html).toContain(
      '<p><a href="https://opendata.cbs.nl/x">Bron: CBS StatLine, tabel 86141NED. Gesynchroniseerd 3 juli 2026.</a></p>',
    );
  });

  it('renders the attribution as plain text when no source URL is available', () => {
    const { html } = buildAnswerCopy(view(), null);
    expect(html).toContain('<p>Bron: CBS StatLine, tabel 86141NED. Gesynchroniseerd 3 juli 2026.</p>');
    expect(html).not.toContain('<a href');
  });
});

// #296 part 2 Task 7: a scatter answer copies its coverage line (the
// region-set slot), BOTH definitions and BOTH attribution sentences.
describe('buildAnswerCopy — scatter answer', () => {
  const scatterView = view({
    body: 'Gemiddeld inkomen tegenover bevolking per provincie, 2024.',
    scatterLine: 'Dekking: alle 12 provincies hebben beide cijfers.',
    stalenessWarning: 'Let op: de tabel Y (y) …\nLet op: de tabel X (x) …',
    definitionLine: 'Definitie (verticale as): y.',
    pairedDefinitionLine: 'Definitie (horizontale as): x.',
    attribution: 'Bron: CBS StatLine, tabel Y.',
    pairedAttribution: 'Bron: CBS StatLine, tabel X.',
  });

  it('text: body, coverage, staleness, both definitions, both attributions, URL', () => {
    expect(buildAnswerCopy(scatterView, 'https://opendata.cbs.nl/y').text).toBe(
      [
        'Gemiddeld inkomen tegenover bevolking per provincie, 2024.',
        'Dekking: alle 12 provincies hebben beide cijfers.',
        'Let op: de tabel Y (y) …\nLet op: de tabel X (x) …',
        'Definitie (verticale as): y.',
        'Definitie (horizontale as): x.',
        'Bron: CBS StatLine, tabel Y.',
        'Bron: CBS StatLine, tabel X.',
        'https://opendata.cbs.nl/y',
      ].join('\n\n'),
    );
  });

  it('html: the second attribution is its own paragraph after the linked first one', () => {
    expect(buildAnswerCopy(scatterView, 'https://opendata.cbs.nl/y').html).toContain(
      '<p><a href="https://opendata.cbs.nl/y">Bron: CBS StatLine, tabel Y.</a></p><p>Bron: CBS StatLine, tabel X.</p>',
    );
  });
});
