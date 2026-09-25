// UserChartView (ADR 037 D11, H2) — the first-ever test file for this
// component. The load-bearing property throughout: a UserChartSpec chart
// must be visibly/structurally impossible to confuse with a CBS ChartView —
// the badge, the dashed chrome, the provenance+disclaimer footer, and the
// ABSENCE of anything CBS-shaped (no SourceBadge, no "Bron: CBS StatLine",
// no "CC BY 4.0"). Every displayed number must be the spec's own
// formattedValue string (R6-analog, same honesty contract chart.test.tsx
// pins for ChartView).
//
// Co-pilot phase 2 (session 113, Task 5): the card now composes the shared
// shell (history, form tabs, legend, style panel, notes, title/caption,
// per-turn persistence). The Server Action modules are mocked the way
// chart-edits-persistence.test.tsx mocks them — without that, the imports
// would reach the real 'use server' modules in jsdom.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
import type { ClientChartInstruction, DatasetProfile, DatasetTurnRecord, UserChartSpec, UserDataset } from '../backend/attachments/types.ts';
// Own-data publish (ADR 057, Task 4): requirement 8 renders the card off the
// REAL server-side replay + prune pipeline (Task 2), not a hand-built
// fixture — the same fixture style as own-chart-publication.test.ts.
import { buildDatasetProfile } from '../backend/attachments/ingest/profile.ts';
import { makeCommand } from '../lib/chart-commands.ts';
import { buildPublishedChart, pruneForPublic, type PublicChartState } from '../lib/own-chart-publication.ts';

const datasetActions = vi.hoisted(() => ({
  renderDatasetInstruction: vi.fn(),
}));
vi.mock('../app/dataset-actions.ts', () => datasetActions);
const chartEditsActions = vi.hoisted(() => ({
  fetchChartEdits: vi.fn().mockResolvedValue({ ok: true, log: null }),
  saveChartEdits: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../app/chart-edits-actions.ts', () => chartEditsActions);
const derivationActions = vi.hoisted(() => ({
  requestDatasetDerivation: vi.fn(),
}));
vi.mock('../app/dataset-derivation-actions.ts', () => derivationActions);
const wholeVerificationActions = vi.hoisted(() => ({
  requestDatasetWholeVerification: vi.fn(),
}));
vi.mock('../app/dataset-whole-verification-actions.ts', () => wholeVerificationActions);

// Final-review fixes A4/A5: the Publish dialog's Server Actions, mocked at
// the module boundary (own-chart-publish-dialog.test.tsx's own shape) so the
// card's publish WIRING — which log it hands over — can be asserted.
const publishActions = vi.hoisted(() => ({
  getOwnChartPublication: vi.fn().mockResolvedValue(null),
  publishOwnChart: vi.fn().mockResolvedValue({ ok: true, publicId: 'abc123' }),
  unpublishOwnChart: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../app/own-chart-publish-actions.ts', () => publishActions);

import { CHART_EDITS_SAVE_DEBOUNCE_MS } from '../lib/use-chart-edits.ts';
import { UserChartView, type UserChartEditContext, type UserChartPublicView } from './user-chart.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: null });
  chartEditsActions.saveChartEdits.mockResolvedValue({ ok: true });
  datasetActions.renderDatasetInstruction.mockReset();
  derivationActions.requestDatasetDerivation.mockReset();
  wholeVerificationActions.requestDatasetWholeVerification.mockReset();
  publishActions.getOwnChartPublication.mockResolvedValue(null);
  publishActions.publishOwnChart.mockResolvedValue({ ok: true, publicId: 'abc123' });
  publishActions.unpublishOwnChart.mockResolvedValue({ ok: true });
});

function point(overrides: Partial<UserChartSpec['series'][0]['points'][0]> = {}) {
  return {
    rowRef: 'r1:c1',
    xKey: '2024',
    xLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    sourceText: '42,0',
    ...overrides,
  };
}

function spec(overrides: Partial<UserChartSpec> = {}): UserChartSpec {
  return {
    schemaVersion: 1,
    origin: 'user_dataset',
    trust: 'unverified',
    kind: 'line',
    xHeader: 'Year',
    yHeaders: ['Revenue'],
    series: [{ label: 'Revenue', points: [point()] }],
    provenance: {
      datasetId: 7,
      sourceKind: 'file_csv',
      displayName: 'verkoop-2024.csv',
      sourceUrlHost: null,
      capturedAt: '2026-09-06T12:00:00.000Z',
      contentSha256: 'deadbeef',
    },
    disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.',
    ...overrides,
  };
}

/** Two series, two points each — enough for a legend, a hidden-series count
 * and a real `.recharts-line-curve`/`.recharts-bar-rectangle` per series. */
function twoSeriesSpec(): UserChartSpec {
  return spec({
    yHeaders: ['Revenue'],
    series: [
      {
        label: 'Amsterdam',
        points: [
          point({ rowRef: 'r1:c1', xKey: '2023', xLabel: '2023', value: 40, formattedValue: '40,0', sourceText: '40,0' }),
          point({ rowRef: 'r2:c1', xKey: '2024', xLabel: '2024', value: 42, formattedValue: '42,0', sourceText: '42,0' }),
        ],
      },
      {
        label: 'Rotterdam',
        points: [
          point({ rowRef: 'r1:c2', xKey: '2023', xLabel: '2023', value: 20, formattedValue: '20,0', sourceText: '20,0' }),
          point({ rowRef: 'r2:c2', xKey: '2024', xLabel: '2024', value: 24, formattedValue: '24,0', sourceText: '24,0' }),
        ],
      },
    ],
  });
}

const PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Year', type: 'year', nulls: 0 },
    { id: 'c1', header: 'Revenue', type: 'number', numberFormat: 'nl', nulls: 0 },
  ],
  rowCount: 2,
};

const LAST_INSTRUCTION: ClientChartInstruction = {
  version: 2,
  kind: 'line',
  x: 'c0',
  y: ['c1'],
  seriesBy: null,
  filters: [],
  sort: null,
  limit: null,
  aggregate: null,
  derived: null,
  unsupported: null,
};

function editContext(overrides: Partial<UserChartEditContext> = {}): UserChartEditContext {
  return { datasetId: 3, threadId: 42, turnId: 7, profile: PROFILE, lastInstruction: LAST_INSTRUCTION, ...overrides };
}

// Own-data publish (ADR 057, Task 4) — `publicView (ADR 057)` below tests
// against these two builders directly (requirements 1-7); requirement 8
// instead runs the REAL `buildPublishedChart`/`pruneForPublic` pipeline (see
// that describe block) so it proves the actual privacy guarantee, not a
// hand-built stand-in for it.
function publicChartState(overrides: Partial<PublicChartState> = {}): PublicChartState {
  return {
    form: 'line',
    hiddenKeys: [],
    dimmedKeys: [],
    highlightedKey: null,
    presentation: {},
    notes: [],
    title: null,
    caption: null,
    goalLines: [],
    eraShadings: [],
    headlineOverrideResultId: null,
    derivedOverlayRequests: [],
    ...overrides,
  };
}

function publicChartView(overrides: Partial<UserChartPublicView> = {}): UserChartPublicView {
  return { state: publicChartState(), overlays: {}, sourceLine: null, accountStyle: null, explicitLang: null, ...overrides };
}

/** Two series × three years — heatmap-shaped (a 2 × 3 grid, every cell a real
 * value) but NOT slope-shaped (three x values per series, not exactly two). */
function twoSeriesThreeYearSpec(): UserChartSpec {
  return spec({
    yHeaders: ['Revenue'],
    series: [
      {
        label: 'Amsterdam',
        points: [
          point({ rowRef: 'r1:c1', xKey: '2022', xLabel: '2022', value: 30, formattedValue: '30,0', sourceText: '30,0' }),
          point({ rowRef: 'r2:c1', xKey: '2023', xLabel: '2023', value: 40, formattedValue: '40,0', sourceText: '40,0' }),
          point({ rowRef: 'r3:c1', xKey: '2024', xLabel: '2024', value: 42, formattedValue: '42,0', sourceText: '42,0' }),
        ],
      },
      {
        label: 'Rotterdam',
        points: [
          point({ rowRef: 'r1:c2', xKey: '2022', xLabel: '2022', value: 10, formattedValue: '10,0', sourceText: '10,0' }),
          point({ rowRef: 'r2:c2', xKey: '2023', xLabel: '2023', value: 20, formattedValue: '20,0', sourceText: '20,0' }),
          point({ rowRef: 'r3:c2', xKey: '2024', xLabel: '2024', value: 24, formattedValue: '24,0', sourceText: '24,0' }),
        ],
      },
    ],
  });
}

/** Two series × ONE moment — pie-shaped (every series exactly one point, at
 * least two slices), the way a bar-kind `seriesBy` instruction over one x
 * value renders; also stacked-shaped (one stack). Amsterdam 40, Rotterdam 20
 * — a 2:1 split, so every share below is an exact-looking number. */
function twoSeriesOneMomentSpec(): UserChartSpec {
  return spec({
    kind: 'bar',
    yHeaders: ['Revenue'],
    series: [
      { label: 'Amsterdam', points: [point({ rowRef: 'r1:c1', xKey: '2024', xLabel: '2024', value: 40, formattedValue: '40,0', sourceText: '40,0' })] },
      { label: 'Rotterdam', points: [point({ rowRef: 'r1:c2', xKey: '2024', xLabel: '2024', value: 20, formattedValue: '20,0', sourceText: '20,0' })] },
    ],
  });
}

/** Three regions, one moment, ALL real values (600/600/300) — Task 4 fix
 * regression fixtures (adversarial review): a third series lets a legend
 * toggle change WHICH parts are sent without emptying the parts list
 * entirely, distinct from `threeRegionOneMomentSpecWithNull` below (C1,
 * a genuinely null part) and the two-series specs above (hiding either
 * series there always empties the parts list — I2's own scenario). */
function threeRegionOneMomentSpec(): UserChartSpec {
  return spec({
    kind: 'bar',
    yHeaders: ['Revenue'],
    series: [
      { label: 'Noord', points: [point({ rowRef: 'r1:c1', xKey: '2024', xLabel: '2024', value: 600, formattedValue: '600,0', sourceText: '600,0' })] },
      { label: 'Zuid', points: [point({ rowRef: 'r1:c2', xKey: '2024', xLabel: '2024', value: 600, formattedValue: '600,0', sourceText: '600,0' })] },
      { label: 'Oost', points: [point({ rowRef: 'r1:c3', xKey: '2024', xLabel: '2024', value: 300, formattedValue: '300,0', sourceText: '300,0' })] },
    ],
  });
}

/** The reviewer's own C1 regression scenario, verbatim: three regions, one
 * moment, Noord=600 / Zuid=600 / Oost genuinely blank in the source file
 * ("leeg in bron" — the SAME reason nullCellSpec above uses). Oost's null
 * value has no angle and is correctly dropped from RENDERING (Task 3's own
 * rule — only two slices are drawn), but a visible, real region whose value
 * is unknown must still reach the verification check as a withheld part,
 * never silently vanish from the sum (arithmetically identical to
 * defaulting it to zero, the exact fabrication class this feature exists
 * to prevent). */
function threeRegionOneMomentSpecWithNull(): UserChartSpec {
  return spec({
    kind: 'bar',
    yHeaders: ['Revenue'],
    series: [
      { label: 'Noord', points: [point({ rowRef: 'r1:c1', xKey: '2024', xLabel: '2024', value: 600, formattedValue: '600,0', sourceText: '600,0' })] },
      { label: 'Zuid', points: [point({ rowRef: 'r1:c2', xKey: '2024', xLabel: '2024', value: 600, formattedValue: '600,0', sourceText: '600,0' })] },
      { label: 'Oost', points: [point({ rowRef: 'r1:c3', xKey: '2024', xLabel: '2024', value: null, formattedValue: null, sourceText: '', reason: 'leeg in bron' })] },
    ],
  });
}

function lineCurves(): number {
  return document.querySelectorAll('.recharts-line-curve').length;
}

/** (g) The whole-card digit scan: every numeric token a reader can see traces
 * to one of the spec's OWN strings (a formattedValue, an xLabel, the capture
 * date) — the card itself never composes a figure. The plotted-point count is
 * structural (how many points are drawn), not a value, so it is allowed
 * explicitly. Shared by the line-form scan below and the heatmap scan.
 * `extraAllowed` (Task 3) is the ONE other permitted source: the 100%-stacked
 * form's shares — pure arithmetic over displayed values, formatted by the
 * app's own formatter — which the caller computes through that same
 * formatter, exactly as chart.test.tsx's stacked100 scan does. */
function expectDigitsTraceToSpec(container: HTMLElement, s: UserChartSpec, extraAllowed: readonly string[] = []): void {
  const allowed = [
    ...extraAllowed,
    s.provenance.capturedAt.slice(0, 10),
    s.provenance.displayName,
    String(s.series[0]!.points.length),
    ...s.series.flatMap((se) => [se.label, ...se.points.flatMap((p) => [p.formattedValue ?? '', p.xLabel])]),
  ].filter(Boolean);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const tokens: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
  }
  expect(tokens.length).toBeGreaterThan(0);
  for (const tok of tokens) {
    expect(
      allowed.some((str) => str.includes(tok)),
      `numeric token "${tok}" in the rendered DOM has no source in the spec's own strings`,
    ).toBe(true);
  }
}

// Own-data publish (ADR 057, Task 4 fix round 1, ruling R8/M2): a
// PUBLIC-specific allowed list, deliberately narrower than
// `expectDigitsTraceToSpec` above — a public render never shows
// `provenance.capturedAt`, `provenance.displayName`, or the plotted-point
// count (none of them are read by the card in public mode at all: the
// footer's own source line replaces `provenanceLine`, see requirement 5),
// so including them in the allowed list would let a real leak of one of
// those three past this scan undetected. Only what a public visitor can
// actually see traces a digit: series labels, formatted values, x labels,
// `yHeaders`, and whatever `extraAllowed` the caller passes (the source
// line's own text).
function expectPublicDigitsTraceToSpec(container: HTMLElement, s: UserChartSpec, extraAllowed: readonly string[] = []): void {
  const allowed = [
    ...extraAllowed,
    ...s.yHeaders,
    ...s.series.flatMap((se) => [se.label, ...se.points.flatMap((p) => [p.formattedValue ?? '', p.xLabel])]),
  ].filter(Boolean);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const tokens: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
  }
  expect(tokens.length).toBeGreaterThan(0);
  for (const tok of tokens) {
    expect(
      allowed.some((str) => str.includes(tok)),
      `numeric token "${tok}" in the rendered DOM has no source in the spec's own strings (public-mode allowed list)`,
    ).toBe(true);
  }
}

describe('UserChartView — H2 structural distinction from ChartView', () => {
  it('renders the persistent "Your data · unverified" badge', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByText('Your data · unverified')).toBeInTheDocument();
  });

  it('uses a dashed, distinct container chrome (huisstijl tokens)', () => {
    const { container } = render(<UserChartView spec={spec()} />);
    expect(container.firstElementChild?.className).toContain('border-dashed');
  });

  it('never renders a SourceBadge, CBS attribution, or a license line', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.queryByText(/CC BY 4\.0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bron: CBS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/StatLine/)).not.toBeInTheDocument();
  });

  it('shows the exact disclaimer line the spec carries, verbatim', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByText('User-uploaded data — not verified by checkdecijfers.')).toBeInTheDocument();
  });

  it('shows a provenance line built from the file name, upload date, and points plotted', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByText('Uit bestand verkoop-2024.csv, geüpload op 2026-09-06 · 1 punten weergegeven')).toBeInTheDocument();
  });

  it('shows the heading built from the spec\'s own headers, verbatim (U9)', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Revenue per Year');
  });
});

describe('UserChartView — honesty contract (mirrors chart.test.tsx)', () => {
  it('renders a download menu wired to this chart\'s own disclaimer + dataset id', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('renders a legend only when there is more than one series', () => {
    const { rerender } = render(<UserChartView spec={spec()} />);
    expect(screen.queryByRole('group', { name: 'Reeksen' })).not.toBeInTheDocument();

    rerender(<UserChartView spec={twoSeriesSpec()} />);
    const legend = screen.getByRole('group', { name: 'Reeksen' });
    expect(legend).toHaveTextContent('Amsterdam');
    expect(legend).toHaveTextContent('Rotterdam');
  });

  it('accepts a bar-kind spec without throwing', () => {
    expect(() => render(<UserChartView spec={spec({ kind: 'bar' })} />)).not.toThrow();
  });

  // (g) The whole-card digit scan — see `expectDigitsTraceToSpec` above.
  it('the whole-card digit scan is clean: every rendered digit traces to a spec string', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    expectDigitsTraceToSpec(container, s);
  });

  // #283 residual: the hbar (Liggend) form's numeric axis used to draw NO
  // scale at all (`tick={false}`) — a reader could see the bars and their
  // own end labels but nothing locating those values in the wider range.
  // It now draws the same lo/hi tick pair the line/area forms' Y-axis
  // already shows (`valueLabelPlan` + `AxisTick`, just oriented for a
  // bottom axis) — each tick's text is a plotted point's own
  // `formattedValue`, never a number this card invents or rounds.
  it('#283: the Liggend form draws a real numeric-axis scale — two ticks, each an existing point\'s own formattedValue; the whole-card digit scan stays clean', () => {
    const s = twoSeriesOneMomentSpec(); // Amsterdam 40, Rotterdam 20 — kind: 'bar', comparison-shaped
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    const ticks = [...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="axis-tick"]')];
    expect(ticks.map((el) => el.textContent).sort()).toEqual(['20,0', '40,0']);
    // Bound to a real result, exactly like every other axis-tick/value-label
    // on this card (data-label-for) — never free-floating text.
    expect(ticks.map((el) => el.getAttribute('data-label-for')).sort()).toEqual(['r1:c1', 'r1:c2']);
    expectDigitsTraceToSpec(container, s);
  });

  it('#283: a single-value Liggend chart (lo === hi) draws exactly one axis tick, not a fabricated pair', () => {
    const s = spec({ kind: 'bar', series: [{ label: 'Amsterdam', points: [point({ rowRef: 'r1:c1', value: 40, formattedValue: '40,0' })] }] });
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    const ticks = [...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="axis-tick"]')];
    expect(ticks.map((el) => el.textContent)).toEqual(['40,0']);
  });
});

