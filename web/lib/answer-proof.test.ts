// buildAnswerProof (session 72 design brief, docs/session-briefs/
// 2026-09-03-source-drill-through-design.md; #70/#79/#89/#90-deep): the
// three-depth "Bewijs dit cijfer" panel data. Pins the deterministic Dutch
// templates §4 of the brief specifies, and — the load-bearing test — that
// every numeric token this module ever prints is a formatted STORED value
// (a cell's own `value`, a derivation's own `value`/`netChange`/`factor`) or
// a verbatim metadata field, never a value this module computed itself
// (R1/R3, docs/05-data-rules.md).
import { describe, expect, it } from 'vitest';
import {
  findNumericTokens,
  maskPhrases,
  normalizeForScan,
  numbersInText,
  unitMaskPhrases,
} from '../backend/answer/compose/format.ts';
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import type { DerivationRecord } from '../backend/query/types.ts';
import { DERIVED_DATA_MARKING } from '../backend/query/types.ts';
import type { ValidatedResult } from '../backend/query/types.ts';
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';
import { buildAnswerProof } from './answer-proof.ts';

describe('buildAnswerProof', () => {
  /** The two-point series the direction / first_last cases share — one
   * definition, so a fixture tweak cannot drift between the canaries. */
  function seriesEndpoints() {
    return {
      first: fakeCell({ resultId: 'F', periodCode: '2020JJ00', periodLabel: '2020', value: 3.0, decimals: 1 }),
      last: fakeCell({ resultId: 'La', periodCode: '2024JJ00', periodLabel: '2024', value: 3.9, decimals: 1 }),
    };
  }

  it('(1) single cell, no derivations: reads the one cell, no computation applied, not marked', () => {
    const response = fakeAnswerResponse({
      shape: 'single',
      cells: [fakeCell()],
      attribution: { periodSemantics: 'jaargemiddelde' },
    });
    const proof = buildAnswerProof(response)!;

    expect(proof.cells).toHaveLength(1);
    expect(proof.cells[0]!.valueText).toBe('3,3%');
    expect(proof.steps).toEqual([
      {
        text: 'Gelezen: 1 cel uit tabel 86141NED: Inflatie (CPI), 2024 → 3,3%.',
        technical: ' [cel-id 86141NED:CPI000000:NL01:2024JJ00]',
      },
      { text: 'Geen bewerking toegepast: het antwoord is de waarde uit de cel.', technical: null },
    ]);
    expect(proof.marked).toBe(false);
    expect(proof.nullNotice).toBeNull();
    // Raw passthrough fields (the component prefixes them at render time).
    expect(proof.periodSemantics).toBe('jaargemiddelde');
    expect(proof.tableId).toBe('86141NED');
    expect(proof.tableTitle).toBe('Consumentenprijzen; prijsindex 2015=100');
    expect(proof.tableVersion).toBe(1);
    expect(proof.syncedAt).toBe('2026-07-03');
    expect(proof.license).toBe('CC BY 4.0');
    // WP30a present-only convention: no source on the fixture's default
    // attribution ⇒ no `source` key on the proof at all.
    expect('source' in proof).toBe(false);
  });

  it('(1b) a regioned cell reads with its region named before the period', () => {
    const cell = fakeCell({ regionLabel: 'Amsterdam', regionCode: 'GM0363' });
    const proof = buildAnswerProof(fakeAnswerResponse({ shape: 'single', cells: [cell] }))!;
    expect(proof.steps[0]!.text).toBe(
      'Gelezen: 1 cel uit tabel 86141NED: Inflatie (CPI), Amsterdam, 2024 → 3,3%.',
    );
  });

  it('(2) an explicit difference: signed text from the STORED derivation value, procentpunt for %, marked', () => {
    const earlier = fakeCell({ resultId: 'E', periodCode: '2023JJ00', periodLabel: '2023', value: 3.3, decimals: 1 });
    const later = fakeCell({ resultId: 'L', periodCode: '2024JJ00', periodLabel: '2024', value: 3.6, decimals: 1 });
    const difference: DerivationRecord = {
      kind: 'difference',
      explicit: true,
      sourceResultIds: ['E', 'L'],
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      // Deliberately NOT later.value - earlier.value (which would be +0,3):
      // proves the sign and magnitude come from the STORED field, never a
      // recomputation over the cells.
      value: -0.3,
      minuendResultId: 'L',
      subtrahendResultId: 'E',
    };
    const response = fakeAnswerResponse({
      shape: 'derived',
      cells: [earlier, later],
      derivations: [difference],
    });
    const proof = buildAnswerProof(response)!;

    const step = proof.steps.find((s) => s.text.startsWith('Verschil berekend'));
    expect(step).toEqual({
      text: 'Verschil berekend: 2024 (3,6%) min 2023 (3,3%) = -0,3 procentpunt.',
      technical: ' [cel-id E, L]',
    });
    expect(proof.marked).toBe(true);
  });

  it('(3) comparison + max: names the winner and lists Volgorde in rankingResultIds order (not cell array order)', () => {
    const ams = fakeCell({ resultId: 'AMS', regionLabel: 'Amsterdam', regionCode: 'GM0363', value: 900000, decimals: 0, unit: 'aantal' });
    const rtd = fakeCell({ resultId: 'RTD', regionLabel: 'Rotterdam', regionCode: 'GM0599', value: 650000, decimals: 0, unit: 'aantal' });
    const utr = fakeCell({ resultId: 'UTR', regionLabel: 'Utrecht', regionCode: 'GM0344', value: 350000, decimals: 0, unit: 'aantal' });
    const max: DerivationRecord = {
      kind: 'max',
      explicit: true,
      sourceResultIds: ['AMS', 'RTD', 'UTR'],
      unit: 'aantal',
      marking: DERIVED_DATA_MARKING,
      value: 900000,
      winnerResultId: 'AMS',
      rankingResultIds: ['AMS', 'RTD', 'UTR'],
    };
    // Cell array order deliberately does NOT match rankingResultIds order.
    const response = fakeAnswerResponse({
      shape: 'comparison',
      cells: [utr, ams, rtd],
      derivations: [max],
    });
    const proof = buildAnswerProof(response)!;

    const step = proof.steps.find((s) => s.text.startsWith('Hoogste waarde bepaald'));
    expect(step).toEqual({
      text: 'Hoogste waarde bepaald: Amsterdam (900.000). Volgorde: Amsterdam (900.000); Rotterdam (650.000); Utrecht (350.000).',
      technical: ' [cel-id AMS, RTD, UTR]',
    });
    expect(proof.marked).toBe(true);
  });

  it('(4) series + direction: the Dutch word matches `direction`, non-monotonic sentence only when monotonic is false, first_last renders nothing', () => {
    const { first, last } = seriesEndpoints();
    const direction: DerivationRecord = {
      kind: 'direction',
      explicit: false,
      sourceResultIds: ['F', 'La'],
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      direction: 'up',
      monotonic: true,
      // Deliberately NOT last.value - first.value (0.9): the printed net change
      // must be the STORED field — the same canary tests (2) and (5) set for
      // difference and unit_expansion (review round 2: this fixture used to
      // coincide with a recomputation, so it could not tell the two apart).
      netChange: 1.2,
      firstResultId: 'F',
      lastResultId: 'La',
    };
    const firstLast: DerivationRecord = {
      kind: 'first_last',
      explicit: false,
      sourceResultIds: ['F', 'La'],
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      firstResultId: 'F',
      lastResultId: 'La',
    };
    const response = fakeAnswerResponse({
      shape: 'series',
      cells: [first, last],
      derivations: [direction, firstLast],
    });
    const proof = buildAnswerProof(response)!;

    // Exactly the read step + the direction step — first_last (D9) is skipped.
    expect(proof.steps).toHaveLength(2);
    expect(proof.steps[1]).toEqual({
      text: 'Richting van de reeks: gestegen van 2020 tot en met 2024; netto 1,2 procentpunt.',
      technical: ' [cel-id F, La]',
    });

    const nonMonotonic = buildAnswerProof(
      fakeAnswerResponse({
        shape: 'series',
        cells: [first, last],
        derivations: [{ ...direction, direction: 'down', monotonic: false, netChange: -1.2 } satisfies DerivationRecord],
      }),
    )!;
    expect(nonMonotonic.steps[1]!.text).toBe(
      'Richting van de reeks: gedaald van 2020 tot en met 2024; netto -1,2 procentpunt.' +
        ' De reeks ging niet in elke stap dezelfde kant op.',
    );
  });

  it('(5) unit_expansion: the expanded figure is the STORED derivation value, never a live multiplication', () => {
    const cell = fakeCell({ resultId: 'B', value: 8204, decimals: 0, unit: 'x 1 000', periodLabel: '2024' });
    const expansion: DerivationRecord = {
      kind: 'unit_expansion',
      explicit: false,
      sourceResultIds: ['B'],
      unit: 'aantal',
      marking: DERIVED_DATA_MARKING,
      factor: 1000,
      // Deliberately NOT 8204 * 1000 (= 8 204 000): proves the printed
      // figure is derivation.value verbatim, never a computed product.
      value: 8204500,
    };
    const response = fakeAnswerResponse({ shape: 'derived', cells: [cell], derivations: [expansion] });
    const proof = buildAnswerProof(response)!;

    const step = proof.steps.find((s) => s.text.startsWith('Uitgerekend'));
    expect(step).toEqual({
      text: 'Uitgerekend: 8.204 (x 1 000) = 8.204.500.',
      technical: ' [cel-id B]',
    });
  });

  it('(6) a null cell states its CBS reason, never a bare gap, and the panel carries a null notice', () => {
    const cell = fakeCell({ resultId: 'N', value: null, valueAttribute: 'Confidential', status: 'Voorlopig' });
    const proof = buildAnswerProof(fakeAnswerResponse({ shape: 'single', cells: [cell] }))!;

    expect(proof.cells[0]!.valueText).toBe('geen waarde — door CBS niet gepubliceerd (vertrouwelijk)');
    expect(proof.steps[0]!.text).toBe(
      'Gelezen: 1 cel uit tabel 86141NED: Inflatie (CPI), 2024 → geen waarde — door CBS niet gepubliceerd (vertrouwelijk).',
    );
    expect(proof.nullNotice).toBe('1 van de 1 cellen heeft geen waarde; de reden van CBS staat per cel in de tabel.');
  });

  it('(7) a provisional cell carries the suffix on valueText and the verbatim CBS status', () => {
    const cell = fakeCell({ status: 'Voorlopig', provisional: true });
    const proof = buildAnswerProof(fakeAnswerResponse({ shape: 'single', cells: [cell] }))!;
    expect(proof.cells[0]!.valueText).toBe('3,3% (voorlopig cijfer)');
    expect(proof.cells[0]!.status).toBe('Voorlopig');
    expect(proof.cells[0]!.provisional).toBe(true);
  });

  it('(8) alternates: the registry cross-reference is stripped from the label and moved into technical; absent alternates render no entry and no "geen andere lezing" claim', () => {
    const withAlternates = buildAnswerProof(
      fakeAnswerResponse({
        shape: 'single',
        cells: [fakeCell()],
        attribution: {
          alternates: [
            { measure: 'M_ALT', label: 'bruto binnenlands product (eigen key: gdp_growth_yoy_volume)' },
            { dims: { SeizoensCorrectie: 'NG' }, label: 'niet-seizoengecorrigeerd' },
          ],
        },
      }),
    )!;
    expect(withAlternates.alternates).toEqual([
      { label: 'bruto binnenlands product', technical: ' — meetcode M_ALT' },
      { label: 'niet-seizoengecorrigeerd', technical: ' — SeizoensCorrectie=NG' },
    ]);
    // Neither the stripped registry notation nor the code leaks into `label`.
    expect(withAlternates.alternates[0]!.label).not.toContain('key');
    expect(withAlternates.alternates[0]!.label).not.toContain('gdp_growth_yoy_volume');

    const withoutAlternates = buildAnswerProof(fakeAnswerResponse({ shape: 'single', cells: [fakeCell()] }))!;
    expect(withoutAlternates.alternates).toEqual([]);
    const everyString = JSON.stringify(withoutAlternates);
    expect(everyString).not.toContain('andere lezing');
    expect(everyString).not.toContain('geen andere');
  });

  it('(9) a null definitionLabel falls back to the first cell\'s measureTitle', () => {
    const proof = buildAnswerProof(
      fakeAnswerResponse({
        shape: 'single',
        cells: [fakeCell({ measureTitle: 'Bevolkingsgroei' })],
        attribution: { definitionLabel: null },
      }),
    )!;
    expect(proof.reading).toBe('Bevolkingsgroei');
  });

  it('(10) an envelope without a real `result` (e.g. a redacted row) returns null, never throws', () => {
    const minimal = { schemaVersion: 1, kind: 'answer', question: 'q', text: 't', redacted: true } as unknown as AnswerResponse;
    expect(() => buildAnswerProof(minimal)).not.toThrow();
    expect(buildAnswerProof(minimal)).toBeNull();

    const noCells = fakeAnswerResponse({ shape: 'single', cells: [fakeCell()] });
    // @ts-expect-error deliberately malformed at runtime — the belt this
    // guard exists for (a stored envelope whose shape drifted from the type).
    noCells.result.cells = 'not-an-array';
    expect(buildAnswerProof(noCells)).toBeNull();
  });

  it('(orchestrator review round 1) a derivation referencing a resultId absent from `cells` degrades to null, never throws', () => {
    // A malformed/stale stored row: `derivationStep` resolves cells via
    // `cellsById.get(id)!` (the template.ts `byId` idiom) — a resultId with
    // no matching cell throws when a field is read off the `undefined`
    // result. replay-assemble.ts runs buildAnswerProof over EVERY stored
    // row, so this must degrade to a missing proof panel, never crash the
    // whole resumed thread's render.
    const cell = fakeCell();
    const danglingDifference: DerivationRecord = {
      kind: 'difference',
      explicit: true,
      sourceResultIds: ['GHOST', cell.resultId],
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      value: 0.3,
      minuendResultId: 'GHOST', // not among `cells`
      subtrahendResultId: cell.resultId,
    };
    const response = fakeAnswerResponse({
      shape: 'derived',
      cells: [cell],
      derivations: [danglingDifference],
    });
    expect(() => buildAnswerProof(response)).not.toThrow();
    expect(buildAnswerProof(response)).toBeNull();
  });

  // ---------------------------------------------------------------------
  // (11) R1 scan: every numeric token this module prints, across a rich
  // fixture exercising every derivation kind at once, is either a formatted
  // stored cell/derivation value or a verbatim metadata field (a period
  // code, a table id, a region code, a measure code, a count of cells).
  // Mirrors validate.ts's own scanBody discipline (findNumericTokens after
  // maskPhrases(unitMaskPhrases(unit))), adapted to this deterministic (not
  // LLM) surface — the belt against a future edit sneaking in live
  // arithmetic instead of reading a stored field.
  // ---------------------------------------------------------------------
  it('(11) R1 scan: every numeric token traces to a stored value or verbatim metadata', () => {
    const earlier = fakeCell({ resultId: 'E', periodCode: '2023JJ00', periodLabel: '2023', value: 3.3, decimals: 1, regionCode: 'NL01' });
    const later = fakeCell({ resultId: 'L', periodCode: '2024JJ00', periodLabel: '2024', value: 3.6, decimals: 1, regionCode: 'NL01' });
    const nullCell = fakeCell({
      resultId: 'N',
      periodCode: '2025JJ00',
      periodLabel: '2025',
      value: null,
      valueAttribute: 'NotAvailable',
      status: 'Voorlopig',
      provisional: true,
    });
    const expansionCell = fakeCell({ resultId: 'B', periodCode: '2022JJ00', periodLabel: '2022', value: 8204, decimals: 0, unit: 'x 1 000' });
    const cells = [earlier, later, nullCell, expansionCell];

    const difference: DerivationRecord = {
      kind: 'difference', explicit: true, sourceResultIds: ['E', 'L'], unit: '%',
      marking: DERIVED_DATA_MARKING, value: -0.3, minuendResultId: 'L', subtrahendResultId: 'E',
    };
    const direction: DerivationRecord = {
      kind: 'direction', explicit: false, sourceResultIds: ['E', 'L'], unit: '%',
      // Deliberately NOT later.value - earlier.value (0.3) — see test (4).
      marking: DERIVED_DATA_MARKING, direction: 'up', monotonic: false, netChange: 0.5,
      firstResultId: 'E', lastResultId: 'L',
    };
    const expansion: DerivationRecord = {
      kind: 'unit_expansion', explicit: false, sourceResultIds: ['B'], unit: 'aantal',
      marking: DERIVED_DATA_MARKING, factor: 1000, value: 8204500,
    };

    const response = fakeAnswerResponse({
      shape: 'derived',
      cells,
      derivations: [difference, direction, expansion],
      attribution: {
        alternates: [{ measure: 'M_ALT', label: 'alternatieve meting' }],
        periodSemantics: 'jaargemiddelde',
      },
    });
    const result = response.result as unknown as ValidatedResult;
    const proof = buildAnswerProof(response)!;

    // The set of numbers this module is ALLOWED to print: every stored cell
    // value, every derivation's own numeric field, and every number that
    // occurs verbatim in metadata (table id, table version, period/region/
    // measure codes, counts of cells).
    const allowed = new Set<number>();
    for (const cell of result.cells) {
      if (cell.value !== null) allowed.add(cell.value);
      for (const n of numbersInText(cell.resultId)) allowed.add(n);
      for (const n of numbersInText(cell.periodLabel)) allowed.add(n);
      for (const n of numbersInText(cell.regionLabel)) allowed.add(n);
      for (const n of numbersInText(cell.measureTitle)) allowed.add(n);
    }
    for (const derivation of result.derivations) {
      if (derivation.kind === 'difference' || derivation.kind === 'max') allowed.add(derivation.value);
      if (derivation.kind === 'direction') allowed.add(derivation.netChange);
      if (derivation.kind === 'unit_expansion') {
        allowed.add(derivation.factor);
        allowed.add(derivation.value);
      }
    }
    for (const n of numbersInText(result.attribution.tableId)) allowed.add(n);
    for (const n of numbersInText(result.attribution.tableTitle)) allowed.add(n);
    allowed.add(result.attribution.tableVersion);
    allowed.add(result.cells.length);
    allowed.add(result.cells.filter((c) => c.value === null).length);

    const units = new Set<string>([...result.cells.map((c) => c.unit), ...result.derivations.map((d) => d.unit)]);
    const masks = [...units].flatMap(unitMaskPhrases);

    const strings: (string | null)[] = [
      proof.reading,
      proof.periodSemantics,
      ...proof.alternates.flatMap((a) => [a.label, a.technical]),
      ...proof.cells.map((c) => c.valueText),
      ...proof.steps.flatMap((s) => [s.text, s.technical]),
      proof.nullNotice,
    ];

    let scannedAtLeastOneToken = false;
    for (const text of strings) {
      if (text === null) continue;
      const masked = maskPhrases(normalizeForScan(text), masks);
      for (const token of findNumericTokens(masked)) {
        scannedAtLeastOneToken = true;
        expect(allowed.has(token.value)).toBe(true);
      }
    }
    // A scan that silently found nothing would pass vacuously — this fixture
    // is built specifically so every step contributes at least one token.
    expect(scannedAtLeastOneToken).toBe(true);
  });

  it('(12) review round 2: a multi-cell answer without a SHOWN derivation says so in the plural — a comparison, and a series whose only derivation is first_last', () => {
    const utr = fakeCell({ resultId: 'UTR', regionLabel: 'Utrecht', regionCode: 'GM0344', value: 350000, decimals: 0 });
    const ams = fakeCell({ resultId: 'AMS', regionLabel: 'Amsterdam', regionCode: 'GM0363', value: 900000, decimals: 0 });
    const comparison = buildAnswerProof(fakeAnswerResponse({ shape: 'comparison', cells: [utr, ams] }))!;
    expect(comparison.steps).toEqual([
      { text: 'Gelezen: 2 cellen uit tabel 86141NED (de tabel hierboven).', technical: ' [cel-id UTR, AMS]' },
      { text: 'Geen bewerking toegepast: het antwoord toont de gelezen waarden van deze cellen.', technical: null },
    ]);
    expect(comparison.marked).toBe(false);

    const { first, last } = seriesEndpoints();
    const firstLast: DerivationRecord = {
      kind: 'first_last',
      explicit: false,
      sourceResultIds: ['F', 'La'],
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      firstResultId: 'F',
      lastResultId: 'La',
    };
    // No live producer of this shape is known: run.ts registers direction and
    // first_last under the same gate (more than one requested period, every
    // value present) and refuses mixed units before either runs. The belt exists for
    // stored rows this build did not write — replay reads every historical
    // envelope. compose.ts's marking line and citation.ts mark ANY result
    // with a derivation record as derived (derivations.length > 0), so the
    // panel must not say "geen bewerking" and must stay marked (R5).
    const bindingOnly = 'Geen bewerking met een eigen uitkomst: het antwoord duidt de reeks als geheel (begin- en eindpunt) en toont de gelezen waarden van deze cellen.';
    const series = buildAnswerProof(fakeAnswerResponse({ shape: 'series', cells: [first, last], derivations: [firstLast] }))!;
    expect(series.steps).toHaveLength(2);
    expect(series.steps[1]).toEqual({ text: bindingOnly, technical: null });
    expect(series.marked).toBe(true);

    // **Assumption:** a stored row may carry first_last beside a null cell
    // (nothing in this build writes one — ADR 011 omits pre-registrations that
    // cannot be honest — and this clone's history cannot show whether an
    // older build did; mirrored in open-questions #79). Replay must survive
    // whatever was stored: the derived sentence AND the null notice, marked.
    const lastNull = fakeCell({ ...last, value: null, valueAttribute: 'NotAvailable' });
    const firstLastBesideNull = buildAnswerProof(fakeAnswerResponse({ shape: 'series', cells: [first, lastNull], derivations: [firstLast] }))!;
    expect(firstLastBesideNull.steps[1]).toEqual({ text: bindingOnly, technical: null });
    expect(firstLastBesideNull.nullNotice).toBe('1 van de 2 cellen heeft geen waarde; de reden van CBS staat per cel in de tabel.');
    expect(firstLastBesideNull.marked).toBe(true);
  });

  it('(13) review round 2: the two count-shaped numbers the R1 scan exempts are pinned as their exact sentences', () => {
    const a = fakeCell({ resultId: 'A', periodCode: '2022JJ00', periodLabel: '2022', value: 3.1, decimals: 1 });
    const b = fakeCell({ resultId: 'B', periodCode: '2023JJ00', periodLabel: '2023', value: 3.3, decimals: 1 });
    const n = fakeCell({ resultId: 'N', periodCode: '2024JJ00', periodLabel: '2024', value: null, valueAttribute: 'NotAvailable' });
    const proof = buildAnswerProof(fakeAnswerResponse({ shape: 'series', cells: [a, b, n] }))!;
    expect(proof.steps[0]).toEqual({
      text: 'Gelezen: 3 cellen uit tabel 86141NED (de tabel hierboven).',
      technical: ' [cel-id A, B, N]',
    });
    expect(proof.nullNotice).toBe('1 van de 3 cellen heeft geen waarde; de reden van CBS staat per cel in de tabel.');
  });

  it('(14) review round 2 belts: an unknown derivation kind, or a direction outside up/down/flat, yields the honest unknown step — never `undefined` in steps[], never a throw, never the word "undefined"', () => {
    const { first, last } = seriesEndpoints();
    const unknownKind = {
      kind: 'median', explicit: false, sourceResultIds: ['F', 'La'], unit: '%', marking: DERIVED_DATA_MARKING, value: 3.4,
    } as unknown as DerivationRecord;
    const odd = buildAnswerProof(fakeAnswerResponse({ shape: 'series', cells: [first, last], derivations: [unknownKind] }))!;
    expect(odd.steps).toHaveLength(2);
    expect(odd.steps[1]).toEqual({ text: 'Een bewerking van een onbekend type kon niet worden weergegeven.', technical: null });
    expect(odd.marked).toBe(true);

    // 'sideways' misses the table; 'constructor' HITS it through the prototype
    // chain (a function, not a word) — both must yield the honest step.
    for (const direction of ['sideways', 'constructor', '__proto__']) {
      const oddDirection = {
        kind: 'direction', explicit: false, sourceResultIds: ['F', 'La'], unit: '%', marking: DERIVED_DATA_MARKING,
        direction, monotonic: true, netChange: 0.9, firstResultId: 'F', lastResultId: 'La',
      } as unknown as DerivationRecord;
      const proof = buildAnswerProof(fakeAnswerResponse({ shape: 'series', cells: [first, last], derivations: [oddDirection] }))!;
      expect(proof.steps[1]).toEqual({ text: 'Een bewerking van een onbekend type kon niet worden weergegeven.', technical: null });
      for (const step of proof.steps) {
        expect(step.text).not.toContain('undefined');
        expect(step.text).not.toContain('function');
      }
    }
  });

  it('never throws on a maximally empty-but-array-shaped result', () => {
    const response = fakeAnswerResponse({ shape: 'single', cells: [] });
    expect(() => buildAnswerProof(response)).not.toThrow();
  });
});
