// #296 part 2 Task 6: the two-measure scatter card. Renders the REAL Recharts
// chart in jsdom (same approach as chart.test.tsx's #197 section: with no
// ResizeObserver, ResponsiveContainer keeps its initialDimension, so the svg
// — dots, ticks, labels — is really in the DOM; every text asserted below is
// drawn by scatter-view.tsx's own components, never Recharts' own <Text>).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScatterAxis, ScatterPoint, ScatterSpec } from '../backend/chart/index.ts';
import { PROVISIONAL_NOTE, PROVISIONAL_NOTE_EN } from '../backend/chart/index.ts';
import { DEFAULT_PALETTE } from '../lib/chart-presentation.ts';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { translateAttributionLine } from '../lib/i18n/cbs-words.ts';
import { scatterBodyEn, scatterLineEn, scatterTitleEn } from '../lib/scatter-text-en.ts';
import { ScatterTooltip, ScatterView } from './scatter-view.tsx';

// ChartEmbedButton (mounted when `embed` is passed) imports this 'use server'
// module — mocked so nothing reaches a real db/auth boundary (chart.test.tsx
// does the same).
const { createEmbedCode, startProSubscriptionCheckout } = vi.hoisted(() => ({
  createEmbedCode: vi.fn(),
  startProSubscriptionCheckout: vi.fn(),
}));
vi.mock('../app/embed-actions.ts', () => ({ createEmbedCode, startProSubscriptionCheckout }));

afterEach(() => cleanup());

function axis(overrides: Partial<ScatterAxis> = {}): ScatterAxis {
  return {
    measureTitle: 'Gemiddeld inkomen',
    unit: '1 000 euro',
    decimals: 1,
    periodLabel: '2024',
    tableId: '84639NED',
    defaultScale: 'linear',
    attributionLine:
      'Bron: CBS StatLine, tabel 84639NED — Inkomen van huishoudens. Gegevens gesynchroniseerd op 2026-09-20. Periode: 2024. Licentie: CC BY 4.0.',
    canonicalKey: null,
    syncedAt: '2026-09-20T04:00:00.000Z',
    ...overrides,
  };
}

function pt(regionCode: string, label: string, y: number, yFormatted: string, x: number, xFormatted: string, provisional = false): ScatterPoint {
  return {
    regionCode,
    label,
    x,
    y,
    xFormatted,
    yFormatted,
    xResultId: `X:${regionCode}`,
    yResultId: `Y:${regionCode}`,
    provisional,
  };
}

// Six provinces. y = income (1 000 euro, one decimal), x = population
// (aantal, spread > 100x so the spec opens x on log).
const POINTS: ScatterPoint[] = [
  pt('PV20', 'Groningen (PV)', 38.2, '38,2', 596075, '596.075'),
  pt('PV21', 'Fryslân', 36.9, '36,9', 659551, '659.551'),
  pt('PV27', 'Noord-Holland', 47.5, '47,5', 2952622, '2.952.622', true),
  pt('PV29', 'Zeeland', 39.1, '39,1', 391124, '391.124'),
  pt('PV24', 'Flevoland', 41.3, '41,3', 1500, '1.500'),
  pt('PV30', 'Noord-Brabant', 44.0, '44,0', 2626210, '2.626.210'),
];

function spec(overrides: Partial<ScatterSpec> = {}): ScatterSpec {
  return {
    schemaVersion: 1,
    kind: 'scatter',
    title: 'Gemiddeld inkomen tegenover bevolking op 1 januari, 2024',
    y: axis(),
    x: axis({
      measureTitle: 'Bevolking op 1 januari',
      unit: 'aantal',
      decimals: 0,
      tableId: '03759ned',
      defaultScale: 'log',
      attributionLine:
        'Bron: CBS StatLine, tabel 03759ned — Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio. Gegevens gesynchroniseerd op 2026-09-21. Periode: 2024. Licentie: CC BY 4.0.',
      canonicalKey: 'population_on_1_january',
      syncedAt: '2026-09-21T04:00:00.000Z',
    }),
    points: POINTS,
    scope: { kind: 'all_provincies' },
    leftOut: [],
    notApplicableCount: 0,
    labelled: ['PV27', 'PV21', 'PV24'],
    provisionalNote: PROVISIONAL_NOTE,
    license: 'CC BY 4.0',
    ...overrides,
  };
}

