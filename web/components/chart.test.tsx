// Honesty-contract tests for the Recharts wrapper (ADR 018 decision 6):
// every displayed numeric STRING must be a point's own formattedValue, and
// periods must sort chronologically by code, not label/insertion order —
// mirroring the checks ADR 014's SVG-renderer test suite already runs.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import {
  annotationMarkers,
  buildRows,
  ChartTooltip,
  ChartView,
  seriesStyle,
  tableModel,
  valueLabelPlan,
  yAxisDomain,
} from './chart.tsx';

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
    expect(caveat.className).toContain('text-warn');
    expect(caveat.className).toContain('text-sm');
    const nullNote = screen.getByText('2022: geen gegevens beschikbaar (geheim).');
    expect(nullNote.className).toContain('text-warn');
    const credit = screen.getByText(s.attributionLine);
    expect(credit.className).toContain('text-xs');
    expect(credit.className).toContain('text-ink-muted');
    // Order: the caveat precedes the credit in the DOM.
    const all: HTMLElement[] = [...container.querySelectorAll('p')];
    expect(all.indexOf(caveat)).toBeLessThan(all.indexOf(credit));
  });
});

// #170(4): curated event markers, resolved to the exact periodLabel Recharts
// matches its categorical x-axis on — never reformatted, only looked up.
describe('annotationMarkers', () => {
  it('resolves an in-view annotation to its row\'s own periodLabel', () => {
    const s = spec({ annotations: [{ periodCode: '2024JJ00', label: 'Testgebeurtenis' }] });
    const { rows } = buildRows(s);
    expect(annotationMarkers(s, rows)).toEqual([{ periodLabel: '2024', label: 'Testgebeurtenis' }]);
  });

  it('drops an annotation whose period is not one of this chart\'s own rows', () => {
    const s = spec({ annotations: [{ periodCode: '1999JJ00', label: 'Buiten beeld' }] });
    const { rows } = buildRows(s);
    expect(annotationMarkers(s, rows)).toEqual([]);
  });

  it('is empty for a bar chart even if the spec somehow carries an annotation', () => {
    const s = spec({ kind: 'bar', annotations: [{ periodCode: '2024JJ00', label: 'x' }] });
    const { rows } = buildRows(s);
    expect(annotationMarkers(s, rows)).toEqual([]);
  });

  it('is empty when the spec carries no annotations field at all', () => {
    const s = spec();
    const { rows } = buildRows(s);
    expect(annotationMarkers(s, rows)).toEqual([]);
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

  it('#170(1): renders the source badge from the STRUCTURED attribution, link bound to the spec own table id', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    render(<ChartView spec={spec()} />);
    const badge = screen.getByRole('link', { name: 'CBS 12345NED · gesynchroniseerd 2026-07-01' });
    expect(badge).toHaveAttribute(
      'href',
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/12345NED/table',
    );
  });

  it('#170(4): renders the annotation as always-visible footer text, neutral tone (not the #92 amber caveat)', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const s = spec({ annotations: [{ periodCode: '2024JJ00', label: 'Testgebeurtenis 2024' }] });
    render(<ChartView spec={s} />);
    const marker = screen.getByText('Gemarkeerd in de grafiek: Testgebeurtenis 2024');
    expect(marker.className).toContain('text-ink-muted');
    expect(marker.className).not.toContain('text-warn');
  });

  it('#170(4): renders nothing extra when the spec carries no annotations (unchanged default)', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const { container } = render(<ChartView spec={spec()} />);
    expect(container.textContent).not.toContain('Gemarkeerd in de grafiek');
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

  it('#197: refuses a spec version it does not speak instead of silently drawing it (mirrors render.ts)', () => {
    const s = { ...spec(), schemaVersion: 2 } as unknown as ChartSpec;
    const { container } = render(<ChartView spec={s} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText(/nieuwere versie/)).toBeInTheDocument();
    // The attribution still renders: a refused chart is never a silently
    // source-less one (R4).
    expect(screen.getByText('Bron: CBS StatLine, tabel 12345NED.')).toBeInTheDocument();
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
      // #170(1): the source badge renders the STRUCTURED attribution (table
      // id + measured sync date) — spec's own strings, same membership rule.
      s.attribution.tableId,
      s.attribution.syncedAt,
      s.definitionLine ?? '',
      s.provisionalNote ?? '',
      ...s.nullNotes,
      // #170(4): annotation labels are spec strings too — same membership rule.
      ...(s.annotations ?? []).map((a) => a.label),
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

// ---------------------------------------------------------------------------
// #197 step 1 — numbers on the chart + the accessibility baseline (session 69).
// The tests below render the REAL chart in jsdom: ResponsiveContainer keeps
// its initialDimension when ResizeObserver is undefined (jsdom's default), so
// the svg — axis ticks, dots, labels — is actually in the DOM here, unlike the
// ResizeObserver-stubbed tests above, which only ever saw the footer text.
// Recharts' default axis <Text> measures glyphs and renders nothing in jsdom;
// every label asserted here is rendered by this file's own components.
// ---------------------------------------------------------------------------

function threePointSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return spec({
    series: [
      {
        label: 'Nederland',
        regionCode: 'NL01',
        points: [
          point({ resultId: 'lo', periodCode: '2022JJ00', periodLabel: '2022', value: 1.5, formattedValue: '1,5' }),
          point({ resultId: 'mid', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0' }),
          point({ resultId: 'hi', periodCode: '2024JJ00', periodLabel: '2024', value: 3.25, formattedValue: '3,3' }),
        ],
      },
    ],
    ...overrides,
  });
}

// Shared by the idea-6 (series legend) and idea-8 (small multiples) describe
// blocks below — both need a plain two-series spec and previously each
// defined a byte-identical local copy of this helper.
function twoSeriesSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return spec({
    series: [
      { label: 'Nederland', regionCode: 'NL01', points: [point({ resultId: 'nl', value: 1, formattedValue: '1,0' })] },
      { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'ut', value: 2, formattedValue: '2,0' })] },
    ],
    ...overrides,
  });
}

describe('seriesStyle (#197: colour-blind-safe series palette + non-colour encoding)', () => {
  it('draws the first four series in the dedicated series tokens, never the semantic status colours', () => {
    const colors = [0, 1, 2, 3].map((i) => seriesStyle(i).color);
    expect(colors).toEqual(['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']);
  });

  it('renders series five and beyond in the muted ink token — the chart stops pretending to tell them apart by hue', () => {
    expect(seriesStyle(4).color).toBe('var(--ink-muted)');
    expect(seriesStyle(9).color).toBe('var(--ink-muted)');
  });

  it('gives every series after the first a distinct dash pattern, so colour is never the only difference', () => {
    expect(seriesStyle(0).dasharray).toBeUndefined();
    const dashes = [1, 2, 3, 4].map((i) => seriesStyle(i).dasharray);
    for (const d of dashes) expect(d).toBeTruthy();
    expect(new Set(dashes).size).toBe(4);
  });
});

describe('valueLabelPlan (#197: the numbers a lay reader asked for — still only spec strings)', () => {
  it('ticks the y-axis at the plotted minimum and maximum with those points\' own formattedValue, bound to their resultIds', () => {
    const plan = valueLabelPlan(threePointSpec());
    expect(plan.axisTicks).toEqual([
      { value: 1.5, display: '1,5', resultId: 'lo' },
      { value: 3.25, display: '3,3', resultId: 'hi' },
    ]);
  });

  it('labels the end of each line with its LAST plotted point as "periode: waarde"', () => {
    const plan = valueLabelPlan(threePointSpec());
    expect(plan.endLabels).toEqual([{ seriesKey: 's0', periodCode: '2024JJ00', resultId: 'hi', text: '2024: 3,3' }]);
  });

  it('skips a trailing null when choosing the end label — an honest gap has no value to show', () => {
    const s = threePointSpec();
    s.series[0].points.push(
      point({ resultId: 'gap', periodCode: '2025JJ00', periodLabel: '2025', value: null, formattedValue: null }),
    );
    const plan = valueLabelPlan(s);
    expect(plan.endLabels[0].resultId).toBe('hi');
    expect(plan.axisTicks.map((t) => t.resultId)).toEqual(['lo', 'hi']);
  });

  it('marks a provisional end value the way the tooltip and the SVG renderer do (trailing *)', () => {
    const s = threePointSpec();
    s.series[0].points[2].provisional = true;
    expect(valueLabelPlan(s).endLabels[0].text).toBe('2024: 3,3*');
  });

  it('collapses to a single tick when every plotted value is identical', () => {
    const s = spec({
      series: [
        {
          label: 'A',
          regionCode: null,
          points: [
            point({ resultId: 'a', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0' }),
            point({ resultId: 'b', periodCode: '2024JJ00', periodLabel: '2024', value: 2, formattedValue: '2,0' }),
          ],
        },
      ],
    });
    expect(valueLabelPlan(s).axisTicks).toHaveLength(1);
  });

  it('plans nothing when every point is null', () => {
    const s = spec({
      series: [{ label: 'A', regionCode: null, points: [point({ value: null, formattedValue: null })] }],
    });
    const plan = valueLabelPlan(s);
    expect(plan.axisTicks).toEqual([]);
    expect(plan.endLabels).toEqual([]);
    expect(plan.barLabels).toEqual([]);
  });

  it('gives a bar chart a value label per bar (no axis ticks, no end labels)', () => {
    const s = spec({
      kind: 'bar',
      series: [
        { label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'ams', value: 4.2, formattedValue: '4,2' })] },
        { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'utr', value: 3.1, formattedValue: '3,1', provisional: true })] },
      ],
    });
    const plan = valueLabelPlan(s);
    expect(plan.axisTicks).toEqual([]);
    expect(plan.endLabels).toEqual([]);
    expect(plan.barLabels).toEqual([
      { seriesKey: 's0', periodCode: '2024JJ00', resultId: 'ams', text: '4,2' },
      { seriesKey: 's1', periodCode: '2024JJ00', resultId: 'utr', text: '3,1*' },
    ]);
  });

  it('drops per-bar labels above the readable maximum (idea-bank >15 rule) rather than smearing them', () => {
    const series = Array.from({ length: 16 }, (_, i) => ({
      label: `G${i}`,
      regionCode: `GM${i}`,
      points: [point({ resultId: `r${i}`, value: i, formattedValue: `${i},0` })],
    }));
    expect(valueLabelPlan(spec({ kind: 'bar', series })).barLabels).toEqual([]);
  });
});

