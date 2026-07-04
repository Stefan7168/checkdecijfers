// buildAnswerCsv (WP21, open-questions #52): full-string pins on the exported
// file — the attribution preamble (R4/CC BY inside the file), the exact
// Dutch-notation number serialization with its round-trip guarantee (R1/R3),
// per-cell status + null reasons (R11), verbatim units (R10), and the
// explicit-derivations-only section with its marking + source ids (R5).
import { describe, expect, it } from 'vitest';
import type { DerivationRecord, ResultCell } from '../backend/query/types.ts';
import { DERIVED_DATA_MARKING } from '../backend/query/types.ts';
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';
import { buildAnswerCsv } from './csv.ts';

const BOM = '\ufeff';

function fakeDifference(overrides: Partial<Extract<DerivationRecord, { kind: 'difference' }>> = {}): DerivationRecord {
  return {
    kind: 'difference',
    explicit: true,
    sourceResultIds: ['P19', 'P24'],
    unit: 'aantal',
    marking: DERIVED_DATA_MARKING,
    value: 660779,
    minuendResultId: 'P24',
    subtrahendResultId: 'P19',
    ...overrides,
  };
}

/** The waarde column of every data row (rows between the header and the next
 * blank line), split on the ';' dialect. Test-side parsing is deliberately
 * dumb — and guarded (adversarial review, test-honesty lens): a quoted field
 * would silently shift every column index and let a wrong assertion pass, so
 * this helper THROWS on any quote; quoted-field fixtures must use raw
 * content assertions instead. */
function dataRowFields(content: string): string[][] {
  const lines = content.replace(BOM, '').split('\r\n');
  const headerIdx = lines.findIndex((line) => line.startsWith('onderwerp;'));
  const rows: string[][] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (line === '') break;
    if (line.includes('"')) {
      throw new Error('dataRowFields cannot parse quoted fields — assert on raw content instead');
    }
    rows.push(line.split(';'));
  }
  return rows;
}

