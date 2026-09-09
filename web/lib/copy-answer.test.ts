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

  it('pins the order: body, assumption, staleness, definition, alternates, marking, attribution, URL', () => {
    const { text } = buildAnswerCopy(
      view({
        assumptionLine: 'Dit is het landelijke cijfer.',
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
        'Dit cijfer kan verouderd zijn.',
        'Dit betreft de standaardpopulatie.',
        'Er is ook een andere lezing beschikbaar.',
        'Bevat afgeleide cijfers (CC BY 4.0).',
        'Bron: CBS StatLine, tabel 86141NED. Gesynchroniseerd 3 juli 2026.',
        'https://opendata.cbs.nl/x',
      ].join('\n\n'),
    );
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
