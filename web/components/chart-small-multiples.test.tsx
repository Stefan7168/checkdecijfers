import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { ChartSmallMultiples, sharedLineDomain } from './chart-small-multiples.tsx';

function twoPointSeriesSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
    series: [
      {
        label: 'Klein',
        regionCode: null,
        points: [
          {
            resultId: 'k-lo',
            periodCode: '2023JJ00',
            periodLabel: '2023',
            value: 1,
            formattedValue: '1,0',
            decimals: 1,
            status: 'Definitief',
            provisional: false,
            valueAttribute: 'None',
          },
          {
            resultId: 'k-hi',
            periodCode: '2024JJ00',
            periodLabel: '2024',
            value: 2,
            formattedValue: '2,0',
            decimals: 1,
            status: 'Definitief',
            provisional: false,
            valueAttribute: 'None',
          },
        ],
      },
    ],
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

  it('"eigen assen" labels each panel with its OWN min/max, bound to its own points -- never a foreign or invented number', () => {
    const { container } = render(
      <ChartSmallMultiples spec={twoPointSeriesSpec()} hiddenKeys={new Set()} axisMode="own" />,
    );
    const panel = container.querySelector('[data-panel-for="s0"]')!;
    const lo = panel.querySelector('[data-role="axis-tick"][data-label-for="k-lo"]');
    const hi = panel.querySelector('[data-role="axis-tick"][data-label-for="k-hi"]');
    expect(lo?.textContent).toBe('1,0');
    expect(hi?.textContent).toBe('2,0');
  });

  it('"gelijke assen" shows no per-panel tick labels (a shared endpoint may belong to a different series\' data, which would be dishonest to label here)', () => {
    const { container } = render(
      <ChartSmallMultiples spec={twoPointSeriesSpec()} hiddenKeys={new Set()} axisMode="shared" />,
    );
    const panel = container.querySelector('[data-panel-for="s0"]')!;
    expect(panel.querySelector('[data-role="axis-tick"]')).toBeNull();
  });
});

describe('sharedLineDomain ("gelijke assen": the shared y-domain across all visible panels)', () => {
  function asymmetricSpec(): ChartSpec {
    return spec({
      series: [
        {
          label: 'Klein',
          regionCode: null,
          points: [
            point({ resultId: 'k1', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' }),
            point({ resultId: 'k2', periodCode: '2024JJ00', periodLabel: '2024', value: 2, formattedValue: '2,0' }),
          ],
        },
        {
          label: 'Groot',
          regionCode: null,
          points: [
            point({ resultId: 'g1', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' }),
            point({ resultId: 'g2', periodCode: '2024JJ00', periodLabel: '2024', value: 1000, formattedValue: '1.000,0' }),
          ],
        },
      ],
    });
  }

  it('spans the min and max across ALL visible series, not just one', () => {
    // Klein alone is [1,2]; Groot alone is [1,1000] -- the shared domain
    // must cover both, proving it is not accidentally scoped to one series.
    expect(sharedLineDomain(asymmetricSpec(), [0, 1])).toEqual([1, 1000]);
  });

  it('excludes a hidden series from the shared domain (only the passed indexes count)', () => {
    // Same spec, but only Klein (index 0) is "visible" -- Groot's 1000 must
    // not leak into the domain once it is hidden.
    expect(sharedLineDomain(asymmetricSpec(), [0])).toEqual([1, 2]);
  });

  it('skips null cells rather than treating them as zero', () => {
    const s = spec({
      series: [
        {
          label: 'Met gat',
          regionCode: null,
          points: [
            point({ resultId: 'a', value: 5, formattedValue: '5,0' }),
            point({ resultId: 'b', value: null, formattedValue: null }),
          ],
        },
      ],
    });
    expect(sharedLineDomain(s, [0])).toEqual([5, 5]);
  });

  it('returns undefined (falls back to auto-scaling) when every visible point is null', () => {
    const s = spec({
      series: [{ label: 'Leeg', regionCode: null, points: [point({ value: null, formattedValue: null })] }],
    });
    expect(sharedLineDomain(s, [0])).toBeUndefined();
  });
});
