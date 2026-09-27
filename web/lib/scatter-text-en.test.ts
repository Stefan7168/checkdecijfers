// #296 part 2 Task 6: the English mirrors of src/chart/scatter-text.ts's
// Dutch builders. Hand-built ScatterSpec fixtures — pure functions of the
// spec, exactly like the Dutch suite (tests/chart/scatter-text.test.ts).
import { describe, expect, it } from 'vitest';
import type { ScatterAxis, ScatterLeftOut, ScatterPoint, ScatterSideStatus, ScatterSpec } from '../backend/chart/scatter.ts';
import { SCATTER_NAMED_LIMIT } from '../backend/chart/scatter-text.ts';
import { scatterAxisTitle, scatterBodyEn, scatterLineEn, scatterTitleEn } from './scatter-text-en.ts';

function axis(measureTitle: string, tableId: string, unit = 'euro', periodLabel = '2024'): ScatterAxis {
  return {
    measureTitle,
    unit,
    decimals: 0,
    periodLabel,
    tableId,
    defaultScale: 'linear',
    attributionLine: `Bron: CBS StatLine, tabel ${tableId}.`,
  };
}

function point(regionCode: string): ScatterPoint {
  return {
    regionCode,
    label: regionCode,
    x: 1,
    y: 1,
    xFormatted: '1',
    yFormatted: '1',
    xResultId: `X:${regionCode}`,
    yResultId: `Y:${regionCode}`,
    provisional: false,
  };
}

function points(n: number, prefix = 'P'): ScatterPoint[] {
  return Array.from({ length: n }, (_, i) => point(`${prefix}${i}`));
}

function side(state: ScatterSideStatus['state'], valueAttribute: string | null = null): ScatterSideStatus {
  return { state, valueAttribute };
}

function leftOutRegion(regionCode: string, label: string, y: ScatterSideStatus, x: ScatterSideStatus): ScatterLeftOut {
  return { regionCode, label, y, x };
}

function spec(overrides: Partial<ScatterSpec> = {}): ScatterSpec {
  return {
    schemaVersion: 1,
    kind: 'scatter',
    title: 'Gemiddeld inkomen tegenover bevolking op 1 januari, 2024',
    y: axis('Gemiddeld inkomen', 'Y'),
    x: axis('Bevolking op 1 januari', 'X', 'aantal'),
    points: points(12, 'PV'),
    scope: { kind: 'all_provincies' },
    leftOut: [],
    notApplicableCount: 0,
    labelled: [],
    provisionalNote: null,
    license: 'CC BY 4.0',
    ...overrides,
  };
}

describe('scatterTitleEn', () => {
  it('mirrors the Dutch title with English measure names and period', () => {
    expect(scatterTitleEn(spec())).toBe('Average income against population on 1 January, 2024');
  });

  it('leaves an unseeded measure title in Dutch rather than guessing', () => {
    expect(scatterTitleEn(spec({ y: axis('Onbekende maat', 'Y') }))).toBe(
      'Onbekende maat against population on 1 January, 2024',
    );
  });
});

describe('scatterBodyEn', () => {
  it('states the two axes, the region class, the period and the not-causation caveat', () => {
    expect(scatterBodyEn(spec())).toBe(
      'Average income against population on 1 January per province, 2024. Each dot is one province. ' +
        'The chart shows how the two figures occur together, not that one causes the other.',
    );
  });

  it('uses the municipality noun for both municipality scopes and the region noun for landsdelen', () => {
    expect(scatterBodyEn(spec({ scope: { kind: 'all_gemeenten' } }))).toContain('per municipality, 2024. Each dot is one municipality.');
    expect(scatterBodyEn(spec({ scope: { kind: 'gemeenten_in_provincie', parent: 'PV27' } }))).toContain(
      'per municipality, 2024.',
    );
    expect(scatterBodyEn(spec({ scope: { kind: 'all_landsdelen' } }))).toContain('per region, 2024. Each dot is one region.');
  });

  it('carries no data value (no digit beyond the period label)', () => {
    const body = scatterBodyEn(spec());
    expect(body.replaceAll('2024', '').replaceAll('1 January', '')).not.toMatch(/\d/);
  });
});