describe('ChartView — #197 step 1, rendered against the real svg', () => {
  // Earlier tests in this file stub ResizeObserver and never unstub it; with
  // it defined, ResponsiveContainer measures the jsdom container (0×0) and
  // renders nothing. Undefined = it keeps initialDimension and draws.
  beforeEach(() => vi.unstubAllGlobals());

  it('labels the y-axis at min and max with the points\' own formattedValue, each bound to its resultId', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const lo = container.querySelector('svg [data-role="axis-tick"][data-label-for="lo"]');
    const hi = container.querySelector('svg [data-role="axis-tick"][data-label-for="hi"]');
    expect(lo?.textContent).toBe('1,5');
    expect(hi?.textContent).toBe('3,3');
    expect(container.querySelector('svg [data-role="axis-tick"][data-label-for="mid"]')).toBeNull();
  });

  it('shows an always-visible end-of-line label on the last plotted point', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const end = container.querySelector('svg [data-role="end-label"][data-label-for="hi"]');
    expect(end?.textContent).toBe('2024: 3,3');
  });

  it('bar chart: every bar carries its own value label bound to its resultId, and a provisional bar is hatched', () => {
    const s = spec({
      kind: 'bar',
      provisionalNote: 'Voorlopige cijfers zijn gemarkeerd met *.',
      series: [
        { label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'ams', value: 4.2, formattedValue: '4,2' })] },
        { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'utr', value: 3.1, formattedValue: '3,1', provisional: true })] },
      ],
    });
    const { container } = render(<ChartView spec={s} />);
    expect(container.querySelector('svg [data-role="bar-label"][data-label-for="ams"]')?.textContent).toBe('4,2');
    expect(container.querySelector('svg [data-role="bar-label"][data-label-for="utr"]')?.textContent).toBe('3,1*');
    const provisionalBar = container.querySelector('svg [data-point="value"][data-result-id="utr"]');
    expect(provisionalBar?.getAttribute('fill')).toMatch(/^url\(#/);
    const finalBar = container.querySelector('svg [data-point="value"][data-result-id="ams"]');
    expect(finalBar?.getAttribute('fill')).toBe('var(--series-1)');
  });

  it('gives the chart an accessible name from spec strings and a keyboard hint in its <desc>', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toContain('Testreeks');
    expect(svg.querySelector('desc')?.textContent).toMatch(/pijltjestoetsen/);
  });

  it('exposes the chart title as a heading so heading-navigation reaches it', () => {
    render(<ChartView spec={threePointSpec()} />);
    expect(screen.getByRole('heading', { name: 'Testreeks' })).toBeInTheDocument();
  });

  it('renders a legend key for the hollow provisional marker exactly when the spec carries a provisional note', () => {
    const withNote = threePointSpec({ provisionalNote: 'Voorlopige cijfers zijn gemarkeerd met *.' });
    const { unmount } = render(<ChartView spec={withNote} />);
    expect(screen.getByText('○ = voorlopig cijfer')).toBeInTheDocument();
    unmount();
    render(<ChartView spec={threePointSpec()} />);
    expect(screen.queryByText('○ = voorlopig cijfer')).toBeNull();
  });

  it('still shows no numeric token that is not a spec string once axis and end labels render (membership over the REAL svg)', () => {
    const s = threePointSpec({
      provisionalNote: 'Voorlopige cijfers (2024) zijn gemarkeerd met *.',
      nullNotes: ['2021: geen gegevens beschikbaar (geheim).'],
      definitionLine: 'Definitie: testdefinitie 2020.',
    });
    const { container } = render(<ChartView spec={s} />);
    expect(container.querySelector('svg')).not.toBeNull();
    const specStrings = [
      s.title,
      s.unit,
      s.attributionLine,
      s.attribution.tableId,
      s.attribution.syncedAt,
      s.definitionLine ?? '',
      s.provisionalNote ?? '',
      ...s.nullNotes,
      ...Object.keys(s.dimLabels),
      ...Object.values(s.dimLabels),
      ...s.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
    ].filter(Boolean);
    // Per TEXT NODE, not container.textContent: adjacent svg <text> nodes
    // concatenate without a separator ("1,5" + "3,3" -> "1,53,3"), which
    // would hide the very labels this test exists to check.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const tokens: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
    }
    expect(tokens.length).toBeGreaterThan(0);
    // The axis ticks and the end label must actually be among the tokens —
    // otherwise this test proves nothing about them.
    expect(tokens).toContain('1,5');
    expect(tokens).toContain('3,3');
    for (const tok of tokens) {
      expect(
        specStrings.some((str) => str.includes(tok)),
        `numeric token "${tok}" in the rendered DOM has no source in the spec's own strings`,
      ).toBe(true);
    }
  });
});