// #318 (session 126, own-data parity): the CSV download — built by
// web/lib/user-csv.ts (its own suite pins the file format and the
// formula-injection defense); here only that the card offers it, in every
// form, and hands it THIS spec.
const CSV_BUTTON = 'CSV';
describe('UserChartView — CSV download (#318 own-data parity)', () => {
  it('offers the CSV download in chart and table form alike', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.getByRole('button', { name: CSV_BUTTON })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getByRole('button', { name: CSV_BUTTON })).toBeInTheDocument();
  });

  it('downloads this chart\'s own points as a named CSV file', async () => {
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:test';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      render(<UserChartView spec={twoSeriesSpec()} />);
      fireEvent.click(screen.getByRole('button', { name: CSV_BUTTON }));
      expect(clickSpy).toHaveBeenCalledTimes(1);
      const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe('checkdecijfers-your-data-7.csv');
      const text = await blobs[0]!.text();
      expect(text).toContain('Amsterdam;42;42,0;r2:c1');
      expect(text).toContain('Rotterdam;20;20,0;r1:c2');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    } finally {
      clickSpy.mockRestore();
    }
  });
});

// Task 6 (own-data publish, ADR 057): the Publish button next to
// DownloadCsvButton — gated on `edit?.publishEnabled === true`, and never in
// public mode (mirroring DownloadCsvButton's own `!publicMode` gate). The
// dialog's own open/fetch/field behaviour is own-chart-publish-dialog.test.tsx's
// job; this suite only proves the button's presence/absence contract.
describe('UserChartView — Publish button (own-data publish, ADR 057, Task 6)', () => {
  it('does not render Publish when there is no edit context', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.queryByRole('button', { name: 'Publiceren' })).toBeNull();
  });

  it('does not render Publish when edit.publishEnabled is not true (flag off / not yet updated)', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    expect(screen.queryByRole('button', { name: 'Publiceren' })).toBeNull();
  });

  // UserChartView has no `lang` prop of its own — `chartLang` falls back to
  // the ambient LangProvider default ('nl', lang-provider.tsx) when no
  // provider wraps the test, exactly like every other Dutch-by-default
  // assertion in this file — so the trigger renders "Publiceren" here, not
  // "Publish" (own-chart-publish-dialog.test.tsx pins the English copy
  // directly via its own explicit `lang="en"` prop).
  it('renders Publish when edit.publishEnabled is true', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext({ publishEnabled: true })} />);
    expect(screen.getByRole('button', { name: 'Publiceren' })).toBeInTheDocument();
  });

  it('never renders Publish in public mode, even if publishEnabled were somehow true', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext({ publishEnabled: true })} publicView={publicChartView()} />);
    expect(screen.queryByRole('button', { name: 'Publiceren' })).toBeNull();
  });

  /** Opens the publish dialog from the card's own trigger and clicks the
   * in-dialog Publish button (same accessible name — scoped via `within`). */
  async function publishFromCard(): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole('button', { name: 'Publiceren' }));
    const dialog = await screen.findByRole('dialog', { name: /grafiek publiceren/i });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Publiceren' })).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publiceren' }));
    return dialog;
  }

  it('publishes the card\'s own command log (a legend toggle) for this turn', async () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext({ publishEnabled: true })} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Reeksen' })).getByRole('button', { name: 'Amsterdam' }));
    await publishFromCard();
    await waitFor(() => expect(publishActions.publishOwnChart).toHaveBeenCalledTimes(1));
    const [turnId, log] = publishActions.publishOwnChart.mock.calls[0]! as [number, { kind: string; key?: string }[]];
    expect(turnId).toBe(7);
    expect(log.map((c) => [c.kind, c.key])).toEqual([['toggleSeries', 's0']]);
  });

  // A4 (ruling R14): a colour drag is a TRANSIENT history entry until
  // sealed, and bare serializeHistory skips it — the published chart would
  // lack the colour the author is looking at. Publishing mid-drag (the Style
  // panel still open, so nothing has sealed it) must include it.
  it('A4: an unsealed colour drag is part of the published log', async () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext({ publishEnabled: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    await screen.findByRole('tab', { name: 'Grafiek' });
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    const picker = (await screen.findByLabelText('Kleur van Amsterdam kiezen')) as HTMLInputElement;
    fireEvent.change(picker, { target: { value: '#ff8800' } });
    await publishFromCard();
    await waitFor(() => expect(publishActions.publishOwnChart).toHaveBeenCalledTimes(1));
    const log = publishActions.publishOwnChart.mock.calls[0]![1] as { kind: string }[];
    expect(log.map((c) => c.kind)).toEqual(['setPresentation']);
  });

  // A5 (ruling R13): the history keeps at most HISTORY_CAP (200) entries, so
  // after 201 toggles of the same series the oldest toggle is trimmed — the
  // remaining 200 replay to Amsterdam SHOWN while the author sees it HIDDEN.
  // Publishing that log would expose a series the author hid, so the card
  // refuses client-side: the 'changed' line, and the server is never called.
  it('A5: refuses (changed line, no server call) when the trimmed history no longer replays to what the author sees', async () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext({ publishEnabled: true })} />);
    const toggle = within(screen.getByRole('group', { name: 'Reeksen' })).getByRole('button', { name: 'Amsterdam' });
    for (let i = 0; i < 201; i++) fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const dialog = await publishFromCard();
    await waitFor(() => expect(within(dialog).getByText(/niet precies zo worden gepubliceerd/i)).toBeInTheDocument());
    expect(publishActions.publishOwnChart).not.toHaveBeenCalled();
  });
});

// Session 126 follow-up: the image download menu is offered only where
// there is one chart <svg> to export, and it follows the chart's language.
describe('UserChartView — image download menu (session 126 follow-up)', () => {
  it('offers no image download in Tabel or Warmtekaart form — only the CSV', () => {
    render(<UserChartView spec={twoSeriesThreeYearSpec()} />);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    for (const form of ['Tabel', 'Warmtekaart']) {
      fireEvent.click(screen.getByRole('tab', { name: form }));
      expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: CSV_BUTTON })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('labels the menu in the chart\'s own language', () => {
    render(
      <LangProvider lang="en">
        <UserChartView spec={twoSeriesSpec()} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.getByRole('menu', { name: 'Download format' })).toBeInTheDocument();
  });
});

// #318 (session 126, own-data parity): small multiples — the CBS card's
// one-mini-chart-per-series view, same line-only gate, same toggle labels.
describe('UserChartView — small multiples (#318 own-data parity)', () => {
  it('offers no toggle for a single series', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.queryByRole('button', { name: 'Kleine grafieken' })).not.toBeInTheDocument();
  });

  it('draws one panel per series, hides the image download, and toggles back', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    expect(screen.getByRole('button', { name: 'Kleine grafieken' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Kleine grafieken per reeks' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-panel-for]').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Gelijke assen' })).toHaveAttribute('aria-pressed', 'true');
    // Several small <svg>s are not one exportable chart — same rule as the CBS card.
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Eigen assen' }));
    expect(screen.getByRole('button', { name: 'Eigen assen' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    expect(container.querySelectorAll('[data-panel-for]').length).toBe(0);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('leaves no half-applied view behind when the reader switches to a bar chart', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(screen.queryByRole('button', { name: 'Kleine grafieken' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-panel-for]').length).toBe(0);
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('keeps the CSV download while small multiples hide the image download', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    expect(screen.getByRole('button', { name: CSV_BUTTON })).toBeInTheDocument();
  });

  it('keeps the whole-card digit scan clean with small multiples on', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eigen assen' }));
    expectDigitsTraceToSpec(container, s);
  });
});

// (b) The form switch — the same tablist contract as the CBS card, over the
// own-data card's own command history.
describe('UserChartView — the form switch (co-pilot phase 2)', () => {
  it('renders the form tabs, switches to a bar chart, and Undo restores the line', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tabel' })).toBeInTheDocument();
    expect(lineCurves()).toBe(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(lineCurves()).toBe(2);
  });

  it('offers a table of the spec\'s own strings in Tabel form', () => {
    const s = twoSeriesSpec();
    render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('Amsterdam');
    expect(table).toHaveTextContent('42,0');
    expect(table).toHaveTextContent('2024');
  });

  it('disables a form the spec does not allow (Vlak needs a single time series)', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.getByRole('tab', { name: 'Vlak' })).toBeDisabled();
  });

  // §6's command ↔ control contract: every command kind the chat can emit has
  // an on-screen control, and the control SAYS which kind it is.
  it('marks every form tab with data-command-kind="setForm"', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    for (const name of ['Lijn', 'Vlak', 'Staaf', 'Liggend', 'Tabel', 'Dumbbell', 'Helling', 'Warmtekaart', 'Taartdiagram', 'Gestapeld', 'Gestapeld (%)']) {
      expect(screen.getByRole('tab', { name, hidden: true })).toHaveAttribute('data-command-kind', 'setForm');
    }
  });
});

// Review fix round 1 (IMPORTANT 1): `valueLabels` used to be a live toggle in
// the style panel that changed nothing on this card — and the resolver FORCES
// it on for bar/hbar ("zonder waarden heeft een staafdiagram geen schaal"),
// which is exactly the state the own-data bar was in: no number anywhere but
// the tooltip.
describe('UserChartView — value labels (co-pilot phase 2)', () => {
  function labelTexts(): string[] {
    return [...document.querySelectorAll('.recharts-label-list text')].map((el) => el.textContent ?? '');
  }

  it('bar form labels every point with its own formattedValue', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    const texts = labelTexts();
    for (const value of ['40,0', '42,0', '20,0', '24,0']) expect(texts).toContain(value);
  });

  // Through the one real product path that sets a presentation value before
  // the first paint: the signed-in account default (`withAccountDefault`).
  it('draws no value label at all once the reader turns them off (line form)', () => {
    render(
      <ChartStyleProvider initial={{ valueLabels: 'hidden' }}>
        <UserChartView spec={twoSeriesSpec()} />
      </ChartStyleProvider>,
    );
    expect(labelTexts()).toEqual([]);
  });

  it('labels a line chart\'s points while they are shown (the stock default)', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(labelTexts()).toContain('42,0');
  });
});

// (c) The lifted legend — one component, both cards.
describe('UserChartView — the legend (co-pilot phase 2)', () => {
  it('hides a series, and ⌘Z brings it back', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    expect(lineCurves()).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    expect(lineCurves()).toBe(1);

    fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true });
    expect(lineCurves()).toBe(2);
  });

  it('highlights one series and dims the others', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Markeer Amsterdam' }));
    expect(document.querySelector('[data-series-dimmed="true"]')).not.toBeNull();
  });

  it('dims a series via the legend button, keeping it visible at reduced opacity', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    // Both lines visible before dimming
    expect(lineCurves()).toBe(2);

    // Click the dim button for Amsterdam
    const dimButton = screen.getByRole('button', { name: /Dim Amsterdam/ });
    fireEvent.click(dimButton);

    // Series should still be visible (not removed from DOM)
    expect(lineCurves()).toBe(2);

    // Dim button should be pressed
    expect(dimButton).toHaveAttribute('aria-pressed', 'true');

    // Amsterdam (s0) line should have 0.35 opacity
    const dimmedLine = document.querySelector('path[stroke-opacity="0.35"]');
    expect(dimmedLine).not.toBeNull();
  });
});

// (d) The reader's own title, as an undoable command.
describe('UserChartView — the title (co-pilot phase 2)', () => {
  it('adds a title the reader typed and shows it as the card\'s heading', () => {
    render(<UserChartView spec={spec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Titel toevoegen' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Omzet loopt op' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('user-chart-title')).toHaveTextContent('Omzet loopt op');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Omzet loopt op');
  });

  it('offers a caption under the chart too', () => {
    render(<UserChartView spec={spec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift toevoegen' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Eigen cijfers' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('chart-caption')).toHaveTextContent('Eigen cijfers');
  });
});

// (e) Persistence — the SAME hook the CBS card uses, keyed by dataset turn.
describe('UserChartView — per-turn persistence (co-pilot phase 2)', () => {
  it('fetches this turn\'s stored log when signed in with an edit context', async () => {
    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    await waitFor(() => expect(chartEditsActions.fetchChartEdits).toHaveBeenCalledWith({ kind: 'turn', id: 7 }));
  });

  it('replays a stored setTitle command onto the card', async () => {
    chartEditsActions.fetchChartEdits.mockResolvedValue({
      ok: true,
      log: [{ kind: 'setTitle', title: 'Bewaarde titel', id: 'c1', at: '2026-09-18T00:00:00.000Z', source: 'panel' }],
    });
    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    expect(await screen.findByTestId('user-chart-title')).toHaveTextContent('Bewaarde titel');
  });

  it('never fetches or saves without an edit context (a hand-built spec)', async () => {
    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true'));
    expect(chartEditsActions.fetchChartEdits).not.toHaveBeenCalled();
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });
});

// Review fix round 1 (IMPORTANT 2): a stored log whose first command is a
// DATA change, followed by commands that name the series of the spec that
// data change produces. Before the fix, hydrate validated those later
// commands against the spec the card happened to be showing, dropped them
// all, and the next debounce persisted the loss.
describe('UserChartView — hydrating a stored data edit (co-pilot phase 2)', () => {
  const OTHER_INSTRUCTION: ClientChartInstruction = { ...LAST_INSTRUCTION, kind: 'bar' };

  function storedLog() {
    return [
      { kind: 'setInstruction', instruction: OTHER_INSTRUCTION, summary: 'Omzet per gemeente', id: 'c1', at: '2026-09-18T00:00:00.000Z', source: 'chat' },
      { kind: 'toggleSeries', key: 's1', id: 'c2', at: '2026-09-18T00:00:01.000Z', source: 'canvas' },
    ];
  }

  it('renders the stored instruction\'s chart with the stored series hidden — never dropping the toggle', async () => {
    // The card mounts on a ONE-series spec, so 's1' is invalid against it and
    // only the freshly rendered two-series spec makes the toggle replayable.
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: twoSeriesSpec() });
    chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: storedLog() });

    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Rotterdam' })).toHaveAttribute('aria-pressed', 'false'));
    expect(lineCurves()).toBe(1);
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledWith(3, OTHER_INSTRUCTION);

    // …and nothing writes the dropped command back to the row.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, CHART_EDITS_SAVE_DEBOUNCE_MS + 200));
    });
    for (const call of chartEditsActions.saveChartEdits.mock.calls) {
      expect((call[1] as { kind: string }[]).map((c) => c.kind)).toContain('toggleSeries');
    }
  });

  it('does not re-fire a refused instruction when the reader redoes across it', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'invalid', reason: 'zero_rows' });
    chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: storedLog() });

    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );

    // The refusal line shows, the previous chart stands, and the action was
    // called exactly once however often the instruction is revisited.
    expect(await screen.findByText('Geen rijen voldoen aan dit filter.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(screen.queryByText('Geen rijen voldoen aan dit filter.')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    await screen.findByText('Geen rijen voldoen aan dit filter.');
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
  });
});

// Task 5 review ask, built in Task 6: the card's miss→fetch→apply path
// through its FIRST real doorway (the Data panel) — a live control change,
// one free deterministic render call, the plot swapped for what came back,
// and Undo going back through the cache without a second call.
describe('UserChartView — a data command from the Data panel (co-pilot phase 2)', () => {
  function aggregatedSpec(): UserChartSpec {
    return spec({
      kind: 'bar',
      yHeaders: ['Sum of Revenue'],
      series: [{ label: 'Sum of Revenue', points: [point({ rowRef: 'g1', value: 99, formattedValue: '99,0', sourceText: '99,0' })] }],
    });
  }

  it('renders the new spec on a cache miss and restores the original on Undo — one call in total', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: aggregatedSpec() });
    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={spec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Revenue per Year');

    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });

    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Sum of Revenue per Year'));
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledWith(3, { ...LAST_INSTRUCTION, aggregate: { fn: 'sum' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Revenue per Year'));
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
  });

  it('offers no Data doorway at all without an edit context (no profile to validate against)', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.queryByRole('button', { name: 'Data' })).not.toBeInTheDocument();
  });
});

// Co-pilot phase 4 parity: ChartGoalLine and ChartEraShading, already mounted
// on ChartView (chart.tsx), mounted here too — same command kinds
// (addGoalLine/removeGoalLine/addEraShading/removeEraShading), same
// export-boundary contract. Mirrors chart.test.tsx's 'ChartView
// click-to-annotate' goal-line tests and its 'ChartView — Task 3 era shading
// visual rendering (ReferenceArea)' describe block, over this card's own
// export-container hook (`[data-testid="user-chart-container"]`, this file's
// existing selector, rather than the CBS card's `[role="tabpanel"]
// [aria-label="Grafiek"]`) — there is no separate zoom control on this card
// (see this file's own header comment), so unlike chart.test.tsx's era-
// shading tests, the "Tot" select needs no extra scoping to disambiguate it
// from a zoom-range "Tot".
describe('UserChartView — goal lines and era shading (co-pilot phase 4 parity)', () => {
  it('a saved goal line is never rendered inside the chart export container', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Doellijn toevoegen' }));
    fireEvent.change(screen.getByLabelText('Waarde'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Test Doel' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));

    const exportContainer = container.querySelector('[data-testid="user-chart-container"]');
    expect(exportContainer?.textContent).not.toContain('Test Doel');
    expect(screen.getByText('Test Doel')).toBeInTheDocument();
  });

  it('a saved goal line renders a real ReferenceLine on the chart', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    const before = container.querySelectorAll('.recharts-reference-line').length;
    fireEvent.click(await screen.findByRole('button', { name: 'Doellijn toevoegen' }));
    fireEvent.change(screen.getByLabelText('Waarde'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Test Doel' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));

    expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(before);
  });

  it('renders a ReferenceArea band in a line chart when an era shading is added through the real UI', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periode markeren' }));

    const fromSelect = await screen.findByLabelText('Van');
    fireEvent.change(fromSelect, { target: { value: '2023' } });
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Testperiode' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));

    expect(container.querySelector('.recharts-reference-area-rect')).not.toBeNull();
  });

  it('a saved era shading LABEL is never rendered inside the chart export container (the band still is)', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periode markeren' }));

    const fromSelect = await screen.findByLabelText('Van');
    fireEvent.change(fromSelect, { target: { value: '2023' } });
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Testperiode label' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));

    const exportContainer = container.querySelector('[data-testid="user-chart-container"]');
    expect(exportContainer?.textContent).not.toContain('Testperiode label');
    // The label text IS still shown to the reader, just outside the export.
    expect(screen.getByText('Testperiode label')).toBeInTheDocument();
    // The band itself, unlike the label, genuinely is inside the export.
    expect(container.querySelector('.recharts-reference-area-rect')).not.toBeNull();
  });
});

