import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { headlineFigure } from './chart-headline.ts';

type Point = ChartSpec['series'][number]['points'][number];
function point(overrides: Partial<Point> = {}): Point {
  return {
    resultId: 'r1',
    periodCode: '2024JJ00',
    periodLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    decimals: 1,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    ...overrides,
  };
}
const single = (points: Point[]): Pick<ChartSpec, 'kind' | 'series' | 'unit'> => ({
  kind: 'line',
  unit: 'x 1 000',
  series: [{ label: 'Nederland', regionCode: null, points }],
});

describe('headlineFigure — the last plotted point of a single time series, a spec string bound to its cell', () => {
  it('returns the last plotted point verbatim with its period, the unit and the resultId', () => {
    const s = single([
      point({ resultId: 'a', periodCode: '2022JJ00', periodLabel: '2022', value: 1234.5, formattedValue: '1.234,5' }),
      point({ resultId: 'b', periodCode: '2023JJ00', periodLabel: '2023', value: 1300, formattedValue: '1.300,0' }),
    ]);
    expect(headlineFigure(s)).toEqual({ value: '1.300,0', provisional: false, periodLabel: '2023', unit: 'x 1 000', resultId: 'b' });
  });
  it('skips a trailing null (an honest gap) and takes the last point that is actually plotted', () => {
    const s = single([
      point({ resultId: 'a', periodLabel: '2022', value: 1, formattedValue: '1,0' }),
      point({ resultId: 'b', periodLabel: '2023', value: null, formattedValue: null, valueAttribute: 'Geheim' }),
    ]);
    expect(headlineFigure(s)?.resultId).toBe('a');
  });
  it('carries the provisional flag through (the renderer adds the same * suffix every other label uses)', () => {
    const s = single([point({ resultId: 'p', value: 5, formattedValue: '5,0', provisional: true, status: 'Voorlopig' })]);
    expect(headlineFigure(s)?.provisional).toBe(true);
  });
  it('is null for a multi-series chart, a comparison (bar kind), an empty series and an all-null series', () => {
    const two = { ...single([point()]), series: [single([point()]).series[0]!, { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'u' })] }] };
    expect(headlineFigure(two)).toBeNull();
    expect(headlineFigure({ ...single([point()]), kind: 'bar' })).toBeNull();
    expect(headlineFigure(single([]))).toBeNull();
    expect(headlineFigure(single([point({ value: null, formattedValue: null, valueAttribute: 'Geheim' })]))).toBeNull();
  });
  it('never formats: the value is the exact formattedValue string, whatever the numeric value is', () => {
    const s = single([point({ value: 17590672, formattedValue: '17.590.672' })]);
    expect(headlineFigure(s)?.value).toBe('17.590.672');
  });
});
