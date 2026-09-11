// Honesty-contract tests for the Recharts wrapper (ADR 018 decision 6):
// every displayed numeric STRING must be a point's own formattedValue, and
// periods must sort chronologically by code, not label/insertion order —
// mirroring the checks ADR 014's SVG-renderer test suite already runs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import type { ChartStyleEvent } from '../backend/chart/user-styles.ts';
import { setChartUsageSink } from '../lib/chart-usage-client.ts';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { StylePanelOwnerProvider } from '../lib/style-panel-owner.tsx';
import { attributedSvgMarkup } from './chart-download.tsx';

// WP218 phase 2 (owner C): chart.tsx imports the account-default Server
// Actions from THIS tiny file, never web/app/actions.ts (see chart-style-
// actions.ts's own header) — mocked here so the account-default save/forget
// flow tests below never touch a real db/auth boundary, mirroring how the
// phase-6 usage counter is exercised only through its own injectable sink.
// `lookupBrand` (WP218 phase 3, owner B) joins the same mock for the same
// reason.
const chartStyleActions = vi.hoisted(() => ({
  saveMyChartStyle: vi.fn(),
  forgetMyChartStyle: vi.fn(),
  lookupBrand: vi.fn(),
}));
vi.mock('../app/chart-style-actions.ts', () => chartStyleActions);
import {
  annotationMarkers,
  baselineAxisLine,
  buildRegionRows,
  buildRows,
  ChartTooltip,
  ChartView,
  clampTotChange,
  clampVanafChange,
  DEFAULT_PALETTE,
  RECHARTS_PALETTE,
  seriesStyle,
  tableModel,
  valueLabelPlan,
  yAxisDomain,
  type PlottableSpec,
  RegionTooltip,
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

// WP218 phase 5 (Task 1): the pure row-builder for the horizontal-bar form —
// one row per series (region), the series' FIRST point (a comparison has
// exactly one period per region), spec order NEVER reordered (R6), null-safe
// for a series with no point at all. Mirrors buildRows' own test shape but
// against a minimal `PlottableSpec` literal (buildRegionRows only needs
// `kind`/`series`/`label`/`points`, same structural subset buildRows uses).
function regionSpec(series: PlottableSpec['series']): PlottableSpec {
  return { kind: 'bar', series };
}

describe('buildRegionRows', () => {
  it('builds one row per series in SPEC ORDER (R6 — never sorted, even when labels would sort differently)', () => {
    const s = regionSpec([
      { label: 'Zeeland', points: [{ periodCode: '2024JJ00', periodLabel: '2024', value: 3, formattedValue: '3,0', provisional: false, resultId: 'r-zeeland' }] },
      { label: 'Amsterdam', points: [{ periodCode: '2024JJ00', periodLabel: '2024', value: 9, formattedValue: '9,0', provisional: false, resultId: 'r-amsterdam' }] },
    ]);
    const { rows } = buildRegionRows(s, (i) => `color-${i}`);
    expect(rows.map((r) => r.label)).toEqual(['Zeeland', 'Amsterdam']);
  });

  it("carries value_display/value_provisional/value_resultId verbatim from each series' FIRST point", () => {
    const s = regionSpec([
      {
        label: 'Utrecht',
        points: [
          { periodCode: '2024JJ00', periodLabel: '2024', value: 42, formattedValue: '42,0', provisional: true, resultId: 'r-utrecht' },
          // A comparison has exactly one period per region — a second point
          // must never be read; pinning this catches an accidental [1] or
          // last-wins swap.
          { periodCode: '2025JJ00', periodLabel: '2025', value: 99, formattedValue: '99,0', provisional: false, resultId: 'r-utrecht-2' },
        ],
      },
    ]);
    const { rows } = buildRegionRows(s, (i) => `color-${i}`);
    expect(rows[0]).toEqual({
      label: 'Utrecht',
      value: 42,
      value_display: '42,0',
      value_provisional: true,
      value_resultId: 'r-utrecht',
      colorIndex: 0,
    });
  });

  it('a series with no point at all becomes a null row (null-safe), not a thrown error', () => {
    const s = regionSpec([{ label: 'Empty region', points: [] }]);
    const { rows } = buildRegionRows(s, (i) => `color-${i}`);
    expect(rows[0]).toEqual({
      label: 'Empty region',
      value: null,
      value_display: null,
      value_provisional: false,
      value_resultId: null,
      colorIndex: 0,
    });
  });

  it("colorIndex is the series' position, and colors[i] is colorFor(i) for every series", () => {
    const s = regionSpec([
      { label: 'A', points: [{ periodCode: '2024JJ00', periodLabel: '2024', value: 1, formattedValue: '1,0', provisional: false, resultId: 'r-a' }] },
      { label: 'B', points: [{ periodCode: '2024JJ00', periodLabel: '2024', value: 2, formattedValue: '2,0', provisional: false, resultId: 'r-b' }] },
      { label: 'C', points: [] },
    ]);
    const colorFor = vi.fn((i: number) => `#color${i}`);
    const { rows, colors } = buildRegionRows(s, colorFor);
    expect(rows.map((r) => r.colorIndex)).toEqual([0, 1, 2]);
    expect(colors).toEqual(['#color0', '#color1', '#color2']);
  });

  it('an empty series list yields empty rows and colors', () => {
    const { rows, colors } = buildRegionRows(regionSpec([]), (i) => `color-${i}`);
    expect(rows).toEqual([]);
    expect(colors).toEqual([]);
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
    expect(caveat.className).toContain('text-warning');
    expect(caveat.className).toContain('text-sm');
    const nullNote = screen.getByText('2022: geen gegevens beschikbaar (geheim).');
    expect(nullNote.className).toContain('text-warning');
    const credit = screen.getByText(s.attributionLine);
    expect(credit.className).toContain('text-xs');
    expect(credit.className).toContain('text-muted-foreground');
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
    expect(marker.className).toContain('text-muted-foreground');
    expect(marker.className).not.toContain('text-warning');
  });

  // Final review finding: annotationMarkers(viewSpec, rows) used to be called
  // against the spec's ORIGINAL kind, so a line-kind chart's curated
  // annotations stayed non-empty even after switching to Staaf -- but the
  // <ReferenceLine> elements that actually draw a marker only render inside
  // the LineChart JSX branch, never BarChart. The footer text below would
  // then claim "Gemarkeerd in de grafiek" (marked in the chart) while nothing
  // was visually marked, a false on-screen claim. Fixed by composing
  // `effectiveKind` into the call, mirroring how `valueLabelPlan` already
  // does it.
  it('#170(4)/honesty: stops claiming a marker is on the chart once a line-kind spec with a curated annotation is switched to Staaf', () => {
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
    expect(screen.getByText('Gemarkeerd in de grafiek: Testgebeurtenis 2024')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));

    expect(screen.queryByText(/Gemarkeerd in de grafiek/)).not.toBeInTheDocument();
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

// ADR 042 (2026-09-11): the colour-blind-safe DEFAULT_PALETTE is the default;
// the session-87 "basic Recharts" palette (RECHARTS_PALETTE) is kept for the Classic look.
describe('seriesStyle (ADR 042: the designed default palette)', () => {
  it('draws series in DEFAULT_PALETTE, in order, as literal hex', () => {
    const colors = [0, 1, 2, 3].map((i) => seriesStyle(i).color);
    expect(colors).toEqual(DEFAULT_PALETTE.slice(0, 4));
    expect(DEFAULT_PALETTE[0]).toBe('#0072b2');
    for (const c of RECHARTS_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('cycles the palette for series beyond its length — still a distinct, deterministic colour per index', () => {
    expect(seriesStyle(DEFAULT_PALETTE.length).color).toBe(DEFAULT_PALETTE[0]);
    expect(seriesStyle(DEFAULT_PALETTE.length + 1).color).toBe(DEFAULT_PALETTE[1]);
    expect(new Set(RECHARTS_PALETTE).size).toBe(RECHARTS_PALETTE.length);
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
    expect(finalBar?.getAttribute('fill')).toBe(DEFAULT_PALETTE[0]);
  });

  it('gives the chart an accessible name from spec strings and a keyboard hint in its <desc>', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    // WP218 phase 1: the Opmaak trigger's own icon is an <svg> too, rendered
    // ahead of the chart in DOM order — scoped to Recharts' own root class so
    // this keeps finding the CHART svg specifically, not the icon.
    const svg = container.querySelector('svg.recharts-surface')!;
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
    // WP218 phase 1: scoped past the Opmaak trigger's own icon <svg> — see
    // the accessible-name test above for why a bare 'svg' selector is now
    // ambiguous in this card.
    expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
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

// ---------------------------------------------------------------------------
// ADR 042 (2026-09-11): ChartView draws the designed default from the
// presentation resolver with no overrides — these are the default's literals
// (ends markers, horizontal grid, no y-axis line, 2 px lines, r 4 markers),
// pinned so the look cannot drift silently. The resolver's constants
// themselves are pinned by chart-presentation.test.ts.
// ---------------------------------------------------------------------------

describe('ADR 042 — the designed default renders its literals', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('line stroke-width 2, dot r 4 ring 2, horizontal grid only, no y-axis line', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const path = container.querySelector('.recharts-line-curve');
    expect(path?.getAttribute('stroke-width')).toBe('2');
    const dot = container.querySelector('circle[data-point="value"]');
    expect(dot?.getAttribute('r')).toBe('4');
    expect(dot?.getAttribute('stroke-width')).toBe('2');
    expect(container.querySelector('.recharts-cartesian-grid-horizontal')).not.toBeNull();
    expect(container.querySelector('.recharts-cartesian-grid-vertical')).toBeNull();
    expect(container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')).toBeNull();
  });
  it('ends markers by default: the first and last plotted point are drawn, the middle one is hidden (opacity 0, still a data point), a provisional middle point stays visible', () => {
    const s = spec({
      series: [
        {
          label: 'Nederland',
          regionCode: null,
          points: [
            point({ resultId: 'a', periodCode: '2022JJ00', periodLabel: '2022', value: 1, formattedValue: '1,0' }),
            point({ resultId: 'b', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0' }),
            point({ resultId: 'c', periodCode: '2024JJ00', periodLabel: '2024', value: 3, formattedValue: '3,0' }),
            point({ resultId: 'd', periodCode: '2025JJ00', periodLabel: '2025', value: 4, formattedValue: '4,0', provisional: true, status: 'Voorlopig' }),
            point({ resultId: 'e', periodCode: '2026JJ00', periodLabel: '2026', value: 5, formattedValue: '5,0' }),
          ],
        },
      ],
    });
    const { container } = render(<ChartView spec={s} />);
    const dots = [...container.querySelectorAll('circle[data-point="value"]')];
    expect(dots.length).toBe(5);
    const byId = (id: string) => dots.find((d) => d.getAttribute('data-result-id') === id)!;
    expect(byId('a').getAttribute('data-marker')).toBeNull();
    expect(byId('e').getAttribute('data-marker')).toBeNull();
    expect(byId('b').getAttribute('data-marker')).toBe('hidden');
    expect(byId('c').getAttribute('data-marker')).toBe('hidden');
    expect(byId('d').getAttribute('data-marker')).toBeNull();
    expect(byId('d').getAttribute('fill')).toBe('var(--card)');
    expect(byId('b').getAttribute('opacity')).toBe('0');
    expect(byId('a').getAttribute('opacity')).toBeNull();
  });
  it('value labels are 12 px with a card-coloured halo (paint-order stroke) — end label on a line, bar label on a bar', () => {
    const line = render(<ChartView spec={threePointSpec()} />).container;
    const end = line.querySelector('text[data-role="end-label"]')!;
    expect(end.getAttribute('font-size')).toBe('12');
    expect(end.getAttribute('paint-order')).toBe('stroke');
    expect(end.getAttribute('stroke')).toBe('var(--card)');
    expect(end.getAttribute('stroke-width')).toBe('3');
    const axisTick = line.querySelector('text[data-role="axis-tick"]')!;
    expect(axisTick.getAttribute('font-size')).toBe('11');
    const bar = render(<ChartView spec={spec({ kind: 'bar', series: [{ label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'x', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' })] }] })} />).container;
    const barLabel = bar.querySelector('text[data-role="bar-label"]')!;
    expect(barLabel.getAttribute('font-size')).toBe('12');
    expect(barLabel.getAttribute('paint-order')).toBe('stroke');
    expect(barLabel.getAttribute('stroke')).toBe('var(--card)');
  });
  it('a marker hidden by the marker mode becomes visible while it holds keyboard focus (globals.css rule pinned)', () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const globalsCssPath = join(currentDir, '../app/globals.css');
    const css = readFileSync(globalsCssPath, 'utf8');
    expect(css).toMatch(/circle\[data-marker="hidden"\]:focus-visible\s*\{\s*opacity:\s*1;?\s*\}/);
  });
  it('a hairline baseline in the grid colour replaces the x-axis line by default; Aslijnen on draws real axis lines; grid Geen removes the baseline too', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const xLine = () => container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line');
    const yLine = () => container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line');
    expect(xLine()?.getAttribute('stroke')).toBe('var(--border)');
    expect(yLine()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aslijnen' }));
    expect(xLine()?.getAttribute('stroke')).toBe('var(--muted-foreground)');
    expect(yLine()?.getAttribute('stroke')).toBe('var(--muted-foreground)');
    fireEvent.click(screen.getByRole('button', { name: 'Aslijnen' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Geen' }));
    expect(xLine()).toBeNull();
  });
  it('baselineAxisLine: full axis line when shown; a grid-coloured hairline when hidden but a grid exists; nothing when neither', () => {
    expect(baselineAxisLine({ axisLines: 'shown', grid: 'none' })).toBe(true);
    expect(baselineAxisLine({ axisLines: 'hidden', grid: 'horizontal' })).toEqual({ stroke: 'var(--border)' });
    expect(baselineAxisLine({ axisLines: 'hidden', grid: 'both' })).toEqual({ stroke: 'var(--border)' });
    expect(baselineAxisLine({ axisLines: 'hidden', grid: 'none' })).toBe(false);
  });
  it('the bar and horizontal-bar forms get the same hairline baseline on their category axis', () => {
    const cmp = spec({
      kind: 'bar',
      series: [
        { label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'a', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' })] },
        { label: 'Rotterdam', regionCode: 'GM0599', points: [point({ resultId: 'r', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0' })] },
      ],
    });
    const { container } = render(<ChartView spec={cmp} />);
    expect(container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line')?.getAttribute('stroke')).toBe('var(--border)');
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    expect(container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')?.getAttribute('stroke')).toBe('var(--border)');
    expect(container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line')).toBeNull();
  });
  it('the tooltip crosshair is a solid hairline, never the dashed 3 3 of an event marker or the 4 3 of the story ring (source pin)', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, './chart.tsx'), 'utf8');
    const cursors = src.match(/cursor=\{\{[^}]*stroke: 'var\(--muted-foreground\)'[^}]*\}\}/g) ?? [];
    expect(cursors.length).toBe(2);
    for (const c of cursors) {
      expect(c).not.toContain('strokeDasharray');
      expect(c).toContain('strokeOpacity: 0.35');
    }
  });
  it('height follows width: unmeasured (jsdom) keeps the 256 px class and no inline height', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const panel = () => container.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel().className).toContain('h-64');
    expect(panel().style.height).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ADR 042: the remaining Task 4 literals (height-follows-width once
// measured, the mount entrance, the header hierarchy, the chip legend) — a
// sibling of the describe block above rather than sharing its body, because
// the "unmeasured (jsdom)" test just above depends on NO ResizeObserver
// being stubbed while every test here needs `FakeResizeObserver` stubbed —
// two contradictory `beforeEach`es would fight over the same block.
// ---------------------------------------------------------------------------

describe('ADR 042 — height follows width once measured', () => {
  type ResizeCallback = (entries: { target: Element }[]) => void;
  // Recharts' own ResponsiveContainer ALSO constructs a ResizeObserver (on
  // its own inner wrapper div, a descendant of the tabpanel) once the
  // global is stubbed, and — as a child — its effect commits before
  // ChartView's own `useElementWidth` effect (React fires child effects
  // before parent effects), so a plain "callbacks[0]" would fire Recharts'
  // own handler instead of ours and crash (it reads `entry.contentRect`,
  // which this fake never provides). Recording each instance's own
  // `observe()` target lets the test pick out the ONE observer that was
  // pointed at the tabpanel itself, regardless of how many others exist.
  let resizeObservers: Array<{ cb: ResizeCallback; target: Element | null }> = [];
  class FakeResizeObserver {
    private readonly entry: { cb: ResizeCallback; target: Element | null };
    constructor(cb: ResizeCallback) {
      this.entry = { cb, target: null };
      resizeObservers.push(this.entry);
    }
    observe(target: Element): void { this.entry.target = target; }
    disconnect(): void { resizeObservers = resizeObservers.filter((e) => e !== this.entry); }
  }
  function fireResize(target: Element): void {
    const entry = resizeObservers.find((e) => e.target === target);
    if (!entry) throw new Error('no FakeResizeObserver was pointed at this element');
    act(() => entry.cb([{ target }]));
  }

  beforeEach(() => {
    resizeObservers = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a measured width sets the explicit height (700 → 360, 400 → 256) and the class no longer pins h-64', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    panel.getBoundingClientRect = () => ({ width: 700 }) as DOMRect;
    fireResize(panel);
    expect(panel.style.height).toBe('360px');
    expect(panel.className).not.toContain('h-64');
    panel.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
    fireResize(panel);
    expect(panel.style.height).toBe('256px');
  });
  it('a frame aspect ratio switches the measured height off — the frame sizes the box and the container goes h-full with no inline height', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    panel.getBoundingClientRect = () => ({ width: 700 }) as DOMRect;
    fireResize(panel);
    expect(panel.style.height).toBe('360px');
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kader' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Breedbeeld' }));
    const after = container.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(after.style.height).toBe('');
    expect(after.className).toContain('h-full');
  });
  it('the export container carries the entrance utilities, with the reduced-motion opt-out', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    for (const cls of ['animate-in', 'fade-in', 'slide-in-from-bottom-1', 'duration-300', 'motion-reduce:animate-none']) {
      expect(panel.className).toContain(cls);
    }
  });
  it('the card header: a semibold base-size title, then the unit and the pinned dimensions on one muted line', () => {
    const s = spec({ dimLabels: { Geslacht: 'Totaal' } });
    const { container } = render(<ChartView spec={s} />);
    const heading = container.querySelector('[role="heading"][aria-level="3"]') as HTMLElement;
    expect(heading.className).toContain('text-base');
    expect(heading.className).toContain('font-semibold');
    const subtitle = heading.nextElementSibling as HTMLElement;
    expect(subtitle.className).toContain('text-muted-foreground');
    expect(subtitle.textContent).toContain(s.unit);
    expect(subtitle.textContent).toContain('Geslacht: Totaal');
  });
  it('legend entries are chips (rounded-full, bordered) and keep their toggle semantics', () => {
    const { container } = render(<ChartView spec={twoSeriesSpec()} />);
    const legendButtons = [...container.querySelectorAll('[role="group"] button[aria-pressed="true"]')];
    expect(legendButtons.length).toBeGreaterThan(0);
    for (const b of legendButtons) {
      expect(b.className).toContain('rounded-full');
      expect(b.className).toContain('border');
    }
  });
});

describe('RegionTooltip (WP218 phase 5, Liggend) — binding, not just membership', () => {
  it('shows the region, the period and the region\'s OWN display string inside the node bound to its resultId, with the provisional mark', () => {
    const s = spec({
      kind: 'bar',
      series: [
        { label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'cell-ams', periodCode: '2023JJ00', periodLabel: '2023', value: 1.1, formattedValue: '1,1' })] },
        { label: 'Rotterdam', regionCode: 'GM0599', points: [point({ resultId: 'cell-rot', periodCode: '2023JJ00', periodLabel: '2023', value: 2.2, formattedValue: '2,2', provisional: true, status: 'Voorlopig' })] },
      ],
    });
    const { rows } = buildRegionRows(s, () => '#000000');
    const { container } = render(<RegionTooltip active payload={[{ payload: { ...rows[1], key: 's1', color: '#000000', dimmed: false, patternId: 'p1' } }]} periodLabel="2023" />);
    const bound = container.querySelector('[data-label-for="cell-rot"]');
    expect(bound).not.toBeNull();
    expect(bound!.textContent).toBe('2023: 2,2 *');
    expect(container.textContent).toContain('Rotterdam');
    expect(container.querySelector('[data-label-for="cell-ams"]')).toBeNull();
    expect(container.firstElementChild!.getAttribute('role')).toBe('status');
  });
  it('renders nothing for a null cell or when inactive', () => {
    const s = spec({ kind: 'bar', series: [{ label: 'X', regionCode: null, points: [] }] });
    const { rows } = buildRegionRows(s, () => '#000000');
    const row = { ...rows[0], key: 's0', color: '#000000', dimmed: false, patternId: 'p0' };
    expect(render(<RegionTooltip active payload={[{ payload: row }]} periodLabel="2023" />).container.firstElementChild).toBeNull();
    expect(render(<RegionTooltip active={false} payload={[{ payload: row }]} periodLabel="2023" />).container.firstElementChild).toBeNull();
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

  it('offers a Lijn/Tabel switch, chart first, and swaps to a table bound cell-by-cell to the spec', () => {
    // Task 3 renamed the chart tab from the old generic "Grafiek" to the
    // form it actually renders ("Lijn", since threePointSpec is kind: 'line').
    const { container } = render(<ChartView spec={threePointSpec()} />);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('svg.recharts-surface')).toBeNull();
    const table = screen.getByRole('table', { name: 'Testreeks (%)' });
    expect(table.querySelector('[data-label-for="lo"]')?.textContent).toBe('1,5');
    expect(table.querySelector('[data-label-for="hi"]')?.textContent).toBe('3,3');
    // Image download makes no sense for a table — the menu is not offered there.
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
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
    expect(container.querySelector('svg.recharts-surface')).toBeNull();
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

  it('keeps the user-chosen Tabel view when the SAME ChartView instance is handed a different spec without remounting, instead of reverting to that new spec\'s own default form', () => {
    // Mirrors the old (pre-reducer) code's deliberate `view` exemption from
    // the spec-swap reset: view is presentationally valid for ANY spec, so
    // carrying it across a swap is not a leak worth clearing. Both specs
    // here are plain single-series line charts, so each one's OWN default
    // form is 'line' (Lijn) -- if the swap silently reset to that
    // default, this would catch it.
    const { rerender } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveAttribute('aria-selected', 'true');

    rerender(<ChartView spec={threePointSpec({ title: 'Andere reeks' })} />);
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('table', { name: 'Andere reeks (%)' })).toBeInTheDocument();
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

  it('final-review fix: leaving small multiples on and switching to Staaf brings the download menu back (it no longer stays hidden on an ordinary bar chart)', () => {
    render(<ChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    // smallMultiplesAvailable goes false on Staaf (it's a line-only view),
    // but the `smallMultiples` state itself is still true — the download
    // menu must key off BOTH, exactly like the container/render branch do,
    // not `smallMultiples` alone.
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
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

// Task 3 (line/bar/table form switch) fixtures — self-contained per-spec
// factories built on the file's own point()/spec() helpers rather than
// duplicating them, per the plan's "reuse the existing declaration" note.
function twoSeriesLineSpec(): ChartSpec {
  return spec({
    kind: 'line',
    series: [
      {
        label: 'Nederland',
        regionCode: null,
        points: [
          point({ resultId: 'nl-2020', periodCode: '2020', periodLabel: '2020', value: 100, formattedValue: '100' }),
          point({ resultId: 'nl-2021', periodCode: '2021', periodLabel: '2021', value: 110, formattedValue: '110' }),
        ],
      },
      {
        label: 'Utrecht',
        regionCode: 'GM0344',
        points: [
          point({ resultId: 'ut-2020', periodCode: '2020', periodLabel: '2020', value: 50, formattedValue: '50' }),
          point({ resultId: 'ut-2021', periodCode: '2021', periodLabel: '2021', value: 55, formattedValue: '55' }),
        ],
      },
    ],
  });
}

function multiRegionBarSpec(): ChartSpec {
  return spec({
    kind: 'bar',
    series: [
      {
        label: 'Groningen',
        regionCode: 'PV20',
        points: [point({ resultId: 'gr-2021', periodCode: '2021', periodLabel: '2021', value: 10, formattedValue: '10' })],
      },
      {
        label: 'Friesland',
        regionCode: 'PV21',
        points: [point({ resultId: 'fr-2021', periodCode: '2021', periodLabel: '2021', value: 20, formattedValue: '20' })],
      },
      {
        label: 'Drenthe',
        regionCode: 'PV22',
        points: [point({ resultId: 'dr-2021', periodCode: '2021', periodLabel: '2021', value: 15, formattedValue: '15' })],
      },
    ],
  });
}

function negativeValueLineSpec(): ChartSpec {
  return spec({
    kind: 'line',
    series: [
      {
        label: 'Nederland',
        regionCode: null,
        points: [
          point({ resultId: 'neg-2020', periodCode: '2020', periodLabel: '2020', value: -5, formattedValue: '-5' }),
          point({ resultId: 'neg-2021', periodCode: '2021', periodLabel: '2021', value: 10, formattedValue: '10' }),
        ],
      },
    ],
  });
}

// Single-series bar-kind spec: unlike multiRegionBarSpec (3 series, Lijn
// disabled by the honesty guard), one series means Lijn stays allowed — the
// case this switches into a line form whose spec.kind was always 'bar'.
function singleRegionBarSpec(): ChartSpec {
  return spec({
    kind: 'bar',
    series: [
      {
        label: 'Groningen',
        regionCode: 'PV20',
        points: [point({ resultId: 'gr-2021', periodCode: '2021', periodLabel: '2021', value: 10, formattedValue: '10' })],
      },
    ],
  });
}

describe('ChartView form switch', () => {
  it('offers Lijn, Staaf and Tabel controls', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Staaf' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tabel' })).toBeInTheDocument();
  });

  it('disables Lijn for a multi-region comparison (bar) chart and explains why', () => {
    const s = multiRegionBarSpec();
    render(<ChartView spec={s} />);
    const lineTab = screen.getByRole('tab', { name: 'Lijn' });
    expect(lineTab).toBeDisabled();
    expect(lineTab).toHaveAttribute('title', expect.stringContaining('regio'));
  });

  it('switching to Staaf renders a BarChart-shaped structure for a line-kind spec', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(document.querySelector('.recharts-bar')).not.toBeNull();
  });

  it('bar form always domains the Y-axis at zero, even for an originally line-kind spec', () => {
    const s = negativeValueLineSpec();
    render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    // yAxisDomain is exercised indirectly via Recharts' rendered axis; assert
    // the exported yAxisDomain function directly instead for a hermetic check:
    expect(yAxisDomain('bar')).toEqual([0, 'auto']);
  });

  it('never renders a connected line across regions after a same-instance spec swap into a disallowed multi-region comparison', () => {
    // The visual dock and Ontdek's reading toggle swap `spec` on the SAME
    // mounted ChartView (no `key`), and the reset action deliberately
    // preserves the previously chosen form across that swap. Picking Lijn
    // on an allowed spec, then handing the same instance a multi-region bar
    // spec, must not carry the 'line' form into a spec where it's forbidden.
    const { container, rerender } = render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(container.querySelector('.recharts-line')).not.toBeNull();

    rerender(<ChartView spec={multiRegionBarSpec()} />);
    expect(container.querySelector('.recharts-line')).toBeNull();
    expect(container.querySelector('.recharts-bar')).not.toBeNull();
  });

  // Final review finding: aria-selected/tabIndex/segment styling on the three
  // tab buttons used to read `state.form` directly. In the exact scenario
  // above (a stale 'line' form surviving a same-instance spec swap into a
  // newly-disallowed multi-region spec), that made the Lijn tab both
  // aria-selected={true} and tabIndex={0} while also `disabled` -- and,
  // because the code assumed exactly one tab matches `state.form`, neither
  // Staaf nor Tabel got tabIndex={0} either. No tab in the tablist was
  // reachable by keyboard Tab at all. Fixed by deriving one `activeForm`
  // value (the same "disallowed line falls back to bar" projection
  // `effectiveKind` already used) and reading it everywhere the tablist
  // decides aria-selected/tabIndex.
  it('keeps exactly one tab keyboard-reachable when a stale Lijn form meets a newly-disallowed multi-region spec', () => {
    const { rerender } = render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(screen.getByRole('tab', { name: 'Lijn' }).tabIndex).toBe(0);

    // No `key` change -- same mounted ChartView instance, same as the test
    // above. The reducer's `reset` action preserves `state.form === 'line'`
    // across the swap, but this new spec has 3 series and kind 'bar', so
    // canUseLine is now false.
    rerender(<ChartView spec={multiRegionBarSpec()} />);

    const lineTab = screen.getByRole('tab', { name: 'Lijn' });
    const barTab = screen.getByRole('tab', { name: 'Staaf' });
    const tableTab = screen.getByRole('tab', { name: 'Tabel' });
    expect(lineTab).toBeDisabled();

    const focusable = [lineTab, barTab, tableTab].filter((tab) => tab.tabIndex === 0);
    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toBe(barTab);
    expect(barTab).toHaveAttribute('aria-selected', 'true');
    expect(lineTab).toHaveAttribute('aria-selected', 'false');
    expect(tableTab).toHaveAttribute('aria-selected', 'false');
  });

  // Regression: valueLabelPlan(spec) branched on the ORIGINAL spec.kind, not
  // effectiveKind, so a spec switched to a different form kept the labels of
  // its original kind — always empty for the new one. A line-kind spec shown
  // as Staaf got no bar labels; a bar-kind spec shown as Lijn got no axis
  // ticks/end labels. Both would silently strip the "honesty-bound custom
  // ticks and labels" this file's own top-of-file comment describes as
  // load-bearing.
  it('shows bar value labels when a line-kind spec is switched to Staaf', () => {
    const s = twoSeriesLineSpec();
    const { container } = render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(container.querySelector('.recharts-bar')).not.toBeNull();
    expect(container.querySelector('[data-role="bar-label"]')).not.toBeNull();
  });

  it('shows axis tick / end-of-line labels when a single-series bar-kind spec is switched to Lijn', () => {
    const s = singleRegionBarSpec();
    const { container } = render(<ChartView spec={s} />);
    const lineTab = screen.getByRole('tab', { name: 'Lijn' });
    expect(lineTab).not.toBeDisabled();
    fireEvent.click(lineTab);
    expect(container.querySelector('.recharts-line')).not.toBeNull();
    expect(
      container.querySelector('[data-role="axis-tick"], [data-role="end-label"]'),
    ).not.toBeNull();
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

// Task 4: single-series line-kind spec spanning four periods, used to test
// the Vanaf/Tot period-range zoom control.
function fourYearLineSpec(): ChartSpec {
  return spec({
    kind: 'line',
    attribution: { ...spec().attribution, coveredPeriods: { from: '2018', to: '2021' } },
    series: [
      {
        label: 'Nederland',
        regionCode: null,
        points: [
          point({ resultId: 'nl-2018', periodCode: '2018', periodLabel: '2018', value: 100, formattedValue: '100' }),
          point({ resultId: 'nl-2019', periodCode: '2019', periodLabel: '2019', value: 105, formattedValue: '105' }),
          point({ resultId: 'nl-2020', periodCode: '2020', periodLabel: '2020', value: 110, formattedValue: '110' }),
          point({ resultId: 'nl-2021', periodCode: '2021', periodLabel: '2021', value: 115, formattedValue: '115' }),
        ],
      },
    ],
  });
}

// Extends fourYearLineSpec with attribution.trendHeadline set, to test that
// zooming suppresses the trend headline (it describes the full range, not a
// narrowed one).
function trendHeadlineLineSpec(): ChartSpec {
  const base = fourYearLineSpec();
  return { ...base, attribution: { ...base.attribution, trendHeadline: 'Nederland steeg gestaag sinds 2018.' } };
}

// Two-series, four-period line spec used to prove ChartSmallMultiples
// receives the *windowed* spec (viewSpec), not the raw unwindowed one.
// Nederland's own min sits on the period that gets zoomed out (2018) and its
// max sits on a period that survives (2021), so valueLabelPlan's own-axis
// endpoint ticks (see ChartSmallMultiples' "Eigen assen" mode) shift once
// windowed: the 2018-tagged tick must disappear and a tick tagged to a
// surviving period must appear in its place.
function twoSeriesFourYearLineSpec(): ChartSpec {
  return spec({
    kind: 'line',
    attribution: { ...spec().attribution, coveredPeriods: { from: '2018', to: '2021' } },
    series: [
      {
        label: 'Nederland',
        regionCode: null,
        points: [
          point({ resultId: 'nl-2018', periodCode: '2018', periodLabel: '2018', value: 50, formattedValue: '50' }),
          point({ resultId: 'nl-2019', periodCode: '2019', periodLabel: '2019', value: 100, formattedValue: '100' }),
          point({ resultId: 'nl-2020', periodCode: '2020', periodLabel: '2020', value: 105, formattedValue: '105' }),
          point({ resultId: 'nl-2021', periodCode: '2021', periodLabel: '2021', value: 110, formattedValue: '110' }),
        ],
      },
      {
        label: 'Utrecht',
        regionCode: 'GM0344',
        points: [
          point({ resultId: 'ut-2018', periodCode: '2018', periodLabel: '2018', value: 30, formattedValue: '30' }),
          point({ resultId: 'ut-2019', periodCode: '2019', periodLabel: '2019', value: 40, formattedValue: '40' }),
          point({ resultId: 'ut-2020', periodCode: '2020', periodLabel: '2020', value: 42, formattedValue: '42' }),
          point({ resultId: 'ut-2021', periodCode: '2021', periodLabel: '2021', value: 44, formattedValue: '44' }),
        ],
      },
    ],
  });
}

describe('ChartView period-range zoom', () => {
  it('offers Vanaf/Tot period selectors for a line-kind chart with multiple periods', () => {
    const s = fourYearLineSpec();
    render(<ChartView spec={s} />);
    expect(screen.getByLabelText('Vanaf')).toBeInTheDocument();
    expect(screen.getByLabelText('Tot')).toBeInTheDocument();
  });

  it('narrowing the range hides points outside it and shows a disclosure note', () => {
    const s = fourYearLineSpec();
    const { container } = render(<ChartView spec={s} />);
    fireEvent.change(screen.getByLabelText('Vanaf'), { target: { value: '2019' } });
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2020' } });
    expect(screen.getByText(/2019.*2020/)).toBeInTheDocument();
    // Scoped to the plotted chart panel, not the whole screen: the Vanaf/Tot
    // selects deliberately keep listing every period (including 2018) so the
    // zoom can be widened back out — that's an available *option*, not
    // plotted data. What must actually disappear once windowed is 2018 as a
    // point on the chart itself.
    const chartPanel = container.querySelector('[role="tabpanel"][aria-label="Grafiek"]') as HTMLElement;
    expect(within(chartPanel).queryByText('2018')).not.toBeInTheDocument();
  });

  it('suppresses the trend headline while a period range is active', () => {
    const s = trendHeadlineLineSpec();
    render(<ChartView spec={s} />);
    expect(screen.getByTestId('trend-headline')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vanaf'), { target: { value: '2019' } });
    expect(screen.queryByTestId('trend-headline')).not.toBeInTheDocument();
  });

  it('does not offer a zoom control for a bar (comparison) chart', () => {
    const s = multiRegionBarSpec();
    render(<ChartView spec={s} />);
    expect(screen.queryByLabelText('Vanaf')).not.toBeInTheDocument();
  });

  // Regression: ChartSmallMultiples was still being handed the raw,
  // unwindowed spec, so zooming the main view did nothing to the small
  // multiples panels -- a silent honesty gap (they'd show the full range
  // with no indication they differ from the just-zoomed main view).
  it('also windows the small-multiples panels once zoomed (not just the main chart)', () => {
    const s = twoSeriesFourYearLineSpec();
    const { container } = render(<ChartView spec={s} />);
    fireEvent.change(screen.getByLabelText('Vanaf'), { target: { value: '2019' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    // "Eigen assen" is the mode whose own-axis endpoint ticks are bound to a
    // resultId (data-label-for) -- the same axis-tick technique the #197
    // step-1 tests already use (svg [data-role="axis-tick"][data-label-for]).
    fireEvent.click(screen.getByRole('button', { name: 'Eigen assen' }));
    const nlPanel = container.querySelector('[data-panel-for="s0"]') as HTMLElement;
    expect(nlPanel.querySelector('[data-role="axis-tick"][data-label-for="nl-2018"]')).toBeNull();
    expect(nlPanel.querySelector('[data-role="axis-tick"][data-label-for="nl-2021"]')).not.toBeNull();
  });

  // Code-review follow-up: the clamp logic moved out of the inline onChange
  // handlers into two named pure functions so Vanaf and Tot can't drift out
  // of sync independently — unit-tested directly here, hermetically.
  it('clampVanafChange pins the new Vanaf and drags Tot up only when Tot would be before it', () => {
    expect(clampVanafChange('2021', '2019')).toEqual(['2021', '2021']);
    expect(clampVanafChange('2019', '2021')).toEqual(['2019', '2021']);
    expect(clampVanafChange('2020', '2020')).toEqual(['2020', '2020']);
  });

  it('clampTotChange pins the new Tot and drags Vanaf down only when Vanaf would be after it', () => {
    expect(clampTotChange('2021', '2019')).toEqual(['2019', '2019']);
    expect(clampTotChange('2019', '2021')).toEqual(['2019', '2021']);
    expect(clampTotChange('2020', '2020')).toEqual(['2020', '2020']);
  });

  // Regression: neither selector clamped against the other, so picking a
  // Vanaf past the current Tot (or vice versa) produced an inverted range --
  // windowSpec correctly returned zero points (never fabricated data), but
  // the on-screen AND exported disclosure sentence read as nonsense
  // ("Getoond: 2021-2019 van ...").
  it('clamps Tot up to Vanaf when Vanaf is moved past it', () => {
    const s = fourYearLineSpec();
    render(<ChartView spec={s} />);
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2019' } });
    fireEvent.change(screen.getByLabelText('Vanaf'), { target: { value: '2021' } });
    expect(screen.getByLabelText<HTMLSelectElement>('Vanaf').value).toBe('2021');
    expect(screen.getByLabelText<HTMLSelectElement>('Tot').value).toBe('2021');
    expect(screen.getByText(/2021.*2021/)).toBeInTheDocument();
  });

  it('clamps Vanaf down to Tot when Tot is moved before it', () => {
    const s = fourYearLineSpec();
    render(<ChartView spec={s} />);
    fireEvent.change(screen.getByLabelText('Vanaf'), { target: { value: '2021' } });
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2019' } });
    expect(screen.getByLabelText<HTMLSelectElement>('Vanaf').value).toBe('2019');
    expect(screen.getByLabelText<HTMLSelectElement>('Tot').value).toBe('2019');
    expect(screen.getByText(/2019.*2019/)).toBeInTheDocument();
  });

  // Regression: small multiples always drew LineChart panels regardless of
  // the form switch, so choosing Staaf while small multiples was on kept
  // silently showing lines -- the bar-zero-axis rule was bypassed by
  // drawing no bar at all, not by drawing a dishonest one. Gated off rather
  // than given its own bar path (cheapest, most conservative fix).
  it('turns off small multiples availability once the form is switched away from Lijn', () => {
    const s = twoSeriesFourYearLineSpec();
    render(<ChartView spec={s} />);
    expect(screen.getByRole('button', { name: 'Kleine grafieken' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(screen.queryByRole('button', { name: 'Kleine grafieken' })).not.toBeInTheDocument();
  });
});

// Task 5 (#212 series highlight): a second, independent legend interaction —
// highlighting a series dims the others via strokeOpacity/fillOpacity,
// without hiding them (that stays the existing toggle's job). Reuses
// twoSeriesLineSpec (Task 3 fixture, series labelled 'Nederland'/'Utrecht')
// rather than duplicating a spec factory.
describe('ChartView series highlight', () => {
  it('offers a highlight control per series alongside the hide toggle', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    expect(screen.getByRole('button', { name: /Markeer Nederland/ })).toBeInTheDocument();
  });

  it('marks the highlighted series pressed and dims the un-highlighted one', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('button', { name: /Markeer Nederland/ }));
    expect(screen.getByRole('button', { name: /Markeer Nederland/ })).toHaveAttribute('aria-pressed', 'true');
    // Empirically verified against the installed Recharts (3.10.1): the
    // `data-series-dimmed`/`stroke-opacity` props passed to <Line> land on
    // its rendered `<path class="recharts-curve recharts-line-curve" ...>`,
    // not on a `.recharts-line`-classed node as the plan assumed (that class
    // is on the outer <g> wrapper, one level up, which never receives this
    // custom prop) -- so this asserts the attribute directly rather than
    // requiring a specific wrapper class.
    const dimmedLine = document.querySelector('[data-series-dimmed="true"]');
    expect(dimmedLine).not.toBeNull();
    expect(dimmedLine).toHaveAttribute('stroke-opacity', '0.25');
  });

  it('clicking the same highlight button again clears the highlight', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    const btn = screen.getByRole('button', { name: /Markeer Nederland/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-series-dimmed="true"]')).toBeNull();
  });

  // Review finding (#212): hiding the currently-highlighted series left
  // `highlightedKey` pointing at a series no longer drawn, so the OTHER
  // still-visible series stayed dimmed to 0.25 opacity with nothing actually
  // highlighted -- a confusing, reachable dead state. Fixed at the reducer
  // level (chartViewReducer's 'toggleSeries' case clears highlightedKey when
  // the key being hidden was the highlighted one), so this asserts the
  // observable effect: hiding the highlighted series un-dims the remaining
  // visible one and drops its own now-meaningless pressed state.
  it('hiding the highlighted series clears the highlight instead of leaving the other series dimmed', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    const highlightBtn = screen.getByRole('button', { name: /Markeer Nederland/ });
    fireEvent.click(highlightBtn);
    expect(highlightBtn).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[data-series-dimmed="true"]')).not.toBeNull();

    // Hide the highlighted series ("Nederland") via its pre-existing hide
    // toggle -- the first button in its legend entry, accessible name is
    // just the series label.
    fireEvent.click(screen.getByRole('button', { name: 'Nederland' }));

    expect(highlightBtn).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-series-dimmed="true"]')).toBeNull();
  });
});

describe('ChartView click-to-annotate', () => {
  it('clicking a chart point opens the note entry form for that point', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    const dot = document.querySelector('circle[data-point="value"]')!;
    fireEvent.click(dot);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('a saved note is never rendered inside the chart export container', () => {
    const s = twoSeriesLineSpec();
    const { container } = render(<ChartView spec={s} />);
    const dot = document.querySelector('circle[data-point="value"]')!;
    fireEvent.click(dot);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Test notitie' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));
    const exportContainer = container.querySelector('[role="tabpanel"][aria-label="Grafiek"]');
    expect(exportContainer?.textContent).not.toContain('Test notitie');
    expect(screen.getByText('Test notitie')).toBeInTheDocument();
  });

  it('does not carry a pending click or a saved note over to a different spec on the same mounted instance', () => {
    const s = twoSeriesLineSpec();
    const { rerender } = render(<ChartView spec={s} />);
    const dot = document.querySelector('circle[data-point="value"]')!;
    fireEvent.click(dot);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Blijft niet over' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));
    expect(screen.getByText('Blijft niet over')).toBeInTheDocument();

    rerender(<ChartView spec={multiRegionBarSpec()} />);
    expect(screen.queryByText('Blijft niet over')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // Fix 3 (#212 review): the clickable point marker has role="button" and
  // tabIndex={0} so a keyboard user can Tab to it and hear its aria-label,
  // but an SVG element with a synthetic role="button" gets no native
  // Enter/Space activation from the browser the way a real <button> would.
  // Without an onKeyDown handler mirroring onClick, pressing Enter or Space
  // on a focused point silently does nothing.
  it('pressing Enter on a focused chart point opens the note entry form, same as a click', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    const dot = document.querySelector('circle[data-point="value"]')!;
    fireEvent.keyDown(dot, { key: 'Enter' });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('pressing Space on a focused chart point also opens the note entry form', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    const dot = document.querySelector('circle[data-point="value"]')!;
    fireEvent.keyDown(dot, { key: ' ' });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  // Final review finding: a new note's id used to be
  // `${resultId}-${prev.length}` -- not monotonic, since `prev.length`
  // shrinks on delete. Two notes on the SAME point could end up with an
  // identical id after a delete-then-recreate sequence, and `onDelete`
  // filters by id, so deleting ONE of them silently deleted BOTH. This
  // reproduces that exact sequence: a note on P1, a note on P2, delete the P1
  // note (shrinking the notes array), a second note on P2 (recreating the
  // collision under the old scheme), then delete one of the two P2 notes.
  it('deleting one note leaves the other note on the same point intact, even after a delete-then-recreate sequence', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);

    const dotFor = (resultId: string): Element =>
      Array.from(document.querySelectorAll('circle[data-point="value"]')).find(
        (el) => el.getAttribute('data-result-id') === resultId,
      )!;
    const addNote = (resultId: string, text: string): void => {
      fireEvent.click(dotFor(resultId));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));
    };
    const noteItems = (): HTMLElement[] => Array.from(document.querySelectorAll('ul li'));
    const deleteNoteByText = (text: string): void => {
      const li = noteItems().find((el) => el.textContent?.includes(text))!;
      fireEvent.click(within(li).getByRole('button', { name: /verwijder/i }));
    };

    // twoSeriesLineSpec's points carry resultIds 'nl-2020'/'nl-2021'
    // (Nederland, P1) and 'ut-2020'/'ut-2021' (Utrecht, P2).
    addNote('nl-2020', 'P1 note');
    addNote('ut-2020', 'P2 note A');
    deleteNoteByText('P1 note');
    addNote('ut-2020', 'P2 note B');

    expect(noteItems()).toHaveLength(2);
    deleteNoteByText('P2 note A');

    expect(screen.queryByText(/P1 note/)).not.toBeInTheDocument();
    expect(screen.queryByText(/P2 note A/)).not.toBeInTheDocument();
    expect(screen.getByText(/P2 note B/)).toBeInTheDocument();
    expect(noteItems()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// WP218 phase 1, Task 7 (#218 chart styling): mounting the Opmaak panel on
// every ChartView. Phase 0 already wired every Recharts prop to
// `resolvePresentation`'s output (`pres`) and Task 5/6 already built
// ChartConfigPanel as a dumb component over that resolver (tested in
// chart-config-panel.test.tsx in isolation) — this task's own job is purely
// the WIRING: mount the panel as a sibling of the Weergave tablist,
// `onChange`/`onReset` into the reducer's `setPresentation`/
// `resetPresentation` actions, and an `aria-describedby` bridge from the
// disabled Lijn tab's existing `title` to a visually-hidden reason span. The
// tests below prove the END-TO-END path (a click in the panel really changes
// the rendered chart), not the resolver's own logic (chart-presentation.
// test.ts) or the panel's own rendering rules (chart-config-panel.test.tsx).
// ---------------------------------------------------------------------------

/** Same walker as the two membership tests above ("ADR 018 membership
 * check" and "membership over the REAL svg"), factored out here because this
 * describe block runs it twice (a line spec and a bar spec) with the panel
 * open on every one of its own tabs. */
function scanForUnboundDigits(container: HTMLElement, specStrings: string[]): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const tokens: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
  }
  expect(tokens.length).toBeGreaterThan(0);
  for (const tok of tokens) {
    expect(
      specStrings.some((str) => str.includes(tok)),
      `numeric token "${tok}" in the rendered DOM has no source in the spec's own strings`,
    ).toBe(true);
  }
}

describe('WP218 phase 1 — the Opmaak panel on the chart card', () => {
  it('pre-fills with what is on screen: after Dik, the line is 3 px and the panel says Dik; after Lijn→Staaf→Lijn it still says Dik', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dik' }));
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('3');
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(screen.getByRole('radio', { name: 'Dik' })).toHaveAttribute('aria-checked', 'true');
  });

  it('R11: with "Alleen voorlopige" the hollow marker stays, final dots are transparent but still present as points', () => {
    const s = threePointSpec({
      series: [
        {
          label: 'Nederland',
          regionCode: 'NL01',
          points: [
            point({ resultId: 'lo', periodCode: '2022JJ00', periodLabel: '2022', value: 1.5, formattedValue: '1,5' }),
            point({
              resultId: 'mid',
              periodCode: '2023JJ00',
              periodLabel: '2023',
              value: 2,
              formattedValue: '2,0',
              provisional: true,
            }),
            point({ resultId: 'hi', periodCode: '2024JJ00', periodLabel: '2024', value: 3.25, formattedValue: '3,3' }),
          ],
        },
      ],
    });
    const { container } = render(<ChartView spec={s} />);
    const before = container.querySelectorAll('[data-point="value"]').length;
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Alleen voorlopige' }));
    expect(container.querySelectorAll('[data-point="value"]').length).toBe(before);
    expect(container.querySelectorAll('circle[data-marker="hidden"]').length).toBe(before - 1);
    const hollow = [...container.querySelectorAll('circle[data-point="value"]')].find(
      (c) => c.getAttribute('fill') === 'var(--card)',
    );
    expect(hollow?.getAttribute('opacity')).not.toBe('0');
  });

  it('grid Geen removes the grid; Aslijnen toggles the axis lines; Schuin tilts the x labels and reserves height', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    // ADR 042: axis lines are off by default — switch them on to measure the plot bottom off the y-axis line.
    fireEvent.click(screen.getByRole('button', { name: 'Aslijnen' }));
    const flatBottom = Number(
      container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')?.getAttribute('y2'),
    );
    // Recharts' own default axis <Text> renders nothing in jsdom (see this
    // file's #197 top-of-file comment), so the tilt itself can't be read off
    // a tick's own transform here — xAxisHeight's pixel math is unit-pinned
    // in chart-presentation.test.ts. What IS observable end-to-end is the
    // reserved height actually reaching the render: tilting reserves MORE
    // x-axis height, so the plot area — and the y-axis line drawn across it
    // — shrinks.
    fireEvent.click(screen.getByRole('radio', { name: 'Schuin' }));
    const tiltedBottom = Number(
      container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')?.getAttribute('y2'),
    );
    expect(tiltedBottom).toBeLessThan(flatBottom);

    fireEvent.click(screen.getByRole('radio', { name: 'Geen' }));
    expect(container.querySelector('.recharts-cartesian-grid-horizontal')).toBeNull();
    expect(container.querySelector('.recharts-cartesian-grid-vertical')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Aslijnen' }));
    expect(container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line')).toBeNull();
    expect(container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')).toBeNull();
  });

  it('Y-as vanaf nul on a line switches the domain to zero (bar is always zero regardless)', () => {
    const s = threePointSpec({
      series: [
        {
          label: 'Nederland',
          regionCode: 'NL01',
          points: [
            point({ resultId: 'lo', periodCode: '2022JJ00', periodLabel: '2022', value: 50, formattedValue: '50' }),
            point({ resultId: 'hi', periodCode: '2024JJ00', periodLabel: '2024', value: 60, formattedValue: '60' }),
          ],
        },
      ],
    });
    const { container } = render(<ChartView spec={s} />);
    const beforeY = Number(container.querySelector('[data-role="axis-tick"][data-label-for="lo"]')?.getAttribute('y'));
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Y-as vanaf nul' }));
    const afterY = Number(container.querySelector('[data-role="axis-tick"][data-label-for="lo"]')?.getAttribute('y'));
    // The exact pixel is Recharts' own scale math; the meaningful, large
    // shift proves the domain actually changed, not a no-op click.
    expect(afterY).toBeLessThan(beforeY - 50);

    cleanup();
    render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    // Bar form deletes 'zeroBaseline' from `applicable` entirely (chart-
    // presentation.ts resolvePresentation) — the control is never offered
    // because a bar's own render always floors at zero unconditionally.
    expect(screen.queryByRole('button', { name: 'Y-as vanaf nul' })).toBeNull();
    expect(yAxisDomain('bar')).toEqual([0, 'auto']);
  });

  it('a colour change recolours line, legend swatch and tooltip swatch together', () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    const hexInput = screen.getByRole('textbox', { name: /Kleur van Nederland/ });
    fireEvent.change(hexInput, { target: { value: '#ff0000' } });
    fireEvent.keyDown(hexInput, { key: 'Enter' });

    const line = container.querySelector('.recharts-line-curve');
    expect(line?.getAttribute('stroke')).toBe('#ff0000');
    const swatch = container.querySelector(
      '[role="group"][aria-label="Reeksen"] span[aria-hidden="true"]',
    ) as HTMLElement;
    expect(swatch.style.backgroundColor).toBe('rgb(255, 0, 0)');
    // The tooltip's own swatch (ChartTooltip) is fed the identical
    // `seriesMeta[i].color` via Recharts' payload.color — buildRows resolves
    // it ONCE, above, into the very same seriesMeta array that both the
    // Line's stroke and the legend swatch just proved reads the new colour.
    // Driving Recharts' real hover/pin tooltip open in jsdom to read a third
    // DOM node is impractical here — this file's own ChartTooltip tests
    // (search "ChartTooltip") always render it directly with a hand-built
    // payload rather than trigger it through hover, for the same reason —
    // so this is proven by construction (one shared value, two independent
    // readings already checked) rather than a third DOM read.
  });

  it('a spec swap on the same mounted chart also drops the panel\'s per-row state (a refusal alert typed for the old chart never shows on the new one)', () => {
    const { container, rerender } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    const hex = screen.getByRole('textbox', { name: /hex-code/ }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: '#fefefe' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<ChartView spec={threePointSpec({ title: 'Een andere grafiek' })} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Opmaak' })).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('2');
  });

  it('a spec swap on the same mounted chart clears the presentation (owner E)', () => {
    const { container, rerender } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dik' }));
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('3');
    rerender(<ChartView spec={threePointSpec({ title: 'Ander' })} />);
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('2');
  });

  // Review fix (chart-panel-layout, option A): `styleOpen` is now this
  // component's own state (not remounted-away with the panel's old internal
  // `open`), so a spec swap must reset it explicitly — proven directly here,
  // not just inferred from the per-row-state test above.
  it('a spec swap on the same mounted chart closes the Opmaak panel', () => {
    const { rerender } = render(<ChartView spec={threePointSpec()} />);
    const trigger = screen.getByRole('button', { name: 'Opmaak' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Opmaak van de grafiek' })).toBeInTheDocument();

    rerender(<ChartView spec={threePointSpec({ title: 'Een andere grafiek' })} />);
    expect(screen.getByRole('button', { name: 'Opmaak' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
  });

  it('Standaard restores the byte-identical stock svg', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    // WP218 phase 1: scoped past the Opmaak trigger's own icon <svg> — see
    // the accessible-name test earlier in this file for why a bare 'svg'
    // selector is ambiguous in this card now that the panel is mounted.
    const stock = container.querySelector('svg.recharts-surface')!.outerHTML;
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dik' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Geen' }));
    expect(container.querySelector('svg.recharts-surface')!.outerHTML).not.toBe(stock);
    fireEvent.click(screen.getByRole('button', { name: 'Standaard' }));
    expect(container.querySelector('svg.recharts-surface')!.outerHTML).toBe(stock);
  });

  it('the whole-card digit scan still passes with the panel open on every tab (line and bar)', () => {
    const lineSpec = threePointSpec({
      provisionalNote: 'Voorlopige cijfers (2024) zijn gemarkeerd met *.',
      nullNotes: ['2021: geen gegevens beschikbaar (geheim).'],
      definitionLine: 'Definitie: testdefinitie 2020.',
    });
    const { container: lineContainer } = render(<ChartView spec={lineSpec} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    for (const tab of screen.getAllByRole('tab', { name: /Grafiek|Kleuren|Lettertype/ })) fireEvent.click(tab);
    scanForUnboundDigits(
      lineContainer,
      [
        lineSpec.title,
        lineSpec.unit,
        lineSpec.attributionLine,
        lineSpec.attribution.tableId,
        lineSpec.attribution.syncedAt,
        lineSpec.definitionLine ?? '',
        lineSpec.provisionalNote ?? '',
        ...lineSpec.nullNotes,
        ...Object.keys(lineSpec.dimLabels),
        ...Object.values(lineSpec.dimLabels),
        ...lineSpec.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
      ].filter(Boolean),
    );
    cleanup();

    const barSpec = multiRegionBarSpec();
    const { container: barContainer } = render(<ChartView spec={barSpec} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    for (const tab of screen.getAllByRole('tab', { name: /Grafiek|Kleuren|Lettertype/ })) fireEvent.click(tab);
    scanForUnboundDigits(
      barContainer,
      [
        barSpec.title,
        barSpec.unit,
        barSpec.attributionLine,
        barSpec.attribution.tableId,
        barSpec.attribution.syncedAt,
        ...Object.keys(barSpec.dimLabels),
        ...Object.values(barSpec.dimLabels),
        ...barSpec.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
      ].filter(Boolean),
    );
  });

  // Final-review fix: table form gets NO frame and NO Style panel (as
  // before the Frame-tab feature) — a framed table would need its own
  // export path. Neither the "Opmaak" trigger nor its dialog is offered in
  // Tabel form; switching back to Lijn restores both.
  it('the panel is NOT offered in Tabel form (no frame, no Style panel)', () => {
    render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.queryByRole('button', { name: 'Opmaak' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
  });

  // Round 2: switching TO Tabel form must close the Style panel itself
  // (setOpenPanel(null)), not just skip rendering it while on Tabel — else
  // `openPanel` stays stuck on 'style' and the panel silently reappears the
  // moment the user switches back to a chart form, with no click to open it.
  it('round 2: selecting Tabel closes the Style panel, and it does not reappear on its own when switching back to a chart form', () => {
    render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('region', { name: 'Opmaak van de grafiek' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
  });

  // Final-review fix (Fix 7): with a frame aspect ratio set AND small
  // multiples on, the container must keep growing with the small-multiples
  // grid (h-auto) rather than being forced into the frame's fixed aspect
  // box (h-full) — which would clip panels past a handful of series, the
  // exact bug h-auto was originally added to avoid.
  it('small multiples stays h-auto even when a frame aspect ratio is set', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const dialog = screen.getByRole('region', { name: 'Opmaak van de grafiek' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Kader' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Vierkant' }));
    const panel = screen.getByRole('tabpanel', { name: 'Grafiek' });
    expect(panel.className).toContain('h-auto');
    expect(panel.className).not.toContain('h-full');
  });

  it('option A layout: the region follows the chart tabpanel, the trigger stays in the Weergave tablist row, and opening the panel does not move or remount the chart', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const chartTabpanel = container.querySelector('[role="tabpanel"][aria-label="Grafiek"]') as HTMLElement;
    expect(chartTabpanel).not.toBeNull();

    // The trigger is portaled into a slot inside the SAME row as the
    // Weergave tablist (owner: option A — "the trigger stays in the tablist
    // row") — proven via a shared ancestor that contains both, since the
    // trigger is a row-mate of the tablist, not a DOM child of it.
    const trigger = screen.getByRole('button', { name: 'Opmaak' });
    const tablist = screen.getByRole('tablist', { name: 'Weergave' });
    expect((tablist.parentElement as HTMLElement).contains(trigger)).toBe(true);

    fireEvent.click(trigger);
    const region = screen.getByRole('region', { name: 'Opmaak van de grafiek' });
    // "First the graph on top, then the design settings" (owner): the region
    // is a FOLLOWING sibling of the chart's own tabpanel, never a preceding
    // one — the pre-refactor layout wrapped the panel under the Weergave row
    // ABOVE the chart, which this compareDocumentPosition check would fail.
    expect(Boolean(chartTabpanel.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(chartTabpanel.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_PRECEDING)).toBe(false);
    // Opening the panel mounts a new sibling AFTER the chart — it must not
    // tear down and remount the chart's own tabpanel to do it.
    expect(container.querySelector('[role="tabpanel"][aria-label="Grafiek"]')).toBe(chartTabpanel);

    fireEvent.keyDown(region, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('the disabled Lijn tab on a region comparison carries its reason via aria-describedby', () => {
    render(<ChartView spec={multiRegionBarSpec()} />);
    const lineTab = screen.getByRole('tab', { name: 'Lijn' });
    expect(lineTab).toBeDisabled();
    const describedById = lineTab.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const reason = document.getElementById(describedById!);
    expect(reason?.textContent).toMatch(/regio/);
    expect(lineTab).toHaveAttribute('title', expect.stringContaining('regio'));
  });

  it('the SVG export carries the chosen stroke-width verbatim', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dik' }));
    const svg = container.querySelector('svg.recharts-surface') as unknown as SVGSVGElement;
    const markup = attributedSvgMarkup(svg, 'x', () => ({}));
    expect(markup).toContain('stroke-width="3"');
  });
});

// WP218 phase 6, Task 3 (#218/#220): the anonymous style-panel usage counter.
// chart.tsx must never import the server action or web/app/actions.ts
// directly — only lib/chart-usage-client.ts's injectable sink, which is what
// these tests register a spy against.
describe('WP218 phase 6 — anonymous style-panel usage counter', () => {
  let sink: ReturnType<typeof vi.fn<(event: ChartStyleEvent) => void>>;

  beforeEach(() => {
    sink = vi.fn<(event: ChartStyleEvent) => void>();
    setChartUsageSink(sink);
  });

  afterEach(() => {
    setChartUsageSink(null);
  });

  it('tracks panel_open exactly once on open, and option_changed exactly once when Dik is clicked', () => {
    render(<ChartView spec={threePointSpec()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith('panel_open');

    fireEvent.click(screen.getByRole('radio', { name: 'Dik' }));
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenNthCalledWith(2, 'option_changed');

    // Final-review fix: "Standaard" (the full reset) is counted too, exactly
    // like "Standaardkleuren" (a partial reset via onChange) already was —
    // before the fix, a full reset fired nothing, so the counter
    // systematically under-counted resets.
    fireEvent.click(screen.getByRole('button', { name: 'Standaard' }));
    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink).toHaveBeenNthCalledWith(3, 'option_changed');
  });
});

// WP218 phase 2 (#218 chart styling, owner decision C): the account default
// as resolvePresentation's `base` — a signed-in visitor's saved style
// (ChartStyleProvider, mounted by Workspace in real use) governs what a
// FRESH/reset chart looks like, per-chart tweaks still win on top of it, and
// "Standaard" resets to it, never to the hardcoded stock look, matching
// owner E ("each chart starts fresh" against THIS base).
describe('WP218 phase 2 — account default for chart styling (owner C)', () => {
  beforeEach(() => {
    chartStyleActions.saveMyChartStyle.mockReset();
    chartStyleActions.forgetMyChartStyle.mockReset();
  });

  it('a saved lineWidth:thick default renders at 3 px, panel pristine, Dik checked, hint shown', () => {
    const { container } = render(
      <ChartStyleProvider initial={{ lineWidth: 'thick' }}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('3');

    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('radio', { name: 'Dik' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Standaard' })).toBeDisabled();
    expect(screen.getByText('Mijn standaard is actief.')).toBeInTheDocument();
  });

  it('clicking Dun then Standaard returns to 3 px — the account default, not stock', () => {
    const { container } = render(
      <ChartStyleProvider initial={{ lineWidth: 'thick' }}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dun' }));
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('1');
    expect(screen.queryByText('Mijn standaard is actief.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Standaard' }));
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('3');
  });

  it('a spec swap keeps the account default as the base while clearing per-chart tweaks', () => {
    const { container, rerender } = render(
      <ChartStyleProvider initial={{ lineWidth: 'thick' }}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dun' }));
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('1');

    rerender(
      <ChartStyleProvider initial={{ lineWidth: 'thick' }}>
        <ChartView spec={threePointSpec({ title: 'Een andere grafiek' })} />
      </ChartStyleProvider>,
    );
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('3');
  });

  it('without a provider: the stock look, and no account row at all', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.queryByRole('button', { name: 'Bewaar als mijn standaard' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vergeet mijn standaard' })).toBeNull();
    expect(screen.queryByText('Mijn standaard is actief.')).toBeNull();
  });

  it('save flow: a key the resolver locked for the current form is saved as the ACCOUNT DEFAULT, never the form-forced value (a bar-forced zero baseline never becomes a line chart\'s default)', async () => {
    chartStyleActions.saveMyChartStyle.mockResolvedValue({ ok: true });
    render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar als mijn standaard' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Opgeslagen.');
    const saved = chartStyleActions.saveMyChartStyle.mock.calls[0][0] as Record<string, unknown>;
    // Bar form forces zeroBaseline to 'zero' on screen; the account had no
    // saved default (STOCK_PRESENTATION's 'auto') and the bar-forced value
    // must never be baked in as the new account default (final-review fix:
    // the key is still SAVED — as the base value — never simply omitted).
    expect(saved).toHaveProperty('zeroBaseline', 'auto');
    // ADR 042: an unrelated key (not forced by the bar form) is still saved
    // as STOCK_PRESENTATION's own value — 'horizontal', the designed
    // default, not the pre-ADR-042 'both'.
    expect(saved).toHaveProperty('grid', 'horizontal');
  });

  it('final-review fix: saving from Staaf never wipes an earlier-saved valueLabels default — a locked key saves back the ACCOUNT DEFAULT, not the bar-forced value', async () => {
    chartStyleActions.saveMyChartStyle.mockResolvedValue({ ok: true });
    render(
      <ChartStyleProvider initial={{ valueLabels: 'hidden' }}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    // An unrelated tweak (the font) is what a reader actually does before
    // re-saving — this must not disturb the valueLabels default at all.
    fireEvent.click(screen.getByRole('tab', { name: 'Lettertype' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Lettertype' }), { target: { value: 'Roboto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar als mijn standaard' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Opgeslagen.');
    const saved = chartStyleActions.saveMyChartStyle.mock.calls[0][0] as Record<string, unknown>;
    // Bar form forces valueLabels to 'shown' on screen; the account default
    // was 'hidden' (set on an earlier line chart) and must survive this
    // save untouched — the bug saved the whole row with the key OMITTED,
    // which reloaded as 'shown' (the stock default), silently losing it.
    expect(saved).toHaveProperty('valueLabels', 'hidden');
    expect(saved).toHaveProperty('fontFamily', 'Roboto');
  });

  it('save flow: a successful mocked save shows Opgeslagen. and the usage sink receives default_saved', async () => {
    chartStyleActions.saveMyChartStyle.mockResolvedValue({ ok: true });
    const sink = vi.fn<(event: ChartStyleEvent) => void>();
    setChartUsageSink(sink);
    try {
      render(
        <ChartStyleProvider initial={{ lineWidth: 'thick' }}>
          <ChartView spec={threePointSpec()} />
        </ChartStyleProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
      fireEvent.click(screen.getByRole('button', { name: 'Bewaar als mijn standaard' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Opgeslagen.');
      // WP218 phase 3 (owner B): the second argument is always passed —
      // `undefined` here since no brand was applied on this chart.
      expect(chartStyleActions.saveMyChartStyle).toHaveBeenCalledWith(
        expect.objectContaining({ lineWidth: 'thick' }),
        undefined,
      );
      expect(sink).toHaveBeenCalledWith('default_saved');
      // The hint keeps showing afterward: the just-saved default IS what's
      // still on screen (pristine, hasDefault still true).
      expect(screen.getByText('Mijn standaard is actief.')).toBeInTheDocument();
    } finally {
      setChartUsageSink(null);
    }
  });

  it('forget flow: a successful mocked forget shows Vergeten. and the usage sink receives default_forgotten, hint gone', async () => {
    chartStyleActions.forgetMyChartStyle.mockResolvedValue({ ok: true });
    const sink = vi.fn<(event: ChartStyleEvent) => void>();
    setChartUsageSink(sink);
    try {
      const { container } = render(
        <ChartStyleProvider initial={{ lineWidth: 'thick' }}>
          <ChartView spec={threePointSpec()} />
        </ChartStyleProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
      fireEvent.click(screen.getByRole('button', { name: 'Vergeet mijn standaard' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Vergeten.');
      expect(sink).toHaveBeenCalledWith('default_forgotten');
      expect(screen.queryByText('Mijn standaard is actief.')).toBeNull();
      // accountStyle is now null ⇒ base is stock again.
      expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('2');
    } finally {
      setChartUsageSink(null);
    }
  });
});

// Final-review fix (WP218 chart styling): `findFont` only recognises the
// seven curated FONT_OPTIONS, but a brand font (phase 3's `pickBrandFont`)
// can put any Google-origin family straight into `fontFamily` without ever
// being curated — the effect used to skip loading it entirely, so the chart
// silently fell back to the system font while the panel claimed the brand
// font was applied.
describe('WP218 final-review fix — an uncurated (brand) font family is still loaded', () => {
  afterEach(() => {
    document.head.querySelectorAll('link[data-font-family]').forEach((n) => n.remove());
  });

  it('a fontFamily outside FONT_OPTIONS gets its own Google Fonts <link>', () => {
    render(
      <ChartStyleProvider initial={{ fontFamily: 'Poppins' }}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    const link = document.head.querySelector('link[data-font-family="Poppins"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('rel')).toBe('stylesheet');
  });

  it('a curated font is unaffected — loaded exactly as before, no duplicate link', () => {
    render(
      <ChartStyleProvider initial={{ fontFamily: 'Roboto' }}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    expect(document.head.querySelectorAll('link[data-font-family="Roboto"]')).toHaveLength(1);
  });

  it('the stock look (no fontFamily override) loads nothing', () => {
    render(<ChartView spec={threePointSpec()} />);
    expect(document.head.querySelector('link[data-font-family]')).toBeNull();
  });
});

// WP218 phase 3 (#218 chart styling, owner decision B): "Pas merkkleuren
// toe" wired into ChartView. `brand` is offered to the panel only when
// signedIn (the same ChartStyleProvider gate as `account`); a successful
// apply is remembered in ChartView state and handed to the NEXT
// saveMyChartStyle call as its `brandApplied` argument.
describe('WP218 phase 3 — brand colours wired into ChartView (owner B)', () => {
  beforeEach(() => {
    chartStyleActions.lookupBrand.mockReset();
    chartStyleActions.saveMyChartStyle.mockReset();
  });

  it('without a provider (not signed in): no Merkkleuren block at all', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    expect(screen.queryByRole('button', { name: 'Pas merkkleuren toe' })).toBeNull();
  });

  it('applying a brand recolours the first series and the usage sink receives brand_applied', async () => {
    chartStyleActions.lookupBrand.mockResolvedValue({
      ok: true,
      brand: {
        name: 'Voorbeeld BV',
        domain: 'voorbeeld.nl',
        colors: ['#ff0000', '#00ff00'],
        font: null,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false,
      },
    });
    const sink = vi.fn<(event: ChartStyleEvent) => void>();
    setChartUsageSink(sink);
    try {
      const { container } = render(
        <ChartStyleProvider initial={{}}>
          <ChartView spec={twoSeriesLineSpec()} />
        </ChartStyleProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
      fireEvent.click(screen.getByRole('button', { name: 'Pas merkkleuren toe' }));

      await screen.findByRole('status');
      expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke')).toBe('#ff0000');
      expect(chartStyleActions.lookupBrand).toHaveBeenCalledWith(undefined);
      expect(sink).toHaveBeenCalledWith('brand_applied');
    } finally {
      setChartUsageSink(null);
    }
  });

  it('a subsequent "Bewaar als mijn standaard" passes the just-applied brand as brandApplied', async () => {
    chartStyleActions.lookupBrand.mockResolvedValue({
      ok: true,
      brand: {
        name: 'Voorbeeld BV',
        domain: 'voorbeeld.nl',
        colors: ['#ff0000'],
        font: null,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false,
      },
    });
    chartStyleActions.saveMyChartStyle.mockResolvedValue({ ok: true });
    render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={twoSeriesLineSpec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pas merkkleuren toe' }));
    await waitFor(() => expect(chartStyleActions.lookupBrand).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Bewaar als mijn standaard' }));
    await waitFor(() => expect(chartStyleActions.saveMyChartStyle).toHaveBeenCalledTimes(1));
    expect(chartStyleActions.saveMyChartStyle).toHaveBeenCalledWith(expect.anything(), {
      domain: 'voorbeeld.nl',
      name: 'Voorbeeld BV',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

// ---------------------------------------------------------------------------
// WP218 phase 4 (#219), Task 4 (design §4): the chart card follows the app
// language, with a per-chart override, via the CBS word list (never machine
// translation). `chartLang = pres.language ?? useLang()` — these tests prove
// the WHOLE pipeline: the catalogue chrome (Weergave tabs, Vanaf/Tot, the
// panel), the word-list converters (unit/region/period-label/measure-title/
// attribution-line) wired onto the actual spec, and the honesty invariant
// (a translated card still passes the same digit-membership scan).
// ---------------------------------------------------------------------------

function englishWordListSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return spec({
    title: 'Consumentenvertrouwen',
    unit: 'aantal',
    series: [
      {
        label: 'Nederland',
        regionCode: 'NL01',
        points: [
          point({
            resultId: 'q1-2021',
            periodCode: '2021KW01',
            periodLabel: '2021 1e kwartaal',
            value: 5,
            formattedValue: '5,0',
          }),
        ],
      },
    ],
    attributionLine:
      'Bron: CBS StatLine, tabel 83693NED — Consumentenvertrouwen. Gegevens gesynchroniseerd op 2026-09-01. Periode: 2021 1e kwartaal. Licentie: CC BY 4.0.',
    attribution: {
      tableId: '83693NED',
      tableTitle: 'Consumentenvertrouwen',
      tableVersion: 1,
      syncedAt: '2026-09-01',
      coveredPeriods: { from: '2021KW01', to: '2021KW01' },
      license: 'CC BY 4.0',
    },
    ...overrides,
  });
}

describe('WP218 phase 4 — charts follow the app language, per-chart, via the CBS word list', () => {
  it('an English chart shows the Line/Bar/Table tabs', () => {
    const s = englishWordListSpec();
    render(
      <LangProvider lang="en">
        <ChartView spec={s} />
      </LangProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Line' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bar' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Table' })).toBeInTheDocument();
  });

  it('an English chart shows the translated title/unit/region (in the legend) and the attribution line with id/date byte-identical', () => {
    // A second series ('Utrecht', a municipality — never translated) so the
    // legend renders at all (a single-series chart shows no legend) and
    // proves translateRegion is SELECTIVE: 'Nederland' becomes 'the
    // Netherlands', 'Utrecht' stays 'Utrecht'.
    const s = englishWordListSpec({
      series: [
        ...englishWordListSpec().series,
        { label: 'Utrecht', regionCode: 'PV26', points: [point({ resultId: 'ut-2021', periodCode: '2021KW01', periodLabel: '2021 1e kwartaal', value: 4, formattedValue: '4,0' })] },
      ],
    });
    render(
      <LangProvider lang="en">
        <ChartView spec={s} />
      </LangProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Consumer confidence' })).toBeInTheDocument();
    expect(screen.getByText('number')).toBeInTheDocument(); // translateUnit('aantal')
    expect(screen.getByRole('button', { name: 'the Netherlands' })).toBeInTheDocument(); // translateRegion('Nederland')
    expect(screen.getByRole('button', { name: 'Utrecht' })).toBeInTheDocument(); // untranslated municipality
    expect(
      screen.getByText(
        'Source: CBS StatLine, table 83693NED — Consumentenvertrouwen. Data synced on 2026-09-01. Period: 2021 Q1. License: CC BY 4.0.',
      ),
    ).toBeInTheDocument();
  });

  it('an English chart shows the translated x-axis period label (2021 Q1) and Vanaf/Tot become From/To', () => {
    const s = englishWordListSpec();
    // A second period so the zoom selectors (Vanaf/Tot -> From/To) render.
    s.series[0].points.push(
      point({
        resultId: 'q2-2021',
        periodCode: '2021KW02',
        periodLabel: '2021 2e kwartaal',
        value: 6,
        formattedValue: '6,0',
      }),
    );
    render(
      <LangProvider lang="en">
        <ChartView spec={s} />
      </LangProvider>,
    );
    const fromSelect = screen.getByRole('combobox', { name: 'From' });
    const toSelect = screen.getByRole('combobox', { name: 'To' });
    expect(within(fromSelect).getByText('2021 Q1')).toBeInTheDocument();
    expect(within(toSelect).getByText('2021 Q2')).toBeInTheDocument();
    // The translated label also appears bound to the plotted point itself
    // (the axis tick's own display string), not just the range selectors.
    expect(screen.getAllByText('2021 Q1').length).toBeGreaterThan(0);
  });

  it('the whole-card digit scan still passes on an English chart (every numeric token stays a spec string)', () => {
    const s = englishWordListSpec({
      provisionalNote: 'Voorlopige cijfers (2021) zijn gemarkeerd met *.',
      nullNotes: ['2020: geen gegevens beschikbaar (geheim).'],
    });
    const { container } = render(
      <LangProvider lang="en">
        <ChartView spec={s} />
      </LangProvider>,
    );
    scanForUnboundDigits(
      container,
      [
        s.title,
        s.unit,
        s.attributionLine,
        s.attribution.tableId,
        s.attribution.syncedAt,
        s.provisionalNote ?? '',
        ...s.nullNotes,
        ...Object.keys(s.dimLabels),
        ...Object.values(s.dimLabels),
        ...s.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
      ].filter(Boolean),
    );
  });

  it('bakes the ENGLISH attribution line into the export markup, matching what the card shows', async () => {
    let capturedBlob: Blob | undefined;
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();

    render(
      <LangProvider lang="en">
        <ChartView spec={englishWordListSpec()} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as SVG' }));

    expect(capturedBlob).toBeDefined();
    const markup = await capturedBlob!.text();
    // #223: this attribution line is long enough to wrap across more than
    // one footer <text> line at this chart's width — checked word by word
    // (order aside) rather than as one contiguous substring, so the
    // assertion survives wrapping while still proving every word of the
    // English attribution reached the export, not the Dutch original.
    // Review fix: bare '2021' is excluded — it also appears in the
    // chart's own x-axis tick ('2021 Q1', no trailing period, per the
    // sibling test above), so it alone would pass even if the footer word
    // were dropped. 'Q1.' (WITH the trailing period the footer has and the
    // axis tick does not) stays in the list as the footer-specific proof
    // that spot covers.
    for (const word of 'Source: CBS StatLine, table 83693NED — Consumentenvertrouwen. Data synced on 2026-09-01. Period: Q1. License: CC BY 4.0.'.split(
      ' ',
    )) {
      expect(markup).toContain(word);
    }

    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  it('a per-chart language override wins over the app language: LangProvider lang="en" + choosing Nederlands flips this ONE chart to Dutch', () => {
    render(
      <LangProvider lang="en">
        <ChartView spec={englishWordListSpec()} />
      </LangProvider>,
    );
    // The app is English by default: the panel trigger and tabs read English.
    expect(screen.getByRole('tab', { name: 'Line' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    const languageSelect = screen.getByRole('combobox', { name: 'Chart language' });
    fireEvent.change(languageSelect, { target: { value: 'nl' } });

    // The per-chart override now wins: the WHOLE card, panel included,
    // switches to Dutch even though the app itself stays English.
    expect(screen.getByRole('tab', { name: 'Lijn' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Staaf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Consumentenvertrouwen' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// WP218 phase 5, Task 2 (owner D): two more Weergave tabs — Vlak (area) and
// Liggend (horizontal bar) — over the SAME five-tab switch, in order Lijn /
// Vlak / Staaf / Liggend / Tabel. S1/S2/S3 mirror chart-view-state.test.ts's
// own fixtures for the guard functions this render wires up:
//   S1 = threePointSpec()   — single-series time series (kind line, count 1)
//   S2 = twoSeriesLineSpec() — multi-series time series (kind line, count 2)
//   S3 = multiRegionBarSpec() — multi-region comparison (kind bar, count 3)
// ---------------------------------------------------------------------------

describe('ChartView form switch — WP218 phase 5 (Vlak/Liggend tabs)', () => {
  it('offers all five tabs, in order Lijn, Vlak, Staaf, Liggend, Tabel', () => {
    render(<ChartView spec={threePointSpec()} />);
    const tabs = screen.getAllByRole('tab').map((el) => el.textContent);
    expect(tabs).toEqual(['Lijn', 'Vlak', 'Staaf', 'Liggend', 'Tabel']);
  });

  it('S1 (single-series time series): only Liggend is disabled, with a reason', () => {
    render(<ChartView spec={threePointSpec()} />);
    expect(screen.getByRole('tab', { name: 'Lijn' })).not.toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Vlak' })).not.toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Staaf' })).not.toBeDisabled();
    const hbarTab = screen.getByRole('tab', { name: 'Liggend' });
    expect(hbarTab).toBeDisabled();
    expect(hbarTab).toHaveAttribute('title', expect.stringContaining('regio'));
  });

  it('S2 (multi-series time series): Vlak and Liggend are both disabled, each with its own reason', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    expect(screen.getByRole('tab', { name: 'Lijn' })).not.toBeDisabled();
    const areaTab = screen.getByRole('tab', { name: 'Vlak' });
    expect(areaTab).toBeDisabled();
    expect(areaTab).toHaveAttribute('title', expect.stringContaining('reeksen'));
    const hbarTab = screen.getByRole('tab', { name: 'Liggend' });
    expect(hbarTab).toBeDisabled();
    expect(hbarTab).toHaveAttribute('title', expect.stringContaining('regio'));
  });

  it('S3 (multi-region comparison): Lijn and Vlak are both disabled, each with its own reason; Liggend is allowed', () => {
    render(<ChartView spec={multiRegionBarSpec()} />);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toBeDisabled();
    const areaTab = screen.getByRole('tab', { name: 'Vlak' });
    expect(areaTab).toBeDisabled();
    expect(areaTab).toHaveAttribute('title', expect.stringContaining('tijd'));
    expect(screen.getByRole('tab', { name: 'Staaf' })).not.toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Liggend' })).not.toBeDisabled();
  });

  it('a disabled tab\'s reason is reachable by keyboard/AT via aria-describedby, not just the pointer title', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    const areaTab = screen.getByRole('tab', { name: 'Vlak' });
    const describedBy = areaTab.getAttribute('aria-describedby')!;
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Een gevuld vlak per reeks zou de reeksen over elkaar leggen en gaten verbergen.',
    );
  });

  it('S2: arrow-key order skips the disabled Vlak/Liggend tabs entirely (Lijn -> Staaf -> Tabel -> Lijn)', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    const lineTab = screen.getByRole('tab', { name: 'Lijn' });
    lineTab.focus();
    fireEvent.keyDown(lineTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Staaf' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tabel' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveFocus();
  });

  it('S3: arrow-key order skips the disabled Lijn/Vlak tabs entirely (Staaf -> Liggend -> Tabel -> Staaf)', () => {
    render(<ChartView spec={multiRegionBarSpec()} />);
    const barTab = screen.getByRole('tab', { name: 'Staaf' });
    barTab.focus();
    fireEvent.keyDown(barTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Liggend' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Liggend' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tabel' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveFocus();
  });

  it('a spec swap from an area-chosen S1 to a disallowed S2 falls back to line', () => {
    const { container, rerender } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Vlak' }));
    expect(container.querySelector('.recharts-area')).not.toBeNull();

    rerender(<ChartView spec={twoSeriesLineSpec()} />);
    expect(container.querySelector('.recharts-area')).toBeNull();
    expect(container.querySelector('.recharts-line')).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Vlak' })).toHaveAttribute('aria-selected', 'false');
  });

  it('a spec swap from an hbar-chosen S3 to a disallowed S1 falls back to bar', () => {
    const { container, rerender } = render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    expect(container.querySelector('[data-role="region-axis-tick"]')).not.toBeNull();

    rerender(<ChartView spec={threePointSpec()} />);
    expect(container.querySelector('[data-role="region-axis-tick"]')).toBeNull();
    expect(container.querySelector('.recharts-bar')).not.toBeNull();
    expect(container.querySelector('.recharts-line')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Liggend' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('ChartView — area form (WP218 phase 5)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  function areaSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
    return threePointSpec({
      series: [
        {
          label: 'Nederland',
          regionCode: 'NL01',
          points: [
            point({ resultId: 'lo', periodCode: '2022JJ00', periodLabel: '2022', value: 1.5, formattedValue: '1,5' }),
            point({
              resultId: 'mid',
              periodCode: '2023JJ00',
              periodLabel: '2023',
              value: 2,
              formattedValue: '2,0',
              provisional: true,
            }),
            point({ resultId: 'hi', periodCode: '2024JJ00', periodLabel: '2024', value: 3.25, formattedValue: '3,3' }),
          ],
        },
      ],
      ...overrides,
    });
  }

  it('renders a filled Area element (Recharts 3\'s own class) with a gradient url fill by default for a single time series (ADR 042)', () => {
    const { container } = render(<ChartView spec={areaSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Vlak' }));
    const area = container.querySelector('.recharts-area-area');
    expect(area).not.toBeNull();
    // ADR 042: gradient is the default area fill — a literal series colour
    // would be the OLD (flat) default; see the dedicated gradient test below
    // for the <linearGradient>/<stop> shape and the flat-mode toggle.
    expect(area?.getAttribute('fill')).toMatch(/^url\(#/);
    expect(area?.getAttribute('fill-opacity')).toBe('1');
  });

  it('draws a hollow marker on the provisional point, same R11 convention as the line form', () => {
    const { container } = render(<ChartView spec={areaSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Vlak' }));
    const hollow = container.querySelector('circle[data-point="value"][data-result-id="mid"]');
    expect(hollow?.getAttribute('fill')).toBe('var(--card)');
    const finalDot = container.querySelector('circle[data-point="value"][data-result-id="lo"]');
    expect(finalDot?.getAttribute('fill')).toBe(DEFAULT_PALETTE[0]);
  });

  it('floors the Y-axis at zero (the area lock) — the same kind of large, meaningful shift the line form\'s own zero-baseline toggle produces', () => {
    const s = areaSpec({
      series: [
        {
          label: 'Nederland',
          regionCode: 'NL01',
          points: [
            point({ resultId: 'lo', periodCode: '2022JJ00', periodLabel: '2022', value: 50, formattedValue: '50' }),
            point({ resultId: 'hi', periodCode: '2024JJ00', periodLabel: '2024', value: 60, formattedValue: '60' }),
          ],
        },
      ],
    });
    const { container } = render(<ChartView spec={s} />);
    const autoY = Number(container.querySelector('[data-role="axis-tick"][data-label-for="lo"]')?.getAttribute('y'));
    fireEvent.click(screen.getByRole('tab', { name: 'Vlak' }));
    const zeroY = Number(container.querySelector('[data-role="axis-tick"][data-label-for="lo"]')?.getAttribute('y'));
    expect(zeroY).toBeLessThan(autoY - 50);
  });

  it('locks Y-as vanaf nul with its own area-specific reason rather than hiding the control (unlike bar, which deletes it)', () => {
    render(<ChartView spec={areaSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Vlak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const toggle = screen.getByRole('button', { name: 'Y-as vanaf nul' });
    expect(toggle).toBeDisabled();
    const reasonId = toggle.getAttribute('aria-describedby')!;
    expect(document.getElementById(reasonId)?.textContent).toBe('Een gevuld vlak begint altijd bij nul.');
  });

  it('the whole-card membership scan passes in area form (no digit on screen without a source in the spec\'s own strings)', () => {
    const s = areaSpec({
      provisionalNote: 'Voorlopige cijfers zijn gemarkeerd met *.',
      nullNotes: ['2021: geen gegevens beschikbaar (geheim).'],
      definitionLine: 'Definitie: testdefinitie 2020.',
    });
    const { container } = render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Vlak' }));
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
    scanForUnboundDigits(container, specStrings);
  });

  it('area form fills with a vertical gradient by default (a <linearGradient> per series, fill url(#…)), and flat when areaFill is flat', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Vlak' }));
    const gradient = container.querySelector('svg defs linearGradient');
    expect(gradient).not.toBeNull();
    const stops = gradient!.querySelectorAll('stop');
    expect(stops.length).toBe(2);
    expect(stops[0]!.getAttribute('stop-color')).toBe(DEFAULT_PALETTE[0]);
    const area = container.querySelector('.recharts-area-area');
    expect(area?.getAttribute('fill')).toBe(`url(#${gradient!.getAttribute('id')})`);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verloop in het vlak' }));
    expect(container.querySelector('.recharts-area-area')?.getAttribute('fill')).toBe(DEFAULT_PALETTE[0]);
  });
});

describe('ChartView — horizontal bar form (WP218 phase 5)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('renders one rect[data-point] per region, in the spec\'s own order, never sorted (R6)', () => {
    const { container } = render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    const bars = container.querySelectorAll('rect[data-point="value"]');
    expect(bars).toHaveLength(3);
    expect([...bars].map((b) => b.getAttribute('data-result-id'))).toEqual(['gr-2021', 'fr-2021', 'dr-2021']);
  });

  it('shows region labels as y-axis text nodes (a custom tick — Recharts\' own default axis text renders nothing in jsdom)', () => {
    const { container } = render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    const regionTicks = [...container.querySelectorAll('[data-role="region-axis-tick"]')].map((t) => t.textContent);
    expect(regionTicks).toEqual(['Groningen', 'Friesland', 'Drenthe']);
  });

  it('binds each bar\'s own value label to its resultId', () => {
    const { container } = render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    expect(container.querySelector('[data-role="bar-label"][data-label-for="gr-2021"]')?.textContent).toBe('10');
    expect(container.querySelector('[data-role="bar-label"][data-label-for="fr-2021"]')?.textContent).toBe('20');
    expect(container.querySelector('[data-role="bar-label"][data-label-for="dr-2021"]')?.textContent).toBe('15');
  });

  it('hiding a region via the legend drops its row entirely (order kept for the rest)', () => {
    const { container } = render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    fireEvent.click(screen.getByRole('button', { name: 'Friesland' }));
    const bars = container.querySelectorAll('rect[data-point="value"]');
    expect([...bars].map((b) => b.getAttribute('data-result-id'))).toEqual(['gr-2021', 'dr-2021']);
  });

  it('highlighting one region dims the fill-opacity of the others', () => {
    const { container } = render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markeer Groningen' }));
    const bars = [...container.querySelectorAll('rect[data-point="value"]')];
    const groningen = bars.find((b) => b.getAttribute('data-result-id') === 'gr-2021')!;
    const friesland = bars.find((b) => b.getAttribute('data-result-id') === 'fr-2021')!;
    expect(groningen.getAttribute('fill-opacity')).toBe('1');
    expect(friesland.getAttribute('fill-opacity')).toBe('0.25');
  });

  it('a provisional region is hatched, not just noted in prose', () => {
    const s = multiRegionBarSpec();
    s.series[1]!.points[0] = point({
      resultId: 'fr-2021',
      periodCode: '2021',
      periodLabel: '2021',
      value: 20,
      formattedValue: '20',
      provisional: true,
    });
    const { container } = render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    const bar = container.querySelector('rect[data-point="value"][data-result-id="fr-2021"]');
    expect(bar?.getAttribute('fill')).toMatch(/^url\(#/);
    const finalBar = container.querySelector('rect[data-point="value"][data-result-id="gr-2021"]');
    expect(finalBar?.getAttribute('fill')).toBe(DEFAULT_PALETTE[0]);
  });

  it('the whole-card membership scan passes in hbar form', () => {
    const s = multiRegionBarSpec();
    const { container } = render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    const specStrings = [
      s.title,
      s.unit,
      s.attributionLine,
      s.attribution.tableId,
      s.attribution.syncedAt,
      ...Object.keys(s.dimLabels),
      ...Object.values(s.dimLabels),
      ...s.series.flatMap((se) => [se.label, ...se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])]),
    ].filter(Boolean);
    scanForUnboundDigits(container, specStrings);
  });

  it('the SVG export contains the region labels and the value labels', async () => {
    let capturedBlob: Blob | undefined;
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();

    render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download als SVG' }));

    expect(capturedBlob).toBeDefined();
    const markup = await capturedBlob!.text();
    expect(markup).toContain('Groningen');
    expect(markup).toContain('Friesland');
    expect(markup).toContain('Drenthe');
    expect(markup).toMatch(/>10</);
    expect(markup).toMatch(/>20</);
    expect(markup).toMatch(/>15</);

    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });
});

describe('Story mode (session 92): a code-built story under the chart', () => {
  it('offers the colourful Inzichten trigger next to Opmaak on a chart with findings, not on Tabel, not on a one-point chart', () => {
    const { container, unmount } = render(<ChartView spec={threePointSpec()} />);
    const trigger = screen.getByRole('button', { name: 'Inzichten' });
    expect(container.querySelector('[data-story-trigger-ring]')).toContainElement(trigger);
    expect(trigger.querySelector('svg')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.queryByRole('button', { name: 'Inzichten' })).toBeNull();
    unmount();
    render(<ChartView spec={spec()} />);
    expect(screen.queryByRole('button', { name: 'Inzichten' })).toBeNull();
  });

  it('opening the story closes Opmaak and vice versa (one panel under the chart)', () => {
    render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('region', { name: 'Opmaak van de grafiek' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Inzichten bij de grafiek' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.queryByRole('region', { name: 'Inzichten bij de grafiek' })).toBeNull();
  });

  it('a point step rings exactly that point outside its own marker, and never carries data-point', () => {
    // threePointSpec's findings (chart-insights.ts, hand-verified): every
    // point is a real finding here (recordLow@2022 "lo", jumpUp@2023 "mid",
    // jumpUp@2024 "hi") — unlike the old buildStorySteps, there is no
    // non-data "overview" step wasting the first slot, so the ring is
    // already on the FIRST finding's point the moment the panel opens.
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    const openRings = container.querySelectorAll('[data-story-marker]');
    expect(openRings).toHaveLength(1);
    expect(openRings[0]!.getAttribute('data-story-marker')).toBe('lo');
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    const rings = container.querySelectorAll('[data-story-marker]');
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(ring.getAttribute('data-point')).toBeNull();
    expect(ring.getAttribute('data-story-marker')).toBe('mid');
    expect(container.querySelectorAll('[data-point]')).toHaveLength(3);
    const dot = container.querySelector('[data-result-id="mid"]')!;
    expect(Number(ring.getAttribute('r'))).toBeGreaterThan(Number(dot.getAttribute('r')));
  });

  // Final-review fix: `activeStoryStep` only ever threaded into SeriesDot
  // (Lijn/Vlak) — a single-series time series shown as Staaf never reacted
  // to the story at all, since SeriesBar had no equivalent thread.
  it('a single-series time series shown as Staaf reacts to the story too, with a dashed outline around the bar', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    const beforeStory = container.querySelectorAll('[data-point]').length;
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    const markers = container.querySelectorAll('[data-story-marker]');
    expect(markers).toHaveLength(1);
    expect(markers[0]!.tagName.toLowerCase()).toBe('rect');
    expect(markers[0]!.getAttribute('data-point')).toBeNull();
    expect(container.querySelectorAll('[data-point]')).toHaveLength(beforeStory);
  });

  // Final-review fix (R11): a ringed point must never look like the hollow
  // "alleen voorlopige" marker — the ring itself carries a dashed stroke as
  // a distinct visual channel, and the ringed point's own filled marker must
  // stay visible even while every other final marker is hidden.
  it('the story ring never looks like the hollow provisional marker, even in "alleen voorlopige" mode', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Alleen voorlopige' }));
    // threePointSpec's first finding (chart-insights.ts) already rings "lo"
    // the moment the panel opens — no "Volgende" click needed (unlike the
    // old buildStorySteps, whose first step was a non-data overview).
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    const ring = container.querySelector('[data-story-marker]')!;
    expect(ring.getAttribute('stroke-dasharray')).toBeTruthy();
    const ringedDot = container.querySelector('[data-result-id="lo"]')!;
    expect(ringedDot.getAttribute('data-marker')).not.toBe('hidden');
    expect(ringedDot.getAttribute('opacity')).not.toBe('0');
    expect(container.querySelector('[data-result-id="mid"]')!.getAttribute('data-marker')).toBe('hidden');
    expect(container.querySelector('[data-result-id="hi"]')!.getAttribute('data-marker')).toBe('hidden');
  });

  // Resolution note (story-task-4-brief): getByRole('button', { name: /Utrecht/ })
  // matches two legend buttons (the toggle and "Markeer Utrecht"); the exact
  // name 'Utrecht' — what every other legend test in this file uses — is the
  // plain toggle button, whose accessible name is the series label alone.
  it("a series step highlights that series (others dim) and closing restores the reader's own view", () => {
    const { container } = render(<ChartView spec={twoSeriesFourYearLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Utrecht' }));
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(container.querySelectorAll('[data-series-dimmed="true"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(container.querySelectorAll('[data-series-dimmed="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1);
  });

  it('a comparison story highlights the highest bar', () => {
    const { container } = render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(screen.getByRole('region', { name: 'Inzichten bij de grafiek' })).toHaveTextContent('Friesland: 20 %');
    expect(container.querySelectorAll('[data-series-dimmed="true"]').length).toBeGreaterThan(0);
  });

  it('a spec swap on the same instance closes the story and starts the next one at the first step', () => {
    const { rerender } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    rerender(<ChartView spec={twoSeriesFourYearLineSpec()} />);
    expect(screen.queryByRole('region', { name: 'Inzichten bij de grafiek' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    expect(screen.getAllByRole('article')[0]).toHaveAttribute('aria-current', 'step');
  });

  it('counts story_open once per open and story_step per landed step', () => {
    const events: ChartStyleEvent[] = [];
    setChartUsageSink((e) => {
      events.push(e);
    });
    try {
      render(<ChartView spec={threePointSpec()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
      fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
      fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
      expect(events).toEqual(['story_open', 'story_step', 'story_step']);
    } finally {
      setChartUsageSink(null);
    }
  });

  it('with the story open the whole card still shows only spec digits, in Dutch and in English', () => {
    const s = threePointSpec({ provisionalNote: 'Voorlopige cijfers (2024) zijn gemarkeerd met *.' });
    const strings = [
      s.title,
      s.unit,
      s.attributionLine,
      s.attribution.tableId,
      s.attribution.syncedAt,
      s.provisionalNote ?? '',
      ...s.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
    ].filter(Boolean);
    const nl = render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    scanForUnboundDigits(nl.container, strings);
    nl.unmount();
    const en = render(
      <LangProvider lang="en">
        <ChartView spec={s} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    scanForUnboundDigits(en.container, strings);
  });

  // Task 3 (design §C2): the frame renders no text of its own — with a
  // frame on, the whole card must still show only digits traceable to the
  // spec's own strings, in Dutch and in English.
  it('with a frame on, the whole card still shows only spec digits, in Dutch and in English', () => {
    const s = threePointSpec();
    const strings = [
      s.title,
      s.unit,
      s.attributionLine,
      s.attribution.tableId,
      s.attribution.syncedAt,
      ...s.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
    ].filter(Boolean);
    const framedStyle = { frameBackground: { kind: 'gradient' as const, from: '#fde68a', to: '#f472b6' }, frameInset: 'large' as const };
    const nl = render(
      <ChartStyleProvider initial={framedStyle}>
        <ChartView spec={s} />
      </ChartStyleProvider>,
    );
    scanForUnboundDigits(nl.container, strings);
    nl.unmount();
    const en = render(
      <LangProvider lang="en">
        <ChartStyleProvider initial={framedStyle}>
          <ChartView spec={s} />
        </ChartStyleProvider>
      </LangProvider>,
    );
    scanForUnboundDigits(en.container, strings);
  });

  it('only the story ring — never the panel text — enters the SVG export', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    // Scoped to the chart's own tabpanel, mirroring EXACTLY what
    // ChartDownloadMenu itself reads (containerRef.current.querySelector
    // ('svg') — chart-download.tsx) — a plain container-wide `svg` selector
    // would instead match the Opmaak/Inzichten trigger buttons' own icon
    // <svg>, which render earlier in the DOM than the chart's.
    const svg = container.querySelector('[role="tabpanel"] svg')!;
    expect(svg.querySelector('[data-story-marker]')).not.toBeNull();
    expect(svg.textContent).not.toContain('Hoogste punt');
    expect(svg.textContent).not.toContain('Begin');
  });

  // Task 3 (design §C2): the story ring/panel must behave identically with a
  // frame on — the frame is decoration around the export container, so
  // wrapping it must not change where the story marker lands or what the
  // story panel shows.
  it('the story ring and panel behave identically with a frame on', () => {
    const { container } = render(
      <ChartStyleProvider initial={{ frameBackground: { kind: 'solid', hex: '#336699' }, framePadding: 'medium' }}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    expect(container.querySelector('[data-slot="chart-frame"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    expect(screen.getAllByRole('article')[0]).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    const svg = container.querySelector('[role="tabpanel"] svg')!;
    expect(svg.querySelector('[data-story-marker]')).not.toBeNull();
  });

  // Review fix: while the story is open, every reader view control that
  // could contradict the active caption (hide/highlight the narrated
  // series, zoom it out of view, switch to small multiples) must be locked
  // — the story drives the chart while it's open.
  it('locks the legend, the zoom selects and the small-multiples toggle while the story is open, with a readable reason', () => {
    render(<ChartView spec={twoSeriesFourYearLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    // Scoped to the legend's own group: once the story is open, its step-jump
    // dots (chart-story.tsx) can carry a step title that collides with a
    // series label ("Utrecht") — the SAME collision the pre-existing
    // "a series step highlights..." test's resolution note describes for
    // the highlight button, just from a different element this time.
    const legend = within(screen.getByRole('group', { name: 'Reeksen' }));
    const utrecht = legend.getByRole('button', { name: 'Utrecht' });
    expect(utrecht).toBeDisabled();
    expect(utrecht).toHaveAttribute('title', 'Sluit het verhaal om dit te wijzigen.');
    expect(document.getElementById(utrecht.getAttribute('aria-describedby')!)).toHaveTextContent('Sluit het verhaal om dit te wijzigen.');
    expect(screen.getByLabelText('Vanaf')).toBeDisabled();
    expect(screen.getByLabelText('Tot')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kleine grafieken' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(screen.getByRole('button', { name: 'Utrecht' })).not.toBeDisabled();
    expect(screen.getByLabelText('Vanaf')).not.toBeDisabled();
  });

  // Final-review fix: every `aria-describedby` pointing at the lock-reason
  // span is already gated on `storyOpen`, so the span itself should only
  // exist in the DOM while the story is open too — not sit there
  // permanently, described by nothing, once the story closes.
  it('the lock-reason span only exists while the story is open', () => {
    const { container } = render(<ChartView spec={twoSeriesFourYearLineSpec()} />);
    expect(container.querySelector('[id$="-story-lock"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    expect(container.querySelector('[id$="-story-lock"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(container.querySelector('[id$="-story-lock"]')).toBeNull();
  });

  it("choosing another chart form closes the story and restores the reader's own view", () => {
    const { container } = render(<ChartView spec={twoSeriesFourYearLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Utrecht' }));
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(screen.queryByRole('region', { name: 'Inzichten bij de grafiek' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Inzichten' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1);
  });
});

// Task 5 (design §C2): the Frame tab wired into chart.tsx — frame_changed
// counted alongside option_changed, the contrast guard re-checking every
// per-chart series colour override against the new frame backdrops, and the
// account-default save dropping an "Own image" background.
describe('Task 5 — Frame tab wiring in chart.tsx', () => {
  beforeEach(() => {
    chartStyleActions.saveMyChartStyle.mockReset();
  });

  it('a frame control change fires frame_changed in addition to option_changed', () => {
    const events: ChartStyleEvent[] = [];
    setChartUsageSink((e) => {
      events.push(e);
    });
    try {
      render(<ChartView spec={threePointSpec()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Kader' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Kleur' }));
      expect(events).toEqual(['panel_open', 'option_changed', 'frame_changed']);
    } finally {
      setChartUsageSink(null);
    }
  });

  it('a plain (non-frame) control change fires only option_changed, never frame_changed', () => {
    const events: ChartStyleEvent[] = [];
    setChartUsageSink((e) => {
      events.push(e);
    });
    try {
      render(<ChartView spec={threePointSpec()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Dik' }));
      expect(events).toEqual(['panel_open', 'option_changed']);
    } finally {
      setChartUsageSink(null);
    }
  });

  // Final-review fix (Fix 5): a frame background that would hide a
  // per-chart series colour is now REFUSED UP FRONT by ChartConfigPanel's
  // own contrast guard, before chart.tsx ever sees the change — so
  // chart.tsx no longer silently drops or rewrites a series colour
  // override. A gradient whose own two ends are set to the EXACT series hex
  // is guaranteed unreadable against itself (contrast ratio 1, well under
  // the refusal threshold) regardless of the hex's absolute luminance.
  it('a frame background that would hide a per-chart series colour is refused; the series override is left untouched', () => {
    render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    const hex = screen.getByRole('textbox', { name: 'Kleur van Nederland (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: '#446688' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    // The override committed cleanly (no refusal alert — legible on both
    // ordinary cards).
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Kader' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Verloop' }));
    const from = screen.getByRole('textbox', { name: 'Van (hex)' }) as HTMLInputElement;
    fireEvent.change(from, { target: { value: '#446688' } });
    fireEvent.blur(from);
    const to = screen.getByRole('textbox', { name: 'Naar (hex)' }) as HTMLInputElement;
    fireEvent.change(to, { target: { value: '#446688' } });
    fireEvent.blur(to);

    // Refused: an alert is shown, in the digit-free exact wording.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Deze achtergrond maakt een reeks onleesbaar. Kies een andere kleur of zet de kaart aan.',
    );

    // The series override is left exactly as the reader set it — chart.tsx
    // never got a change to apply, so there is nothing to drop or rewrite.
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    const hexAfter = screen.getByRole('textbox', { name: 'Kleur van Nederland (hex-code)' }) as HTMLInputElement;
    expect(hexAfter.value).toBe('#446688');
  });

  it('save-default: an effective "Own image" frame background is saved as none, with the extra digit-free caveat appended to the saved status', async () => {
    chartStyleActions.saveMyChartStyle.mockResolvedValue({ ok: true });
    render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kader' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Eigen afbeelding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar als mijn standaard' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Opgeslagen. De afbeelding wordt niet bewaard in je standaard.',
    );
    const saved = chartStyleActions.saveMyChartStyle.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).toHaveProperty('frameBackground', 'none');
  });

  it('save-default: an ordinary (non-image) frame background saves plainly, no caveat appended', async () => {
    chartStyleActions.saveMyChartStyle.mockResolvedValue({ ok: true });
    render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kader' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Kleur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar als mijn standaard' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Opgeslagen.');
    expect(status.textContent).not.toMatch(/afbeelding/);
    const saved = chartStyleActions.saveMyChartStyle.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).toHaveProperty('frameBackground', { kind: 'solid', hex: '#ffffff' });
  });

  it('clicking Standaard resets and also clears the uploaded frame image', async () => {
    const { container } = render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={threePointSpec()} />
      </ChartStyleProvider>,
    );
    // Open the panel (opens on Grafiek tab)
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));

    // Navigate to Frame tab and upload an image
    fireEvent.click(screen.getByRole('tab', { name: 'Kader' }));

    // Select "Eigen afbeelding" to activate the image upload
    fireEvent.click(screen.getByRole('radio', { name: 'Eigen afbeelding' }));

    // Upload a file
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const small = new File([new Uint8Array(1024)], 'test.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [small] } });

    // Wait for the image to be loaded into the frame
    await waitFor(() => {
      const frame = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
      const style = window.getComputedStyle(frame);
      // The backgroundImage should be set after the file is processed
      expect(style.backgroundImage).toBeTruthy();
      expect(style.backgroundImage).not.toBe('none');
    });

    // Go back to Grafiek tab to access the Standaard button
    fireEvent.click(screen.getByRole('tab', { name: 'Grafiek' }));

    // Click Standaard to reset everything
    fireEvent.click(screen.getByRole('button', { name: 'Standaard' }));

    // Verify the frame no longer has a background-image after the reset
    const frameAfterReset = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    expect(frameAfterReset).not.toBeNull();
    const styleAfterReset = window.getComputedStyle(frameAfterReset);
    expect(styleAfterReset.backgroundImage).toBe('none');
  });
});

// Task 6 (chart frame plan): one Style panel open per page — StylePanelOwnerProvider
// is the shared "owner" slot every ChartView on the page claims while its own
// panel is open.
describe('ChartView — StylePanelOwnerProvider (one Style panel per page)', () => {
  it('opening chart B\'s Style panel closes chart A\'s, when both share one provider', () => {
    render(
      <StylePanelOwnerProvider>
        <ChartView spec={threePointSpec({ title: 'Grafiek A' })} />
        <ChartView spec={threePointSpec({ title: 'Grafiek B' })} />
      </StylePanelOwnerProvider>,
    );
    const [triggerA, triggerB] = screen.getAllByRole('button', { name: 'Opmaak' });
    fireEvent.click(triggerA!);
    expect(triggerA).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('region', { name: 'Opmaak van de grafiek' })).toHaveLength(1);

    fireEvent.click(triggerB!);
    expect(triggerB).toHaveAttribute('aria-expanded', 'true');
    expect(triggerA).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('region', { name: 'Opmaak van de grafiek' })).toHaveLength(1);
  });

  it('without a provider (the default), two charts each keep their own panel open independently', () => {
    render(
      <>
        <ChartView spec={threePointSpec({ title: 'Grafiek A' })} />
        <ChartView spec={threePointSpec({ title: 'Grafiek B' })} />
      </>,
    );
    const [triggerA, triggerB] = screen.getAllByRole('button', { name: 'Opmaak' });
    fireEvent.click(triggerA!);
    fireEvent.click(triggerB!);
    expect(triggerA).toHaveAttribute('aria-expanded', 'true');
    expect(triggerB).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('region', { name: 'Opmaak van de grafiek' })).toHaveLength(2);
  });
});