describe('ChartTooltip — #197: announced, not just shown', () => {
  it('is a polite live region, so keyboard point-walking through the chart is read out', () => {
    const s = threePointSpec();
    const { rows, seriesMeta } = buildRows(s);
    const payload = seriesMeta.map((m) => ({ dataKey: m.key, color: m.color, payload: rows[2] }));
    const { container } = render(<ChartTooltip active label="2024" payload={payload} seriesMeta={seriesMeta} />);
    const root = container.firstElementChild!;
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-live')).toBe('polite');
  });
});

// ---------------------------------------------------------------------------
// #197 step 2 — the "Tabel" view beside every chart (session 69). A second,
// dumb renderer over the same spec: period × series, the point's own
// formattedValue (+ the '*' provisional suffix), a null cell shown as an
// honest gap with its CBS reason. The switch is pure UI state.
// ---------------------------------------------------------------------------

describe('tableModel (#197 step 2)', () => {
  it('lays a line chart out as one row per period and one column per series, cells bound to their resultIds', () => {
    const s = spec({
      series: [
        {
          label: 'Amsterdam',
          regionCode: 'GM0363',
          points: [
            point({ resultId: 'a23', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' }),
            point({ resultId: 'a24', periodCode: '2024JJ00', periodLabel: '2024', value: 2, formattedValue: '2,0', provisional: true }),
          ],
        },
        {
          label: 'Utrecht',
          regionCode: 'GM0344',
          points: [point({ resultId: 'u24', periodCode: '2024JJ00', periodLabel: '2024', value: 3, formattedValue: '3,0' })],
        },
      ],
    });
    const model = tableModel(s);
    expect(model.caption).toBe('Testreeks (%)');
    expect(model.header).toEqual(['Periode', 'Amsterdam', 'Utrecht']);
    expect(model.rows).toEqual([
      { label: '2023', cells: [{ text: '1,0', resultId: 'a23' }, { text: '', resultId: null }] },
      { label: '2024', cells: [{ text: '2,0*', resultId: 'a24' }, { text: '3,0', resultId: 'u24' }] },
    ]);
  });

  it('shows a null cell as an honest gap carrying the CBS reason, never a blank that reads as zero', () => {
    const s = spec({
      series: [
        {
          label: 'A',
          regionCode: null,
          points: [point({ resultId: 'gap', value: null, formattedValue: null, valueAttribute: 'Geheim' })],
        },
      ],
    });
    expect(tableModel(s).rows[0].cells[0]).toEqual({ text: '— (Geheim)', resultId: 'gap' });
  });

  it('lays a bar chart out as one row per region under the single period', () => {
    const s = spec({
      kind: 'bar',
      series: [
        { label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'ams', value: 4.2, formattedValue: '4,2' })] },
        { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'utr', value: 3.1, formattedValue: '3,1', provisional: true })] },
      ],
    });
    const model = tableModel(s);
    expect(model.header).toEqual(['Regio', '2024']);
    expect(model.rows).toEqual([
      { label: 'Amsterdam', cells: [{ text: '4,2', resultId: 'ams' }] },
      { label: 'Utrecht', cells: [{ text: '3,1*', resultId: 'utr' }] },
    ]);
  });
});