describe('UserChartView — difference/mean overlays (co-pilot phase 4 parity, Task 7)', () => {
  it('offers no overlay controls at all without an edit context — resolving one needs a real datasetId', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.queryByRole('button', { name: 'Verschil aanduiden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
  });

  it('offers no overlay controls on a bar-form chart, even with an edit context', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(screen.queryByRole('button', { name: 'Verschil aanduiden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
  });

  it('offers no average button with two series visible — an average across different series is not well-defined', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
  });

  it('toggles the difference picker\'s pressed state', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    const pickerButton = screen.getByRole('button', { name: 'Verschil aanduiden' });
    expect(pickerButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(pickerButton);
    expect(pickerButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pickerButton);
    expect(pickerButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('a resolved average renders a labelled ReferenceLine INSIDE the export container — unlike a goal line, this value is server-computed and verified, not reader-typed', async () => {
    derivationActions.requestDatasetDerivation.mockResolvedValueOnce({ ok: true, result: { value: 41, decimals: 1, rowRef: 'agg:mean:r1:c1+r2:c1' } });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    // Hide Rotterdam: Amsterdam becomes the sole visible series (its own two
    // points), matching chart.tsx's own I8 gate ("exactly one visible series").
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gemiddelde tonen' }));

    expect(derivationActions.requestDatasetDerivation).toHaveBeenCalledWith(3, LAST_INSTRUCTION, 'mean', ['r1:c1', 'r2:c1']);
    await waitFor(() => expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(0));
    const exportContainer = container.querySelector('[data-testid="user-chart-container"]');
    expect(exportContainer?.textContent).toContain('41,0');
  });

  it('a server refusal shows the reason text and draws nothing', async () => {
    derivationActions.requestDatasetDerivation.mockResolvedValueOnce({ ok: false, reason: 'no value available to compute an average' });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    const before = container.querySelectorAll('.recharts-reference-line').length;
    fireEvent.click(await screen.findByRole('button', { name: 'Gemiddelde tonen' }));

    expect(await screen.findByText('no value available to compute an average')).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-reference-line').length).toBe(before);
  });

  it('the remove chip drops the stored recipe and its resolved line disappears', async () => {
    derivationActions.requestDatasetDerivation.mockResolvedValueOnce({ ok: true, result: { value: 41, decimals: 1, rowRef: 'agg:mean:r1:c1+r2:c1' } });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gemiddelde tonen' }));
    await waitFor(() => expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /× Gemiddelde tonen/ }));
    await waitFor(() => expect(container.querySelectorAll('.recharts-reference-line').length).toBe(0));
  });
  it('#293: switching to a bar chart keeps the remove chip reachable (the add buttons go, the chip stays)', async () => {
    derivationActions.requestDatasetDerivation.mockResolvedValueOnce({ ok: true, result: { value: 41, decimals: 1, rowRef: 'agg:mean:r1:c1+r2:c1' } });
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gemiddelde tonen' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(screen.queryByRole('button', { name: 'Verschil aanduiden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /× Gemiddelde tonen/ }));
    expect(screen.queryByRole('button', { name: /× Gemiddelde tonen/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Own-data chart-fit parity (plan 2026-09-22, Task 1): the Helling (slope)
// and Warmtekaart (heatmap) tabs. Slope is the existing line branch at
// exactly two x values (nothing new drawn); the heatmap is this card's OWN
// table rows as a CSS grid over `userHeatmapModel` — each cell its point's
// own formattedValue bound via data-label-for, shaded by that same point's
// value on the grid's one shared min..max scale. Mirrors chart.test.tsx's
// 'ChartView — heatmap form (phase 5, Task 4)' block over this card's own
// fixtures and its own test id (`user-heatmap-grid`).
//   twoSeriesSpec()          — 2 series × 2 years: slope AND heatmap allowed
//   twoSeriesThreeYearSpec() — 2 series × 3 years: heatmap yes, slope no
//   spec()                   — 1 series × 1 point: neither
// ---------------------------------------------------------------------------
describe('UserChartView — slope + heatmap (own-data chart-fit parity, Task 1)', () => {
  const SLOPE_REASON = 'Beschikbaar zodra je precies twee momenten vergelijkt.';
  const HEATMAP_REASON = 'Beschikbaar zodra je minstens twee reeksen en twee momenten vergelijkt.';

  function grid(container: HTMLElement): HTMLElement {
    const el = container.querySelector<HTMLElement>('[data-testid="user-heatmap-grid"]');
    expect(el, 'no own-data heatmap grid on the card').not.toBeNull();
    return el!;
  }
  function cell(container: HTMLElement, resultId: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-testid="user-heatmap-grid"] [role="cell"][data-label-for="${resultId}"]`);
    expect(el, `no heatmap cell for ${resultId}`).not.toBeNull();
    return el!;
  }
  /** The whole-number percentage of --heatmap-high the cell's background is
   * mixed with — the SAME color-mix string chart.tsx's grid writes. */
  function mixPercent(el: HTMLElement): number {
    const m = /color-mix\(in oklch, var\(--heatmap-low\), var\(--heatmap-high\) (\d+)%\)/.exec(el.style.backgroundColor);
    expect(m, `cell background is not a heatmap mix: "${el.style.backgroundColor}"`).not.toBeNull();
    return Number(m![1]);
  }
  function expectDisabledWithReason(tab: HTMLElement, reason: string): void {
    expect(tab).toBeDisabled();
    expect(tab).toHaveAttribute('title', reason);
    const describedById = tab.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)!.textContent).toBe(reason);
  }

  it('the phase-5 trio trails Tabel in the scorer\'s own fixed order: Dumbbell (Task 2), Helling, Warmtekaart — then the three whole forms (Task 3)', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual([
      'Lijn', 'Vlak', 'Staaf', 'Liggend', 'Tabel', 'Dumbbell', 'Helling', 'Warmtekaart', 'Taartdiagram', 'Gestapeld', 'Gestapeld (%)',
    ]);
  });

  it('a 2-series × 2-point spec offers Helling enabled; selecting it draws the line branch at exactly two moments', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    const tab = screen.getByRole('tab', { name: 'Helling' });
    expect(tab).not.toBeDisabled();
    expect(tab).not.toHaveAttribute('title');
    expect(tab).not.toHaveAttribute('aria-describedby');

    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'false');
    // The line render, unchanged: two curves, each ONE straight segment
    // (`type="linear"`, so the path is `M … L …`), four value dots in all —
    // the same structure the CBS card's Helling tab proves in its e2e.
    const curves = [...container.querySelectorAll('.recharts-line-curve')];
    expect(curves).toHaveLength(2);
    for (const path of curves) expect(((path.getAttribute('d') ?? '').match(/L/g) ?? []).length).toBe(1);
    expect(container.querySelectorAll('circle[data-point="value"]')).toHaveLength(4);
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();
    // Still a chart form: the export container, the Style trigger and the
    // legend are all there.
    expect(container.querySelector('[data-testid="user-chart-container"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();
  });

  it('Helling is disabled, with its reason for pointer and screen reader, for three x values per series and for a single series', () => {
    const { unmount } = render(<UserChartView spec={twoSeriesThreeYearSpec()} />);
    const tab = screen.getByRole('tab', { name: 'Helling' });
    expectDisabledWithReason(tab, SLOPE_REASON);
    fireEvent.click(tab);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    unmount();

    // One series with exactly two points: a slope compares at least two things.
    const single = spec({ series: [twoSeriesSpec().series[0]!] });
    render(<UserChartView spec={single} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Helling' }), SLOPE_REASON);
  });

  it('a 2-series × 2-point spec offers Warmtekaart enabled; selecting it renders a grid of the table\'s own bound cells and no chart', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    const tab = screen.getByRole('tab', { name: 'Warmtekaart' });
    expect(tab).not.toBeDisabled();
    expect(tab).not.toHaveAttribute('title');
    expect(tab).not.toHaveAttribute('aria-describedby');

    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'false');
    // Nothing Recharts-shaped on the card, no plain <table>, no export container.
    expect(container.querySelector('.recharts-wrapper')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('[data-testid="user-chart-container"]')).toBeNull();

    const g = grid(container);
    expect(g).toHaveAttribute('role', 'table');
    // The same accessible name the table carries: the card's own heading.
    expect(g).toHaveAttribute('aria-label', 'Revenue per Year');
    // One column per series plus the row-header column.
    expect(g.style.gridTemplateColumns).toBe('max-content repeat(2, minmax(0, 1fr))');
    // The table's own header words: the file's xHeader, then the series labels (U9, verbatim).
    expect([...g.querySelectorAll('[role="columnheader"]')].map((el) => el.textContent)).toEqual(['Year', 'Amsterdam', 'Rotterdam']);
    expect([...g.querySelectorAll('[role="rowheader"]')].map((el) => el.textContent)).toEqual(['2023', '2024']);
    // Exactly four cells, each its point's OWN formattedValue, bound to its rowRef.
    const cells = [...g.querySelectorAll<HTMLElement>('[role="cell"]')];
    expect(cells.map((el) => [el.getAttribute('data-label-for'), el.textContent])).toEqual([
      ['r1:c1', '40,0'],
      ['r1:c2', '20,0'],
      ['r2:c1', '42,0'],
      ['r2:c2', '24,0'],
    ]);
    // The tabpanel the tablist points at is the grid's own wrapper.
    expect(g.parentElement).toHaveAttribute('role', 'tabpanel');
    expect(g.parentElement).toHaveAttribute('id', tab.getAttribute('aria-controls'));
    expect(g.parentElement).toHaveAttribute('aria-label', 'Warmtekaart');
  });

  it('colour: each cell is mixed by its value\'s place on the ONE grid-wide min..max scale, whole percentages', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    // min 20 (r1:c2), max 42 (r2:c1): 40 -> 20/22 = 90.9 -> 91%, 24 -> 4/22 = 18.2 -> 18%.
    expect(mixPercent(cell(container, 'r1:c2'))).toBe(0);
    expect(mixPercent(cell(container, 'r2:c1'))).toBe(100);
    expect(mixPercent(cell(container, 'r1:c1'))).toBe(91);
    expect(mixPercent(cell(container, 'r2:c2'))).toBe(18);
  });

  it('a 2 × 3 grid is offered too (at least two x values, not exactly two) and scales over all six cells', () => {
    const s = twoSeriesThreeYearSpec();
    const { container } = render(<UserChartView spec={s} />);
    const tab = screen.getByRole('tab', { name: 'Warmtekaart' });
    expect(tab).not.toBeDisabled();
    fireEvent.click(tab);
    const g = grid(container);
    expect(g.querySelectorAll('[role="cell"]')).toHaveLength(6);
    expect([...g.querySelectorAll('[role="rowheader"]')].map((el) => el.textContent)).toEqual(['2022', '2023', '2024']);
    // min 10 (r1:c2), max 42 (r3:c1); r2:c1 = 40 -> 30/32 = 93.75 -> 94%; r2:c2 = 20 -> 10/32 = 31.25 -> 31%.
    expect(mixPercent(cell(container, 'r1:c2'))).toBe(0);
    expect(mixPercent(cell(container, 'r3:c1'))).toBe(100);
    expect(mixPercent(cell(container, 'r2:c1'))).toBe(94);
    expect(mixPercent(cell(container, 'r2:c2'))).toBe(31);
    expect(cell(container, 'r2:c1').textContent).toBe('40,0');
    expectDigitsTraceToSpec(container, s);
  });

  it('the whole-card digit scan is clean in Warmtekaart form — the mix percentages live in style attributes, never in text', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    expectDigitsTraceToSpec(container, s);
  });

  it('is gated exactly like the table: no Style trigger, no legend, no notes strip, no era shading while the grid is shown — and Lijn restores them', async () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    // Line form (the default here) has all four.
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Doellijn toevoegen' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Periode markeren' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    expect(screen.queryByRole('button', { name: 'Opmaak' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Reeksen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Doellijn toevoegen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Periode markeren' })).toBeNull();

    // And back: switching to Lijn restores them and drops the grid.
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Doellijn toevoegen' })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
  });

  it('a single-series spec, a null cell and ragged x values each disable Warmtekaart with its reason — the table stays', () => {
    // One series: not a grid at all.
    const { container, unmount } = render(<UserChartView spec={spec()} />);
    const tab = screen.getByRole('tab', { name: 'Warmtekaart' });
    expectDisabledWithReason(tab, HEATMAP_REASON);
    fireEvent.click(tab);
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    unmount();

    // A null cell: nothing honest to colour there.
    const nulled = twoSeriesSpec();
    nulled.series[1]!.points[1] = point({ rowRef: 'r2:c2', xKey: '2024', xLabel: '2024', value: null, formattedValue: null, sourceText: '', reason: 'leeg in bron' });
    const second = render(<UserChartView spec={nulled} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Warmtekaart' }), HEATMAP_REASON);
    second.unmount();

    // Ragged x values: an intersection with no cell. The table still shows
    // that gap as a gap — the heatmap just is not offered.
    const ragged = twoSeriesSpec();
    ragged.series[1]!.points = [
      point({ rowRef: 'r0:c2', xKey: '2022', xLabel: '2022', value: 18, formattedValue: '18,0', sourceText: '18,0' }),
      point({ rowRef: 'r1:c2', xKey: '2023', xLabel: '2023', value: 20, formattedValue: '20,0', sourceText: '20,0' }),
    ];
    render(<UserChartView spec={ragged} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Warmtekaart' }), HEATMAP_REASON);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('switching to Warmtekaart then Undo returns to the prior form through the existing setForm history', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).not.toBeNull();
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    expect(screen.getByRole('tab', { name: 'Warmtekaart' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).not.toBeNull();
  });

  // This card's own version of chart.test.tsx's alternate-reading fallback:
  // the ONE way a mounted own-data card swaps its spec in place is a DATA
  // command (`renderDatasetInstruction`), and the spec that comes back can
  // be one the grid cannot honestly draw. `activeForm` runs `fallbackForm`
  // over that very spec, so the choice falls back (heatmap -> table) and
  // `userHeatmapModel`'s throw is never reached; Undo, a cache hit, brings
  // the grid straight back because the reader's own choice was never
  // discarded.
  it('a data edit that leaves the grid unreadable falls back to the table — never a thrown render — and Undo brings the grid back', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: spec() });
    const { container } = render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={twoSeriesSpec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).not.toBeNull();

    // The Data panel stays available in a tabular form (WHICH data is drawn
    // is orthogonal to how it is shown) — the same doorway the Data-panel
    // test above uses.
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveAttribute('aria-selected', 'true');
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Warmtekaart' }), HEATMAP_REASON);
    // Gated as the table it now renders as.
    expect(screen.queryByRole('button', { name: 'Opmaak' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(container.querySelector('[data-testid="user-heatmap-grid"]')).not.toBeNull());
    expect(screen.getByRole('tab', { name: 'Warmtekaart' })).toHaveAttribute('aria-selected', 'true');
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
  });

  it('the same fallback for Helling: a data edit to three x values falls back to a bar (fallbackForm\'s slope -> bar)', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: twoSeriesThreeYearSpec() });
    const { container } = render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={twoSeriesSpec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Helling' }));
    expect(screen.getByRole('tab', { name: 'Helling' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true'));
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Helling' }), SLOPE_REASON);
  });

  it('renders the English tab names; the grid keeps the file\'s own header words (never translated, U9)', () => {
    const { container } = render(
      <LangProvider lang="en">
        <UserChartView spec={twoSeriesSpec()} />
      </LangProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Slope' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Heatmap' }));
    const g = grid(container);
    expect(g.parentElement).toHaveAttribute('aria-label', 'Heatmap');
    expect([...g.querySelectorAll('[role="columnheader"]')].map((el) => el.textContent)).toEqual(['Year', 'Amsterdam', 'Rotterdam']);
    expect(cell(container, 'r2:c2').textContent).toBe('24,0');
  });

  // The layout contract, as far as jsdom can see it. jsdom has no layout
  // engine and loads no Tailwind, so `getComputedStyle(...).display` and
  // bounding boxes say nothing here — the real proof that `display:
  // contents` rows vanish from the box tree and the cells line up in shared
  // columns is chart-copilot.spec.ts's heatmap block (bounding boxes +
  // computed display) and belongs in Task 5's own-data e2e over THIS test
  // id. What jsdom CAN pin is the structure that proof depends on: the
  // `grid` class and inline column template on the table, `contents` on
  // every row, one column per series.
  it('carries the structure the real-browser layout proof (Task 5 e2e) asserts: grid on the table, contents on every row', () => {
    const { container } = render(<UserChartView spec={twoSeriesThreeYearSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Warmtekaart' }));
    const g = grid(container);
    expect(g.classList.contains('grid')).toBe(true);
    expect(g.style.gridTemplateColumns).toBe('max-content repeat(2, minmax(0, 1fr))');
    const rows = [...g.querySelectorAll('[role="row"]')];
    // Header row + one row per x value.
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.classList.contains('contents')).toBe(true);
    // Every row has exactly one cell per series column (header: one columnheader per column).
    expect(rows[0]!.querySelectorAll('[role="columnheader"]')).toHaveLength(3);
    for (const row of rows.slice(1)) {
      expect(row.querySelectorAll('[role="rowheader"]')).toHaveLength(1);
      expect(row.querySelectorAll('[role="cell"]')).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Own-data chart-fit parity (plan 2026-09-22, Task 2): the Dumbbell tab.
// Unlike Helling this is genuinely NEW drawing on this card: a
// `BarChart layout="vertical"` shell with no <Bar>, and `UserDumbbellOverlay`
// (chart.tsx's DumbbellOverlay, mirrored — its header comment says why it is
// a copy and not a shared import) reading Recharts' own settled scales and
// drawing each row's connector, two dots and two labels itself. Mirrors
// chart.test.tsx's 'ChartView — dumbbell form (phase 5, Task 3)' block over
// this card's own fixtures: these tests pin the REAL rendered geometry — dot
// positions linear in the values and aligned with Recharts' own axis ticks
// — plus the honesty bindings (each label is its point's own formattedValue,
// bound via data-label-for), never just "it rendered".
//   twoSeriesSpec()          — 2 series × 2 years (40→42, 20→24): allowed
//   twoSeriesThreeYearSpec() — 2 series × 3 years: disallowed
//   spec()                   — 1 series × 1 point: disallowed
// ---------------------------------------------------------------------------
describe('UserChartView — dumbbell (own-data chart-fit parity, Task 2)', () => {
  const DUMBBELL_REASON = 'Beschikbaar zodra minstens twee reeksen elk precies een begin- en een eindwaarde hebben.';
  const SLOPE_REASON = 'Beschikbaar zodra je precies twee momenten vergelijkt.';
  // Scoped to this card's own export container: a CBS card and an own-data
  // card can share a page, and the dumbbell's data-roles are the same on
  // both (ADR 037 H2 — a locator must never confuse the two).
  const DOT = '[data-testid="user-chart-container"] svg [data-role="dumbbell-dot"]';
  const LABEL = '[data-testid="user-chart-container"] svg [data-role="dumbbell-label"]';
  const CONNECTOR = '[data-testid="user-chart-container"] svg [data-role="dumbbell-connector"]';

  /** twoSeriesSpec with Amsterdam FALLING (80 -> 60); Rotterdam still rises. */
  function fallingSpec(): UserChartSpec {
    const s = twoSeriesSpec();
    s.series[0]!.points = [
      point({ rowRef: 'r1:c1', xKey: '2023', xLabel: '2023', value: 80, formattedValue: '80,0', sourceText: '80,0' }),
      point({ rowRef: 'r2:c1', xKey: '2024', xLabel: '2024', value: 60, formattedValue: '60,0', sourceText: '60,0' }),
    ];
    return s;
  }
  /** twoSeriesSpec with Rotterdam's 2024 cell empty in the file. */
  function nullCellSpec(): UserChartSpec {
    const s = twoSeriesSpec();
    s.series[1]!.points[1] = point({ rowRef: 'r2:c2', xKey: '2024', xLabel: '2024', value: null, formattedValue: null, sourceText: '', reason: 'leeg in bron' });
    return s;
  }
  function dot(container: HTMLElement, rowRef: string): SVGCircleElement {
    const el = container.querySelector<SVGCircleElement>(`${DOT}[data-result-id="${rowRef}"]`);
    expect(el, `no dumbbell dot for ${rowRef}`).not.toBeNull();
    return el!;
  }
  function label(container: HTMLElement, rowRef: string): SVGTextElement {
    const el = container.querySelector<SVGTextElement>(`${LABEL}[data-label-for="${rowRef}"]`);
    expect(el, `no dumbbell label for ${rowRef}`).not.toBeNull();
    return el!;
  }
  function row(container: HTMLElement, key: string): Element {
    const el = container.querySelector(`[data-testid="user-chart-container"] svg [data-role="dumbbell-row"][data-series-key="${key}"]`);
    expect(el, `no dumbbell row for ${key}`).not.toBeNull();
    return el!;
  }
  function tick(container: HTMLElement, name: string): Element {
    const el = [...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="category-axis-tick"]')].find((t) => t.textContent === name);
    expect(el, `no category-axis tick for ${name}`).toBeDefined();
    return el!;
  }
  const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));
  function expectDisabledWithReason(tab: HTMLElement, reason: string): void {
    expect(tab).toBeDisabled();
    expect(tab).toHaveAttribute('title', reason);
    const describedById = tab.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const hint = document.getElementById(describedById!);
    expect(hint).not.toBeNull();
    expect(hint).toHaveClass('sr-only');
    expect(hint!.textContent).toBe(reason);
  }

  it('a 2-series × 2-point spec offers Dumbbell enabled; selecting it draws two bound dots per row and no bar, line or tooltip — still a chart form, with its export container, Style trigger and legend', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    const tab = screen.getByRole('tab', { name: 'Dumbbell' });
    expect(tab).not.toBeDisabled();
    expect(tab).not.toHaveAttribute('title');
    expect(tab).not.toHaveAttribute('aria-describedby');
    // The line form mounts a tooltip; the dumbbell deliberately does not.
    expect(container.querySelector('.recharts-tooltip-wrapper')).not.toBeNull();

    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'false');
    // The shell carries no graphical item at all — nothing on a dumbbell is
    // a bar, and no line is drawn through Recharts either — and no tooltip,
    // which would have nothing to build its payload from.
    expect(container.querySelector('.recharts-bar')).toBeNull();
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();
    expect(container.querySelector('.recharts-line-curve')).toBeNull();
    expect(container.querySelector('.recharts-area')).toBeNull();
    expect(container.querySelector('.recharts-tooltip-wrapper')).toBeNull();

    // Exactly four dots, one per real point, each bound to its rowRef;
    // exactly one connector per row, keyed like every other form's series.
    const dots = [...container.querySelectorAll(DOT)];
    expect(dots.map((d) => d.getAttribute('data-result-id')).sort()).toEqual(['r1:c1', 'r1:c2', 'r2:c1', 'r2:c2']);
    const rows = [...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="dumbbell-row"]')];
    expect(rows.map((r) => r.getAttribute('data-series-key'))).toEqual(['s0', 's1']);
    expect(container.querySelectorAll(CONNECTOR)).toHaveLength(2);
    // A chart form: the frame's export container holds the drawing (a
    // PNG/SVG download gets the dots), and the chart-only chrome is there.
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="user-heatmap-grid"]')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('every label is its point\'s OWN formattedValue, bound via data-label-for; the category axis carries the series labels verbatim (U9); the whole card passes the digit scan', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    expect(label(container, 'r1:c1').textContent).toBe('40,0');
    expect(label(container, 'r2:c1').textContent).toBe('42,0');
    expect(label(container, 'r1:c2').textContent).toBe('20,0');
    expect(label(container, 'r2:c2').textContent).toBe('24,0');
    expect(container.querySelectorAll(LABEL)).toHaveLength(4);
    expect([...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="category-axis-tick"]')].map((el) => el.textContent)).toEqual([
      'Amsterdam',
      'Rotterdam',
    ]);
    // The number axis draws no ticks of its own (`tick={false}`): every
    // visible digit on the card is a dot label or the footer, and each
    // traces to a spec string.
    expectDigitsTraceToSpec(container, s);
  });

  it('geometry: dot x-positions are linear in the values from a zero-anchored domain, both ends of a row sit on that row\'s own axis tick, and the connector joins the two dots', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    const am23 = dot(container, 'r1:c1'); // 40
    const am24 = dot(container, 'r2:c1'); // 42
    const rt23 = dot(container, 'r1:c2'); // 20
    const rt24 = dot(container, 'r2:c2'); // 24

    // Ordered left-to-right exactly as the values order (20 < 24 < 40 < 42).
    expect(num(rt23, 'cx')).toBeLessThan(num(rt24, 'cx'));
    expect(num(rt24, 'cx')).toBeLessThan(num(am23, 'cx'));
    expect(num(am23, 'cx')).toBeLessThan(num(am24, 'cx'));
    // Linear: Rotterdam's 4 value-units span exactly twice the pixels
    // Amsterdam's 2 do, and the 20 units between the two 2023 dots span
    // five times Rotterdam's 4.
    const pxPer2 = num(am24, 'cx') - num(am23, 'cx');
    const pxPer4 = num(rt24, 'cx') - num(rt23, 'cx');
    expect(pxPer2).toBeGreaterThan(0);
    expect(pxPer4 / pxPer2).toBeCloseTo(2, 6);
    expect((num(am23, 'cx') - num(rt23, 'cx')) / pxPer4).toBeCloseTo(5, 6);
    // A zero-anchored domain (hbar's own [0, 'auto']): value 0 sits to the
    // LEFT of every dot yet inside the plot — never past the leftmost dot.
    const xAtZero = num(rt23, 'cx') - 20 * (pxPer4 / 4);
    expect(xAtZero).toBeLessThan(num(rt23, 'cx'));
    expect(xAtZero).toBeGreaterThan(0);

    // Both dots of a row share one y — the band CENTRE, which is exactly
    // where Recharts placed that row's own category tick
    // (UserCategoryAxisTick renders at the tick's y, +4 dy for baseline
    // alignment).
    expect(num(am23, 'cy')).toBe(num(am24, 'cy'));
    expect(num(rt23, 'cy')).toBe(num(rt24, 'cy'));
    expect(num(am23, 'cy')).not.toBe(num(rt23, 'cy'));
    expect(num(am23, 'cy')).toBeCloseTo(num(tick(container, 'Amsterdam'), 'y'), 6);
    expect(num(rt23, 'cy')).toBeCloseTo(num(tick(container, 'Rotterdam'), 'y'), 6);

    // The connector runs between the two dots of its row, at their y.
    const line = row(container, 's0').querySelector('[data-role="dumbbell-connector"]')!;
    expect(num(line, 'x1')).toBe(num(am23, 'cx'));
    expect(num(line, 'x2')).toBe(num(am24, 'cx'));
    expect(num(line, 'y1')).toBe(num(am23, 'cy'));
    expect(num(line, 'y2')).toBe(num(am23, 'cy'));

    // Labels: the leftmost dot's label sits to its left (end-anchored), the
    // rightmost dot's to its right (start-anchored) — on the dot's own y.
    const l23 = label(container, 'r1:c1');
    const l24 = label(container, 'r2:c1');
    expect(l23.getAttribute('text-anchor')).toBe('end');
    expect(num(l23, 'x')).toBeLessThan(num(am23, 'cx'));
    expect(l24.getAttribute('text-anchor')).toBe('start');
    expect(num(l24, 'x')).toBeGreaterThan(num(am24, 'cx'));
    expect(num(l23, 'y')).toBe(num(am23, 'cy') + 4);
  });

  it('a row whose value FELL draws its start dot on the right (label side follows the pixel order); no label ever carries a provisional suffix on this tier', () => {
    const s = fallingSpec();
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    const from = dot(container, 'r1:c1'); // 80
    const to = dot(container, 'r2:c1'); // 60
    expect(num(to, 'cx')).toBeLessThan(num(from, 'cx'));
    expect(label(container, 'r2:c1').getAttribute('text-anchor')).toBe('end');
    expect(label(container, 'r1:c1').getAttribute('text-anchor')).toBe('start');
    expect(label(container, 'r1:c1').textContent).toBe('80,0');
    expect(label(container, 'r2:c1').textContent).toBe('60,0');
    // Rotterdam rose (20 -> 24): its start dot is the left one.
    expect(num(dot(container, 'r1:c2'), 'cx')).toBeLessThan(num(dot(container, 'r2:c2'), 'cx'));
    // No provisional/definitief concept on this tier (ADR 037 D7): every
    // label is the bare formattedValue, never with chart.tsx's ' *' suffix.
    for (const el of container.querySelectorAll(LABEL)) expect(el.textContent).not.toMatch(/\*/);
    expectDigitsTraceToSpec(container, s);
  });

  it('hiding a series via the legend drops its row entirely (no dots, no connector), order kept; ⌘Z brings it back', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    expect(container.querySelector(`${DOT}[data-result-id="r1:c2"]`)).toBeNull();
    expect(container.querySelector(`${DOT}[data-result-id="r2:c2"]`)).toBeNull();
    expect(container.querySelectorAll(DOT)).toHaveLength(2);
    expect(container.querySelectorAll(CONNECTOR)).toHaveLength(1);
    expect(row(container, 's0')).toBeInTheDocument();
    expect(screen.getByText('1 van 2 reeksen verborgen')).toBeInTheDocument();

    fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true });
    expect(container.querySelectorAll(DOT)).toHaveLength(4);
    expect([...container.querySelectorAll('[data-testid="user-chart-container"] svg [data-role="dumbbell-row"]')].map((r) => r.getAttribute('data-series-key'))).toEqual(['s0', 's1']);
  });

  it('highlighting a series dims the other row to 0.25 (dots, connector and labels), and the legend\'s own Dim keeps a row at 0.35 — this card\'s two levels, never chart.tsx\'s single one', () => {
    const first = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markeer Amsterdam' }));
    const dimmed = row(first.container, 's1');
    expect(dimmed).toHaveAttribute('data-series-dimmed', 'true');
    expect(dimmed.querySelector('[data-role="dumbbell-connector"]')).toHaveAttribute('stroke-opacity', '0.25');
    for (const d of dimmed.querySelectorAll('[data-role="dumbbell-dot"]')) expect(d).toHaveAttribute('fill-opacity', '0.25');
    for (const l of dimmed.querySelectorAll('[data-role="dumbbell-label"]')) expect(l).toHaveAttribute('fill-opacity', '0.25');
    const kept = row(first.container, 's0');
    expect(kept).not.toHaveAttribute('data-series-dimmed');
    expect(kept.querySelector('[data-role="dumbbell-connector"]')).toHaveAttribute('stroke-opacity', '1');
    // Dimmed is not hidden: still four dots.
    expect(first.container.querySelectorAll(DOT)).toHaveLength(4);
    first.unmount();

    const second = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    fireEvent.click(screen.getByRole('button', { name: /Dim Amsterdam/ }));
    const readerDimmed = row(second.container, 's0');
    expect(readerDimmed).toHaveAttribute('data-series-dimmed', 'true');
    expect(readerDimmed.querySelector('[data-role="dumbbell-connector"]')).toHaveAttribute('stroke-opacity', '0.35');
    for (const d of readerDimmed.querySelectorAll('[data-role="dumbbell-dot"]')) expect(d).toHaveAttribute('fill-opacity', '0.35');
    expect(row(second.container, 's1').querySelector('[data-role="dumbbell-connector"]')).toHaveAttribute('stroke-opacity', '1');
  });

  it('a null cell disables Dumbbell with its reason for pointer and screen reader (sr-only, exactly once); a click does nothing; Helling shares the rule with its own wording; the table still shows the gap', () => {
    render(<UserChartView spec={nullCellSpec()} />);
    const tab = screen.getByRole('tab', { name: 'Dumbbell' });
    expectDisabledWithReason(tab, DUMBBELL_REASON);
    expect(screen.getAllByText(DUMBBELL_REASON)).toHaveLength(1);
    fireEvent.click(tab);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Helling' }), SLOPE_REASON);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('three x values per series and a single series both disable Dumbbell with the same reason', () => {
    const { unmount } = render(<UserChartView spec={twoSeriesThreeYearSpec()} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Dumbbell' }), DUMBBELL_REASON);
    unmount();
    render(<UserChartView spec={spec({ series: [twoSeriesSpec().series[0]!] })} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Dumbbell' }), DUMBBELL_REASON);
  });

  it('offers no difference/average overlay controls in Dumbbell form (they only ever draw on line/area), even with an edit context', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    expect(screen.getByRole('button', { name: 'Verschil aanduiden' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    expect(screen.queryByRole('button', { name: 'Verschil aanduiden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
  });

  it('switching to Dumbbell then Undo returns to the prior form through the existing setForm history', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    expect(container.querySelectorAll(DOT)).toHaveLength(4);
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    expect(container.querySelector(DOT)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    expect(screen.getByRole('tab', { name: 'Dumbbell' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelectorAll(DOT)).toHaveLength(4);
  });

  // This card's own version of chart.test.tsx's alternate-reading fallback
  // (the same shape as the Warmtekaart test above): a data command can hand
  // the card a spec the dumbbell cannot honestly draw. `activeForm` runs
  // `fallbackForm` over that very spec, so the choice falls back (dumbbell
  // -> bar) with the tab disabled and explained — never an empty axes-only
  // shell — and Undo (a cache hit, one server call in total) brings the
  // dumbbell straight back because the reader's own choice was never
  // discarded.
  it('a data edit to three x values falls back to a bar — never an empty axes-only shell — and Undo brings the dumbbell back', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: twoSeriesThreeYearSpec() });
    const { container } = render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={twoSeriesSpec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Dumbbell' }));
    expect(container.querySelectorAll(DOT)).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true'));
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    expect(container.querySelector(DOT)).toBeNull();
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Dumbbell' }), DUMBBELL_REASON);

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(container.querySelectorAll(DOT)).toHaveLength(4));
    expect(screen.getByRole('tab', { name: 'Dumbbell' })).toHaveAttribute('aria-selected', 'true');
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
  });

  it('renders the English disabled reason; the tab word itself is the same in both languages', () => {
    render(
      <LangProvider lang="en">
        <UserChartView spec={nullCellSpec()} />
      </LangProvider>,
    );
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Dumbbell' }), 'Available once at least two series each have exactly a start and an end value.');
  });
});

// ---------------------------------------------------------------------------
// Own-data chart-fit + verified-whole parity (plan 2026-09-22, Task 3): the
// Taartdiagram / Gestapeld / Gestapeld (%) tabs, UNCONDITIONAL on this tier.
// chart.tsx offers these three only for a registry-known roster whose parts
// it checks on demand against a CBS-published total (chart.test.tsx's
// 'ChartView — verified-whole forms (phase 5b, Task 4)' block, mirrored
// here); an own-data chart has no registry and no such total, so the forms
// are offered on SHAPE alone and ALWAYS carry the honesty note under the
// chart. This task builds the forms and the note's one DEFAULT state (nothing
// designated, nothing checked); Task 4 adds the designation click and the
// other three states. These tests pin the REAL rendered content — bound
// slices/segments, each label its point's own formattedValue (or, for the
// percent stack, a share the app's own formatter produced over the values on
// screen), stacked geometry, the exact note text and its placement — never
// just "it rendered".
//   twoSeriesOneMomentSpec() — 2 series × 1 moment (40 / 20): pie AND stacks
//   twoSeriesSpec()          — 2 series × 2 years: stacks, never a pie
//   spec()                   — 1 series × 1 point: none of the three
// ---------------------------------------------------------------------------
describe('UserChartView — pie / stacked / 100%-stacked (own-data verified-whole parity, Task 3)', () => {
  const NOT_CHECKED = 'Niet gecontroleerd tegen een totaal — klik op een punt om te controleren of deze delen optellen.';
  const NOT_CHECKED_EN = 'Not checked against a total — click a point to verify these parts add up.';
  // Fix wave (session 124, final-review I4): the SAME default without the
  // "click a point" invitation — what a card with no edit context shows,
  // since there a slice/segment is not clickable at all.
  const NOT_CHECKED_READ_ONLY = 'Niet gecontroleerd tegen een totaal.';
  const NOT_CHECKED_READ_ONLY_EN = 'Not checked against a total.';
  const PIE_REASON = 'Beschikbaar zodra de grafiek één moment toont voor minstens twee reeksen.';
  const STACKED_REASON = 'Beschikbaar zodra de grafiek minstens twee reeksen toont.';
  const OMITTED_2024 =
    'Niet getekend voor 2024 — daar ontbreekt een deel, is een deel negatief of tellen de delen op tot nul, dus een aandeel in procenten is niet te bepalen.';
  // Scoped to this card's own export container (ADR 037 H2: a CBS card and an
  // own-data card can share a page and use the same data-roles).
  const IN = '[data-testid="user-chart-container"]';
  const SECTOR = `${IN} .recharts-pie-sector`;
  const SEGMENT = `${IN} svg rect[data-point="value"]`;

  /** twoSeriesSpec with Rotterdam's 2024 cell empty in the file. */
  function nullCellSpec(): UserChartSpec {
    const s = twoSeriesSpec();
    s.series[1]!.points[1] = point({ rowRef: 'r2:c2', xKey: '2024', xLabel: '2024', value: null, formattedValue: null, sourceText: '', reason: 'leeg in bron' });
    return s;
  }
  function labelsByRole(container: HTMLElement, role: string): [string | null, string | null][] {
    return [...container.querySelectorAll<HTMLElement>(`${IN} [data-role="${role}"]`)].map((el) => [el.getAttribute('data-label-for'), el.textContent]);
  }
  function segment(container: HTMLElement, rowRef: string): SVGRectElement {
    const el = container.querySelector<SVGRectElement>(`${SEGMENT}[data-result-id="${rowRef}"]`);
    expect(el, `no stack segment for ${rowRef}`).not.toBeNull();
    return el!;
  }
  function segmentIds(container: HTMLElement): string[] {
    return [...container.querySelectorAll(SEGMENT)].map((el) => el.getAttribute('data-result-id') ?? '').sort();
  }
  const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));
  function note(): HTMLElement {
    return screen.getByTestId('own-whole-note');
  }
  function expectDisabledWithReason(tab: HTMLElement, reason: string): void {
    expect(tab).toBeDisabled();
    expect(tab).toHaveAttribute('title', reason);
    const describedById = tab.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const hint = document.getElementById(describedById!);
    expect(hint).not.toBeNull();
    expect(hint).toHaveClass('sr-only');
    expect(hint!.textContent).toBe(reason);
  }

  it('the three whole tabs trail Warmtekaart, in the fixed order Taartdiagram, Gestapeld, Gestapeld (%) — all eleven tabs on the card', () => {
    render(<UserChartView spec={twoSeriesOneMomentSpec()} />);
    const names = screen.getAllByRole('tab').map((el) => el.textContent);
    expect(names).toHaveLength(11);
    expect(names.slice(-4)).toEqual(['Warmtekaart', 'Taartdiagram', 'Gestapeld', 'Gestapeld (%)']);
  });

  it('pie: a one-moment 2-series spec offers Taartdiagram enabled — no roster, no check, no server call; selecting it draws one bound slice per series, labelled with its own formattedValue, with the default note under the chart, and stays a chart form', () => {
    const s = twoSeriesOneMomentSpec();
    const { container } = render(<UserChartView spec={s} />);
    const tab = screen.getByRole('tab', { name: 'Taartdiagram' });
    expect(tab).not.toBeDisabled();
    expect(tab).not.toHaveAttribute('title');
    expect(tab).not.toHaveAttribute('aria-describedby');
    // Not a whole form yet (this spec opens on Liggend): no note anywhere.
    expect(screen.queryByTestId('own-whole-note')).toBeNull();

    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('tabindex', '0');
    // Two slices, each bound to its series' own cell, in spec order — drawn
    // at once: nothing to wait for on this tier.
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
    const sectors = [...container.querySelectorAll<HTMLElement>(`${SECTOR} [data-point="value"]`)];
    expect(sectors.map((el) => el.getAttribute('data-result-id'))).toEqual(['r1:c1', 'r1:c2']);
    expect(sectors.map((el) => el.getAttribute('data-series-key'))).toEqual(['s0', 's1']);
    // Each label is the point's OWN formattedValue — never a Recharts percentage.
    expect(labelsByRole(container, 'pie-label')).toEqual([
      ['r1:c1', '40,0'],
      ['r1:c2', '20,0'],
    ]);
    expect([...container.querySelectorAll('[data-role="pie-label"]')].some((el) => /%/.test(el.textContent ?? ''))).toBe(false);
    // A plain pie: every sector path reaches the centre (one arc, no inner arc).
    for (const path of container.querySelectorAll<SVGPathElement>(`${SECTOR} path`)) {
      expect((path.getAttribute('d') ?? '').match(/A/g)?.length ?? 0).toBe(1);
    }
    // Slices are told apart by colour (the per-series palette).
    expect(new Set(sectors.map((el) => el.getAttribute('fill'))).size).toBe(2);
    // Nothing bar- or line-shaped; still a chart form with its export
    // container, Style trigger and legend.
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();
    expect(container.querySelector('.recharts-line-curve')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector(IN)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();

    // The note: the exact default wording, in its default state, at the
    // same prominence chart.tsx gives its own whole note — and OUTSIDE the
    // export container, like everything that is not a plotted value.
    const n = note();
    expect(n.textContent).toBe(NOT_CHECKED_READ_ONLY);
    expect(n).toHaveAttribute('data-state', 'not_checked_read_only');
    expect(n).toHaveClass('text-xs');
    expect(n).toHaveClass('text-muted-foreground');
    expect(container.querySelector(`${IN} [data-testid="own-whole-note"]`)).toBeNull();
    // Directly above the provenance/disclaimer footer.
    expect(n.nextElementSibling?.textContent).toContain('verkoop-2024.csv');
    expectDigitsTraceToSpec(container, s);
  });

  it('pie: disabled with its SHAPE reason (pointer + sr-only, exactly once) on a two-moment spec and on a single series — never the CBS roster wording; a click does nothing', () => {
    const first = render(<UserChartView spec={twoSeriesSpec()} />);
    const tab = screen.getByRole('tab', { name: 'Taartdiagram' });
    expectDisabledWithReason(tab, PIE_REASON);
    expect(screen.getAllByText(PIE_REASON)).toHaveLength(1);
    // chart.tsx's own three reasons all name "een volledige set regio’s die
    // het CBS zelf als geheel kent" — a roster condition that is never what
    // is missing on this tier, so that wording must not appear here.
    expect(screen.queryByText(/volledige set regio/)).toBeNull();
    fireEvent.click(tab);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('own-whole-note')).toBeNull();
    first.unmount();

    render(<UserChartView spec={spec()} />);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Taartdiagram' }), PIE_REASON);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Gestapeld' }), STACKED_REASON);
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Gestapeld (%)' }), STACKED_REASON);
  });

  it('donut: the pieHole presentation key only changes the hole — an inner arc on every sector, the same slices and labels', () => {
    const { container } = render(
      <ChartStyleProvider initial={{ pieHole: 'donut' }}>
        <UserChartView spec={twoSeriesOneMomentSpec()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
    for (const path of container.querySelectorAll<SVGPathElement>(`${SECTOR} path`)) {
      expect((path.getAttribute('d') ?? '').match(/A/g)?.length ?? 0).toBe(2);
    }
    expect(labelsByRole(container, 'pie-label')).toEqual([
      ['r1:c1', '40,0'],
      ['r1:c2', '20,0'],
    ]);
  });

  it('pie: hiding a series via the legend drops its slice — the parts on screen are the parts drawn — with the disclosure, the note staying; ⌘Z brings the slice back', () => {
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    expect(container.querySelectorAll(SECTOR)).toHaveLength(1);
    expect(labelsByRole(container, 'pie-label')).toEqual([['r1:c1', '40,0']]);
    expect(screen.getByText('1 van 2 reeksen verborgen')).toBeInTheDocument();
    expect(note().textContent).toBe(NOT_CHECKED_READ_ONLY);

    fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true });
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
  });

  it('stacked: a two-moment 2-series spec offers Gestapeld enabled; selecting it draws one stack per period of bound segments labelled with the REAL values (no percentage anywhere), each period\'s segments stacked end to end, with the default note', () => {
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    // Two moments: never a pie, but both stacks.
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Taartdiagram' }), PIE_REASON);
    const tab = screen.getByRole('tab', { name: 'Gestapeld' });
    expect(tab).not.toBeDisabled();
    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    // One <Bar> per series, four segments in all, each bound to its cell.
    expect(container.querySelectorAll(`${IN} .recharts-bar`)).toHaveLength(2);
    expect(segmentIds(container)).toEqual(['r1:c1', 'r1:c2', 'r2:c1', 'r2:c2']);
    expect(labelsByRole(container, 'stack-label').sort()).toEqual(
      [
        ['r1:c1', '40,0'],
        ['r1:c2', '20,0'],
        ['r2:c1', '42,0'],
        ['r2:c2', '24,0'],
      ].sort(),
    );
    expect([...container.querySelectorAll('[data-role="stack-label"]')].some((el) => /%/.test(el.textContent ?? ''))).toBe(false);

    // Geometry: within a period both segments share one x; Rotterdam's
    // (the second series) sits directly on top of Amsterdam's — its bottom
    // edge IS Amsterdam's top edge (`stackId="whole"`, native stacking) —
    // and the heights are linear in the values from a zero baseline (40:20
    // is exactly 2:1; 42:24 exactly 1.75:1).
    for (const [period, [bottom, top], ratio] of [
      ['2023', ['r1:c1', 'r1:c2'], 2],
      ['2024', ['r2:c1', 'r2:c2'], 42 / 24],
    ] as const) {
      const a = segment(container, bottom);
      const b = segment(container, top);
      expect(num(a, 'x'), period).toBeCloseTo(num(b, 'x'), 6);
      expect(num(b, 'y') + num(b, 'height'), period).toBeCloseTo(num(a, 'y'), 6);
      expect(num(a, 'height') / num(b, 'height'), period).toBeCloseTo(ratio, 6);
    }
    // Amsterdam's 2023 segment (40) is taller than Rotterdam's 2024 one (24)
    // on the one shared scale.
    expect(num(segment(container, 'r1:c1'), 'height')).toBeGreaterThan(num(segment(container, 'r2:c2'), 'height'));

    expect(note().textContent).toBe(NOT_CHECKED_READ_ONLY);
    expect(note().textContent).not.toContain('Niet getekend');
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reeksen' })).toBeInTheDocument();
    expectDigitsTraceToSpec(container, s);
  });

  it('100%-stacked: each segment is its share of the parts ON SCREEN for that period — computed by the app\'s own formatter, never a gate in between — both stacks the same full height, with the default note', async () => {
    const { formatValueNl } = await import('../backend/answer/compose/format.ts');
    const s = twoSeriesSpec();
    const { container } = render(<UserChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld (%)' }));
    expect(segmentIds(container)).toEqual(['r1:c1', 'r1:c2', 'r2:c1', 'r2:c2']);
    // 2023: 40 + 20 = 60; 2024: 42 + 24 = 66 — shares through the SAME
    // formatter the assertion uses, never a hand-typed string.
    const share = (v: number, total: number) => `${formatValueNl((v / total) * 100, 1)}%`;
    const expected = [
      ['r1:c1', share(40, 60)],
      ['r1:c2', share(20, 60)],
      ['r2:c1', share(42, 66)],
      ['r2:c2', share(24, 66)],
    ];
    expect(labelsByRole(container, 'stack-label').sort()).toEqual(expected.slice().sort());
    expect(expected.map(([, text]) => text)).toEqual(['66,7%', '33,3%', '63,6%', '36,4%']);
    // Every stack fills the same hundred-percent axis: the two segments of
    // 2023 add up to exactly the height the two of 2024 do, and the larger
    // part is the taller segment in each.
    const total2023 = num(segment(container, 'r1:c1'), 'height') + num(segment(container, 'r1:c2'), 'height');
    const total2024 = num(segment(container, 'r2:c1'), 'height') + num(segment(container, 'r2:c2'), 'height');
    expect(total2023).toBeGreaterThan(0);
    expect(total2023).toBeCloseTo(total2024, 6);
    expect(num(segment(container, 'r1:c1'), 'height') / num(segment(container, 'r1:c2'), 'height')).toBeCloseTo(2, 6);
    expect(note().textContent).toBe(NOT_CHECKED_READ_ONLY);
    // The computed shares are the ONE allowed extra source of digits.
    expectDigitsTraceToSpec(container, s, expected.map(([, text]) => text!));
  });

  it('100%-stacked: hiding a series changes the denominator — the remaining series is the whole of what is displayed, its own full share — and Undo restores both parts and the original shares', async () => {
    const { formatValueNl } = await import('../backend/answer/compose/format.ts');
    const full = `${formatValueNl(100, 1)}%`;
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld (%)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    expect(segmentIds(container)).toEqual(['r1:c1', 'r2:c1']);
    expect(labelsByRole(container, 'stack-label').sort()).toEqual([
      ['r1:c1', full],
      ['r2:c1', full],
    ]);
    expect(screen.getByText('1 van 2 reeksen verborgen')).toBeInTheDocument();
    expect(note().textContent).toBe(NOT_CHECKED_READ_ONLY);

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(segmentIds(container)).toEqual(['r1:c1', 'r1:c2', 'r2:c1', 'r2:c2']);
    expect(labelsByRole(container, 'stack-label').map(([, text]) => text).sort()).toEqual(['33,3%', '36,4%', '63,6%', '66,7%']);
  });

  it('100%-stacked: a period where a displayed part is missing is omitted from the percent stack and named in the note by its own label; the plain stacked form still draws that period\'s remaining part, without the sentence', () => {
    const s = nullCellSpec();
    const { container } = render(<UserChartView spec={s} />);
    // Both stacked tabs stay enabled: the guards read counts, and the table
    // shows the gap as a gap. Rotterdam has no 2024 value, so 2024 has no
    // honest share.
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld (%)' }));
    expect(segmentIds(container)).toEqual(['r1:c1', 'r1:c2']);
    expect(note().textContent).toBe(`${NOT_CHECKED_READ_ONLY} ${OMITTED_2024}`);
    expectDigitsTraceToSpec(container, s, ['66,7%', '33,3%']);

    // Plain stacked: 2024 is drawn with Amsterdam's part alone, nothing
    // omitted, nothing claimed.
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld' }));
    expect(segmentIds(container)).toEqual(['r1:c1', 'r1:c2', 'r2:c1']);
    expect(note().textContent).toBe(NOT_CHECKED_READ_ONLY);
  });

  it('the note is present in each of the three whole forms and in no other form', () => {
    const first = render(<UserChartView spec={twoSeriesSpec()} />);
    for (const [name, present] of [
      ['Lijn', false],
      ['Gestapeld', true],
      ['Staaf', false],
      ['Gestapeld (%)', true],
      ['Dumbbell', false],
      ['Helling', false],
      ['Tabel', false],
      ['Warmtekaart', false],
    ] as const) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(screen.queryByTestId('own-whole-note') !== null, name).toBe(present);
    }
    first.unmount();
    render(<UserChartView spec={twoSeriesOneMomentSpec()} />);
    for (const [name, present] of [
      ['Liggend', false],
      ['Taartdiagram', true],
      ['Staaf', false],
    ] as const) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(screen.queryByTestId('own-whole-note') !== null, name).toBe(present);
    }
  });

  it('renders the English tab words, note and disabled reasons under LangProvider lang="en"', () => {
    const first = render(
      <LangProvider lang="en">
        <UserChartView spec={twoSeriesOneMomentSpec()} />
      </LangProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Stacked' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Stacked (%)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Pie chart' }));
    expect(note().textContent).toBe(NOT_CHECKED_READ_ONLY_EN);
    first.unmount();

    const second = render(
      <LangProvider lang="en">
        <UserChartView spec={twoSeriesSpec()} />
      </LangProvider>,
    );
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Pie chart' }), 'Available once the chart shows one moment for at least two series.');
    second.unmount();
    render(
      <LangProvider lang="en">
        <UserChartView spec={spec()} />
      </LangProvider>,
    );
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Stacked' }), 'Available once the chart shows at least two series.');
  });

  it('switching to Taartdiagram then Undo returns to the prior form through the existing setForm history; Redo brings the pie back', () => {
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByRole('tab', { name: 'Staaf' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector(SECTOR)).toBeNull();
    expect(screen.queryByTestId('own-whole-note')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    expect(screen.getByRole('tab', { name: 'Taartdiagram' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
    expect(note().textContent).toBe(NOT_CHECKED_READ_ONLY);
  });

  it('offers no difference/average overlay controls in a whole form (they only ever draw on line/area), even with an edit context; the Style trigger stays', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    expect(screen.getByRole('button', { name: 'Verschil aanduiden' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld' }));
    expect(screen.queryByRole('button', { name: 'Verschil aanduiden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gemiddelde tonen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
  });

  // This card's own version of chart.test.tsx's alternate-reading fallback
  // (the same shape as the Warmtekaart and Dumbbell tests above): a data
  // command can hand the card a spec the pie cannot honestly draw as one
  // moment. `activeForm` runs `ownDataFallbackForm` over that very spec, so
  // the choice falls back (pie -> table) with the tab disabled and explained
  // and the note gone with the form — and Undo (a cache hit, one server call
  // in total) brings the pie and its note straight back.
  it('a data edit that gives every series a second point falls back from the pie to the table — tab disabled with its reason, note gone — and Undo brings the pie and its note back', async () => {
    datasetActions.renderDatasetInstruction.mockResolvedValue({ kind: 'ok', chart: twoSeriesSpec() });
    const { container } = render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
    expect(note().textContent).toBe(NOT_CHECKED);

    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(container.querySelector(SECTOR)).toBeNull();
    expect(screen.getByRole('tab', { name: 'Tabel' })).toHaveAttribute('aria-selected', 'true');
    expectDisabledWithReason(screen.getByRole('tab', { name: 'Taartdiagram' }), PIE_REASON);
    expect(screen.queryByTestId('own-whole-note')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(container.querySelectorAll(SECTOR)).toHaveLength(2));
    expect(screen.getByRole('tab', { name: 'Taartdiagram' })).toHaveAttribute('aria-selected', 'true');
    expect(note().textContent).toBe(NOT_CHECKED);
    expect(datasetActions.renderDatasetInstruction).toHaveBeenCalledTimes(1);
  });

  // The persistence proof of the validator change (chart-commands.ts): a
  // stored own-data `setForm: 'pie'` must survive replay. `validateCommand`
  // sees a context WITH a dataset profile and applies the own-data policy —
  // the CBS policy would have dropped the command for want of a
  // `regionScope`, leaving the reader's saved choice silently lost.
  it('persistence: a stored own-data setForm: pie is replayed onto the card — the pie and its note are back after a reload', async () => {
    chartEditsActions.fetchChartEdits.mockResolvedValue({
      ok: true,
      log: [{ kind: 'setForm', form: 'pie', id: 'c1', at: '2026-09-22T00:00:00.000Z', source: 'panel' }],
    });
    const { container } = render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Taartdiagram' })).toHaveAttribute('aria-selected', 'true'));
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
    expect(note().textContent).toBe(NOT_CHECKED);
  });

  // ---------------------------------------------------------------------
  // Task 4: the reader-designated total — clicking a slice/segment marks it
  // as "this is my total", requestDatasetWholeVerification (mocked) runs the real
  // check against the CURRENTLY-DISPLAYED other parts, and the note swaps
  // to one of `checked`/`mismatch`/`cannotCheck`. Reuses every helper above
  // (`note`, `SECTOR`, `SEGMENT`, `segment`, `IN`, `NOT_CHECKED`,
  // `NOT_CHECKED_EN`, `editContext`, `LAST_INSTRUCTION`) rather than
  // redefining them.
  // ---------------------------------------------------------------------
  const CHECKED_AMSTERDAM = 'Gecontroleerd tegen de rij die je koos: Amsterdam.';
  const MISMATCH_AMSTERDAM = 'Deze delen tellen niet op tot Amsterdam — controleer je selectie.';
  const CANNOT_CHECK_AMSTERDAM = 'Kan niet worden gecontroleerd: Amsterdam heeft geen waarde, of een van de delen ontbreekt.';

  it('Task 4: designating a pie slice dispatches setWholeReference and calls requestDatasetWholeVerification with the OTHER visible slice only; a genuine match renders the checked note, chart untouched', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    const amsterdam = container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!;
    expect(amsterdam).toHaveAttribute('role', 'button');
    expect(amsterdam).toHaveAttribute('tabindex', '0');
    fireEvent.click(amsterdam);
    // Amsterdam (r1:c1) designated as the whole; the ONLY other visible
    // slice, Rotterdam (r1:c2), is the sole part — never Amsterdam itself.
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledWith(3, LAST_INSTRUCTION, 'r1:c1', ['r1:c2']);
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    expect(note().textContent).toBe(CHECKED_AMSTERDAM);
    expect(note()).toHaveClass('text-success');
    // The chart is exactly as before: both slices, same labels.
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
    expect(labelsByRole(container, 'pie-label')).toEqual([
      ['r1:c1', '40,0'],
      ['r1:c2', '20,0'],
    ]);
  });

  it('Task 4: clicking the ALREADY-designated slice again clears it — reverts to the exact Task 3 default note instantly, client-side, no second network call', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    const amsterdam = () => container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!;
    fireEvent.click(amsterdam());
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledTimes(1);

    fireEvent.click(amsterdam());
    expect(note().textContent).toBe(NOT_CHECKED);
    expect(note()).toHaveAttribute('data-state', 'not_checked');
    expect(note()).toHaveClass('text-muted-foreground');
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledTimes(1);
  });

  it('Task 4: a genuine mismatch renders the chart IN FULL and the mismatch note together — own-data never hides the chart on a mismatch, unlike CBS', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: false, reason: 'sum_mismatch' } });
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!);
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'mismatch'));
    expect(note().textContent).toBe(MISMATCH_AMSTERDAM);
    expect(note()).toHaveClass('text-warning');
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
    expect(labelsByRole(container, 'pie-label')).toEqual([
      ['r1:c1', '40,0'],
      ['r1:c2', '20,0'],
    ]);
  });

  it('Task 4: missing_whole AND withheld_member both map to the SAME cannotCheck note, chart still drawn in full', async () => {
    for (const reason of ['missing_whole', 'withheld_member'] as const) {
      wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: false, reason } });
      const { container, unmount } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
      fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
      fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!);
      await waitFor(() => expect(note(), reason).toHaveAttribute('data-state', 'cannot_check'));
      expect(note().textContent, reason).toBe(CANNOT_CHECK_AMSTERDAM);
      expect(note(), reason).toHaveClass('text-warning');
      expect(container.querySelectorAll(SECTOR), reason).toHaveLength(2);
      unmount();
    }
  });

  it('Task 4: a bare server refusal (ok:false — e.g. a stale designation) falls back to not_checked, never a fabricated verdict', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: false, reason: 'this dataset is not available' });
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!);
    await waitFor(() => expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledTimes(1));
    expect(note().textContent).toBe(NOT_CHECKED);
    expect(note()).toHaveAttribute('data-state', 'not_checked');
  });

  it('Task 4: designating a STACK segment scopes the parts to the SAME PERIOD only, never a sum across unrelated periods, and the label names series + period', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld' }));
    fireEvent.click(segment(container, 'r2:c1')); // Amsterdam, 2024 (42) — NOT 2023's r1:c1/r1:c2.
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledWith(3, LAST_INSTRUCTION, 'r2:c1', ['r2:c2']);
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    expect(note().textContent).toBe('Gecontroleerd tegen de rij die je koos: Amsterdam · 2024.');
    // Both bars, four segments, all still drawn.
    expect(segmentIds(container)).toEqual(['r1:c1', 'r1:c2', 'r2:c1', 'r2:c2']);
  });

  it('Task 4: a stack segment carries the SAME designation affordance (role, tabindex, Enter activates it)', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld' }));
    const el = segment(container, 'r2:c1');
    expect(el).toHaveAttribute('role', 'button');
    expect(el).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(el, { key: 'Enter' });
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
  });

  it('Task 4: renders the English designation note under LangProvider lang="en"', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: false, reason: 'sum_mismatch' } });
    const { container } = render(
      <LangProvider lang="en">
        <UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Pie chart' }));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!);
    await waitFor(() => expect(note().textContent).toBe("These parts don't add up to Amsterdam — check your selection."));
  });

  it('Task 4: history menu names the designation and its clearing distinctly, and Undo/Redo round-trip through it', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!);
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));

    fireEvent.click(screen.getByRole('button', { name: 'Geschiedenis van bewerkingen' }));
    expect(screen.getAllByRole('menuitem')[0]).toHaveTextContent('Totaal aangewezen');
    fireEvent.click(document.body); // close the menu

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(note().textContent).toBe(NOT_CHECKED);
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
  });

  it('persistence: a stored setWholeReference is replayed onto the card and re-verified against the real dataset', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    chartEditsActions.fetchChartEdits.mockResolvedValue({
      ok: true,
      log: [
        { kind: 'setForm', form: 'pie', id: 'c1', at: '2026-09-22T00:00:00.000Z', source: 'panel' },
        { kind: 'setWholeReference', rowRef: 'r1:c1', id: 'c2', at: '2026-09-22T00:00:01.000Z', source: 'panel' },
      ],
    });
    render(
      <ChartStyleProvider initial={null}>
        <UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />
      </ChartStyleProvider>,
    );
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Taartdiagram' })).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    expect(note().textContent).toBe(CHECKED_AMSTERDAM);
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledWith(3, LAST_INSTRUCTION, 'r1:c1', ['r1:c2']);
  });

  it('fix wave (I4): with no edit context, a slice is NOT offered as a click at all — no role/tabindex, clicking does nothing, and the note drops its "click a point" invitation', () => {
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    const amsterdam = container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!;
    expect(amsterdam).not.toHaveAttribute('role');
    expect(amsterdam).not.toHaveAttribute('tabindex');
    expect(amsterdam).not.toHaveAttribute('aria-pressed');
    expect(amsterdam).not.toHaveAttribute('data-command-kind');
    fireEvent.click(amsterdam);
    expect(wholeVerificationActions.requestDatasetWholeVerification).not.toHaveBeenCalled();
    expect(amsterdam).not.toHaveAttribute('data-whole-reference');
    expect(note()).toHaveAttribute('data-state', 'not_checked_read_only');
    expect(note().textContent).toBe('Niet gecontroleerd tegen een totaal.');
    expect(note()).toHaveClass('text-muted-foreground');
  });

  it('fix wave (I4): the same holds for a stack segment with no edit context', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld' }));
    const el = segment(container, 'r2:c1');
    expect(el).not.toHaveAttribute('role');
    expect(el).not.toHaveAttribute('tabindex');
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(wholeVerificationActions.requestDatasetWholeVerification).not.toHaveBeenCalled();
    expect(note()).toHaveAttribute('data-state', 'not_checked_read_only');
  });

  it('Task 4: switching away from the whole form after designating never fires a pointless server call for a note nothing renders; switching back re-verifies', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!);
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    expect(screen.queryByTestId('own-whole-note')).toBeNull();
    // Still exactly one call — switching to a non-whole form issues no more.
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Fix round (adversarial review, opus tier, real probes against the
  // shipped code): 1 Critical + 2 Important defects, fixed below. Each test
  // mirrors the reviewer's own reachable scenario.
  // -----------------------------------------------------------------------

  it('Task 4 fix (C1, Critical): a genuinely null VISIBLE region is sent as a withheld part, never silently dropped from the sum', async () => {
    // The server (mocked) is told to answer withheld_member — this test's
    // own job is proving the CLIENT sends Oost's rowRef at all; the real
    // arithmetic (a null part -> withheld_member) is already proven,
    // unmocked, by tests/attachments/verify-whole.test.ts.
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: false, reason: 'withheld_member' } });
    const { container } = render(<UserChartView spec={threeRegionOneMomentSpecWithNull()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    // Oost's null value has no angle — Task 3's own rendering rule — so
    // only Noord and Zuid are drawn as slices.
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!); // designate Noord
    // The regression itself: Oost (r1:c3, visible but null) MUST be in the
    // parts list sent to the server — before the fix this called with
    // ['r1:c2'] only, silently excluding Oost from the sum entirely.
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledWith(3, LAST_INSTRUCTION, 'r1:c1', ['r1:c2', 'r1:c3']);
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'cannot_check'));
    expect(note().textContent).toBe('Kan niet worden gecontroleerd: Noord heeft geen waarde, of een van de delen ontbreekt.');
    // Still both slices — a withheld member is informational, not a refusal.
    expect(container.querySelectorAll(SECTOR)).toHaveLength(2);
  });

  it('Task 4 fix (I1, Important): changing the parts (hiding a series) clears a stale "Checked" verdict immediately, never lets it linger while the new check is in flight', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={threeRegionOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!); // designate Noord
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));

    // The NEXT call (fired when Oost is hidden, changing the parts) hangs
    // forever within this test, so the assertion right after the click
    // proves what the note shows WHILE the new check is in flight, not
    // after it eventually settles.
    wholeVerificationActions.requestDatasetWholeVerification.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Oost' })); // hides Oost — Zuid remains, parts still non-empty
    expect(note()).toHaveAttribute('data-state', 'not_checked');
    expect(note().textContent).toBe(NOT_CHECKED);
  });

  it('Task 4 fix (I1, Important): a REJECTED verification request resets to not_checked, never leaves a stale verdict on screen forever', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValueOnce({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={threeRegionOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!); // designate Noord
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));

    // Hiding Oost fires a SECOND request (parts change, still non-empty —
    // Zuid remains); this one rejects outright (a transport failure, not a
    // normal ok:false answer). Before the fix there was no .catch at all,
    // so the rejection would go unhandled and the stale "Checked" verdict
    // above would never be corrected.
    wholeVerificationActions.requestDatasetWholeVerification.mockRejectedValueOnce(new Error('network failure'));
    fireEvent.click(screen.getByRole('button', { name: 'Oost' }));
    await waitFor(() => expect(note().textContent).toBe(NOT_CHECKED));
    expect(note()).toHaveAttribute('data-state', 'not_checked');
  });

  it('Task 4 fix (I2, Important): hiding the designated segment\'s OWN series leaves nothing to check — skips the server call entirely, never a false match or a mismatch with a raw rowRef label', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld' }));
    fireEvent.click(segment(container, 'r2:c1')); // designate Amsterdam's 2024 segment
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledTimes(1);

    // Hide Amsterdam itself — the DESIGNATED series — so its own 2024 row
    // can no longer be located among the currently-visible rows at all.
    fireEvent.click(screen.getByRole('button', { name: 'Amsterdam' }));
    expect(note().textContent).toBe(NOT_CHECKED);
    expect(note()).toHaveAttribute('data-state', 'not_checked');
    // No second network call for a check with nothing real in it — before
    // the fix this would have called with partRowRefs: [] and rendered
    // whatever the (mocked, always-true) server said, a false "Checked ✓"
    // for a comparison against zero parts.
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Fix wave (session 124, final whole-branch review): I1 (a verdict is
  // only ever shown for exactly what it verified) and I2/I3 (the designated
  // slice/segment is marked on the chart itself).
  // -----------------------------------------------------------------------

  /** Every text the note ever held between the start of recording and now
   * — including frames that were committed and replaced within one act(),
   * which a plain post-act DOM read cannot see. */
  function recordNoteTexts(): () => string[] {
    const el = note();
    const seen: string[] = [el.textContent ?? ''];
    const observer = new MutationObserver(() => {});
    observer.observe(el, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
    return () => {
      for (const record of observer.takeRecords()) {
        if (record.type === 'characterData' && record.oldValue !== null) seen.push(record.oldValue);
        for (const removed of record.removedNodes) seen.push(removed.textContent ?? '');
      }
      observer.disconnect();
      seen.push(el.textContent ?? '');
      return seen;
    };
  }

  it('fix wave (I1): re-designating A → B never commits a single frame claiming B was checked while only A was — B shows not_checked until its OWN verdict lands', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValueOnce({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={threeRegionOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!); // designate Noord (A)
    await waitFor(() => expect(note().textContent).toBe('Gecontroleerd tegen de rij die je koos: Noord.'));

    // B's own check hangs, so anything "Checked" about Zuid could only be
    // A's leftover verdict wearing B's label.
    wholeVerificationActions.requestDatasetWholeVerification.mockImplementation(() => new Promise(() => {}));
    const stop = recordNoteTexts();
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c2"]`)!); // re-designate Zuid (B)
    const texts = stop();
    expect(wholeVerificationActions.requestDatasetWholeVerification).toHaveBeenLastCalledWith(3, LAST_INSTRUCTION, 'r1:c2', ['r1:c1', 'r1:c3']);
    expect(texts).not.toContain('Gecontroleerd tegen de rij die je koos: Zuid.');
    expect([...new Set(texts.filter((text) => text.startsWith('Gecontroleerd')))]).toEqual(['Gecontroleerd tegen de rij die je koos: Noord.']);
    expect(note()).toHaveAttribute('data-state', 'not_checked');
  });

  // A pin, not a regression test: the effect's own `cancelled` flag already
  // drops A's late answer (verified: this passes with the render-time key
  // gate reverted); the key gate is a second, independent guard for it.
  it('fix wave (I1, pin): a verdict that lands for a designation the reader has since moved away from is never shown for the new one', async () => {
    let resolveA: (value: unknown) => void = () => {};
    wholeVerificationActions.requestDatasetWholeVerification.mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)));
    const { container } = render(<UserChartView spec={threeRegionOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!); // A, still in flight
    wholeVerificationActions.requestDatasetWholeVerification.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c2"]`)!); // B, hangs
    await act(async () => {
      resolveA({ ok: true, outcome: { verified: true } }); // A's late answer
    });
    expect(note()).toHaveAttribute('data-state', 'not_checked');
  });

  it('fix wave (I2): the designated pie slice is marked on the chart (outline + aria-pressed + its own name); the others are unpressed; clearing removes the mark', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    const slice = (rowRef: string) => container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="${rowRef}"]`)!;
    expect(slice('r1:c1')).toHaveAttribute('aria-pressed', 'false');
    expect(slice('r1:c1')).not.toHaveAttribute('data-whole-reference');

    fireEvent.click(slice('r1:c1'));
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    expect(slice('r1:c1')).toHaveAttribute('aria-pressed', 'true');
    expect(slice('r1:c1')).toHaveAttribute('data-whole-reference', 'true');
    expect(slice('r1:c1')).toHaveAttribute('stroke', 'var(--foreground)');
    expect(slice('r1:c1')).toHaveAttribute('aria-label', 'Amsterdam, 2024 is aangewezen als totaal — klik om op te heffen');
    expect(slice('r1:c2')).toHaveAttribute('aria-pressed', 'false');
    expect(slice('r1:c2')).not.toHaveAttribute('data-whole-reference');
    expect(slice('r1:c2')).toHaveAttribute('aria-label', 'Wijs Rotterdam, 2024 aan als totaal');
    // Presentation only: both slices still drawn, same labels.
    expect(labelsByRole(container, 'pie-label')).toEqual([
      ['r1:c1', '40,0'],
      ['r1:c2', '20,0'],
    ]);

    fireEvent.click(slice('r1:c1'));
    expect(slice('r1:c1')).toHaveAttribute('aria-pressed', 'false');
    expect(slice('r1:c1')).not.toHaveAttribute('data-whole-reference');
  });

  it('keyboard: Enter on a slice designates it and focus stays on that slice through the re-render AND the verdict landing; Enter again clears it, focus still there', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    const slice = () => container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="r1:c1"]`)!;
    act(() => slice().focus());
    expect(document.activeElement).toBe(slice());
    fireEvent.keyDown(slice(), { key: 'Enter' });
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-result-id')).toBe('r1:c1'));
    expect(document.activeElement).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-pressed', 'false'));
    expect(document.activeElement?.getAttribute('data-result-id')).toBe('r1:c1');
  });

  it('keyboard focus restore never steals focus the reader moved elsewhere on purpose', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const { container } = render(<UserChartView spec={twoSeriesOneMomentSpec()} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Taartdiagram' }));
    const slice = (rowRef: string) => container.querySelector<HTMLElement>(`${SECTOR} [data-result-id="${rowRef}"]`)!;
    act(() => slice('r1:c1').focus());
    // A pointer press on something that is not a designation control (the
    // tab strip) is the reader moving on — the chart re-rendering afterwards
    // must leave focus where the reader put it.
    const tab = screen.getByRole('tab', { name: 'Taartdiagram' });
    fireEvent.pointerDown(tab);
    act(() => tab.focus());
    fireEvent.keyDown(slice('r1:c2'), { key: 'Enter' }); // re-renders the chart
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    expect(document.activeElement).toBe(tab);
  });

  it('fix wave (I2/I3): two series sharing ONE label (a derived chart) — the mark, not the label, says which segment is the total', async () => {
    wholeVerificationActions.requestDatasetWholeVerification.mockResolvedValue({ ok: true, outcome: { verified: true } });
    const shared = twoSeriesSpec();
    shared.series[0]!.label = 'Omzet − Kosten';
    shared.series[1]!.label = 'Omzet − Kosten';
    const { container } = render(<UserChartView spec={shared} edit={editContext()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld' }));
    fireEvent.click(segment(container, 'r2:c1'));
    await waitFor(() => expect(note()).toHaveAttribute('data-state', 'checked'));
    const marked = [...container.querySelectorAll(`${SEGMENT}[data-whole-reference="true"]`)].map((el) => el.getAttribute('data-result-id'));
    expect(marked).toEqual(['r2:c1']);
    expect(segment(container, 'r2:c1')).toHaveAttribute('aria-pressed', 'true');
    expect(segment(container, 'r2:c2')).toHaveAttribute('aria-pressed', 'false');
    expect(segment(container, 'r2:c1')).toHaveAttribute('stroke', 'var(--foreground)');
  });
});

