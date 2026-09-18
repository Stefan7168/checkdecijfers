// Chart co-pilot phase 1 (session 112, ADR 056) — the spec §6 "no chat-only
// capability" contract in its phase-1 form: EVERY command kind in
// CHART_COMMAND_KINDS is reachable from an on-screen control, so a later
// chat doorway can never gain a capability the panel/canvas does not
// already offer. Each dispatching control carries `data-command-kind`
// (a data attribute only — no behaviour hangs off it).
//
// Mocking/render conventions copied verbatim from chart-headline-ui.test.tsx
// (which in turn copied chart.test.tsx): `vi.hoisted` + `vi.mock` for every
// Server Action module chart.tsx imports directly.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHART_COMMAND_KINDS, type ChartCommandKind } from '../lib/chart-commands.ts';
import type { ChartSpec } from '../backend/chart/types.ts';

const chartHeadlineActions = vi.hoisted(() => ({
  draftChartHeadline: vi.fn(),
  saveChartHeadline: vi.fn(),
  fetchChartHeadline: vi.fn().mockResolvedValue({ ok: true, headline: null }),
}));
vi.mock('../app/chart-headline-actions.ts', () => chartHeadlineActions);
// Task 7 (co-pilot phase 1): chart.tsx imports the chart_edits Server Action
// module directly — without this mock the real module (and its db/auth
// imports) would load in jsdom.
const chartEditsActions = vi.hoisted(() => ({
  fetchChartEdits: vi.fn().mockResolvedValue({ ok: true, log: null }),
  saveChartEdits: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../app/chart-edits-actions.ts', () => chartEditsActions);
const chartInsightsActions = vi.hoisted(() => ({
  generateInsights: vi.fn().mockResolvedValue({ ok: true, phrased: {} }),
}));
vi.mock('../app/chart-insights-actions.ts', () => chartInsightsActions);
const chartStyleActions = vi.hoisted(() => ({
  saveMyChartStyle: vi.fn(),
  forgetMyChartStyle: vi.fn(),
  lookupBrand: vi.fn(),
}));
vi.mock('../app/chart-style-actions.ts', () => chartStyleActions);
const { createEmbedCode } = vi.hoisted(() => ({ createEmbedCode: vi.fn() }));
vi.mock('../app/embed-actions.ts', () => ({ createEmbedCode }));

import { ChartView } from './chart.tsx';

// chart.test.tsx does not export its fixtures, so its `point`/`spec`/
// `twoSeriesLineSpec` factories are copied here (chart.test.tsx:87-125 and
// :1766-1788) rather than guessed.
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

function twoSeriesLineSpec(): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
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
  };
}

afterEach(cleanup);

/** Kinds whose control only exists inside the open Style panel. */
const PANEL_KINDS: ChartCommandKind[] = ['setPresentation', 'replacePresentation', 'resetPresentation', 'applyTemplate'];
/** Kinds whose control only exists once a point has been clicked / a note exists. */
const NOTE_KINDS: ChartCommandKind[] = ['addNote', 'removeNote'];
/** Co-pilot phase 2 (session 113), Task 4: kinds whose control lives on the
 * OWN-DATA card, not this CBS one. `setInstruction` names dataset columns, so
 * a CBS chart has no control for it and — by the ADR 037 D11 type guard —
 * could not validate one anyway. Its own-data control is covered by that
 * card's suite (Task 5/6), which scans the same `data-command-kind`
 * attribute. */
const OWN_DATA_KINDS: ChartCommandKind[] = ['setInstruction'];

function kindsInDom(root: HTMLElement): Set<string> {
  const out = new Set<string>();
  for (const el of root.querySelectorAll('[data-command-kind]')) {
    for (const k of (el.getAttribute('data-command-kind') ?? '').split(/\s+/)) if (k) out.add(k);
  }
  return out;
}

describe('command ↔ control contract (ADR 056 decision 2, phase-1 form)', () => {
  it('every command kind is reachable from an on-screen control', async () => {
    render(
      <ChartView
        spec={twoSeriesLineSpec()}
        alternates={[{ label: 'Alternatieve lezing', spec: twoSeriesLineSpec() }]}
        embed={{ auditId: 1 }}
      />,
    );
    // Opening the Style panel mounts its kinds. The panel is a portaled,
    // next/dynamic-loaded modal (chart.test.tsx's own note), so this awaits
    // a control inside it and the scan below reads document.body, not the
    // render container.
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    await screen.findByRole('tab', { name: 'Grafiek' });

    const found = kindsInDom(document.body);
    const missing = CHART_COMMAND_KINDS.filter(
      (k) => !found.has(k) && !NOTE_KINDS.includes(k) && !OWN_DATA_KINDS.includes(k),
    );
    expect(missing, `command kinds with no control: ${missing.join(', ')}`).toEqual([]);
    expect(PANEL_KINDS.every((k) => found.has(k))).toBe(true);
  });

  // Task 5: the reader's own title and caption edit IN PLACE on the card —
  // no panel to open, so a plain non-embed render already carries both
  // controls (the pencil next to the heading and the "add a caption" button).
  it('setTitle and setCaption have in-place controls', () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    const found = kindsInDom(container);
    expect(found.has('setTitle')).toBe(true);
    expect(found.has('setCaption')).toBe(true);
  });

  it('addNote/removeNote controls exist in the notes editor', async () => {
    const { ChartNotes } = await import('./chart-notes.tsx');
    const { container } = render(
      <ChartNotes
        notes={[{ id: 'n1', resultId: 'nl-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'x' }]}
        pendingPoint={{ resultId: 'nl-2020', periodLabel: '2020', seriesLabel: 'Nederland' }}
        idPrefix="t"
        onSave={() => {}}
        onCancelPending={() => {}}
        onDelete={() => {}}
      />,
    );
    const found = kindsInDom(container);
    expect(found.has('addNote')).toBe(true);
    expect(found.has('removeNote')).toBe(true);
  });
});
