// Two-measure scatter (spec 2026-09-27), #296 part 2 Task 3: the pure Dutch
// scatter texts. Hand-built ScatterSpec fixtures (no query/db layer) — these
// builders are pure functions of the spec, exactly what's under test.
import { describe, expect, it } from 'vitest';
import { scatterBodyNl, scatterLineNl, SCATTER_NAMED_LIMIT } from '../../src/chart/scatter-text.ts';
import { nullReasonText } from '../../src/answer/compose/template.ts';
import type { ScatterAxis, ScatterLeftOut, ScatterPoint, ScatterSideStatus, ScatterSpec } from '../../src/chart/scatter.ts';

function axis(measureTitle: string, tableId: string, periodLabel = '2024'): ScatterAxis {
  return {
    measureTitle,
    unit: 'euro',
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
    title: 'Gemiddelde verkoopprijs tegenover bevolking op 1 januari, 2024',
    y: axis('Gemiddelde verkoopprijs', 'Y'),
    x: axis('Bevolking op 1 januari', 'X'),
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

describe('scatterBodyNl', () => {
  it('states the two measures, the region-class noun and the period, with the correlation-not-causation caveat', () => {
    expect(scatterBodyNl(spec())).toBe(
      'Gemiddelde verkoopprijs tegenover bevolking op 1 januari per provincie, 2024. ' +
        'Elke stip is één provincie. De grafiek laat zien hoe de twee cijfers samen voorkomen, ' +
        'niet dat het ene het andere veroorzaakt.',
    );
  });

  it('carries no digit outside the two measure titles and the period label', () => {
    const s = spec();
    const body = scatterBodyNl(s);
    // The x title reads mid-sentence with its first letter lowercased
    // (scatterBodyNl's own lowerFirst) — strip THAT form, the form that
    // actually appears, not the verbatim axis title.
    const xTitleLowerFirst = s.x.measureTitle[0]!.toLowerCase() + s.x.measureTitle.slice(1);
    const stripped = body.split(s.y.measureTitle).join('').split(xTitleLowerFirst).join('').split(s.y.periodLabel).join('');
    expect(/\d/.test(stripped)).toBe(false);
  });
});

describe('scatterLineNl', () => {
  it('states full coverage when nothing was left out', () => {
    expect(scatterLineNl(spec())).toBe('Dekking: alle 12 provincies hebben beide cijfers.');
  });

  it('names each left-out region with its own per-side reasons, and counts not-applicable regions separately', () => {
    const s = spec({
      points: points(20, 'G'),
      scope: { kind: 'gemeenten_in_provincie', parent: 'PV26' },
      leftOut: [
        leftOutRegion('A', 'A', side('withheld', 'Secret'), side('value')),
        leftOutRegion('B', 'B', side('value'), side('missing')),
      ],
      notApplicableCount: 3,
    });
    expect(scatterLineNl(s)).toBe(
      'Dekking: 20 gemeenten hebben beide cijfers. Niet getoond: 2 gemeenten — ' +
        `A (gemiddelde verkoopprijs: ${nullReasonText('Secret')}), ` +
        'B (bevolking op 1 januari: niet in onze database). ' +
        '3 gemeenten bestonden in deze periode niet volgens het CBS.',
    );
  });

  it('names only the first 10 left-out regions in leftOut order, then "en N andere" before the closing full stop', () => {
    const many: ScatterLeftOut[] = Array.from({ length: 13 }, (_, i) =>
      leftOutRegion(`R${i}`, `R${i}`, side('missing'), side('value')),
    );
    const s = spec({ leftOut: many });
    const named = many
      .slice(0, SCATTER_NAMED_LIMIT)
      .map((r) => `${r.label} (gemiddelde verkoopprijs: niet in onze database)`)
      .join(', ');
    expect(scatterLineNl(s)).toBe(`Dekking: 12 provincies hebben beide cijfers. Niet getoond: 13 provincies — ${named} en 3 andere.`);
  });

  it('a not-applicable count of exactly 1 uses the singular verb form', () => {
    const s = spec({ notApplicableCount: 1 });
    expect(scatterLineNl(s)).toBe('Dekking: alle 12 provincies hebben beide cijfers. 1 provincie bestond in deze periode niet volgens het CBS.');
  });
});