describe('ChartView — #197 step 2, the Tabel view', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('offers a Grafiek/Tabel switch, chart first, and swaps to a table bound cell-by-cell to the spec', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    expect(screen.getByRole('tab', { name: 'Grafiek' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('svg')).toBeNull();
    const table = screen.getByRole('table', { name: 'Testreeks (%)' });
    expect(table.querySelector('[data-label-for="lo"]')?.textContent).toBe('1,5');
    expect(table.querySelector('[data-label-for="hi"]')?.textContent).toBe('3,3');
    // Image download makes no sense for a table — the menu is not offered there.
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Grafiek' }));
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('opens on the table when a comparison has more series than a chart can label (the idea-bank >15 rule)', () => {
    const series = Array.from({ length: 16 }, (_, i) => ({
      label: `Gemeente ${i}`,
      regionCode: `GM${i}`,
      points: [point({ resultId: `r${i}`, value: i, formattedValue: `${i},0` })],
    }));
    const { container } = render(<ChartView spec={spec({ kind: 'bar', series })} />);
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('shows no numeric token in the table that is not a spec string', () => {
    const s = threePointSpec({ nullNotes: ['2021: geen gegevens beschikbaar (geheim).'] });
    const { container } = render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    const specStrings = [
      s.title,
      s.unit,
      s.attributionLine,
      s.attribution.tableId,
      s.attribution.syncedAt,
      ...s.nullNotes,
      ...Object.keys(s.dimLabels),
      ...Object.values(s.dimLabels),
      ...s.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
    ].filter(Boolean);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const tokens: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
    }
    expect(tokens).toContain('2,0');
    for (const tok of tokens) {
      expect(specStrings.some((str) => str.includes(tok)), `token "${tok}" has no source in the spec`).toBe(true);
    }
  });
});

describe('ChartView — series legend and hide/show (idea 6)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('renders one real button per series, labelled by name, none hidden by default', () => {
    render(<ChartView spec={twoSeriesSpec()} />);
    const nl = screen.getByRole('button', { name: 'Nederland' });
    const ut = screen.getByRole('button', { name: 'Utrecht' });
    // Pressed = shown (the toggle's "on" state) -- both start shown.
    expect(nl).toHaveAttribute('aria-pressed', 'true');
    expect(ut).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not render a legend at all for a single-series chart', () => {
    render(<ChartView spec={threePointSpec()} />);
    expect(screen.queryByRole('button', { name: 'Nederland' })).toBeNull();
  });

  it('clicking a legend button hides that series\' point and shows the disclosure count', () => {
    const { container } = render(<ChartView spec={twoSeriesSpec()} />);
    // Bound to resultId, not a Recharts internal class name — same convention
    // every other test in this file uses (data-point/data-result-id from SeriesDot).
    expect(container.querySelector('svg [data-point="value"][data-result-id="ut"]')).not.toBeNull();
    expect(container.querySelector('svg [data-point="value"][data-result-id="nl"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Utrecht' }));
    expect(container.querySelector('svg [data-point="value"][data-result-id="ut"]')).toBeNull();
    expect(container.querySelector('svg [data-point="value"][data-result-id="nl"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Utrecht' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('1 van 2 reeksen verborgen')).toBeInTheDocument();
  });

  it('clicking a hidden series again restores it and clears the disclosure', () => {
    render(<ChartView spec={twoSeriesSpec()} />);
    const utrecht = screen.getByRole('button', { name: 'Utrecht' });
    fireEvent.click(utrecht);
    fireEvent.click(utrecht);
    expect(utrecht).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/reeksen verborgen/)).toBeNull();
  });

  it('bakes the hidden-series disclosure into the export attribution text, matching #46(c)\'s decided default', async () => {
    // Same URL-API stubbing pattern chart-download.test.tsx already uses,
    // but capturing the actual Blob passed to createObjectURL so we can read
    // back the baked SVG markup (attributedSvgMarkup writes attributionText
    // into it) instead of just checking a download was attempted.
    let capturedBlob: Blob | undefined;
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();

    render(<ChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Utrecht' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download als SVG' }));

    expect(capturedBlob).toBeDefined();
    const markup = await capturedBlob!.text();
    expect(markup).toContain('1 van 2 reeksen verborgen');

    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  it('hiding every series shows an honest "all hidden" disclosure without crashing, and both legend buttons survive to undo it', () => {
    render(<ChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nederland' }));
    fireEvent.click(screen.getByRole('button', { name: 'Utrecht' }));
    expect(screen.getByText('2 van 2 reeksen verborgen')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Grafiek' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nederland' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Utrecht' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('resets hidden-series state when the SAME ChartView instance receives a different spec without remounting (the visual-dock/chart-toggle pattern — neither keys ChartView by spec)', () => {
    const { container, rerender } = render(<ChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nederland' }));
    expect(screen.getByText('1 van 2 reeksen verborgen')).toBeInTheDocument();

    // threePointSpec's single series is ALSO keyed s0 (buildRows keys by
    // index, not by anything chart-specific) -- before the fix, hiding "s0"
    // on one chart then rerendering the same instance with a different
    // single-series chart silently dropped that chart's only line, with no
    // legend to recover it (a single-series chart renders no legend at all)
    // and no disclosure explaining why.
    rerender(<ChartView spec={threePointSpec()} />);
    expect(screen.queryByText(/reeksen verborgen/)).toBeNull();
    expect(container.querySelector('svg [data-point="value"][data-result-id="lo"]')).not.toBeNull();
  });
});

describe('ChartView — small multiples toggle (idea 8)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('offers no small-multiples toggle for a single-series chart', () => {
    render(<ChartView spec={threePointSpec()} />);
    expect(screen.queryByRole('button', { name: 'Kleine grafieken' })).toBeNull();
  });

  it('offers no small-multiples toggle for a bar/comparison chart', () => {
    const s = twoSeriesSpec({ kind: 'bar' });
    render(<ChartView spec={s} />);
    expect(screen.queryByRole('button', { name: 'Kleine grafieken' })).toBeNull();
  });

  it('switches to one panel per series when toggled on, and shows the axis-mode switch only then', () => {
    const { container } = render(<ChartView spec={twoSeriesSpec()} />);
    expect(screen.queryByRole('group', { name: 'Gelijke assen of eigen assen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    // Two panels, each its own small chart — proves the switch happened.
    // (Not asserting "no SVG at all": ChartSmallMultiples' own mini charts
    // are ALSO Recharts SVGs with the same .recharts-surface class as the
    // combined view, so that would be a false signal either way. The
    // ChartView JSX renders ChartSmallMultiples OR the combined
    // ResponsiveContainer, never both — the panel count already proves which
    // branch is active.)
    expect(container.querySelectorAll('[data-panel-for]').length).toBe(2);
    expect(screen.getByRole('group', { name: 'Gelijke assen of eigen assen' })).toBeInTheDocument();
  });

  it('hides the download menu in small-multiples view (it would silently export only the first panel)', () => {
    render(<ChartView spec={twoSeriesSpec()} />);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('a series hidden via the legend (idea 6) has no small-multiples panel either (shared hiddenKeys, not a separate copy)', () => {
    const { container } = render(<ChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Utrecht' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    const panels = container.querySelectorAll('[data-panel-for]');
    expect(panels.length).toBe(1);
    expect(panels[0].getAttribute('data-panel-for')).toBe('s0');
    // Scoped to the small-multiples grid itself, not the whole component --
    // the legend (idea 6) still lists Utrecht, dimmed, so it can be shown
    // again; that's correct and unrelated to whether it has a panel here.
    const grid = screen.getByRole('group', { name: 'Kleine grafieken per reeks' });
    expect(grid.textContent).not.toContain('Utrecht');
  });
});

describe('trend headline (#197 idea 4)', () => {
  it('renders the headline when attribution.trendHeadline is set', () => {
    render(
      <ChartView
        spec={spec({ attribution: { ...spec().attribution, trendHeadline: 'Bevolking steeg gestaag sinds 2015.' } })}
      />,
    );
    expect(screen.getByText('Bevolking steeg gestaag sinds 2015.')).toBeInTheDocument();
  });

  it('renders nothing extra when trendHeadline is absent (old specs unaffected)', () => {
    const { container } = render(<ChartView spec={spec()} />);
    expect(container.querySelector('[data-testid="trend-headline"]')).toBeNull();
  });
});