describe('UserChartView — the incomplete-values note (#314)', () => {
  /** twoSeriesSpec with Rotterdam's 2024 point computed over fewer cells
   * than its group has (execute.ts's `incomplete`). */
  function incompleteSpec(): UserChartSpec {
    const s = twoSeriesSpec();
    s.series[1]!.points[1] = { ...s.series[1]!.points[1]!, incomplete: true };
    return s;
  }
  const NOTE_NL = 'Let op: niet alle waarden telden mee voor Rotterdam · 2024 — lege of niet-numerieke cellen worden overgeslagen.';

  it('names the incomplete point by its own series + x labels, with no number of its own', () => {
    render(<UserChartView spec={incompleteSpec()} />);
    const note = screen.getByTestId('own-incomplete-note');
    expect(note.textContent).toBe(NOTE_NL);
    expect(note).toHaveClass('text-warning');
  });

  it('stays in every form, table included', () => {
    render(<UserChartView spec={incompleteSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getByTestId('own-incomplete-note').textContent).toBe(NOTE_NL);
  });

  it('is absent when no point is incomplete', () => {
    render(<UserChartView spec={twoSeriesSpec()} />);
    expect(screen.queryByTestId('own-incomplete-note')).toBeNull();
  });

  it('drops a point whose series the reader hid (the note describes what is on screen)', () => {
    render(<UserChartView spec={incompleteSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotterdam' }));
    expect(screen.queryByTestId('own-incomplete-note')).toBeNull();
  });

  it('a single-series chart names the point by its x label alone', () => {
    const s = spec();
    s.series[0]!.points[0] = { ...s.series[0]!.points[0]!, incomplete: true };
    render(<UserChartView spec={s} />);
    expect(screen.getByTestId('own-incomplete-note').textContent).toBe(
      `Let op: niet alle waarden telden mee voor ${s.series[0]!.points[0]!.xLabel} — lege of niet-numerieke cellen worden overgeslagen.`,
    );
  });

  it('caps the list at three, then an ellipsis', () => {
    const s = twoSeriesSpec();
    for (const series of s.series) series.points = series.points.map((p) => ({ ...p, incomplete: true as const }));
    render(<UserChartView spec={s} />);
    expect(screen.getByTestId('own-incomplete-note').textContent).toBe(
      'Let op: niet alle waarden telden mee voor Amsterdam · 2023; Amsterdam · 2024; Rotterdam · 2023; … — lege of niet-numerieke cellen worden overgeslagen.',
    );
  });

  it('renders the English note under LangProvider lang="en"', () => {
    render(
      <LangProvider lang="en">
        <UserChartView spec={incompleteSpec()} />
      </LangProvider>,
    );
    expect(screen.getByTestId('own-incomplete-note').textContent).toBe(
      'Note: not every value counted towards Rotterdam · 2024 — empty or non-numeric cells are skipped.',
    );
  });
});

// WP218 phase 4 (#219): proves the language switch reaches this surface (the
// heading/provenance line the component itself composes; disclaimerLine is
// backend data and stays as given regardless of language).
describe('UserChartView — en', () => {
  it('renders the English heading + provenance line under LangProvider lang="en"', () => {
    render(
      <LangProvider lang="en">
        <UserChartView spec={spec()} />
      </LangProvider>,
    );
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Revenue by Year');
    expect(screen.getByText('From file verkoop-2024.csv, uploaded 2026-09-06 · 1 points plotted')).toBeInTheDocument();
  });

  it('renders the English form tabs and style trigger', () => {
    render(
      <LangProvider lang="en">
        <UserChartView spec={spec()} />
      </LangProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Style' })).toBeInTheDocument();
  });
});

// Own-data publish (ADR 057, Task 4): the public page's read-only
// `UserChartView({ spec, publicView })` mode. `publicView` and `edit` are
// mutually exclusive (the public page never passes `edit`), so every test
// below renders with `edit` omitted. See the task brief's 8 requirements +
// the heading fallback carried over from Task 2's review.
describe('publicView (ADR 057)', () => {
  // Requirement 1: the initial document is `publicView.state` converted
  // back to a real `ChartDocState` — never a fresh `initialDocState` — and
  // no `useChartEdits` persistence runs (already off without `edit`; the
  // mocks below prove it is never even attempted).
  it('requirement 1: builds the initial doc state from publicView.state (title, hiddenKeys, form) with no edit persistence', () => {
    const { container } = render(
      <UserChartView
        spec={twoSeriesSpec()}
        publicView={publicChartView({ state: publicChartState({ title: 'Omzet per klant', hiddenKeys: ['s0'], form: 'bar' }) })}
      />,
    );
    // title (state.title) landed.
    expect(screen.getByText('Omzet per klant')).toBeInTheDocument();
    // form (state.form) landed: a real bar chart, no line curve at all.
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(0);
    // hiddenKeys (Set, not the wire array) landed: Amsterdam (s0) is hidden
    // from the legend (requirement 4 covers the full rule; this just proves
    // the conversion reached `state.hiddenKeys` as a real Set the legend's
    // own filter can call `.has()` on).
    expect(within(screen.getByRole('group', { name: 'Reeksen' })).queryByText('Amsterdam')).not.toBeInTheDocument();
    // No persistence: fetchChartEdits/saveChartEdits are the useChartEdits
    // hook's own server actions — never called without an `edit` context,
    // and a public render never has one.
    expect(chartEditsActions.fetchChartEdits).not.toHaveBeenCalled();
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });

  it('requirement 1: periodRange/selectedReading/instruction/wholeReferenceRowRef convert to their null defaults', () => {
    // wholeReferenceRowRef is the one of the four with an observable effect
    // on this card: a pie/stacked form's own honesty note reads it. Forced
    // null here shows as the SAME read-only "not checked" state a signed-in
    // reader sees with no edit context at all (datasetId undefined) —
    // `not_checked_read_only`, chart-view's own convention for "no server to
    // check this against".
    render(<UserChartView spec={twoSeriesOneMomentSpec()} publicView={publicChartView({ state: publicChartState({ form: 'pie' }) })} />);
    expect(screen.getByTestId('own-whole-note')).toHaveAttribute('data-state', 'not_checked_read_only');
    // instruction: null means the data-command render effect (which needs
    // both `datasetId` and a non-null instruction) never fires either.
    expect(datasetActions.renderDatasetInstruction).not.toHaveBeenCalled();
    expect(wholeVerificationActions.requestDatasetWholeVerification).not.toHaveBeenCalled();
  });

  // Requirement 2: resolved overlays come from `publicView.overlays` (turned
  // into a Map), and the derivation effect — which needs `datasetId`, never
  // set in public mode — never runs.
  it('requirement 2: a resolved overlay renders from publicView.overlays, never from requestDatasetDerivation', () => {
    const pv = publicChartView({
      state: publicChartState({ derivedOverlayRequests: [{ id: 'o1', calcKind: 'mean', resultIds: ['r1:c1', 'r2:c1'] }] }),
      overlays: { o1: { value: 41, decimals: 1, rowRef: 'agg:mean:r1:c1+r2:c1' } },
    });
    const { container } = render(<UserChartView spec={twoSeriesSpec()} publicView={pv} />);
    expect(container.querySelectorAll('.recharts-reference-line').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('41,0');
    expect(derivationActions.requestDatasetDerivation).not.toHaveBeenCalled();
  });

  // Requirement 3: no edit panels, no history, no download, no form tabs —
  // and every editable affordance is either absent or inert.
  it('requirement 3: hides every editing/history/panel/download affordance', () => {
    render(
      <UserChartView
        spec={twoSeriesSpec()}
        publicView={publicChartView({ state: publicChartState({ title: 'Publieke titel', caption: 'Publiek bijschrift' }) })}
      />,
    );
    // No form tabs at all.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    // No history, Style panel trigger, Data panel trigger.
    expect(screen.queryByRole('button', { name: 'Ongedaan maken' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Opnieuw' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Opmaak' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Data' })).not.toBeInTheDocument();
    // No co-pilot composer.
    expect(screen.queryByPlaceholderText('Pas deze grafiek aan')).not.toBeInTheDocument();
    // No small-multiples toggle.
    expect(screen.queryByRole('button', { name: 'Kleine grafieken' })).not.toBeInTheDocument();
    // No downloads of any kind.
    expect(screen.queryByRole('button', { name: 'CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    // ChartEditableText renders read-only text: the reader's own title and
    // caption show, with no edit pencil and no "add a title/caption" link.
    expect(screen.getByText('Publieke titel')).toBeInTheDocument();
    expect(screen.getByText('Publiek bijschrift')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Titel bewerken' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Titel toevoegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bijschrift bewerken' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bijschrift toevoegen' })).not.toBeInTheDocument();
  });

  it('requirement 3: the legend does not toggle — every legend control is disabled and a click changes nothing', () => {
    render(<UserChartView spec={twoSeriesSpec()} publicView={publicChartView()} />);
    const legend = screen.getByRole('group', { name: 'Reeksen' });
    const amsterdamToggle = within(legend).getByRole('button', { name: 'Amsterdam' });
    expect(amsterdamToggle).toBeDisabled();
    expect(amsterdamToggle).toHaveAttribute('aria-pressed', 'true');
    for (const button of within(legend).getAllByRole('button')) expect(button).toBeDisabled();
    fireEvent.click(amsterdamToggle);
    // Unchanged: a disabled control never dispatches, so Amsterdam is still
    // shown (still "pressed" = shown) and still plotted.
    expect(amsterdamToggle).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
  });

  // #321(iii): the legend group's own render gate (`!tabularForm &&
  // seriesMeta.length > 1`, below) reads the RAW series count, but the
  // buttons it actually draws come from `listedSeriesMeta` — the public-
  // mode filter that drops a hidden series' slot entirely (requirement 4).
  // A 2-series spec with one hidden therefore still passes the gate (2 > 1)
  // yet the group it renders holds exactly ONE series' worth of controls —
  // this pins that real, previously-untested combination, not just the
  // "more than one series" / "one series, no legend" ends already covered
  // by 'renders a legend only when there is more than one series' above.
  it('#321(iii): a public render with one series filtered out still renders the legend group, with exactly the one remaining series\' controls', () => {
    render(
      <UserChartView
        spec={twoSeriesSpec()}
        publicView={publicChartView({ state: publicChartState({ hiddenKeys: ['s0'] }) })}
      />,
    );
    const legend = screen.getByRole('group', { name: 'Reeksen' });
    expect(within(legend).getByRole('button', { name: 'Rotterdam' })).toBeInTheDocument();
    expect(within(legend).queryByRole('button', { name: 'Amsterdam' })).not.toBeInTheDocument();
    expect(within(legend).queryByText('Amsterdam')).not.toBeInTheDocument();
    // Exactly one series' worth of controls (toggle + dim + highlight) —
    // Amsterdam contributes none, not merely a blank/disabled chip.
    expect(within(legend).getAllByRole('button')).toHaveLength(3);
  });

  it('requirement 3: no Publish button (Task 6 has not shipped it yet, and never would on the public page anyway)', () => {
    render(<UserChartView spec={twoSeriesSpec()} publicView={publicChartView()} />);
    expect(screen.queryByRole('button', { name: /publiceer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  // Fix round 1 (I1): a data point must not be a focusable note-trigger
  // button at all in public mode — `dotFor` passes `undefined` instead of
  // `onPointClick`, which `UserSeriesDot` reads as "no role, no tabIndex, no
  // click handler" (≈358-397). Scoped to the export container (dots only —
  // the legend's own, still-`disabled`, buttons live outside it).
  it('fix round 1 (I1): no chart point is a note-trigger button, and clicking one opens no composer', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} publicView={publicChartView()} />);
    const exportContainer = container.querySelector('[data-testid="user-chart-container"]');
    expect(exportContainer).not.toBeNull();
    expect(exportContainer!.querySelectorAll('[role="button"]')).toHaveLength(0);
    const dot = exportContainer!.querySelector('circle[data-point="value"]');
    expect(dot).not.toBeNull();
    fireEvent.click(dot!);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // Fix round 1 (I1): none of ChartNotes' delete/headline controls, or
  // ChartGoalLine's/ChartEraShading's add controls, are mounted — but a
  // surviving note (one `pruneForPublic` did NOT drop) is still shown,
  // read-only, bound the same way ChartNotes itself displays it.
  it('fix round 1 (I1): no note/goal-line/era-shading editing controls exist; a surviving note stays visible', () => {
    render(
      <UserChartView
        spec={twoSeriesSpec()}
        publicView={publicChartView({
          state: publicChartState({
            notes: [{ id: 'n1', resultId: 'r1:c1', periodLabel: '2023', seriesLabel: 'Amsterdam', text: 'Piekmoment' }],
          }),
        })}
      />,
    );
    expect(screen.getByText('Piekmoment')).toBeInTheDocument();
    expect(screen.getByTestId('public-notes-list')).toHaveTextContent('Amsterdam');
    expect(screen.getByTestId('public-notes-list')).toHaveTextContent('2023');
    expect(screen.queryByRole('button', { name: 'Verwijder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Doellijn toevoegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Periode markeren' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // #321(i) (session 128): strengthened from "does not throw" to actually
  // proving undo/redo are inert — `onHistoryKeyDown`'s very first line is
  // `if (publicMode) return;` (user-chart.tsx), before it even looks at
  // which key was pressed, so no ⌘Z/⌘⇧Z/Ctrl+Y combo should ever reach
  // `dispatch`. A full DOM snapshot before/after each key combo is a
  // stronger proof than spying on `undo`/`redo` directly: this card has no
  // persistence/history UI to begin with in public mode (requirement 3), so
  // if the handler ever DID call `undo`/`redo`, nothing in `history.past`
  // exists for it to pop anyway — a spy could stay silent while the doc
  // still re-rendered from some other unintended effect. Comparing the
  // rendered markup itself catches that class of regression too, not just
  // "was undo() called".
  it('fix round 1 (I1): ⌘Z/Ctrl+Y is not intercepted in public mode — undo/redo never run, chart state stays unchanged', () => {
    const { container } = render(
      <UserChartView
        spec={twoSeriesSpec()}
        publicView={publicChartView({ state: publicChartState({ title: 'Publieke titel', hiddenKeys: ['s0'], form: 'bar' }) })}
      />,
    );
    const card = container.firstElementChild as HTMLElement;
    const before = container.innerHTML;

    expect(() => fireEvent.keyDown(card, { key: 'z', metaKey: true })).not.toThrow();
    expect(container.innerHTML).toBe(before);

    expect(() => fireEvent.keyDown(card, { key: 'z', metaKey: true, shiftKey: true })).not.toThrow();
    expect(container.innerHTML).toBe(before);

    expect(() => fireEvent.keyDown(card, { key: 'y', ctrlKey: true })).not.toThrow();
    expect(container.innerHTML).toBe(before);
  });

  // Ruling R7 (M1): the reader's own toggle-state disclosure ("N of M series
  // hidden") is skipped in public mode — a visitor cannot toggle anything,
  // so it has no use for them, even though the count itself names no label
  // and so is not on its own a P1 leak.
  it('ruling R7 (M1): does not show the hidden-series count disclosure', () => {
    render(<UserChartView spec={twoSeriesSpec()} publicView={publicChartView({ state: publicChartState({ hiddenKeys: ['s0'] }) })} />);
    expect(screen.queryByText(/verborgen/)).not.toBeInTheDocument();
  });

  // Requirement 4: a hidden series' slot is kept (label blanked, not
  // removed — pruneForPublic's own contract), but the legend never lists it.
  it('requirement 4: the legend lists no hidden series (kept slot, no empty chip)', () => {
    render(<UserChartView spec={twoSeriesSpec()} publicView={publicChartView({ state: publicChartState({ hiddenKeys: ['s0'] }) })} />);
    const legend = screen.getByRole('group', { name: 'Reeksen' });
    expect(within(legend).queryByText('Amsterdam')).not.toBeInTheDocument();
    // Rotterdam's own toggle/dim/highlight trio alone — Amsterdam's hidden
    // slot contributes none of its own (SeriesLegend renders three buttons
    // per LISTED series; Amsterdam is filtered out of the list entirely).
    expect(within(legend).getAllByRole('button')).toHaveLength(3);
    expect(within(legend).getByText('Rotterdam')).toBeInTheDocument();
  });

  // Requirement 5: the provenance line never shows the file name — the
  // public page's own source line instead, bound as a spec string
  // (data-label-for), with USER_DATA_BADGE and the disclaimer line intact.
  it('requirement 5: shows the author\'s own source line, never the file name', () => {
    const s = twoSeriesSpec();
    render(<UserChartView spec={s} publicView={publicChartView({ sourceLine: 'Jaarverslag 2025' })} />);
    const sourceLine = screen.getByText('Bron: Jaarverslag 2025');
    expect(sourceLine).toBeInTheDocument();
    expect(sourceLine).toHaveAttribute('data-label-for', 'source-line');
    expect(screen.queryByText(/verkoop-2024\.csv/)).not.toBeInTheDocument();
    expect(screen.getByText('Your data · unverified')).toBeInTheDocument();
    expect(screen.getByText(s.disclaimerLine)).toBeInTheDocument();
  });

  it('requirement 5: falls back to the generic source line when the author left it blank', () => {
    render(<UserChartView spec={twoSeriesSpec()} publicView={publicChartView({ sourceLine: null })} />);
    expect(screen.getByText('Bron: gegevens aangeleverd door de maker')).toBeInTheDocument();
  });

  // Requirement 6: the resolved presentation uses `publicView.accountStyle`,
  // sanitised, exactly the way the signed-in path sanitises the context's
  // own `accountStyle` — proven observably (grid is a free override on a
  // line chart; a garbage key alongside a real one must not crash the
  // sanitiser or block the real key from applying).
  it('requirement 6: applies a sanitised publicView.accountStyle as the account default', () => {
    const { container } = render(
      <UserChartView
        spec={twoSeriesSpec()}
        publicView={publicChartView({ accountStyle: { grid: 'none', notARealOverrideKey: 'nope' } })}
      />,
    );
    expect(container.querySelector('.recharts-cartesian-grid')).toBeNull();
  });

  it('requirement 6: a null accountStyle falls back to the stock look, same as no account default', () => {
    const { container } = render(<UserChartView spec={twoSeriesSpec()} publicView={publicChartView({ accountStyle: null })} />);
    expect(container.querySelector('.recharts-cartesian-grid')).not.toBeNull();
  });

  // Session 128 (ADR 057 ruling 2, "?lang= wins for the chart too"):
  // precedence for the CHART's own language in public mode is explicit valid
  // ?lang= > the frozen style's own `language` > 'nl' — proven observably via
  // the "Bron:"/"Source:" source-line prefix, the one chartLang-driven string
  // requirement 5 above already exercises.
  describe('public mode chart language precedence (ruling 2)', () => {
    it('an explicit publicView.explicitLang wins over the frozen style\'s own language', () => {
      render(
        <UserChartView
          spec={twoSeriesSpec()}
          publicView={publicChartView({ sourceLine: null, accountStyle: { language: 'nl' }, explicitLang: 'en' })}
        />,
      );
      expect(screen.getByText('Source: data supplied by the author')).toBeInTheDocument();
    });

    it('the frozen style\'s own language applies when ?lang= is absent (explicitLang null)', () => {
      render(
        <UserChartView
          spec={twoSeriesSpec()}
          publicView={publicChartView({ sourceLine: null, accountStyle: { language: 'en' }, explicitLang: null })}
        />,
      );
      expect(screen.getByText('Source: data supplied by the author')).toBeInTheDocument();
    });

    it('falls back to Dutch when neither ?lang= nor the frozen style set a language', () => {
      render(
        <UserChartView
          spec={twoSeriesSpec()}
          publicView={publicChartView({ sourceLine: null, accountStyle: null, explicitLang: null })}
        />,
      );
      expect(screen.getByText('Bron: gegevens aangeleverd door de maker')).toBeInTheDocument();
    });
  });

  // Requirement 7 (U6): every digit in a public render traces to the spec's
  // own strings — the source line's digits included, via `extraAllowed`.
  // Ruling R8/M2 (fix round 1): uses `expectPublicDigitsTraceToSpec`, NOT
  // the general `expectDigitsTraceToSpec` — the public allowed list omits
  // `provenance.capturedAt`/`displayName`/the point count on purpose (a
  // public render never shows any of the three), so a real leak of one of
  // them would fail this test instead of silently passing under an allowed
  // list that was too generous to catch it. `displayName` is additionally
  // set to '' here (as pruneForPublic itself would leave it), belt-and-
  // braces against the same leak even if the allowed list ever widened back.
  it('requirement 7 (U6): the whole-card digit scan is clean for a public render, against the tighter public-only allowed list', () => {
    const s = spec({ provenance: { ...spec().provenance, displayName: '' } });
    const sourceLine = 'Jaarverslag 2025';
    const { container } = render(<UserChartView spec={s} publicView={publicChartView({ sourceLine })} />);
    expectPublicDigitsTraceToSpec(container, s, [sourceLine]);
  });

  // Requirement 8: a hidden series' former label and values never reach
  // `container.textContent` — run over the REAL Task 2 replay + prune
  // pipeline (own-chart-publication.ts), not a hand-built stand-in, mirroring
  // own-chart-publication.test.ts's own fixture (rowRef format
  // `r{row}:c{col}`, header row 0).
  describe('requirement 8: a hidden series never reaches the rendered DOM (real buildPublishedChart/pruneForPublic)', () => {
    const CELLS = [
      ['Jaar', 'Klant', 'Omzet'],
      ['2020', 'Geheim BV', '120,5'],
      ['2020', 'Open NV', '80,0'],
      ['2021', 'Geheim BV', '150,0'],
      ['2021', 'Open NV', '90,0'],
    ];
    const dataset: UserDataset = {
      id: 42,
      userId: 'u1',
      sourceKind: 'file_csv',
      displayName: 'klanten_vertrouwelijk.csv',
      sourceUrl: 'https://intranet.example.com/x.csv',
      cells: CELLS,
      profile: buildDatasetProfile(CELLS),
      status: 'ready',
      contentSha256: 'deadbeefcafe',
      createdAt: '2026-09-06T00:00:00Z',
    };
    const instruction = {
      version: 2 as const,
      kind: 'line' as const,
      x: 'c0',
      y: ['c2'],
      seriesBy: 'c1',
      filters: [],
      sort: null,
      limit: null,
      aggregate: null,
      derived: null,
      unsupported: null,
      reading: '',
      confidence: 1,
    };
    const turn = { id: 7, userId: 'u1', datasetId: 42, kind: 'chart', chartEmitted: true, instruction } as unknown as DatasetTurnRecord;

    it('renders neither the hidden series\' label nor its values', () => {
      const built = buildPublishedChart(dataset, turn, [makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel')]);
      if (!built.ok) throw new Error('expected ok');
      const pub = pruneForPublic(built, 'Bron: eigen administratie');
      // Sanity, mirrors own-chart-publication.test.ts: s0 = Geheim BV
      // (first-appearance order), really hidden.
      expect(pub.spec.series[0]!.label).toBe('');
      expect(pub.state.hiddenKeys).toEqual(['s0']);

      const { container } = render(
        <UserChartView spec={pub.spec} publicView={{ state: pub.state, overlays: pub.overlays, sourceLine: pub.sourceLine, accountStyle: null, explicitLang: null }} />,
      );
      expect(container.textContent).not.toContain('Geheim BV');
      expect(container.textContent).not.toContain('120,5');
      expect(container.textContent).not.toContain('150,0');
      // The visible series is unaffected.
      expect(container.textContent).toContain('Open NV');
    });
  });
});

// Final-review fixes A6/A7 — hand-built specs shaped exactly as pruneForPublic
// leaves them: the hidden slot kept, label '' and every value null.
function blankedSlot(points: UserChartSpec['series'][0]['points']): UserChartSpec['series'][0] {
  return { label: '', points: points.map((p) => ({ ...p, value: null, formattedValue: null, sourceText: '' })) };
}

/** Three series × three years, s0 ('Utrecht') blanked as pruneForPublic
 * would leave it — the two visible series are a complete 2 × 3 heatmap grid. */
function publicThreeSeriesSpecS0Blanked(): UserChartSpec {
  const base = twoSeriesThreeYearSpec();
  const utrecht = [
    point({ rowRef: 'r1:c3', xKey: '2022', xLabel: '2022', value: 70, formattedValue: '70,0', sourceText: '70,0' }),
    point({ rowRef: 'r2:c3', xKey: '2023', xLabel: '2023', value: 80, formattedValue: '80,0', sourceText: '80,0' }),
    point({ rowRef: 'r3:c3', xKey: '2024', xLabel: '2024', value: 90, formattedValue: '90,0', sourceText: '90,0' }),
  ];
  return { ...base, series: [blankedSlot(utrecht), ...base.series] };
}

describe('publicView — A6: a hidden series is left out of the table and the heatmap (public mode only)', () => {
  it('the public table has no column for the hidden slot (no empty header)', () => {
    const s = twoSeriesSpec();
    const pruned = { ...s, series: [blankedSlot(s.series[0]!.points), s.series[1]!] };
    render(<UserChartView spec={pruned} publicView={publicChartView({ state: publicChartState({ form: 'table', hiddenKeys: ['s0'] }) })} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Year', 'Rotterdam']);
    // Two cells per row: the period + Rotterdam's value, nothing blank for the slot.
    for (const row of screen.getAllByRole('row').slice(1)) expect(within(row).getAllByRole('cell')).toHaveLength(1);
  });

  it('the author\'s own table still lists a hidden series (restorable), unchanged', () => {
    render(<UserChartView spec={twoSeriesSpec()} edit={editContext()} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Reeksen' })).getByRole('button', { name: 'Amsterdam' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Year', 'Amsterdam', 'Rotterdam']);
  });

  it('a published heatmap with a hidden series draws the heatmap over the visible series only', () => {
    const { container } = render(
      <UserChartView
        spec={publicThreeSeriesSpecS0Blanked()}
        publicView={publicChartView({ state: publicChartState({ form: 'heatmap', hiddenKeys: ['s0'] }) })}
      />,
    );
    const grid = container.querySelector<HTMLElement>('[data-testid="user-heatmap-grid"]');
    expect(grid).not.toBeNull();
    expect(within(grid!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Year', 'Amsterdam', 'Rotterdam']);
    expect(within(grid!).getAllByRole('cell')).toHaveLength(6);
  });
});

// Re-review follow-ups m1/m2: pruneForPublic leaves a hidden slot blanked
// (and, after A1, holding only points at categories a visible series plots),
// so the pie and heatmap SHAPE guards must read the visible series while the
// series COUNT stays the full one — exactly what the author's card counted.
describe('publicView — m1/m2: whole-shape forms survive a hidden series (public mode)', () => {
  it('m1: a pie whose hidden slice sat at its own x still draws as a pie, over the real pipeline, with no trace of the hidden slice', () => {
    const cells = [
      ['Segment', 'Jaar', 'Omzet'],
      ['Alfa', '2022', '111'],
      ['Geheimsegment', '2023', '999'],
      ['Gamma', '2024', '333'],
    ];
    const dataset: UserDataset = {
      id: 61,
      userId: 'u1',
      sourceKind: 'file_csv',
      displayName: 'segmenten.csv',
      sourceUrl: null,
      cells,
      profile: buildDatasetProfile(cells),
      status: 'ready',
      contentSha256: 'feedbeef',
      createdAt: '2026-09-06T00:00:00Z',
    };
    const instruction = {
      version: 2,
      kind: 'bar',
      x: 'c1',
      y: ['c2'],
      seriesBy: 'c0',
      filters: [],
      sort: null,
      limit: null,
      aggregate: null,
      derived: null,
      unsupported: null,
      reading: '',
      confidence: 1,
    };
    const turn = { id: 7, userId: 'u1', datasetId: 61, kind: 'chart', chartEmitted: true, instruction } as unknown as DatasetTurnRecord;
    const built = buildPublishedChart(dataset, turn, [
      makeCommand({ kind: 'setForm', form: 'pie' }, 'panel'),
      makeCommand({ kind: 'toggleSeries', key: 's1' }, 'panel'),
    ]);
    if (!built.ok) throw new Error('expected ok');
    // Sanity: the author's card drew a pie (setForm survived validation).
    expect(built.dropped).toBe(0);
    expect(built.state.form).toBe('pie');
    const pub = pruneForPublic(built, null);
    // The premise: the hidden slice's only point (2023) is a category no
    // visible series plots, so the blanked slot is now EMPTY.
    expect(pub.spec.series[1]!.points).toEqual([]);

    const { container } = render(
      <UserChartView spec={pub.spec} publicView={{ state: pub.state, overlays: pub.overlays, sourceLine: null, accountStyle: null, explicitLang: null }} />,
    );
    expect(container.querySelector('table')).toBeNull();
    const labels = [...container.querySelectorAll('[data-testid="user-chart-container"] [data-role="pie-label"]')].map((el) => el.textContent);
    expect(labels).toEqual(['111', '333']);
    expect(container.textContent).not.toContain('Geheimsegment');
    expect(container.textContent).not.toContain('999');
  });

  it('m2: a heatmap with one visible of two series still draws as a heatmap (one column)', () => {
    const base = twoSeriesThreeYearSpec();
    const pruned = { ...base, series: [blankedSlot(base.series[0]!.points), base.series[1]!] };
    const { container } = render(
      <UserChartView spec={pruned} publicView={publicChartView({ state: publicChartState({ form: 'heatmap', hiddenKeys: ['s0'] }) })} />,
    );
    const grid = container.querySelector<HTMLElement>('[data-testid="user-heatmap-grid"]');
    expect(grid).not.toBeNull();
    expect(within(grid!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Year', 'Rotterdam']);
    expect(within(grid!).getAllByRole('cell')).toHaveLength(3);
  });
});

describe('publicView — A7: goal lines and era shadings are listed read-only', () => {
  it('lists a goal line (value + label) and an era (period labels + label)', () => {
    render(
      <UserChartView
        spec={twoSeriesThreeYearSpec()}
        publicView={publicChartView({
          state: publicChartState({
            goalLines: [{ id: 'g1', value: 35, label: 'Doel omzet' }],
            eraShadings: [{ id: 'e1', fromPeriodCode: '2022', toPeriodCode: '2023', label: 'Crisisjaren' }],
          }),
        })}
      />,
    );
    const list = screen.getByTestId('public-notes-list');
    expect(within(list).getByTestId('public-goal-line')).toHaveTextContent('35: Doel omzet');
    expect(within(list).getByTestId('public-era-shading')).toHaveTextContent('2022 – 2023: Crisisjaren');
    // Still read-only: no remove controls.
    expect(within(list).queryByRole('button')).toBeNull();
  });

  it('the public digit scan stays clean with a goal line (its author-typed value is allowed, like note text)', () => {
    const s = spec({ provenance: { ...spec().provenance, displayName: '' } });
    const { container } = render(
      <UserChartView
        spec={s}
        publicView={publicChartView({ state: publicChartState({ goalLines: [{ id: 'g1', value: 35, label: 'Doel' }] }) })}
      />,
    );
    expect(screen.getByTestId('public-goal-line')).toBeInTheDocument();
    expectPublicDigitsTraceToSpec(container, s, ['35']);
  });
});

// Task 4 review carry-over: `pruneForPublic` can blank EVERY `yHeaders`
// entry (every series on the chart hidden), and the heading must not render
// a bare ", per {x}" — this fix applies in every mode (harmless on the
// author's own card, whose headers are never blank), so it is tested here
// with a plain hand-built spec, not `publicView`.
describe('UserChartView — heading fallback when yHeaders has no surviving header (Task 4 review carry-over)', () => {
  it('falls back to naming just x when every yHeaders entry is blank', () => {
    render(<UserChartView spec={spec({ yHeaders: [''] })} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Year');
  });

  it('keeps the normal "{y} per {x}" heading when at least one header survives', () => {
    render(<UserChartView spec={spec({ yHeaders: ['', 'Revenue'] })} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Revenue per Year');
  });
});
