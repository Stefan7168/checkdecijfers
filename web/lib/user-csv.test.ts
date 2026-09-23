// buildUserChartCsv (the own-data counterpart of csv.test.ts's
// buildAnswerCsv suite): full-string pins on the exported file — the
// disclaimer + source preamble (D0/D11), the exact decimal-comma value
// serialization with no rounding (U1), the null/incomplete note column
// (U11 analog), and the CSV-injection defense (ADR 037 D11, OWASP) applied
// to every user-sourced field but never to a generated number.
import { describe, expect, it } from 'vitest';
import type { UserChartPoint, UserChartSpec } from '../backend/attachments/types.ts';
import { USER_DATA_DISCLAIMER } from '../backend/attachments/types.ts';
import { buildUserChartCsv, neutralizeFormula } from './user-csv.ts';

const BOM = '﻿';

function point(overrides: Partial<UserChartPoint> = {}): UserChartPoint {
  return {
    rowRef: 'r1:c1',
    xKey: '2023',
    xLabel: '2023',
    value: 40,
    formattedValue: '40,0',
    sourceText: '40,0',
    ...overrides,
  };
}

function spec(overrides: Partial<UserChartSpec> = {}): UserChartSpec {
  return {
    schemaVersion: 1,
    origin: 'user_dataset',
    trust: 'unverified',
    kind: 'line',
    xHeader: 'Jaar',
    yHeaders: ['Omzet'],
    series: [{ label: 'Omzet', points: [point()] }],
    provenance: {
      datasetId: 7,
      sourceKind: 'file_csv',
      displayName: 'verkoop-2024.csv',
      sourceUrlHost: null,
      capturedAt: '2026-09-06T12:00:00.000Z',
      contentSha256: 'deadbeef',
    },
    disclaimerLine: USER_DATA_DISCLAIMER,
    ...overrides,
  };
}

/** Two series, two points each — enough to prove series/point order is
 * preserved into the LONG-format table. */
function twoSeriesSpec(): UserChartSpec {
  return spec({
    xHeader: 'Jaar',
    yHeaders: ['Omzet'],
    series: [
      {
        label: 'Amsterdam',
        points: [
          point({ rowRef: 'r1:c1', xKey: '2023', xLabel: '2023', value: 40, formattedValue: '40,0' }),
          point({ rowRef: 'r2:c1', xKey: '2024', xLabel: '2024', value: 42, formattedValue: '42,0' }),
        ],
      },
      {
        label: 'Rotterdam',
        points: [
          point({ rowRef: 'r1:c2', xKey: '2023', xLabel: '2023', value: 20, formattedValue: '20,0' }),
          point({ rowRef: 'r2:c2', xKey: '2024', xLabel: '2024', value: 24, formattedValue: '24,0' }),
        ],
      },
    ],
  });
}