const BODY = 'Gemiddeld inkomen tegenover bevolking op 1 januari per provincie, 2024. Elke stip is één provincie.';
const LINE = 'Dekking: alle 6 provincies hebben beide cijfers.';

function renderNl(props: Partial<Parameters<typeof ScatterView>[0]> = {}) {
  return render(<ScatterView spec={spec()} body={BODY} scatterLine={LINE} {...props} />);
}

function renderEn(props: Partial<Parameters<typeof ScatterView>[0]> = {}) {
  return render(
    <LangProvider lang="en">
      <ScatterView spec={spec()} body={BODY} scatterLine={LINE} {...props} />
    </LangProvider>,
  );
}

function dots(container: HTMLElement): SVGCircleElement[] {
  return Array.from(container.querySelectorAll<SVGCircleElement>('circle[data-point="value"]'));
}

function dot(container: HTMLElement, code: string): SVGCircleElement {
  const found = container.querySelector<SVGCircleElement>(`circle[data-point="value"][data-region="${code}"]`);
  if (!found) throw new Error(`no dot for ${code}`);
  return found;
}

function axisTitle(container: HTMLElement, which: 'vertical' | 'horizontal'): string {
  return Array.from(container.querySelectorAll(`[data-role="axis-title"][data-axis="${which}"] tspan`))
    .map((n) => n.textContent)
    .join(' ');
}

/** The honesty scan: every numeric token on the card must come from one of
 * the spec's own strings (or, on an English card, their English-notation
 * copies) — never a number this component formatted itself. */
function expectEveryDigitTraced(container: HTMLElement, specStrings: string[]) {
  // Per text node, not the concatenated textContent: adjacent svg ticks and
  // table cells would otherwise glue into one token no spec string contains.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const tokens: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
  }
  expect(tokens.length).toBeGreaterThan(0);
  for (const tok of tokens) {
    expect(
      specStrings.some((s) => s.includes(tok)),
      `numeric token "${tok}" has no source in the spec's own strings`,
    ).toBe(true);
  }
}

