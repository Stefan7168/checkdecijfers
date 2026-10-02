// Session 153 (#357 step 5): wording found by the first end-to-end Eurostat
// table-lane benchmark run — a Eurostat table was called a "CBS-tabel", the
// count unit 'Number' was printed after every count (and then flagged by R10),
// and a base year in a unit label ("(2020)") was read as a multiplication factor.
// CBS wording is pinned unchanged next to each.
import { describe, expect, it } from 'vitest';
import { displayValueUnit } from '../../src/answer/compose/template.ts';
import { validateAnswerBody } from '../../src/answer/compose/validate.ts';
import { buildTableLaneRefusal } from '../../src/answer/table-lane/templates.ts';
import type { ValidatedResult } from '../../src/query/index.ts';

describe('units', () => {
  it("Eurostat 'Number' is a bare count, like CBS 'aantal'", () => {
    expect(displayValueUnit(1893, 0, 'Number')).toBe('1.893');
    expect(displayValueUnit(1893, 0, 'aantal')).toBe('1.893');
  });

  it('a base year in parentheses is not a factor; a CBS factor unit still is', () => {
    expect(displayValueUnit(89300, 0, 'Chain linked volumes (2020), euro per capita')).toBe(
      '89.300 (Chain linked volumes (2020), euro per capita)',
    );
    expect(displayValueUnit(9188, 0, 'x 1 000')).toBe('9.188 (x 1 000)');
    expect(displayValueUnit(12, 0, '1 000 euro')).toBe('12 (× 1 000 euro)');
  });

  it("R10 accepts a count without the word 'Number'", () => {
    const cell = {
      resultId: 'r1', tableId: 'eurostat:tran_sf_roadus', measure: 'tran_sf_roadus|NR', measureTitle: 'Persons killed — Number',
      regionCode: 'PL', regionLabel: 'Polen', periodCode: '2023JJ00', periodLabel: '2023', grain: 'JJ', dims: {}, dimLabels: {},
      value: 1893, unit: 'Number', decimals: 0, provisional: false, valueAttribute: null, status: 'Published',
    };
    const result = {
      ok: true, shape: 'single', cells: [cell], derivations: [], intent: {},
      attribution: { tableId: cell.tableId, tableTitle: 't', definitionLabel: null, periodSemantics: null, coveredPeriods: { from: '2023JJ00', to: '2023JJ00' } },
    } as unknown as ValidatedResult;
    expect(validateAnswerBody('In 2023 kwamen in Polen 1.893 mensen om in het verkeer.', result).ok).toBe(true);
  });
});

describe('table-lane refusals name the source', () => {
  const ctx = (tableId: string) => ({ tableId, tableTitle: 'Een tabel', detail: '' });
  it('a Eurostat dataset is a "Eurostat-tabel"; a CBS table stays a "CBS-tabel"', () => {
    expect(buildTableLaneRefusal('region_unknown', ctx('eurostat:tran_sf_roadus')).text).toContain('Eurostat-tabel "Een tabel"');
    expect(buildTableLaneRefusal('region_unknown', ctx('85245NED')).text).toContain('CBS-tabel "Een tabel"');
    expect(buildTableLaneRefusal('cbs_unreachable', ctx('eurostat:tran_sf_roadus')).text).toMatch(/^Eurostat is op dit moment/);
  });
});

describe('the derived-data marking names the source (session 153)', () => {
  it('Eurostat says Eurostat; CBS keeps the exact constant every stored row was built with (R8)', async () => {
    const { derivedDataMarking, DERIVED_DATA_MARKING } = await import('../../src/query/types.ts');
    expect(derivedDataMarking('85245NED')).toBe(DERIVED_DATA_MARKING);
    expect(derivedDataMarking('eurostat:tran_sf_roadus')).toBe('bewerking van Eurostat-gegevens door graphmaker.studio');
  });
});