describe('scatterLineEn', () => {
  it('complete coverage: every region has both figures', () => {
    expect(scatterLineEn(spec())).toBe('Coverage: all 12 provinces have both figures.');
  });

  it('names each left-out region with every missing side and its reason', () => {
    const s = spec({
      points: points(10, 'PV'),
      leftOut: [
        leftOutRegion('PV20', 'Groningen (PV)', side('withheld', 'Confidential'), side('value')),
        leftOutRegion('PV21', 'Noord-Holland', side('value'), side('missing')),
        leftOutRegion('PV22', 'Zeeland', side('not_applicable'), side('withheld', 'Impossible')),
      ],
    });
    expect(scatterLineEn(s)).toBe(
      'Coverage: 10 provinces have both figures. Not shown: 3 provinces — ' +
        'Groningen (province) (average income: CBS publishes no value), ' +
        'North Holland (population on 1 January: not in our database), ' +
        'Zeeland (average income: did not exist according to CBS; population on 1 January: CBS publishes no value).',
    );
  });

  it('names a Eurostat axis\'s withheld reason by Eurostat, not CBS', () => {
    const s = spec({
      x: axis('Bevolking op 1 januari', 'eurostat:demo_r_pjanaggr3', 'aantal'),
      leftOut: [leftOutRegion('PV20', 'Drenthe', side('value'), side('withheld', 'c'))],
    });
    expect(scatterLineEn(s)).toContain('Drenthe (population on 1 January: Eurostat publishes no value)');
  });

  it('caps the named list and counts the rest', () => {
    const leftOut = Array.from({ length: SCATTER_NAMED_LIMIT + 2 }, (_, i) =>
      leftOutRegion(`GM${i}`, `Gemeente ${String.fromCharCode(65 + i)}`, side('missing'), side('value')),
    );
    const line = scatterLineEn(spec({ scope: { kind: 'all_gemeenten' }, points: points(300, 'GM'), leftOut }));
    expect(line.startsWith(`Coverage: 300 municipalities have both figures. Not shown: ${SCATTER_NAMED_LIMIT + 2} municipalities — `)).toBe(true);
    expect(line.endsWith(' and 2 others.')).toBe(true);
    expect(line).not.toContain(`Gemeente ${String.fromCharCode(65 + SCATTER_NAMED_LIMIT)}`);
  });

  it('adds the not-applicable count, singular and plural', () => {
    expect(scatterLineEn(spec({ notApplicableCount: 1 }))).toBe(
      'Coverage: all 12 provinces have both figures. 1 province did not exist in this period according to CBS.',
    );
    expect(scatterLineEn(spec({ notApplicableCount: 3 }))).toBe(
      'Coverage: all 12 provinces have both figures. 3 provinces did not exist in this period according to CBS.',
    );
  });

  it('uses the singular noun for one left-out region', () => {
    const s = spec({ leftOut: [leftOutRegion('PV20', 'Drenthe', side('missing'), side('value'))] });
    expect(scatterLineEn(s)).toContain('Not shown: 1 province — Drenthe (average income: not in our database).');
  });
});

describe('scatterAxisTitle', () => {
  it('Dutch: measure title + unit, plus the log marker', () => {
    const s = spec();
    expect(scatterAxisTitle(s.y, 'nl', false)).toBe('Gemiddeld inkomen (euro)');
    expect(scatterAxisTitle(s.x, 'nl', true)).toBe('Bevolking op 1 januari (aantal) (log. schaal)');
  });

  it('English: translated measure title + unit, plus the log marker', () => {
    const s = spec();
    expect(scatterAxisTitle(s.y, 'en', false)).toBe('Average income (euros)');
    expect(scatterAxisTitle(s.x, 'en', true)).toBe('Population on 1 January (number) (log scale)');
  });

  it('omits an empty unit rather than printing empty brackets', () => {
    expect(scatterAxisTitle(axis('Gemiddeld inkomen', 'Y', ''), 'nl', false)).toBe('Gemiddeld inkomen');
  });
});
