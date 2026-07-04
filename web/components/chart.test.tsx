// Honesty-contract tests for the Recharts wrapper (ADR 018 decision 6):
// every displayed numeric STRING must be a point's own formattedValue, and
// periods must sort chronologically by code, not label/insertion order —
// mirroring the checks ADR 014's SVG-renderer test suite already runs.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { buildRows, ChartTooltip, ChartView, yAxisDomain } from './chart.tsx';

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

  it('binds each row value to its own resultId per series, including disjoint period sets (WP8 binding lesson)', () => {
    const s = spec({
      series: [
        {
          label: 'A',
          regionCode: null,
          points: [
            point({ resultId: 'cell-a-2023', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' }),
          ],
        },
        {
          label: 'B',
          regionCode: null,
          points: [
            point({ resultId: 'cell-b-2023', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0' }),
            point({ resultId: 'cell-b-2024', periodCode: '2024JJ00', periodLabel: '2024', value: 3, formattedValue: '3,0' }),
          ],
        },
      ],
    });
    const { rows, seriesMeta } = buildRows(s);
    const [a, b] = seriesMeta.map((m) => m.key);
    const r23 = rows.find((r) => r.periodCode === '2023JJ00')!;
    const r24 = rows.find((r) => r.periodCode === '2024JJ00')!;
    expect(r23[`${a}_resultId`]).toBe('cell-a-2023');
    expect(r23[`${b}_resultId`]).toBe('cell-b-2023');
    expect(r24[`${a}_resultId`]).toBeNull();
    expect(r24[`${b}_resultId`]).toBe('cell-b-2024');
  });
});

// WP23 (#92): caveats read like caveats, the credit reads like a photo
// credit — amber + larger for provisional/null notes, smallest/lightest for
// the attribution, caveats ABOVE the credit. Content untouched (same strings
// from the one builder, R4); these pins keep the presentation from silently
// reverting.
describe('ChartView — footer arrangement (#92)', () => {
  it('renders caveats amber and larger, the attribution smallest, caveats first', () => {
    const s = spec({
      provisionalNote: 'Voorlopige cijfers zijn gemarkeeerd met *.',
      nullNotes: ['2022: geen gegevens beschikbaar (geheim).'],
    });
    const { container } = render(<ChartView spec={s} />);
    const caveat = screen.getByText('Voorlopige cijfers zijn gemarkeeerd met *.');
    expect(caveat.className).toContain('text-amber-700');
    expect(caveat.className).toContain('text-sm');
    const nullNote = screen.getByText('2022: geen gegevens beschikbaar (geheim).');
    expect(nullNote.className).toContain('text-amber-700');
    const credit = screen.getByText(s.attributionLine);
    expect(credit.className).toContain('text-xs');
    expect(credit.className).toContain('text-zinc-400');
    // Order: the caveat precedes the credit in the DOM.
    const all: HTMLElement[] = [...container.querySelectorAll('p')];
    expect(all.indexOf(caveat)).toBeLessThan(all.indexOf(credit));
  });
});

describe('yAxisDomain (open-questions #48 honesty policy)', () => {
  it('floors bar charts at zero — a truncated bar lies about ratios', () => {
    expect(yAxisDomain('bar')).toEqual([0, 'auto']);
  });
  it('lets line charts zoom to data — position, not area, carries the meaning', () => {
    expect(yAxisDomain('line')).toEqual(['auto', 'auto']);
  });
});

describe('ChartTooltip', () => {
  it('renders each display string inside the node bound to that value\'s own resultId — binding, not just membership', () => {
    const s = spec({
      series: [
        {
          label: 'A',
          regionCode: null,
          points: [point({ resultId: 'cell-a-2023', periodCode: '2023JJ00', periodLabel: '2023', value: 1.1, formattedValue: '1,1' })],
        },
        {
          label: 'B',
          regionCode: null,
          points: [point({ resultId: 'cell-b-2023', periodCode: '2023JJ00', periodLabel: '2023', value: 2.2, formattedValue: '2,2' })],
        },
      ],
    });
    const { rows, seriesMeta } = buildRows(s);
    const payload = seriesMeta.map((m) => ({ dataKey: m.key, color: m.color, payload: rows[0] }));
    const { container } = render(
      <ChartTooltip active label="2023" payload={payload} seriesMeta={seriesMeta} />,
    );
    const nodeA = container.querySelector('[data-label-for="cell-a-2023"]');
    const nodeB = container.querySelector('[data-label-for="cell-b-2023"]');
    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    // The string shown in A's node is A's formattedValue — a swap (B's value
    // rendered under A's identity) fails here even though both strings would
    // pass a membership-only check.
    expect(nodeA!.textContent).toContain('1,1');
    expect(nodeA!.textContent).not.toContain('2,2');
    expect(nodeB!.textContent).toContain('2,2');
    expect(nodeB!.textContent).not.toContain('1,1');
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

  it('every numeric token in the rendered DOM occurs verbatim in the spec\'s own strings (ADR 018 membership check)', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const s = spec({
      provisionalNote: 'Voorlopige cijfers (2024) zijn gemarkeerd met *.',
      nullNotes: ['2022: geen gegevens beschikbaar (geheim).'],
      definitionLine: 'Definitie: testdefinitie 2020.',
    });
    const { container } = render(<ChartView spec={s} />);
    const specStrings = [
      s.title,
      s.unit,
      s.attributionLine,
      s.definitionLine ?? '',
      s.provisionalNote ?? '',
      ...s.nullNotes,
      ...Object.keys(s.dimLabels),
      ...Object.values(s.dimLabels),
      ...s.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
    ].filter(Boolean);
    const tokens = (container.textContent ?? '').match(/\d[\d.,]*/g) ?? [];
    expect(tokens.length).toBeGreaterThan(0);
    for (const tok of tokens) {
      expect(
        specStrings.some((str) => str.includes(tok)),
        `numeric token "${tok}" in the rendered DOM has no source in the spec's own strings`,
      ).toBe(true);
    }
  });
});