describe('buildUserChartCsv', () => {
  it('pins the complete nl file for a small two-series spec', () => {
    const { filename, content } = buildUserChartCsv(twoSeriesSpec(), 'nl');
    expect(filename).toBe('checkdecijfers-your-data-7.csv');
    expect(content).toBe(
      BOM +
        'User-uploaded data — not verified by checkdecijfers.\r\n' +
        'Bron: eigen bestand verkoop-2024.csv, geüpload op 2026-09-06\r\n' +
        'Bestand aangemaakt door checkdecijfers.nl\r\n' +
        '\r\n' +
        'Jaar;Reeks;Waarde;Weergave;Cel;Opmerking\r\n' +
        '2023;Amsterdam;40;40,0;r1:c1;\r\n' +
        '2024;Amsterdam;42;42,0;r2:c1;\r\n' +
        '2023;Rotterdam;20;20,0;r1:c2;\r\n' +
        '2024;Rotterdam;24;24,0;r2:c2;\r\n',
    );
  });

  it('pins the complete en file for the same spec — xHeader stays verbatim, only fixed copy translates', () => {
    const { filename, content } = buildUserChartCsv(twoSeriesSpec(), 'en');
    expect(filename).toBe('checkdecijfers-your-data-7.csv');
    expect(content).toBe(
      BOM +
        'User-uploaded data — not verified by checkdecijfers.\r\n' +
        'Source: your file verkoop-2024.csv, uploaded 2026-09-06\r\n' +
        'File created by checkdecijfers.nl\r\n' +
        '\r\n' +
        'Jaar;Series;Value;Shown as;Cell;Note\r\n' +
        '2023;Amsterdam;40;40,0;r1:c1;\r\n' +
        '2024;Amsterdam;42;42,0;r2:c1;\r\n' +
        '2023;Rotterdam;20;20,0;r1:c2;\r\n' +
        '2024;Rotterdam;24;24,0;r2:c2;\r\n',
    );
  });

  it('keeps a null value honest: empty value/shown-as plus its fixed reason (U11 analog)', () => {
    const { content } = buildUserChartCsv(
      spec({
        series: [
          {
            label: 'Omzet',
            points: [
              point({ rowRef: 'r3:c1', xKey: '2025', xLabel: '2025', value: null, formattedValue: null, sourceText: '', reason: 'leeg in bron' }),
            ],
          },
        ],
      }),
      'nl',
    );
    expect(content).toContain('2025;Omzet;;;r3:c1;leeg in bron\r\n');
  });

  it('discloses an incomplete point only when there is no more specific reason', () => {
    const { content } = buildUserChartCsv(
      spec({
        series: [
          {
            label: 'Omzet',
            points: [point({ rowRef: 'r4:c1', xKey: '2026', xLabel: '2026', value: 15, formattedValue: '15,0', incomplete: true })],
          },
        ],
      }),
      'nl',
    );
    expect(content).toContain(
      '2026;Omzet;15;15,0;r4:c1;onvolledige groep: lege of niet-numerieke cellen overgeslagen\r\n',
    );
  });

  it('serializes a negative value at exact precision, decimal comma, NEVER prefixed as a formula', () => {
    const { content } = buildUserChartCsv(
      spec({ series: [{ label: 'Omzet', points: [point({ value: -12.5, formattedValue: '-12,5' })] }] }),
      'nl',
    );
    // The value column must read exactly '-12,5' — csv.ts's own dialect —
    // and must NOT gain a leading apostrophe: neutralizeFormula applies only
    // to user-sourced text, never to the numbers we compute ourselves.
    expect(content).toContain('2023;Omzet;-12,5;-12,5;r1:c1;\r\n');
    expect(content).not.toContain("'-12,5");
  });

  describe('neutralizeFormula (OWASP CSV Injection)', () => {
    it.each(['=', '+', '-', '@', '\t'])('prefixes a leading %j with a single quote', (lead) => {
      expect(neutralizeFormula(`${lead}cmd`)).toBe(`'${lead}cmd`);
    });

    it('looks through leading whitespace and control characters (the D11 brief\'s trim-first rule)', () => {
      expect(neutralizeFormula(' =1+1')).toBe("' =1+1");
      expect(neutralizeFormula('\u0000@SUM(A1)')).toBe("'\u0000@SUM(A1)");
      expect(neutralizeFormula('\r-2+3')).toBe("'\r-2+3");
    });

    it('leaves a plain number alone — a negative x label is data, not a formula', () => {
      expect(neutralizeFormula('-5')).toBe('-5');
      expect(neutralizeFormula('-5,2')).toBe('-5,2');
      expect(neutralizeFormula('+3')).toBe('+3');
      expect(neutralizeFormula('1.234,5')).toBe('1.234,5');
      // Not a plain number, so still neutralised:
      expect(neutralizeFormula('-2+3')).toBe("'-2+3");
      expect(neutralizeFormula('-5 kg')).toBe("'-5 kg");
    });

    it('leaves ordinary text and a mid-string formula-shaped substring untouched', () => {
      expect(neutralizeFormula('Amsterdam')).toBe('Amsterdam');
      expect(neutralizeFormula('click =HYPERLINK(evil) here')).toBe('click =HYPERLINK(evil) here');
    });

    it.each(['=', '+', '-', '@', '\t'])(
      'neutralizes every user-sourced field for a leading %j — xHeader, series label, xLabel, displayName',
      (lead) => {
        const injected = spec({
          xHeader: `${lead}cmd`,
          series: [
            {
              label: `${lead}series`,
              points: [point({ xLabel: `${lead}x`, rowRef: 'r1:c1', value: 40, formattedValue: '40,0' })],
            },
          ],
          provenance: { ...spec().provenance, displayName: `${lead}file.csv` },
        });
        const { content } = buildUserChartCsv(injected, 'nl');
        const lines = content.replace(BOM, '').split('\r\n');
        expect(lines[1]).toBe(`Bron: eigen bestand '${lead}file.csv, geüpload op 2026-09-06`);
        expect(lines[4]).toBe(`'${lead}cmd;Reeks;Waarde;Weergave;Cel;Opmerking`);
        expect(lines[5]).toBe(`'${lead}x;'${lead}series;40;40,0;r1:c1;`);
      },
    );
  });

  it('neutralizes THEN quotes a field containing both the separator and a quote — the right order', () => {
    // A series label starting with '=' AND carrying ';'/'"': neutralize
    // first ('=A;"B"' -> "'=A;\"B\""), THEN RFC-4180-quote the whole
    // (now-neutralized) field because it still contains ';' and '"'.
    // Quoting first would instead wrap the ORIGINAL '=' at the front inside
    // quotes and never see the neutralized apostrophe — this pins the order.
    const { content } = buildUserChartCsv(
      spec({ series: [{ label: '=A;"B"', points: [point()] }] }),
      'nl',
    );
    expect(content).toContain(`2023;"'=A;""B""";40;40,0;r1:c1;\r\n`);
  });

  it('names the file after the dataset id', () => {
    const { filename } = buildUserChartCsv(spec({ provenance: { ...spec().provenance, datasetId: 42 } }), 'nl');
    expect(filename).toBe('checkdecijfers-your-data-42.csv');
  });
});
