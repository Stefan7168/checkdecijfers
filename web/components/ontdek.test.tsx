// The Ontdek section's rendering contract (ADR 035): charts render through
// the product's own ChartView (R4 attribution and all), and an empty feed
// renders NOTHING — the fail-safe is "no section", never a broken landing.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';

const { getOntdekCharts } = vi.hoisted(() => ({ getOntdekCharts: vi.fn() }));
vi.mock('../lib/ontdek.ts', () => ({ getOntdekCharts }));

import { OntdekCharts } from './ontdek.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function spec(title: string, tableId: string): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title,
    dims: {},
    dimLabels: {},
    unit: '%',
    series: [
      {
        label: title,
        regionCode: null,
        points: [
          {
            resultId: `${tableId}:p1`,
            periodCode: '2026MM05',
            periodLabel: 'mei 2026',
            value: 1.5,
            formattedValue: '1,5',
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
    attributionLine: `Bron: CBS StatLine, tabel ${tableId}. Licentie: CC BY 4.0.`,
    attribution: {
      tableId,
      tableTitle: title,
      tableVersion: 1,
      syncedAt: '2026-07-17',
      coveredPeriods: { from: '2024MM06', to: '2026MM05' },
      license: 'CC BY 4.0',
    },
  };
}

describe('OntdekCharts', () => {
  it('renders a ChartView card per curated chart, each with its own R4 attribution', async () => {
    getOntdekCharts.mockResolvedValue([
      { slug: 'inflatie', spec: spec('Jaarmutatie CPI', '86141NED') },
      { slug: 'huizenprijzen', spec: spec('Gemiddelde verkoopprijs', '85773NED') },
    ]);
    render(await OntdekCharts());
    expect(screen.getByText('Ontdek Nederland in grafieken')).toBeInTheDocument();
    expect(screen.getByText('Jaarmutatie CPI')).toBeInTheDocument();
    expect(screen.getByText('Gemiddelde verkoopprijs')).toBeInTheDocument();
    expect(screen.getByText(/tabel 86141NED/)).toBeInTheDocument();
    expect(screen.getByText(/tabel 85773NED/)).toBeInTheDocument();
  });

  it('renders nothing at all when no charts are available (fail-safe)', async () => {
    getOntdekCharts.mockResolvedValue([]);
    const { container } = render(await OntdekCharts());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Ontdek Nederland in grafieken')).toBeNull();
  });
});
