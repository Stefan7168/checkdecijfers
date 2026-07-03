// Honesty-contract tests for the Recharts wrapper (ADR 018 decision 6):
// every displayed numeric STRING must be a point's own formattedValue, and
// periods must sort chronologically by code, not label/insertion order —
// mirroring the checks ADR 014's SVG-renderer test suite already runs.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { buildRows, ChartView } from './chart.tsx';

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

describe('buildRows', () => {
  it('carries the raw value for geometry and formattedValue for display, never swapped', () => {
    const s = spec({
      series: [
        {
          label: 'Nederland',
          regionCode: 'NL01',
          points: [point({ value: 1500.5, formattedValue: '1.500,5' })],
        },
      ],
    });
    const { rows, seriesMeta } = buildRows(s);
    expect(rows).toHaveLength(1);
    const key = seriesMeta[0].key;
    expect(rows[0][key]).toBe(1500.5);
    expect(rows[0][`${key}_display`]).toBe('1.500,5');
  });

  it('sorts periods chronologically by periodCode, not by label or first-seen order', () => {
    const s = spec({
      series: [
        {
          label: 'A',
          regionCode: null,
          points: [
            point({ periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' }),
          ],
        },
        {
          label: 'B',
          regionCode: null,
          // Disjoint period set from series A, inserted out of order.
          points: [
            point({ periodCode: '2021JJ00', periodLabel: '2021', value: 2, formattedValue: '2,0' }),
            point({ periodCode: '2022JJ00', periodLabel: '2022', value: 3, formattedValue: '3,0' }),
          ],
        },
      ],
    });
    const { rows } = buildRows(s);
    expect(rows.map((r) => r.periodCode)).toEqual(['2021JJ00', '2022JJ00', '2023JJ00']);
  });

  it('renders an honest gap (null/null) both when a series lacks the period and when the cell value is null', () => {
    const s = spec({
      series: [
        {
          label: 'A',
          regionCode: null,
          points: [point({ periodCode: '2023JJ00', periodLabel: '2023' })],
        },
        {
          label: 'B',
          regionCode: null,
          points: [
            point({ periodCode: '2023JJ00', periodLabel: '2023', value: null, formattedValue: null }),
            point({ periodCode: '2024JJ00', periodLabel: '2024' }),
          ],
        },
      ],
    });
    const { rows, seriesMeta } = buildRows(s);
    const row2023 = rows.find((r) => r.periodCode === '2023JJ00')!;
    const row2024 = rows.find((r) => r.periodCode === '2024JJ00')!;
    // Series A has no point at all for 2024 (only B does) -> gap.
    expect(row2024[seriesMeta[0].key]).toBeNull();
    expect(row2024[`${seriesMeta[0].key}_display`]).toBeNull();
    // Series B has a point at 2023 but its value is null -> also a gap.
    expect(row2023[seriesMeta[1].key]).toBeNull();
    expect(row2023[`${seriesMeta[1].key}_display`]).toBeNull();
  });

  it('carries the provisional flag per point', () => {
    const s = spec({
      series: [{ label: 'A', regionCode: null, points: [point({ provisional: true })] }],
    });
    const { rows, seriesMeta } = buildRows(s);
    expect(rows[0][`${seriesMeta[0].key}_provisional`]).toBe(true);
  });
});

describe('ChartView', () => {
  it('renders the structural text fields verbatim for a line chart', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const s = spec({
      provisionalNote: 'Voorlopige cijfers zijn gemarkeerd met *.',
      nullNotes: ['2022: geen gegevens beschikbaar (geheim).'],
      definitionLine: 'Definitie: test.',
    });
    render(<ChartView spec={s} />);
    expect(screen.getByText('Testreeks')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('Voorlopige cijfers zijn gemarkeerd met *.')).toBeInTheDocument();
    expect(screen.getByText('2022: geen gegevens beschikbaar (geheim).')).toBeInTheDocument();
    expect(screen.getByText('Definitie: test.')).toBeInTheDocument();
    expect(screen.getByText('Bron: CBS StatLine, tabel 12345NED.')).toBeInTheDocument();
  });

  it('renders a bar chart kind without crashing', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    render(<ChartView spec={spec({ kind: 'bar' })} />);
    expect(screen.getByText('Testreeks')).toBeInTheDocument();
  });
});
