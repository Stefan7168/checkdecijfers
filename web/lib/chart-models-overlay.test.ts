// #294 (session 129): a derived-overlay label on an ENGLISH chart carries the
// English unit word ("percentage point", not "procentpunt") while the number
// itself stays byte-identical to the Dutch rendering (R6: never a new
// formatting path for a digit).
import { describe, expect, it } from 'vitest';
import { formatOverlayValue } from './chart-models.ts';
import type { ChartPoint } from '../backend/chart/types.ts';

const marking = 'bewerking van CBS-gegevens door checkdecijfers.nl' as const;
const points = [
  { resultId: 'a', decimals: 1 },
  { resultId: 'b', decimals: 1 },
] as unknown as ChartPoint[];

function digits(s: string): string[] {
  return s.match(/\d[\d.,]*/g) ?? [];
}

describe('formatOverlayValue — English unit words (#294)', () => {
  const diff = {
    kind: 'difference' as const,
    explicit: true,
    sourceResultIds: ['a', 'b'],
    unit: '%',
    marking,
    value: 1.25,
    minuendResultId: 'b',
    subtrahendResultId: 'a',
  };

  it('a difference over % reads "procentpunt" in Dutch and "percentage point" in English, same digits', () => {
    const nl = formatOverlayValue(diff, points);
    const en = formatOverlayValue(diff, points, 'en');
    expect(nl).toContain('procentpunt');
    expect(en).toContain('percentage point');
    expect(en).not.toContain('procentpunt');
    expect(digits(en)).toEqual(digits(nl));
  });

  it('a mean translates a known CBS unit and leaves an unknown one unchanged', () => {
    const mean = { kind: 'mean' as const, explicit: true, sourceResultIds: ['a'], unit: 'aantal', marking, value: 12 };
    expect(formatOverlayValue(mean, points, 'en')).toContain('number');
    const odd = { ...mean, unit: 'mln kWh' };
    expect(formatOverlayValue(odd, points, 'en')).toBe(formatOverlayValue(odd, points));
  });

  it('a mean over % stays % in English (a level, not a difference)', () => {
    const mean = { kind: 'mean' as const, explicit: true, sourceResultIds: ['a'], unit: '%', marking, value: 3.5 };
    expect(formatOverlayValue(mean, points, 'en')).toBe(formatOverlayValue(mean, points));
  });
});
