// ADR 044 (Story-stage plan, Task 4): the full-viewport Story stage — a
// portal dialog wrapping a chrome-less ChartView (Task 3) with scroll-driven
// step panels, an entry tilt, a spotlight, and an auto-play toggle. Honesty
// contract: every digit the dialog shows must trace to the spec's own
// strings (or a step's own caption/title, itself built from spec strings by
// the caller) — proven by the whole-dialog digit scan below, which reuses
// the walker `chart.test.tsx` uses for the same purpose (test internals
// aren't imported across files — the brief's own instruction — so this is a
// small inlined copy, not an import).
import { useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { entranceStyle, STAGE_AUTOPLAY_MS } from '../lib/chart-stage.ts';
import type { StoryStep } from '../lib/chart-story.ts';
import { ChartStoryStage, type ChartStoryStageProps } from './chart-story-stage.tsx';

afterEach(() => {
  cleanup();
});

// Fixture shape copied from chart.test.tsx's own point()/spec()/
// threePointSpec() (local to that file, per the task brief) — trimmed to
// what this suite needs.
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

// The digit-scan walker, reused verbatim from
// `chart.test.tsx`'s `scanForUnboundDigits` (per the task brief: copy the
// small helper rather than import test internals).
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

const testSpec = threePointSpec();

// The brief's own fixture: "Hoogste punt in 2024: 3,3" only repeats numbers
// (2024, 3,3) that are already the spec's own periodLabel/formattedValue for
// the 'hi' point above.
const steps: StoryStep[] = [
  { id: 'overview', kind: 'overview', title: 'Overzicht', caption: 'Van 2022 tot 2024.', highlight: null, point: null },
  { id: 'high-s0', kind: 'recordHigh', title: 'Piek', caption: 'Hoogste punt in 2024: 3,3', highlight: 's0', point: { seriesKey: 's0', periodCode: '2024JJ00' } },
  { id: 'explore', kind: 'explore', title: 'Verken zelf', caption: 'Wissel van weergave met de tabs.', highlight: null, point: null },
];

function baseProps(overrides: Partial<ChartStoryStageProps> = {}): ChartStoryStageProps {
  return {
    open: true,
    spec: testSpec,
    steps,
    index: 0,
    onIndexChange: vi.fn(),
    onClose: vi.fn(),
    triggerId: 'trigger-1',
    overrides: {},
    ...overrides,
  };
}

// A stateful harness for the auto-play tests, which need `index` to actually
// advance across re-renders — ChartStoryStage is a controlled component
// (like the compact ChartStoryPanel), so the caller owns the index.
function Harness(props: Partial<ChartStoryStageProps> & { onAdvance?: (i: number) => void }): ReactNode {
  const [index, setIndex] = useState(props.index ?? 0);
  return (
    <ChartStoryStage
      {...baseProps(props)}
      index={index}
      onIndexChange={(i) => {
        setIndex(i);
        props.onAdvance?.(i);
      }}
    />
  );
}

beforeEach(() => {
  const trigger = document.createElement('button');
  trigger.id = 'trigger-1';
  trigger.textContent = 'open';
  document.body.appendChild(trigger);
  // jsdom has no scrollIntoView by default; the component guards with
  // typeof, but stub it anyway so a real call never throws across jsdom
  // versions (per the task brief).
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  document.getElementById('trigger-1')?.remove();
  document.body.style.overflow = '';
  vi.useRealTimers();
});

describe('ChartStoryStage', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ChartStoryStage {...baseProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('open: a focused, aria-modal dialog in document.body with one panel per step, the first current', () => {
    render(<ChartStoryStage {...baseProps()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(dialog);
    for (const step of steps) {
      expect(screen.getByText(step.title)).toBeInTheDocument();
      expect(screen.getByText(step.caption)).toBeInTheDocument();
    }
    expect(dialog.querySelector('[data-stage-step="0"]')).toHaveAttribute('aria-current', 'step');
    expect(dialog.querySelector('[data-stage-step="1"]')).not.toHaveAttribute('aria-current');
    expect(dialog.querySelector('[data-stage-step="2"]')).not.toHaveAttribute('aria-current');
  });

  it('Escape calls onClose and returns focus to #triggerId', () => {
    const onClose = vi.fn();
    render(<ChartStoryStage {...baseProps({ onClose })} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.getElementById('trigger-1'));
  });

  it('ArrowRight reports the next index', () => {
    const onIndexChange = vi.fn();
    render(<ChartStoryStage {...baseProps({ onIndexChange })} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('the position dots are named by step title and report their index', () => {
    const onIndexChange = vi.fn();
    render(<ChartStoryStage {...baseProps({ onIndexChange })} />);
    fireEvent.click(screen.getByRole('button', { name: steps[2]!.title }));
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it('auto-play: off by default; toggling calls onAutoplay once, advances on a timer, and stops at the last step', () => {
    vi.useFakeTimers();
    const onAutoplay = vi.fn();
    const onAdvance = vi.fn();
    render(<Harness onAutoplay={onAutoplay} onAdvance={onAdvance} />);
    const toggle = screen.getByRole('button', { name: 'Automatisch afspelen' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(onAutoplay).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      vi.advanceTimersByTime(STAGE_AUTOPLAY_MS);
    });
    expect(onAdvance).toHaveBeenNthCalledWith(1, 1);
    expect(screen.getByRole('button', { name: 'Automatisch afspelen' })).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      vi.advanceTimersByTime(STAGE_AUTOPLAY_MS);
    });
    expect(onAdvance).toHaveBeenNthCalledWith(2, 2);
    // steps.length - 1 === 2: the last step — auto-play switches itself off.
    expect(screen.getByRole('button', { name: 'Automatisch afspelen' })).toHaveAttribute('aria-pressed', 'false');
    expect(onAutoplay).toHaveBeenCalledTimes(1);

    onAdvance.mockClear();
    act(() => {
      vi.advanceTimersByTime(STAGE_AUTOPLAY_MS * 3);
    });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('any arrow key switches auto-play off', () => {
    vi.useFakeTimers();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Automatisch afspelen' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('locks document.body.style.overflow while open and restores it on unmount', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(<ChartStoryStage {...baseProps()} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('the whole dialog carries no digit that is not sourced from the spec or the given steps', () => {
    render(<ChartStoryStage {...baseProps()} />);
    scanForUnboundDigits(
      screen.getByRole('dialog'),
      [
        testSpec.title,
        testSpec.unit,
        testSpec.attributionLine,
        testSpec.attribution.tableId,
        testSpec.attribution.syncedAt,
        ...Object.keys(testSpec.dimLabels),
        ...Object.values(testSpec.dimLabels),
        ...testSpec.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
        ...steps.map((s) => s.title),
        ...steps.map((s) => s.caption),
      ].filter(Boolean),
    );
  });

  it('honors prefers-reduced-motion: the chart plane wrapper sits at its flat resting transform', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      render(<ChartStoryStage {...baseProps()} />);
      const plane = document.querySelector('[data-stage-plane]') as HTMLElement | null;
      expect(plane).not.toBeNull();
      expect(plane!.style.transform).toBe(entranceStyle(0, true).transform);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