describe('buildAnswerCsv', () => {
  it('pins the complete file for a single definitive cell', () => {
    const { filename, content } = buildAnswerCsv(
      fakeAnswerResponse({ shape: 'single', cells: [fakeCell()] }),
    );
    expect(filename).toBe('checkdecijfers-86141NED-2024JJ00.csv');
    expect(content).toBe(
      BOM +
        '"Bron: CBS StatLine, tabel 86141NED — Consumentenprijzen; prijsindex 2015=100. ' +
        'Gegevens gesynchroniseerd op 2026-07-03. Periode: 2024. Licentie: CC BY 4.0."\r\n' +
        'Bestand aangemaakt door checkdecijfers.nl\r\n' +
        '\r\n' +
        'onderwerp;regio;regiocode;periode;periodecode;waarde;eenheid;status;bijzonderheid;cel-id\r\n' +
        'Inflatie (CPI);;;2024;2024JJ00;3,3;%;Definitief;;86141NED:CPI000000:NL01:2024JJ00\r\n',
    );
  });

  it('starts with the UTF-8 BOM and uses CRLF endings only', () => {
    const { content } = buildAnswerCsv(fakeAnswerResponse({ cells: [fakeCell()] }));
    expect(content.startsWith(BOM)).toBe(true);
    expect(content.endsWith('\r\n')).toBe(true);
    for (const line of content.split('\r\n')) {
      expect(line).not.toContain('\n');
      expect(line).not.toContain('\r');
    }
  });

  it('serializes values ungrouped with a decimal comma — never formatValueNl grouping', () => {
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [
          fakeCell({ resultId: 'A', value: 18044027, decimals: 0, unit: 'aantal' }),
          fakeCell({ resultId: 'B', value: 8204, decimals: 0, unit: 'x 1 000' }),
          fakeCell({ resultId: 'C', value: -0.4, decimals: 1 }),
          fakeCell({ resultId: 'D', value: 2, decimals: 1 }),
        ],
      }),
    );
    const waarde = dataRowFields(content).map((fields) => fields[5]);
    expect(waarde).toEqual(['18044027', '8204', '-0,4', '2,0']);
    // The grouped display form must NOT appear anywhere in the file.
    expect(content).not.toContain('18.044.027');
    // The factor unit rides verbatim in its own column (R10).
    expect(dataRowFields(content)[1]![6]).toBe('x 1 000');
  });

  it('round-trips every emitted waarde to exactly the stored value (R1/R3)', () => {
    const cells = [
      fakeCell({ resultId: 'A', value: 18044027, decimals: 0 }),
      fakeCell({ resultId: 'B', value: 3.3, decimals: 1 }),
      fakeCell({ resultId: 'C', value: 57.6, decimals: 1, unit: '1 000 euro' }),
      fakeCell({ resultId: 'D', value: -0.4, decimals: 1 }),
      fakeCell({ resultId: 'E', value: 2, decimals: 1 }),
      fakeCell({ resultId: 'F', value: 104.85, decimals: 2 }),
    ];
    const { content } = buildAnswerCsv(fakeAnswerResponse({ cells }));
    const rows = dataRowFields(content);
    expect(rows).toHaveLength(cells.length);
    rows.forEach((fields, i) => {
      expect(Number(fields[5]!.replace(',', '.'))).toBe(cells[i]!.value);
    });
  });

  it('keeps a null cell honest: empty waarde plus its CBS reason (R11)', () => {
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [
          fakeCell({ resultId: 'A', periodCode: '2025MM12', periodLabel: '2025 december' }),
          fakeCell({
            resultId: 'B',
            periodCode: '2026MM01',
            periodLabel: '2026 januari',
            value: null,
            valueAttribute: 'NietBeschikbaar',
            status: 'Voorlopig',
            provisional: true,
          }),
        ],
      }),
    );
    const rows = dataRowFields(content);
    expect(rows[1]![5]).toBe('');
    expect(rows[1]![8]).toBe('NietBeschikbaar');
    expect(rows[1]![7]).toBe('Voorlopig');
    expect(rows[0]![7]).toBe('Definitief');
    expect(rows[0]![8]).toBe('');
  });

  it('renders per-cell status so provisional figures are visible per row (R11)', () => {
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [fakeCell(), fakeCell({ resultId: 'X', status: 'Voorlopig', provisional: true })],
      }),
    );
    const statuses = dataRowFields(content).map((fields) => fields[7]);
    expect(statuses).toEqual(['Definitief', 'Voorlopig']);
  });

  it('adds one sorted column per semantic dimension with its Dutch label', () => {
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [
          fakeCell({
            dims: { SeizoensCorrectie: 'A', Geslacht: '3000' },
            dimLabels: { SeizoensCorrectie: 'Seizoengecorrigeerd', Geslacht: 'Mannen' },
          }),
        ],
      }),
    );
    expect(content).toContain(
      'onderwerp;regio;regiocode;periode;periodecode;Geslacht;SeizoensCorrectie;waarde;eenheid;status;bijzonderheid;cel-id',
    );
    expect(dataRowFields(content)[0]!.slice(5, 7)).toEqual(['Mannen', 'Seizoengecorrigeerd']);
  });

  it('exports an explicit difference with the marking, body precision and source ids (R5)', () => {
    const cells = [
      fakeCell({
        resultId: 'P19',
        measureTitle: 'Bevolking',
        regionLabel: 'Nederland',
        regionCode: 'NL01',
        periodCode: '2019JJ00',
        periodLabel: '2019',
        value: 17282163,
        decimals: 0,
        unit: 'aantal',
      }),
      fakeCell({
        resultId: 'P24',
        measureTitle: 'Bevolking',
        regionLabel: 'Nederland',
        regionCode: 'NL01',
        periodCode: '2024JJ00',
        periodLabel: '2024',
        value: 17942942,
        decimals: 0,
        unit: 'aantal',
      }),
    ];
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        shape: 'derived',
        cells,
        derivations: [fakeDifference()],
        attribution: { coveredPeriods: { from: '2019JJ00', to: '2024JJ00' } },
      }),
    );
    expect(content).toContain(`Bewerking: ${DERIVED_DATA_MARKING}\r\n`);
    expect(content).toContain(
      `Afgeleide waarden (${DERIVED_DATA_MARKING})\r\n` +
        'afleiding;waarde;eenheid;bron-cellen\r\n' +
        'verschil (laatste min eerste periode);660779;aantal;P19, P24\r\n',
    );
  });

  it('serializes a float-noise derived value at the body precision, not raw', () => {
    const cells = [
      fakeCell({ resultId: 'E', periodCode: '2023JJ00', periodLabel: '2023', value: 3.3 }),
      fakeCell({ resultId: 'L', periodCode: '2024JJ00', periodLabel: '2024', value: 3.6 }),
    ];
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells,
        derivations: [
          fakeDifference({
            sourceResultIds: ['E', 'L'],
            unit: '%',
            value: 3.6 - 3.3, // 0.30000000000000004 — the float-noise case
            minuendResultId: 'L',
            subtrahendResultId: 'E',
          }),
        ],
      }),
    );
    expect(content).toContain('verschil (laatste min eerste periode);0,3;%;E, L');
    expect(content).not.toContain('0,30000000000000004');
  });

  it('never exports the implicit binding derivations — a plain series file is unmodified CBS data', () => {
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [fakeCell(), fakeCell({ resultId: 'X', periodCode: '2025JJ00', periodLabel: '2025', value: 3.6 })],
        derivations: [
          {
            kind: 'direction',
            explicit: false,
            sourceResultIds: ['86141NED:CPI000000:NL01:2024JJ00', 'X'],
            unit: '%',
            marking: DERIVED_DATA_MARKING,
            direction: 'up',
            monotonic: true,
            netChange: 0.3,
            firstResultId: '86141NED:CPI000000:NL01:2024JJ00',
            lastResultId: 'X',
          } satisfies DerivationRecord,
        ],
      }),
    );
    expect(content).not.toContain('Afgeleide waarden');
    expect(content).not.toContain('bewerking');
  });

  it('quotes fields containing the separator or quotes, RFC 4180 style', () => {
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [fakeCell({ measureTitle: 'Omzet; "detailhandel"' })],
      }),
    );
    expect(content).toContain('"Omzet; ""detailhandel""";;;2024;2024JJ00');
  });

  it('includes definition, period semantics and the staleness warning verbatim when present', () => {
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [fakeCell()],
        attribution: {
          definitionLabel: 'werkloosheidspercentage, seizoengecorrigeerd',
          periodSemantics: 'jaargemiddelde',
        },
        stalenessWarning: 'Let op: deze tabel wordt normaal maandelijks bijgewerkt door CBS.',
      }),
    );
    const lines = content.replace(BOM, '').split('\r\n');
    expect(lines[1]).toBe('Definitie: werkloosheidspercentage, seizoengecorrigeerd');
    expect(lines[2]).toBe('Periodebetekenis: jaargemiddelde');
    expect(lines[3]).toBe('Let op: deze tabel wordt normaal maandelijks bijgewerkt door CBS.');
    expect(lines[4]).toBe('Bestand aangemaakt door checkdecijfers.nl');
  });

  it('omits the optional preamble rows when absent', () => {
    const { content } = buildAnswerCsv(fakeAnswerResponse({ cells: [fakeCell()] }));
    expect(content).not.toContain('Definitie:');
    expect(content).not.toContain('Periodebetekenis:');
    expect(content).not.toContain('Let op:');
  });

  it('names a multi-period file by its covered range', () => {
    const { filename } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [fakeCell()],
        attribution: { coveredPeriods: { from: '2022MM01', to: '2022MM12' } },
      }),
    );
    expect(filename).toBe('checkdecijfers-86141NED-2022MM01-2022MM12.csv');
  });

  // ---- Adversarial-review round (2026-07-05): every test below closes a
  // hole a mutation provably walked through green. ----

  it('serializes a value the toFixed pad would ROUND exactly instead (the round-trip guard firing)', () => {
    // (3.35).toFixed(1) === '3.4' — a padded form would change the value, so
    // the guard must emit the exact stored value (review: the guard's own
    // trigger case had zero coverage).
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({ cells: [fakeCell({ value: 3.35, decimals: 1 })] }),
    );
    const waarde = dataRowFields(content)[0]![5];
    expect(waarde).toBe('3,35');
    expect(content).not.toContain('3,4');
  });

  it('never exports a REAL implicit max (run.ts registers one on every comparison answer)', () => {
    // Review finding: dropping the `explicit` filter survived green because
    // the only implicit fixture was kind 'direction' (already kind-filtered).
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [
          fakeCell({ resultId: 'AMS', regionLabel: 'Amsterdam', regionCode: 'GM0363', value: 931298, decimals: 0, unit: 'aantal' }),
          fakeCell({ resultId: 'RTD', regionLabel: 'Rotterdam', regionCode: 'GM0599', value: 664311, decimals: 0, unit: 'aantal' }),
        ],
        derivations: [
          {
            kind: 'max',
            explicit: false,
            sourceResultIds: ['AMS', 'RTD'],
            unit: 'aantal',
            marking: DERIVED_DATA_MARKING,
            value: 931298,
            winnerResultId: 'AMS',
            rankingResultIds: ['AMS', 'RTD'],
          } satisfies DerivationRecord,
        ],
      }),
    );
    expect(content).not.toContain('Afgeleide waarden');
    expect(content).not.toContain('bewerking');
  });

  it('exports an EXPLICIT max with its own Dutch label and the winner precision', () => {
    // Review finding: no max fixture existed — an inverted label ('laagste')
    // shipped green.
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [
          fakeCell({ resultId: 'AMS', regionLabel: 'Amsterdam', regionCode: 'GM0363', value: 931298, decimals: 0, unit: 'aantal' }),
          fakeCell({ resultId: 'RTD', regionLabel: 'Rotterdam', regionCode: 'GM0599', value: 664311, decimals: 0, unit: 'aantal' }),
        ],
        derivations: [
          {
            kind: 'max',
            explicit: true,
            sourceResultIds: ['AMS', 'RTD'],
            unit: 'aantal',
            marking: DERIVED_DATA_MARKING,
            value: 931298,
            winnerResultId: 'AMS',
            rankingResultIds: ['AMS', 'RTD'],
          } satisfies DerivationRecord,
        ],
      }),
    );
    expect(content).toContain(
      `Afgeleide waarden (${DERIVED_DATA_MARKING})\r\n` +
        'afleiding;waarde;eenheid;bron-cellen\r\n' +
        'hoogste waarde;931298;aantal;AMS, RTD\r\n',
    );
  });

  it('binds a difference to the MINUEND cell precision when the two cells differ (the body convention)', () => {
    // Review finding: all difference fixtures shared one decimals value, so
    // swapping minuend for subtrahend was unobservable.
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [
          fakeCell({ resultId: 'E0', periodCode: '2019JJ00', periodLabel: '2019', value: 100, decimals: 0 }),
          fakeCell({ resultId: 'L1', periodCode: '2024JJ00', periodLabel: '2024', value: 103.5, decimals: 1 }),
        ],
        derivations: [
          fakeDifference({ sourceResultIds: ['E0', 'L1'], value: 3.5, minuendResultId: 'L1', subtrahendResultId: 'E0', unit: '%' }),
        ],
      }),
    );
    // Minuend L1 has decimals 1 → '3,5'; the subtrahend's 0 would give '4'.
    expect(content).toContain('verschil (laatste min eerste periode);3,5;%;E0, L1');
    expect(content).not.toContain(';4;%');
  });

  it('falls back over the OTHER source cells for precision when the reference cell is absent (defense-in-depth)', () => {
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [fakeCell({ resultId: 'ONLY', value: 3.3, decimals: 1 })],
        derivations: [
          fakeDifference({ sourceResultIds: ['GHOST', 'ONLY'], value: 3.6 - 3.3, minuendResultId: 'GHOST', subtrahendResultId: 'ONLY', unit: '%' }),
        ],
      }),
    );
    expect(content).toContain('verschil (laatste min eerste periode);0,3;%;GHOST, ONLY');
  });

  it('emits the exact raw value when NO source cell exists — truth over beauty, never an unregistered rounding', () => {
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [fakeCell()],
        derivations: [
          fakeDifference({ sourceResultIds: ['G1', 'G2'], value: 3.6 - 3.3, minuendResultId: 'G2', subtrahendResultId: 'G1', unit: '%' }),
        ],
      }),
    );
    expect(content).toContain(`verschil (laatste min eerste periode);${String(3.6 - 3.3).replace('.', ',')};%;G1, G2`);
  });

  it('pins the empty-result shape: header row, zero data rows, no derivation section', () => {
    const { content } = buildAnswerCsv(fakeAnswerResponse({ cells: [] }));
    expect(content).toContain(
      'onderwerp;regio;regiocode;periode;periodecode;waarde;eenheid;status;bijzonderheid;cel-id\r\n',
    );
    expect(dataRowFields(content)).toEqual([]);
    expect(content).not.toContain('Afgeleide waarden');
  });

  it('reuses the one shared attribution builder verbatim (R4)', () => {
    // Different attribution fields must flow through into the Bron row —
    // binding, not a constant.
    const { content } = buildAnswerCsv(
      fakeAnswerResponse({
        cells: [fakeCell({ tableId: '82931NED', periodCode: '2023JJ00', periodLabel: '2023' })],
        tableId: '82931NED',
        syncedAt: '2026-01-15T09:00:00.000Z',
        attribution: {
          tableTitle: 'Arbeidsdeelname',
          coveredPeriods: { from: '2023JJ00', to: '2023JJ00' },
        },
      }),
    );
    expect(content).toContain(
      'Bron: CBS StatLine, tabel 82931NED — Arbeidsdeelname. ' +
        'Gegevens gesynchroniseerd op 2026-01-15. Periode: 2023. Licentie: CC BY 4.0.',
    );
  });
});
