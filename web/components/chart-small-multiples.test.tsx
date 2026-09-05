import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { ChartSmallMultiples } from './chart-small-multiples.tsx';

afterEach(cleanup);

function point(overrides: Partial<ChartSpec['series'][0]['points'][0]> = {}) {
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

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
    series: [{ label: 'Nederland', regionCode: 'NL01', points: [point()] }],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 12345NED.',
    attribution: {
      tableId: '12345NED',
      tableTitle: 'Test',
      tableVersion: 1,
      syncedAt: '2026-07-01',
      coveredPeriods: { from: '2020', to: '2024' },
      license: 'CC BY 4.0',
    },
    ...overrides,
  };
}

function threeSeriesSpec(): ChartSpec {
  return spec({
    series: [
      { label: 'Nederland', regionCode: 'NL01', points: [point({ resultId: 'nl', value: 1, formattedValue: '1,0' })] },
      { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'ut', value: 2, formattedValue: '2,0' })] },
      { label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'ams', value: 3, formattedValue: '3,0' })] },
    ],
  });
}

describe('ChartSmallMultiples', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('renders one titled panel per series, in spec order', () => {
    const { container } = render(
      <ChartSmallMultiples spec={threeSeriesSpec()} hiddenKeys={new Set()} axisMode="shared" />,
    );
    const panels = container.querySelectorAll('[data-panel-for]');
    expect(panels.length).toBe(3);
    expect(panels[0].getAttribute('data-panel-for')).toBe('s0');
    expect(container.textContent).toContain('Nederland');
    expect(container.textContent).toContain('Utrecht');
    expect(container.textContent).toContain('Amsterdam');
  });

  it('omits a panel for a hidden series', () => {
    const { container } = render(
      <ChartSmallMultiples spec={threeSeriesSpec()} hiddenKeys={new Set(['s1'])} axisMode="shared" />,
    );
    expect(container.querySelectorAll('[data-panel-for]').length).toBe(2);
    expect(container.textContent).not.toContain('Utrecht');
  });
});
