// #296 part 2 Task 7: "Download als CSV" for a scatter answer — both axes per
// region in the csv.ts dialect (';', decimal comma, no grouping, BOM, CRLF),
// both attribution sentences in the preamble, provisional points marked, and
// every left-out region listed with each side's reason (nothing dropped
// silently — principle (c), R11).
import { describe, expect, it } from 'vitest';
import { nullReasonText } from '../backend/answer/compose/template.ts';
import { PROVISIONAL_NOTE } from '../backend/chart/index.ts';
import { scatterLineNl } from '../backend/chart/scatter-text.ts';
import { fakeAnswerResponse, fakeCell, fakeScatterAnswerResponse, fakeScatterSpec } from '../test/fake-answer.ts';
import { buildAnswerCsv } from './csv.ts';
import { answerCsvFor, buildScatterCsv } from './scatter-csv.ts';

const CRLF = '\r\n';

function lines(content: string): string[] {
  expect(content.startsWith('﻿')).toBe(true);
  expect(content.endsWith(CRLF)).toBe(true);
  return content.slice(1, -CRLF.length).split(CRLF);
}

describe('buildScatterCsv — Dutch', () => {
  const spec = fakeScatterSpec();
  const csv = buildScatterCsv(spec, 'nl', {
    definitionLine: 'Definitie: gemiddeld besteedbaar inkomen per huishouden.',
    pairedDefinitionLine: 'Definitie: inwoners op 1 januari.',
    stalenessWarning: null,
  });
  const rows = lines(csv.content);

  it('preamble: both attribution sentences verbatim, both definitions named by measure, the coverage line, the file credit', () => {
    const blank = rows.indexOf('');
    expect(rows.slice(0, blank)).toEqual([
      spec.y.attributionLine,
      spec.x.attributionLine,
      'Definitie gemiddeld inkomen: gemiddeld besteedbaar inkomen per huishouden.',
      'Definitie bevolking op 1 januari: inwoners op 1 januari.',
      scatterLineNl(spec),
      'Bestand aangemaakt door checkdecijfers.nl',
    ]);
  });

  it('one row per plotted region: both values as exact, ungrouped decimal-comma numbers, plus both cell ids', () => {
    const header = rows.indexOf('regio;regiocode;Gemiddeld inkomen (1 000 euro);Bevolking op 1 januari (aantal);voorlopig;cel-id verticale as;cel-id horizontale as');
    expect(header).toBeGreaterThan(0);
    expect(rows.slice(header + 1, header + 4)).toEqual([
      `Groningen (PV);PV20;38,2;596075;;${spec.points[0]!.yResultId};${spec.points[0]!.xResultId}`,
      `Fryslân;PV21;36,9;659551;;${spec.points[1]!.yResultId};${spec.points[1]!.xResultId}`,
      `Noord-Holland;PV27;47,5;2952622;;${spec.points[2]!.yResultId};${spec.points[2]!.xResultId}`,
    ]);
  });

  it('every value in the file is a plotted point value (R1: no other number source)', () => {
    const header = rows.findIndex((r) => r.startsWith('regio;'));
    for (const [i, point] of spec.points.entries()) {
      const fields = rows[header + 1 + i]!.split(';');
      expect(Number(fields[2]!.replace(',', '.'))).toBe(point.y);
      expect(Number(fields[3]!.replace(',', '.'))).toBe(point.x);
    }
  });

  it('a "Niet getoond" block lists every left-out region with each side\'s reason', () => {
    const block = rows.indexOf('Niet getoond');
    expect(block).toBeGreaterThan(0);
    expect(rows.slice(block + 1)).toEqual([
      'regio;regiocode;reden verticale as;reden horizontale as',
      `Zeeland;PV29;${nullReasonText('Secret', 'cbs')};`,
    ]);
  });

  it('filename names both tables and the period', () => {
    expect(csv.filename).toBe('checkdecijfers-84639NED-03759ned-2024.csv');
  });
});

describe('buildScatterCsv — provisional, staleness, nothing left out', () => {
  it('marks a provisional point with * in its own column and states the note in the preamble', () => {
    const base = fakeScatterSpec();
    const spec = fakeScatterSpec({
      points: base.points.map((p, i) => (i === 1 ? { ...p, provisional: true } : p)),
      provisionalNote: PROVISIONAL_NOTE,
      leftOut: [],
    });
    const warning = 'Let op: de tabel 84639NED (Gemiddeld inkomen) wordt normaal jaarlijks bijgewerkt door CBS, maar onze laatste synchronisatie was op 2025-01-02 — recentere cijfers kunnen inmiddels beschikbaar zijn.';
    const rows = lines(buildScatterCsv(spec, 'nl', { stalenessWarning: warning }).content);
    expect(rows).toContain(PROVISIONAL_NOTE);
    expect(rows).toContain(warning);
    expect(rows.find((r) => r.startsWith('Fryslân;'))!.split(';')[4]).toBe('*');
    expect(rows.find((r) => r.startsWith('Groningen (PV);'))!.split(';')[4]).toBe('');
    // No left-out region ⇒ no empty "Niet getoond" block.
    expect(rows).not.toContain('Niet getoond');
  });

  it('two axes from the same table: the one attribution sentence once, the table once in the filename', () => {
    const base = fakeScatterSpec();
    const spec = fakeScatterSpec({ x: { ...base.x, tableId: base.y.tableId, attributionLine: base.y.attributionLine } });
    const csv = buildScatterCsv(spec, 'nl');
    expect(lines(csv.content).filter((r) => r === base.y.attributionLine)).toHaveLength(1);
    expect(csv.filename).toBe('checkdecijfers-84639NED-2024.csv');
  });
});

describe('buildScatterCsv — English (buildAnswerCsv\'s language handling)', () => {
  const spec = fakeScatterSpec();
  const rows = lines(buildScatterCsv(spec, 'en').content);

  it('fixed column names and the block title in English; CBS data (measure titles, units, region names) as stored', () => {
    expect(rows).toContain(
      'region;region code;Gemiddeld inkomen (1 000 euro);Bevolking op 1 januari (aantal);provisional;cell ID vertical axis;cell ID horizontal axis',
    );
    expect(rows).toContain('Not shown');
    expect(rows).toContain('region;region code;reason vertical axis;reason horizontal axis');
    expect(rows).toContain('Zeeland;PV29;CBS publishes no value;');
    // The provenance preamble stays Dutch, exactly as buildAnswerCsv's does.
    expect(rows[0]).toBe(spec.y.attributionLine);
  });
});

describe('answerCsvFor — the one dispatch the chat and replay both call', () => {
  it('a scatter answer gets the scatter CSV (both axes), never the one-leg answer CSV', () => {
    const response = fakeScatterAnswerResponse();
    expect(answerCsvFor(response, 'nl')).toEqual(
      buildScatterCsv(response.scatter!, 'nl', {
        definitionLine: response.answer.definitionLine,
        pairedDefinitionLine: response.answer.pairedDefinitionLine,
        stalenessWarning: response.stalenessWarning,
      }),
    );
  });

  it('every other answer is byte-identical to buildAnswerCsv', () => {
    const response = fakeAnswerResponse({ cells: [fakeCell()] });
    expect(answerCsvFor(response, 'en')).toEqual(buildAnswerCsv(response, 'en'));
    expect(answerCsvFor(response, 'nl')).toEqual(buildAnswerCsv(response, 'nl'));
  });
});
