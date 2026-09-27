// #296 part 2 Task 7: the scatter card's text lines, per language — the ONE
// place the chat card, the dock, Copy and the embed page get them from.
import { describe, expect, it } from 'vitest';
import { scatterBodyNl, scatterLineNl } from '../backend/chart/scatter-text.ts';
import { fakeScatterAnswerResponse, fakeScatterSpec } from '../test/fake-answer.ts';
import { translateAttributionLine } from './i18n/cbs-words.ts';
import { scatterCardSourceOf, scatterCardText as cardText } from './scatter-card.ts';
import type { AnswerResponse } from '../backend/answer/respond/types.ts';

const scatterCardText = (response: AnswerResponse, lang: 'nl' | 'en') => cardText(scatterCardSourceOf(response), lang);
import { scatterBodyEn, scatterLineEn } from './scatter-text-en.ts';

const Y_STALE =
  'Let op: de tabel 84639NED (Gemiddeld inkomen) wordt normaal jaarlijks bijgewerkt door CBS, ' +
  'maar onze laatste synchronisatie was op 2025-01-02 — recentere cijfers kunnen inmiddels beschikbaar zijn.';
const X_STALE =
  'Let op: de tabel 03759ned (Bevolking op 1 januari) wordt normaal jaarlijks bijgewerkt door CBS, ' +
  'maar onze laatste synchronisatie was op 2025-01-03 — recentere cijfers kunnen inmiddels beschikbaar zijn.';

describe('scatterCardText — Dutch', () => {
  it('the stored body and coverage line verbatim; each definition labelled with its axis; each staleness line on its own', () => {
    const response = fakeScatterAnswerResponse({ stalenessWarning: `${Y_STALE}\n${X_STALE}` });
    const text = scatterCardText(response, 'nl');
    expect(text.body).toBe(response.answer.body);
    expect(text.body).toBe(scatterBodyNl(response.scatter!));
    expect(text.line).toBe(response.answer.scatterLine);
    expect(text.line).toBe(scatterLineNl(response.scatter!));
    expect(text.definitionLines).toEqual([
      'Definitie (verticale as): gemiddeld besteedbaar inkomen per huishouden.',
      'Definitie (horizontale as): inwoners op 1 januari.',
    ]);
    expect(text.stalenessLines).toEqual([Y_STALE, X_STALE]);
    expect(text.extraLines).toEqual([...text.definitionLines, Y_STALE, X_STALE]);
    expect(text.attributionLines).toEqual([response.scatter!.y.attributionLine, response.scatter!.x.attributionLine]);
  });

  it('drops an absent definition (null) instead of printing an empty line; no staleness ⇒ no staleness lines', () => {
    const text = scatterCardText(fakeScatterAnswerResponse({ definitionLine: null }), 'nl');
    expect(text.definitionLines).toEqual(['Definitie (horizontale as): inwoners op 1 januari.']);
    expect(text.stalenessLines).toEqual([]);
  });

  it('two axes from one table and period: the identical attribution sentence is shown once', () => {
    const spec = fakeScatterSpec();
    const same = fakeScatterSpec({ x: { ...spec.x, attributionLine: spec.y.attributionLine } });
    expect(scatterCardText(fakeScatterAnswerResponse({ spec: same }), 'nl').attributionLines).toEqual([
      spec.y.attributionLine,
    ]);
  });
});

describe('scatterCardText — English (no Dutch sentence on the English card)', () => {
  const response = fakeScatterAnswerResponse({ stalenessWarning: `${Y_STALE}\n${X_STALE}` });
  const text = scatterCardText(response, 'en');

  it('body and coverage line are the English builders over the spec', () => {
    expect(text.body).toBe(scatterBodyEn(response.scatter!));
    expect(text.line).toBe(scatterLineEn(response.scatter!));
  });

  it('definitions: only the axes with a hand-written English label; staleness translated per table', () => {
    expect(text.definitionLines).toEqual(['Definition (horizontal axis): The population on 1 January.']);
    expect(text.stalenessLines).toEqual([
      'Note: CBS normally updates table 84639NED (Average income) yearly, but our last sync was on 2025-01-02 — ' +
        'more recent figures may now be available.',
      'Note: CBS normally updates table 03759ned (Population on 1 January) yearly, but our last sync was on 2025-01-03 — ' +
        'more recent figures may now be available.',
    ]);
    expect(text.attributionLines).toEqual([
      translateAttributionLine(response.scatter!.y.attributionLine),
      translateAttributionLine(response.scatter!.x.attributionLine),
    ]);
  });

  it('no Dutch sentence anywhere in the English lines', () => {
    for (const line of [text.body, text.line ?? '', ...text.extraLines]) {
      expect(line).not.toMatch(/Let op|Definitie|Dekking|tabel |wordt|hebben|tegenover|januari|Gemiddeld/);
    }
    // The attribution sentence is English; only the CBS table's own title
    // (a proper name, the app-wide translateAttributionLine convention) stays.
    for (const line of text.attributionLines) {
      expect(line).toMatch(/^Source: /);
      expect(line).not.toMatch(/Bron:|gesynchroniseerd|Licentie|Periode:/);
    }
  });
});