describe('ScatterView — the plot', () => {
  it('draws one dot per point', () => {
    const { container } = renderNl();
    expect(dots(container)).toHaveLength(POINTS.length);
  });

  it('puts the asked-about measure (y) on the vertical axis', () => {
    const { container } = renderNl();
    expect(axisTitle(container, 'vertical')).toContain('Gemiddeld inkomen (1 000 euro)');
    expect(axisTitle(container, 'horizontal')).toContain('Bevolking op 1 januari (aantal)');
    // Geometry: SVG y grows downward, so the highest income sits highest.
    const cy = (code: string) => Number(dot(container, code).getAttribute('cy'));
    expect(cy('PV27')).toBeLessThan(cy('PV30'));
    expect(cy('PV30')).toBeLessThan(cy('PV21'));
  });

  it('opens each axis on its spec default scale and marks a log axis in its title', () => {
    const { container } = renderNl();
    expect(axisTitle(container, 'horizontal')).toContain('(log. schaal)');
    expect(axisTitle(container, 'vertical')).not.toContain('(log. schaal)');
  });

  it('offers a log toggle per log-capable axis; one click returns a log axis to linear', () => {
    const { container } = renderNl();
    const horizontal = screen.getByRole('button', { name: 'Log. schaal horizontaal' });
    expect(horizontal).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(horizontal);
    expect(horizontal).toHaveAttribute('aria-pressed', 'false');
    expect(axisTitle(container, 'horizontal')).not.toContain('(log. schaal)');
    // y is all-positive, so it may switch to log too.
    const vertical = screen.getByRole('button', { name: 'Log. schaal verticaal' });
    expect(vertical).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(vertical);
    expect(axisTitle(container, 'vertical')).toContain('(log. schaal)');
  });

  it('offers no log toggle for an axis with a value at or below zero', () => {
    const withNegative = POINTS.map((p, i) => (i === 0 ? { ...p, y: -1.2, yFormatted: '-1,2' } : p));
    render(<ScatterView spec={spec({ points: withNegative })} />);
    expect(screen.queryByRole('button', { name: 'Log. schaal verticaal' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Log. schaal horizontaal' })).toBeInTheDocument();
  });

  it('labels each axis with real plotted values only, extremes included, each bound to its own cell', () => {
    const { container } = renderNl();
    const ticks = Array.from(container.querySelectorAll('[data-role="axis-tick"]'));
    const byId = new Map(POINTS.flatMap((p) => [[p.yResultId, p.yFormatted], [p.xResultId, p.xFormatted]] as const));
    for (const tick of ticks) {
      // The tick's text is exactly the formatted string of the cell it is bound to.
      expect(byId.get(tick.getAttribute('data-label-for') ?? '')).toBe(tick.textContent);
    }
    const labels = ticks.map((n) => n.textContent);
    expect(labels).toEqual(expect.arrayContaining(['36,9', '47,5', '1.500', '2.952.622']));
  });

  it('shows a visible text label on every labelled point, * on a provisional one', () => {
    const { container } = renderNl();
    const labels = Array.from(container.querySelectorAll('[data-role="point-label"]')).map((n) => n.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Noord-Holland*', 'Fryslân', 'Flevoland']));
    expect(labels).toHaveLength(3);
  });

  it('draws a provisional point hollow (not by colour alone)', () => {
    const { container } = renderNl();
    expect(dot(container, 'PV27').getAttribute('fill')).toBe('var(--card)');
    expect(dot(container, 'PV20').getAttribute('fill')).not.toBe('var(--card)');
  });

  it('paints only theme tokens and the designed chart palette — no stray colours', () => {
    const { container } = renderNl();
    const paints = Array.from(container.querySelectorAll('svg [fill], svg [stroke]')).flatMap((n) => [
      n.getAttribute('fill'),
      n.getAttribute('stroke'),
    ]);
    for (const paint of paints) {
      if (paint === null || paint === 'none' || paint.startsWith('var(--') || paint.startsWith('url(')) continue;
      expect(DEFAULT_PALETTE, `unexpected paint ${paint}`).toContain(paint);
    }
  });
});

describe('ScatterView — axis ticks (fix round 1: up to five real plotted values)', () => {
  // Twelve provinces with a skewed population (x) and an even income (y).
  const TWELVE: ScatterPoint[] = [
    pt('P01', 'Groningen (PV)', 38.2, '38,2', 596075, '596.075'),
    pt('P02', 'Fryslân', 36.9, '36,9', 659551, '659.551'),
    pt('P03', 'Drenthe', 37.8, '37,8', 502051, '502.051'),
    pt('P04', 'Overijssel', 39.4, '39,4', 1184333, '1.184.333'),
    pt('P05', 'Flevoland', 40.1, '40,1', 445731, '445.731'),
    pt('P06', 'Gelderland', 41.0, '41,0', 2133708, '2.133.708'),
    pt('P07', 'Utrecht (PV)', 45.2, '45,2', 1387643, '1.387.643'),
    pt('P08', 'Noord-Holland', 47.5, '47,5', 2952622, '2.952.622'),
    pt('P09', 'Zuid-Holland', 42.1, '42,1', 3804906, '3.804.906'),
    pt('P10', 'Zeeland', 39.1, '39,1', 391124, '391.124'),
    pt('P11', 'Noord-Brabant', 44.0, '44,0', 2626210, '2.626.210'),
    pt('P12', 'Limburg (PV)', 38.0, '38,0', 1128367, '1.128.367'),
  ];
  const twelve = () => spec({ points: TWELVE, labelled: [], x: { ...spec().x, defaultScale: 'linear' } });
  const formatted = new Set(TWELVE.flatMap((p) => [p.yFormatted, p.xFormatted]));

  function ticksOf(container: HTMLElement, which: 'vertical' | 'horizontal'): string[] {
    return Array.from(container.querySelectorAll(`[data-role="axis-tick"][data-axis="${which}"]`)).map((n) => n.textContent ?? '');
  }

  it('draws five distinct ticks per axis, each some point\'s own formatted string', () => {
    const { container } = render(<ScatterView spec={twelve()} />);
    for (const which of ['vertical', 'horizontal'] as const) {
      const ticks = ticksOf(container, which);
      expect(ticks).toHaveLength(5);
      expect(new Set(ticks).size).toBe(5);
      for (const tick of ticks) expect(formatted.has(tick), `${which} tick ${tick}`).toBe(true);
    }
    // Min and max always included.
    expect(ticksOf(container, 'horizontal')).toEqual(expect.arrayContaining(['391.124', '3.804.906']));
    expect(ticksOf(container, 'vertical')).toEqual(expect.arrayContaining(['36,9', '47,5']));
  });

  it('draws a light gridline per tick (the grid follows the ticks), in the shared grid token', () => {
    const { container } = render(<ScatterView spec={twelve()} />);
    // Recharts also draws the plot box's two edges in each direction; the
    // rest are one line per tick.
    const inner = (sel: string, coord: 'y1' | 'x1', lo: 'y' | 'x', size: 'height' | 'width') =>
      Array.from(container.querySelectorAll(sel)).filter((l) => {
        const at = Number(l.getAttribute(coord));
        const start = Number(l.getAttribute(lo));
        return at !== start && at !== start + Number(l.getAttribute(size));
      });
    const horizontal = inner('.recharts-cartesian-grid-horizontal line', 'y1', 'y', 'height');
    const vertical = inner('.recharts-cartesian-grid-vertical line', 'x1', 'x', 'width');
    expect(horizontal).toHaveLength(5);
    expect(vertical).toHaveLength(5);
    for (const line of [...horizontal, ...vertical]) expect(line.getAttribute('stroke')).toBe('var(--border)');
  });

  it('recomputes the ticks in log positions when an axis switches to log', () => {
    const { container } = render(<ScatterView spec={twelve()} />);
    const linear = ticksOf(container, 'horizontal');
    fireEvent.click(screen.getByRole('button', { name: 'Log. schaal horizontaal' }));
    const log = ticksOf(container, 'horizontal');
    expect(log).not.toEqual(linear);
    expect(log.length).toBeGreaterThanOrEqual(3);
    for (const tick of log) expect(formatted.has(tick)).toBe(true);
    expect(log).toEqual(expect.arrayContaining(['391.124', '3.804.906']));
  });

  it('keeps each tick on its own measure after a swap', () => {
    const { container } = render(<ScatterView spec={twelve()} />);
    const yTicks = ticksOf(container, 'vertical');
    const xTicks = ticksOf(container, 'horizontal');
    fireEvent.click(screen.getByRole('button', { name: 'Assen omwisselen' }));
    expect(ticksOf(container, 'horizontal')).toEqual(yTicks);
    expect(ticksOf(container, 'vertical')).toEqual(xTicks);
    const vert = container.querySelector('[data-role="axis-tick"][data-axis="vertical"]');
    expect(vert?.getAttribute('data-label-for')).toMatch(/^X:/);
  });
});

describe('ScatterView — the tooltip', () => {
  const row = (p: ScatterPoint) => ({ payload: { point: p, label: p.label } });

  it('shows the region, the y line and the x line, each the spec\'s own string bound to its cell', () => {
    const s = spec();
    render(<ScatterTooltip active payload={[row(POINTS[0]!)]} spec={s} lang="nl" />);
    const tip = screen.getByRole('status');
    expect(tip).toHaveTextContent('Groningen (PV)');
    expect(within(tip).getByText('38,2').closest('[data-label-for]')).toHaveAttribute('data-label-for', 'Y:PV20');
    expect(within(tip).getByText('596.075').closest('[data-label-for]')).toHaveAttribute('data-label-for', 'X:PV20');
    expect(tip).toHaveTextContent('Gemiddeld inkomen (1 000 euro)');
    expect(tip).toHaveTextContent('Bevolking op 1 januari (aantal)');
    expect(tip).not.toHaveTextContent('*');
  });

  it('marks a provisional point with * and the provisional note', () => {
    render(<ScatterTooltip active payload={[row(POINTS[2]!)]} spec={spec()} lang="nl" />);
    const tip = screen.getByRole('status');
    expect(tip).toHaveTextContent('Noord-Holland*');
    expect(tip).toHaveTextContent(PROVISIONAL_NOTE);
  });

  it('renders nothing when inactive', () => {
    const { container } = render(<ScatterTooltip active={false} payload={[]} spec={spec()} lang="nl" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('English: translated names and English number notation, still bound to the cell', () => {
    render(<ScatterTooltip active payload={[row(POINTS[2]!)]} spec={spec()} lang="en" />);
    const tip = screen.getByRole('status');
    expect(tip).toHaveTextContent('North Holland*');
    expect(tip).toHaveTextContent('Average income (1 000 euros)');
    expect(within(tip).getByText('2,952,622').closest('[data-label-for]')).toHaveAttribute('data-label-for', 'X:PV27');
    expect(tip).toHaveTextContent(PROVISIONAL_NOTE_EN);
  });
});

describe('ScatterView — search', () => {
  function search(value: string) {
    fireEvent.change(screen.getByRole('searchbox', { name: 'Zoek een regio in de grafiek' }), { target: { value } });
  }

  it('highlights a matching dot, case- and accent-insensitively, larger and outlined', () => {
    const { container } = renderNl();
    const before = Number(dot(container, 'PV21').getAttribute('r'));
    search('FRYSLAN');
    const hit = dot(container, 'PV21');
    expect(hit).toHaveAttribute('data-highlighted', 'true');
    expect(Number(hit.getAttribute('r'))).toBeGreaterThan(before);
    expect(hit.getAttribute('stroke')).toBe('var(--foreground)');
    expect(dot(container, 'PV20')).toHaveAttribute('data-highlighted', 'false');
    const list = screen.getByRole('list', { name: 'Gevonden regio’s' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('Fryslân');
    // The match's own numbers, bound to their cells.
    expect(within(list).getByText('36,9')).toHaveAttribute('data-label-for', 'Y:PV21');
    expect(within(list).getByText('659.551')).toHaveAttribute('data-label-for', 'X:PV21');
  });

  it('lists at most five matches and says there are more', () => {
    renderNl();
    search('n'); // matches all six regions
    const list = screen.getByRole('list', { name: 'Gevonden regio’s' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('Meer regio’s gevonden — typ verder om te verfijnen.')).toBeInTheDocument();
  });

  it('empty input highlights nothing', () => {
    const { container } = renderNl();
    search('zee');
    expect(dot(container, 'PV29')).toHaveAttribute('data-highlighted', 'true');
    search('');
    expect(dots(container).every((d) => d.getAttribute('data-highlighted') === 'false')).toBe(true);
    expect(screen.queryByRole('list', { name: 'Gevonden regio’s' })).toBeNull();
  });

  it('says so when nothing matches', () => {
    renderNl();
    search('xyz');
    expect(screen.getByText('Geen regio in deze grafiek past bij “xyz”.')).toBeInTheDocument();
  });
});

describe('ScatterView — swap axes', () => {
  it('swaps the data, titles, scales and tick labels', () => {
    const { container } = renderNl();
    const cxBefore = Number(dot(container, 'PV24').getAttribute('cx'));
    fireEvent.click(screen.getByRole('button', { name: 'Assen omwisselen' }));
    expect(axisTitle(container, 'vertical')).toContain('Bevolking op 1 januari (aantal) (log. schaal)');
    expect(axisTitle(container, 'horizontal')).toContain('Gemiddeld inkomen (1 000 euro)');
    // The log toggle follows its measure: population is now vertical.
    expect(screen.getByRole('button', { name: 'Log. schaal verticaal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Log. schaal horizontaal' })).toHaveAttribute('aria-pressed', 'false');
    const vertTicks = Array.from(container.querySelectorAll('[data-role="axis-tick"][data-axis="vertical"]')).map(
      (n) => n.getAttribute('data-label-for'),
    );
    expect(vertTicks.length).toBeGreaterThanOrEqual(2);
    expect(vertTicks.every((id) => id?.startsWith('X:'))).toBe(true);
    expect(vertTicks).toEqual(expect.arrayContaining(['X:PV24', 'X:PV27']));
    // Flevoland had the smallest population (leftmost); on the income axis it
    // sits mid-field, so it moved right.
    expect(Number(dot(container, 'PV24').getAttribute('cx'))).toBeGreaterThan(cxBefore);
  });
});

describe('ScatterView — table view', () => {
  it('shows region | y | x in spec order, formatted values bound to cells, * on a provisional region', () => {
    renderNl();
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Regio', 'Gemiddeld inkomen (1 000 euro)', 'Bevolking op 1 januari (aantal)']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'Groningen (PV)',
      'Fryslân',
      'Noord-Holland*',
      'Zeeland',
      'Flevoland',
      'Noord-Brabant',
    ]);
    const cells = within(rows[2]!).getAllByRole('cell');
    expect(cells.map((c) => [c.textContent, c.getAttribute('data-label-for')])).toEqual([
      ['47,5', 'Y:PV27'],
      ['2.952.622', 'X:PV27'],
    ]);
  });

  it('switches back to the chart', () => {
    const { container } = renderNl();
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(dots(container)).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Grafiek' }));
    expect(dots(container)).toHaveLength(POINTS.length);
  });
});

describe('ScatterView — the card around the plot (Dutch)', () => {
  it('shows the title, body, coverage line, extra lines in order, provisional note and both attribution lines', () => {
    const s = spec();
    renderNl({ extraLines: ['Definitie verticale as.', 'Let op: de tabel 03759ned is verouderd.'] });
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(s.title);
    expect(screen.getByText(BODY)).toBeInTheDocument();
    const line = screen.getByText(LINE);
    const first = screen.getByText('Definitie verticale as.');
    const second = screen.getByText('Let op: de tabel 03759ned is verouderd.');
    expect(line.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(PROVISIONAL_NOTE)).toBeInTheDocument();
    expect(screen.getByText(s.y.attributionLine)).toBeInTheDocument();
    expect(screen.getByText(s.x.attributionLine)).toBeInTheDocument();
  });

  it('every number on the card traces to a spec string', () => {
    const s = spec();
    const { container } = renderNl({ extraLines: ['Let op: de tabel 03759ned is verouderd.'] });
    expectEveryDigitTraced(container, [
      s.title,
      s.y.measureTitle,
      s.y.unit,
      s.x.measureTitle,
      s.y.attributionLine,
      s.x.attributionLine,
      s.y.tableId,
      s.x.tableId,
      BODY,
      LINE,
      'Let op: de tabel 03759ned is verouderd.',
      ...s.points.flatMap((p) => [p.yFormatted, p.xFormatted]),
    ]);
  });

  it('offers the download menu, and the embed button only when embed is given', () => {
    const { unmount } = renderNl();
    expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insluiten' })).toBeNull();
    unmount();
    renderNl({ embed: { auditId: 42 } });
    expect(screen.getByRole('button', { name: 'Insluiten' })).toBeInTheDocument();
  });

  it('shows one source badge per table, each with that table\'s own sync date', () => {
    renderNl();
    const badges = screen.getAllByRole('link').filter((a) => /84639NED|03759ned/.test(a.textContent ?? ''));
    expect(badges.map((b) => b.textContent)).toEqual([
      expect.stringContaining('84639NED · gesynchroniseerd 2026-09-20'),
      expect.stringContaining('03759ned · gesynchroniseerd 2026-09-21'),
    ]);
  });

  it('shows the same attribution line once when both axes share it', () => {
    const s = spec();
    render(<ScatterView spec={spec({ x: { ...s.x, attributionLine: s.y.attributionLine } })} />);
    expect(screen.getAllByText(s.y.attributionLine)).toHaveLength(1);
  });

  it('embed mode: no controls, no download, the embed footer with its backlink', () => {
    renderNl({ embedMode: true, embedFooter: 'Bevroren op 20 september 2026 ·', embed: { auditId: 42 } });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Insluiten' })).toBeNull();
    expect(screen.getByText(/Bevroren op 20 september 2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'checkdecijfers.nl' })).toBeInTheDocument();
  });

  it('refuses a spec from a newer schema version instead of drawing it', () => {
    const { container } = render(<ScatterView spec={{ ...spec(), schemaVersion: 2 as 1 }} />);
    expect(dots(container)).toHaveLength(0);
    expect(screen.getByText(/nieuwere versie/)).toBeInTheDocument();
  });
});

describe('ScatterView — English', () => {
  it('uses the English title, body and coverage line built from the spec, never the Dutch props', () => {
    const s = spec();
    renderEn();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(scatterTitleEn(s));
    expect(screen.getByText(scatterBodyEn(s))).toBeInTheDocument();
    expect(screen.getByText(scatterLineEn(s))).toBeInTheDocument();
    expect(screen.queryByText(BODY)).toBeNull();
    expect(screen.queryByText(LINE)).toBeNull();
    expect(screen.getByText(PROVISIONAL_NOTE_EN)).toBeInTheDocument();
    expect(screen.getByText(translateAttributionLine(s.y.attributionLine))).toBeInTheDocument();
    expect(screen.getByText(translateAttributionLine(s.x.attributionLine))).toBeInTheDocument();
  });

  it('omits the English body/coverage line when the caller passed no Dutch one', () => {
    const s = spec();
    render(
      <LangProvider lang="en">
        <ScatterView spec={s} />
      </LangProvider>,
    );
    expect(screen.queryByText(scatterBodyEn(s))).toBeNull();
    expect(screen.queryByText(scatterLineEn(s))).toBeNull();
  });

  it('translates axis titles (with the English log marker), region labels and controls', () => {
    const { container } = renderEn();
    expect(axisTitle(container, 'vertical')).toContain('Average income (1 000 euros)');
    expect(axisTitle(container, 'horizontal')).toContain('Population on 1 January (number) (log scale)');
    const labels = Array.from(container.querySelectorAll('[data-role="point-label"]')).map((n) => n.textContent);
    expect(labels).toContain('North Holland*');
    expect(screen.getByRole('button', { name: 'Swap axes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log scale horizontal' })).toBeInTheDocument();
  });

  it('search matches the English and the Dutch region name', () => {
    const { container } = renderEn();
    const box = screen.getByRole('searchbox', { name: 'Find a region in the chart' });
    fireEvent.change(box, { target: { value: 'north holland' } });
    expect(dot(container, 'PV27')).toHaveAttribute('data-highlighted', 'true');
    fireEvent.change(box, { target: { value: 'noord-holland' } });
    expect(dot(container, 'PV27')).toHaveAttribute('data-highlighted', 'true');
  });

  it('every number traces to a spec string in English notation', () => {
    const s = spec();
    const swap = (v: string) => v.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'));
    const { container } = renderEn();
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expectEveryDigitTraced(container, [
      scatterTitleEn(s),
      scatterBodyEn(s),
      scatterLineEn(s),
      'Average income (1 000 euros)',
      translateAttributionLine(s.y.attributionLine),
      translateAttributionLine(s.x.attributionLine),
      ...s.points.flatMap((p) => [swap(p.yFormatted), swap(p.xFormatted)]),
    ]);
    const table = screen.getByRole('table');
    expect(within(table).getByText('2,952,622')).toHaveAttribute('data-label-for', 'X:PV27');
  });
});
