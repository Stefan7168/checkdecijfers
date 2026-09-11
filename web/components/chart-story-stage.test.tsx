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
import { atmosphereState, captionStyle, entranceStyle, planeDriftPx, planeTransform, spotlightStyle, STAGE_AUTOPLAY_MS } from '../lib/chart-stage.ts';
import type { StoryStep } from '../lib/chart-story.ts';
import { ChartStoryStage, type ChartStoryStageProps } from './chart-story-stage.tsx';

// Fix round 1 (item A): the same focusable-elements query the component's
// own Tab-wrap handler uses, so the test asserts against the real DOM order
// rather than a hardcoded guess at which controls exist.
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

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

// Fix round 2 (item 10, test hygiene): the stub is installed on the shared
// `Element.prototype`, so it leaks into every OTHER suite in the same worker
// unless it is put back. Saved here, restored in afterEach.
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

beforeEach(() => {
  const trigger = document.createElement('button');
  trigger.id = 'trigger-1';
  trigger.textContent = 'open';
  document.body.appendChild(trigger);
  // jsdom has no scrollIntoView by default; the component guards with
  // typeof, but stub it anyway so a real call never throws across jsdom
  // versions (per the task brief).
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  document.getElementById('trigger-1')?.remove();
  document.body.style.overflow = '';
  vi.useRealTimers();
});

// Fix round 2 (items 3+4): jsdom lays nothing out, so a stage under test has
// every panel at offsetTop 0 — which reads as "the first caption is already
// centred" and settles the entry ramp instantly. These helpers give the
// scroller a real geometry (three 800 px panels starting one 800 px viewport
// down the column) and drive the hook exactly as the reader's wheel does, so
// the tilt and the caption hand-over can be asserted at real scroll offsets.
//
// jsdom has no requestAnimationFrame. Recharts' store (Redux Toolkit) decides
// ONCE, when the store is created, whether to schedule its notifications
// through rAF — with a real-timer fallback whose callback calls
// `cancelAnimationFrame` — or through a plain timeout. Stubbing rAF per test
// with `vi.stubGlobal` and unstubbing it in `finally` left every store created
// under the stub calling a `cancelAnimationFrame` that no longer existed once
// `cleanup()` unmounted the chart under real timers: 28 unhandled
// ReferenceErrors and a red suite (vitest exits 1 on unhandled errors even
// with every test green). So the polyfill is installed once for this file
// (vitest isolates each test file's globals) and never removed; the helper
// below only switches the timers to fake ones — the polyfill resolves
// `setTimeout` at call time, so it is faked along with everything else.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame ??= ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;

function useStageScrollTimers(): void {
  vi.useFakeTimers();
}

function layoutStage(): HTMLElement {
  const scroller = document.querySelector('[data-stage-scroller]') as HTMLElement;
  Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
  for (let i = 0; i < steps.length; i++) {
    const panel = document.querySelector(`[data-stage-step="${i}"]`) as HTMLElement;
    Object.defineProperty(panel, 'offsetTop', { value: 800 + i * 800, configurable: true });
    Object.defineProperty(panel, 'offsetHeight', { value: 800, configurable: true });
  }
  return scroller;
}

function scrollStage(scroller: HTMLElement, top: number): void {
  scroller.scrollTop = top;
  act(() => {
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
  });
}

function plane(): HTMLElement {
  return document.querySelector('[data-stage-plane]') as HTMLElement;
}

function caption(i: number): HTMLElement {
  return document.querySelector(`[data-stage-step="${i}"] > div`) as HTMLElement;
}

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

  // ADR 044 decision 7 / #236(g) promise "stops on any ... key" — not just
  // the arrows handled above. PageDown/Home/End/Space fall through to the
  // native-scroll branch, which used to arm the reader-scroll guard without
  // also stopping the timer, so auto-play kept firing and yanked the reader
  // back shortly after they navigated with one of these keys.
  it('a native-scroll key (PageDown, not an arrow) also switches auto-play off', () => {
    vi.useFakeTimers();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Automatisch afspelen' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'PageDown' });
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

  // Fix round 1 (item A): Tab used to escape the dialog onto the page
  // behind it (invisible under the full-viewport overlay), and Escape then
  // stopped working because the keydown handler lives on the dialog div.
  it('Tab wraps from the last focusable element to the first, Shift+Tab wraps back, and Escape still closes from an inner button', () => {
    const onClose = vi.fn();
    render(<ChartStoryStage {...baseProps({ onClose })} />);
    const dialog = screen.getByRole('dialog');
    const items = focusables(dialog);
    expect(items.length).toBeGreaterThan(1);
    const first = items[0]!;
    const last = items[items.length - 1]!;

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    const autoplayButton = screen.getByRole('button', { name: 'Automatisch afspelen' });
    autoplayButton.focus();
    fireEvent.keyDown(autoplayButton, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Fix round 1 (item C.3): the spotlight centres on the ringed marker's own
  // centre (left + width/2, top + height/2 — see chart-story-stage.tsx's
  // useLayoutEffect), as a percentage of the chart box. `156`/`60` (rather
  // than the marker's raw `left`/`top` of `160`/`64`) account for that
  // half-width/half-height offset so the centre lands at exactly 25% on
  // both axes, which is what's asserted below via the real spotlightStyle().
  //
  // Rendering note: the initial mount opens with step 0 ('overview', no
  // `point`, so no ring yet) and only THEN moves to step 1 ('high-s0', the
  // ring). Recharts' ResponsiveContainer discovers its real size
  // asynchronously on first mount (still inside `render()`'s own `act()`);
  // starting directly at the ringed step races that discovery and the
  // spotlight effect (which only re-reads the DOM on `step?.id` change, by
  // design — see the effect's own comment) can fire before the ring exists.
  // Landing on it via `rerender` — a plain step-index change, exactly what a
  // real "Volgende"/dot click does — sidesteps the race without weakening
  // what's asserted.
  it('the spotlight centres on the ringed marker, as a percentage of the chart box', () => {
    const original = Element.prototype.getBoundingClientRect;
    const chartBoxRect = { left: 0, top: 0, width: 640, height: 256, right: 640, bottom: 256, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    const markerRect = { left: 156, top: 60, width: 8, height: 8, right: 164, bottom: 68, x: 156, y: 60, toJSON: () => ({}) } as DOMRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.matches('[data-story-marker]')) return markerRect;
      // Fix round 2 (item 8): the vignette is confined to the PLOT box
      // (`[data-slot="chart-frame"]`, the export container's wrapper) and its
      // percentages are measured against THAT box, so the stub now covers it
      // too. Here the plot fills the chart box exactly, which is why the
      // expected 25 % / 25 % is unchanged from before the fix.
      if (this.matches('[data-slot="chart-frame"]')) return chartBoxRect;
      if (this.matches('[data-stage-plane] > div')) return chartBoxRect;
      return original.call(this);
    };
    try {
      // steps[1] ('high-s0') is the only step with a `point`, and it matches
      // threePointSpec's 'hi' point — the same fixture Task 3's own
      // ChartView stage-mode tests use to get exactly one [data-story-marker].
      const { rerender } = render(<ChartStoryStage {...baseProps({ index: 0 })} />);
      rerender(<ChartStoryStage {...baseProps({ index: 1 })} />);
      const spotlight = document.querySelector('[data-stage-spotlight]');
      expect(spotlight).not.toBeNull();
      const background = (spotlight as HTMLElement).style.background;
      expect(background).toContain('25%');
      const expected = spotlightStyle({ cx: 160, cy: 64 }, { width: 640, height: 256 });
      expect(background).toContain(`${expected!.left} ${expected!.top}`);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
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

  // ─── Fix round 2 ────────────────────────────────────────────────────────
  // The whole-branch review's findings, each pinned by the behaviour it
  // restores rather than by the implementation that restores it.

  // Item 1: the stage used to open on panel one no matter which finding the
  // reader was on (the panels only moved when the scroll hook reported a
  // CHANGE), and the same unguarded sync dragged the shared index back to 0
  // on every open — so presenting from finding three, or re-opening after
  // stepping through the story, silently restarted it.
  it('opens at the step the reader is on, scrolls that panel into view, and never drags the index back to the first finding', () => {
    const targets: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      targets.push(this);
    });
    const onIndexChange = vi.fn();
    render(<ChartStoryStage {...baseProps({ index: 2, onIndexChange })} />);
    const dialog = screen.getByRole('dialog');
    const current = dialog.querySelector('[data-stage-step="2"]');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(dialog.querySelector('[data-stage-step="0"]')).not.toHaveAttribute('aria-current');
    expect(targets).toContain(current);
    expect(onIndexChange).not.toHaveBeenCalledWith(0);
  });

  // Item 2: ADR 044 decision 4 gates the depth effects on `lg` AND a fine
  // pointer AND reduced motion; only the reduced-motion third was built, so
  // a phone got a tilting, shadow-lifting, vignetted 50 vh chart.
  it.each([['(hover: none)'], ['(max-width: 1023px)']])(
    'renders statically when %s matches: a flat plane, no transition, no spotlight',
    (query) => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: q === query,
        addEventListener() {},
        removeEventListener() {},
      }));
      useStageScrollTimers();
      try {
        render(<ChartStoryStage {...baseProps()} />);
        const scroller = layoutStage();
        // At the very top of the column the animated path would sit at the
        // full entry tilt; the static path is flat there and everywhere.
        scrollStage(scroller, 0);
        expect(plane().style.transform).toBe(entranceStyle(0, true).transform);
        expect(plane().className).not.toContain('transition-[transform,box-shadow]');
        expect(document.querySelector('[data-stage-spotlight]')).toBeNull();
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    },
  );

  // Items 3 + 4: the entry used to be driven by `stageProgress`'s
  // nearest-centre `progress`, which caps at ~0.5 and restarts at every
  // boundary — the plane popped 4°→0° at step one and the first finding was
  // read at the full 8° tilt. `entry` ramps once, and is settled by the time
  // the first caption reaches the viewport centre.
  it('the plane settles continuously and is flat by the time the first caption is centred', () => {
    useStageScrollTimers();
    try {
      render(<ChartStoryStage {...baseProps()} />);
      const scroller = layoutStage();
      scrollStage(scroller, 0);
      expect(plane().style.transform).toBe(entranceStyle(0, false).transform);
      scrollStage(scroller, 400);
      expect(plane().style.transform).toBe(entranceStyle(0.5, false).transform);
      // 800 px: the first panel's centre has reached the viewport centre.
      scrollStage(scroller, 800);
      expect(plane().style.transform).toBe(entranceStyle(1, false).transform);
      expect(plane().className).toContain('transition-[transform,box-shadow]');
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  // Task: the story-stage motion plane drift (ADR 044 §"As built" — v1 has no
  // parallax; this is the small, safe substitute). Driven by `scroll.progress`
  // (per-step, nearest-centre), deliberately not `scroll.entry` — so it must
  // never show up while the entry above is still tilting, and only ever
  // appear as an appended `translateY` once the plane is flat. The exact
  // curve itself is pinned in chart-stage.test.ts; this proves the hook,
  // `planeDriftPx` and `planeTransform` are wired together correctly here.
  it('drifts the settled plane a few px toward each step boundary, and never while the entry is still tilting', () => {
    useStageScrollTimers();
    try {
      render(<ChartStoryStage {...baseProps()} />);
      const scroller = layoutStage();
      const settled = entranceStyle(1, false).transform;

      // Still inside the entry window: `stageProgress` clamps a step's own
      // progress to 0 for as long as `entry` has not yet reached 1 (proven in
      // chart-stage.ts's own doc comment), so no drift term is appended —
      // byte-identical to the plain (tilted) entry transform.
      scrollStage(scroller, 400);
      expect(plane().style.transform).toBe(entranceStyle(0.5, false).transform);

      // Entry has just settled, still at the first step's own centre
      // (progress 0): no drift yet either.
      scrollStage(scroller, 800);
      expect(plane().style.transform).toBe(settled);
      expect(plane().style.transform).toBe(planeTransform(settled, planeDriftPx(0, false)));

      // A quarter of the way to the next step's centre (progress 0.25): a
      // small translateY is now appended, matching `planeDriftPx` exactly.
      scrollStage(scroller, 1000);
      const quarterDrift = planeDriftPx(0.25, false);
      expect(quarterDrift).toBeGreaterThan(0);
      expect(plane().style.transform).toBe(planeTransform(settled, quarterDrift));
      expect(plane().style.transform).toBe(`${settled} translateY(${quarterDrift}px)`);

      // The boundary itself (progress 0.5): the peak of the breathing curve.
      scrollStage(scroller, 1200);
      const peakDrift = planeDriftPx(0.5, false);
      expect(peakDrift).toBeGreaterThan(quarterDrift);
      expect(plane().style.transform).toBe(planeTransform(settled, peakDrift));
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('reduced motion suppresses the drift too, on the same staticMotion gate the entry tilt already uses', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }));
    useStageScrollTimers();
    try {
      render(<ChartStoryStage {...baseProps()} />);
      const scroller = layoutStage();
      // The same scroll position that produced the peak 5px drift above.
      scrollStage(scroller, 1200);
      expect(plane().style.transform).toBe(entranceStyle(0, true).transform);
      expect(plane().style.transform).not.toContain('translateY(');
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('the captions hand over continuously instead of popping at each boundary', () => {
    useStageScrollTimers();
    try {
      render(<ChartStoryStage {...baseProps()} />);
      const scroller = layoutStage();
      // Centred on the first panel: fully shown, untranslated.
      scrollStage(scroller, 800);
      expect(caption(0).style.opacity).toBe('1');
      expect(caption(1).style.opacity).toBe(String(captionStyle(1, false).opacity));
      // A quarter of the way to the next panel: `progress` 0.25, so the
      // active caption's distance is 0.5 and the next one's is also 0.5 —
      // the crossing point of the hand-over.
      scrollStage(scroller, 1000);
      expect(Number(caption(0).style.opacity)).toBeLessThan(1);
      expect(caption(0).style.opacity).toBe(String(captionStyle(0.5, false).opacity));
      expect(caption(1).style.opacity).toBe(String(captionStyle(0.5, false).opacity));
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  // Editorial reveal (visual upgrade, task 2 of the chain — captions): the
  // active caption must be the EXACT sharp/unscaled/untranslated resting
  // style — the hard constraint this task must not weaken — while an
  // off-centre one carries the new blur + scale exactly as `captionStyle`
  // (chart-stage.ts, pinned on its own there) computes them. This proves the
  // WIRING between the component and the pure function, the same pattern
  // the entranceStyle/planeDriftPx/spotlightStyle tests already use.
  it('the active caption sits at the exact sharp, unscaled resting style; an off-centre one blurs, shrinks and fades to match captionStyle exactly', () => {
    useStageScrollTimers();
    try {
      render(<ChartStoryStage {...baseProps()} />);
      const scroller = layoutStage();
      scrollStage(scroller, 800); // centred on the first panel
      const rest = captionStyle(0, false);
      expect(caption(0).style.opacity).toBe(String(rest.opacity));
      expect(caption(0).style.transform).toBe(rest.transform);
      expect(caption(0).style.filter).toBe(rest.filter);
      const far = captionStyle(1, false);
      expect(caption(1).style.transform).toBe(far.transform);
      expect(caption(1).style.filter).toBe(far.filter);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  // The hard constraint, restated at the component level: reduced motion
  // must yield the unchanged simple style — opacity 1, no blur, no scale, no
  // translate — for EVERY caption regardless of scroll position, on the
  // SAME staticMotion gate the plane/atmosphere tests already exercise, not
  // a second/different one.
  it('reduced motion: every caption sits at the exact flat, sharp resting style regardless of distance', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      render(<ChartStoryStage {...baseProps()} />);
      const rest = captionStyle(0, true);
      for (let i = 0; i < steps.length; i++) {
        expect(caption(i).style.opacity).toBe(String(rest.opacity));
        expect(caption(i).style.transform).toBe(rest.transform);
        expect(caption(i).style.filter).toBe(rest.filter);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Chrome decision: the old bordered, opaque `bg-card` box is gone —
  // replaced by plain text over a borderless, decorative scrim. Guards
  // against silently regressing back to the small-card look.
  it('the caption no longer sits in a bordered card', () => {
    render(<ChartStoryStage {...baseProps()} />);
    expect(caption(0).className).not.toContain('border');
    expect(caption(0).className).not.toContain('bg-card');
  });

  // The scrim and the accent rule are purely decorative chrome behind/around
  // the text — no semantic content, never a click target, matching how the
  // atmosphere layer itself is already proven inert elsewhere in this file.
  it('the caption’s decorative scrim and accent rule are aria-hidden and never focusable', () => {
    render(<ChartStoryStage {...baseProps()} />);
    const decorative = Array.from(caption(0).querySelectorAll('[aria-hidden="true"]')) as HTMLElement[];
    expect(decorative.length).toBeGreaterThanOrEqual(2); // the scrim + the accent rule
    const dialog = screen.getByRole('dialog');
    for (const el of decorative) expect(focusables(dialog)).not.toContain(el);
  });

  // The accent rule is the ONLY colour tie the caption makes to the active
  // finding — reusing `--stage-accent` exactly as the atmosphere task's own
  // doc comment asks, never a re-derived colour (the hard constraint in the
  // brief).
  it('the caption’s accent rule reuses --stage-accent rather than a re-derived colour', () => {
    render(<ChartStoryStage {...baseProps({ index: 1 })} />);
    const rule = caption(1).querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(rule).not.toBeNull();
    // The scrim is the first aria-hidden child (no inline colour of its
    // own); the accent rule is the second and carries `--stage-accent`.
    const accentRule = Array.from(caption(1).querySelectorAll('[aria-hidden="true"]'))[1] as HTMLElement;
    expect(accentRule.style.backgroundColor).toBe('var(--stage-accent)');
  });

  // Typography: the title must read as a designed headline, not a small
  // card label — the primary ask of this task.
  it('the title reads as a designed headline — large, bold, tight tracking — not a small card label', () => {
    render(<ChartStoryStage {...baseProps()} />);
    const title = screen.getByText(steps[0]!.title);
    expect(title.className).toMatch(/text-(3xl|4xl|5xl)/);
    expect(title.className).toContain('font-bold');
    expect(title.className).toContain('tracking-tight');
  });

  // Item 5: Recharts measures itself asynchronously, so the marker often
  // does not exist yet when the step effect reads it on open — the first
  // step of every presentation came up with no vignette at all.
  it('re-reads the spotlight on a resize tick, so a point-first step is not left without its vignette', () => {
    // Recharts' own ResponsiveContainer also constructs a ResizeObserver, so
    // the stub records WHICH element each observer watches and the test only
    // fires the one watching the stage's chart box (firing Recharts' with an
    // empty entry list just crashes its callback).
    const observers: { cb: (entries: unknown[]) => void; targets: Element[] }[] = [];
    class StubResizeObserver {
      private readonly record: { cb: (entries: unknown[]) => void; targets: Element[] };
      constructor(cb: (entries: unknown[]) => void) {
        this.record = { cb, targets: [] };
        observers.push(this.record);
      }
      observe(target: Element): void {
        this.record.targets.push(target);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const original = Element.prototype.getBoundingClientRect;
    try {
      // A point-first story: the very first step carries the ring.
      const pointFirst = [steps[1]!, steps[0]!, steps[2]!];
      render(<ChartStoryStage {...baseProps({ steps: pointFirst })} />);
      // Nothing has a size yet (jsdom rects are all zero) → no vignette.
      expect(document.querySelector('[data-stage-spotlight]')).toBeNull();
      const chartBox = document.querySelector('[data-stage-plane] > div') as Element;
      const watching = observers.filter((o) => o.targets.includes(chartBox));
      expect(watching.length).toBe(1);

      const chartBoxRect = { left: 0, top: 0, width: 640, height: 256, right: 640, bottom: 256, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      const markerRect = { left: 156, top: 60, width: 8, height: 8, right: 164, bottom: 68, x: 156, y: 60, toJSON: () => ({}) } as DOMRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.matches('[data-story-marker]')) return markerRect;
        if (this.matches('[data-slot="chart-frame"]')) return chartBoxRect;
        if (this.matches('[data-stage-plane] > div')) return chartBoxRect;
        return original.call(this);
      };
      // First tick: every observer learns its size — including Recharts'
      // own ResponsiveContainer, which is exactly why the marker did not
      // exist yet when the step effect ran on open (the defect).
      act(() => {
        for (const observer of observers) {
          observer.cb([{ target: observer.targets[0], contentRect: { width: 640, height: 256 } }]);
        }
      });
      expect(document.querySelector('[data-story-marker]')).not.toBeNull();
      // Second tick: the chart box's own observer fires now that the chart
      // inside it has a size — the stage re-reads the marker and the
      // vignette appears without any step change.
      act(() => {
        for (const observer of watching) observer.cb([{ target: chartBox, contentRect: chartBoxRect }]);
      });
      expect(document.querySelector('[data-stage-spotlight]')).not.toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = original;
      vi.unstubAllGlobals();
    }
  });

  // Item 6: ADR 044 decision 7 promises auto-play stops "on any user
  // scroll/key" — only the key half existed, so a reader who took over with
  // the wheel kept being yanked to the next finding every four seconds.
  it('auto-play stops the moment the reader scrolls the stage', () => {
    vi.useFakeTimers();
    const onAdvance = vi.fn();
    render(<Harness onAdvance={onAdvance} />);
    const toggle = screen.getByRole('button', { name: 'Automatisch afspelen' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.wheel(document.querySelector('[data-stage-scroller]') as HTMLElement);
    expect(screen.getByRole('button', { name: 'Automatisch afspelen' })).toHaveAttribute('aria-pressed', 'false');

    act(() => {
      vi.advanceTimersByTime(STAGE_AUTOPLAY_MS * 3);
    });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  // `/code-review` LOW finding after the post-loop fix: binding the
  // scroller's `scroll` event to the gesture handler made auto-play stop
  // ITSELF — its own advance (`go()` → `scrollIntoView`) fires `scroll` on
  // that element in a real browser. jsdom stubs `scrollIntoView`, so this
  // test raises the `scroll` the browser would: auto-play must keep going.
  it('auto-play survives the scroll events its own advances raise (a bare `scroll` never stops it)', () => {
    vi.useFakeTimers();
    const onAdvance = vi.fn();
    render(<Harness onAdvance={onAdvance} />);
    const scroller = document.querySelector('[data-stage-scroller]') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Automatisch afspelen' }));

    act(() => {
      vi.advanceTimersByTime(STAGE_AUTOPLAY_MS);
    });
    expect(onAdvance).toHaveBeenNthCalledWith(1, 1);
    // The programmatic scroll the advance would cause in a browser.
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(screen.getByRole('button', { name: 'Automatisch afspelen' })).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      vi.advanceTimersByTime(STAGE_AUTOPLAY_MS);
    });
    expect(onAdvance).toHaveBeenNthCalledWith(2, 2);
  });

  // NEW regression test (scrollbar-drag auto-play fix): a scrollbar-thumb
  // drag fires only a `scroll` DOM event — no wheel/touch/pointerdown — and
  // (unlike go()'s own advance below) is never preceded by the hook's
  // beginProgrammatic(). ADR 044's as-built section recorded this as an
  // "accepted gap" (auto-play kept running through a scrollbar drag);
  // useStageScroll now exposes isProgrammatic() so onAnyScroll can tell the
  // two kinds of `scroll` event apart, and a non-programmatic one must stop
  // auto-play like any other reader gesture.
  it('a scrollbar-driven scroll (no beginProgrammatic) stops auto-play when it is on', () => {
    useStageScrollTimers();
    try {
      const onAdvance = vi.fn();
      render(<Harness onAdvance={onAdvance} />);
      const scroller = layoutStage();
      fireEvent.click(screen.getByRole('button', { name: 'Automatisch afspelen' }));
      expect(screen.getByRole('button', { name: 'Automatisch afspelen' })).toHaveAttribute('aria-pressed', 'true');

      // The same scrollStage() helper the "reader scrolls via scrollbar"
      // test above uses: a bare `scroll` event, scrollTop set directly —
      // exactly what a scrollbar-thumb drag raises, and never routed through
      // beginProgrammatic() the way go()'s own scrollIntoView advance is.
      scrollStage(scroller, 1600);

      expect(screen.getByRole('button', { name: 'Automatisch afspelen' })).toHaveAttribute('aria-pressed', 'false');
      onAdvance.mockClear();
      act(() => {
        vi.advanceTimersByTime(STAGE_AUTOPLAY_MS * 3);
      });
      expect(onAdvance).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // NEW regression test (scrollbar-drag auto-play fix): unlike
  // 'auto-play survives the scroll events its own advances raise' above
  // (which raises the browser's `scroll` event as a separate, later step),
  // this drives the exact causal chain go() uses — beginProgrammatic()
  // immediately followed by scrollIntoView — by making the scrollIntoView
  // mock itself raise the `scroll` event synchronously, the way a real
  // browser would. isProgrammatic() must read true at that exact moment so
  // auto-play is not stopped: the guard against re-introducing the
  // session-95 regression (auto-play switching itself off after its own
  // first advance) while the scrollbar-drag gap above is being closed.
  it("auto-play's own beginProgrammatic() → scrollIntoView scroll does not stop it", () => {
    vi.useFakeTimers();
    const onAdvance = vi.fn();
    render(<Harness onAdvance={onAdvance} />);
    const scroller = document.querySelector('[data-stage-scroller]') as HTMLElement;
    // Overrides the generic no-op stub from beforeEach for this test only
    // (afterEach restores the true original regardless of this override).
    Element.prototype.scrollIntoView = vi.fn(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    const toggle = screen.getByRole('button', { name: 'Automatisch afspelen' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      vi.advanceTimersByTime(STAGE_AUTOPLAY_MS);
    });

    expect(onAdvance).toHaveBeenNthCalledWith(1, 1);
    expect(screen.getByRole('button', { name: 'Automatisch afspelen' })).toHaveAttribute('aria-pressed', 'true');
  });

  // Item 8: the vignette used to cover the whole card — the title, the
  // legend and the source line dimmed along with the chart. It is now
  // positioned over the plot box alone.
  it('the vignette is confined to the plot box, never the title or the source line', () => {
    const original = Element.prototype.getBoundingClientRect;
    const chartBoxRect = { left: 0, top: 0, width: 640, height: 400, right: 640, bottom: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    const plotRect = { left: 0, top: 40, width: 640, height: 256, right: 640, bottom: 296, x: 0, y: 40, toJSON: () => ({}) } as DOMRect;
    const markerRect = { left: 156, top: 100, width: 8, height: 8, right: 164, bottom: 108, x: 156, y: 100, toJSON: () => ({}) } as DOMRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.matches('[data-story-marker]')) return markerRect;
      if (this.matches('[data-slot="chart-frame"]')) return plotRect;
      if (this.matches('[data-stage-plane] > div')) return chartBoxRect;
      return original.call(this);
    };
    try {
      const { rerender } = render(<ChartStoryStage {...baseProps({ index: 0 })} />);
      rerender(<ChartStoryStage {...baseProps({ index: 1 })} />);
      const spotlight = document.querySelector('[data-stage-spotlight]') as HTMLElement | null;
      expect(spotlight).not.toBeNull();
      expect(spotlight!.style.top).toBe('40px');
      expect(spotlight!.style.height).toBe('256px');
      expect(spotlight!.style.left).toBe('0px');
      expect(spotlight!.style.width).toBe('640px');
      // The centre is measured against the PLOT box: the marker's centre
      // (160, 104) sits 64 px below the plot's own top edge.
      const expected = spotlightStyle({ cx: 160, cy: 64 }, { width: 640, height: 256 });
      expect(spotlight!.style.background).toContain(`${expected!.left} ${expected!.top}`);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  // Fix 3: scrollbar-thumb drags fire only the `scroll` event, not
  // wheel/touch/pointer, so the reader-scroll guard was not armed. A passive
  // scroll listener now catches it. The hook's mount-time measure is a direct
  // call (not a scroll event), so mount-time index-0 suppression stays intact.
  it('reader scrolls via scrollbar → the step follows; opening alone does not trigger onIndexChange', () => {
    useStageScrollTimers();
    try {
      const onIndexChange = vi.fn();
      render(<ChartStoryStage {...baseProps({ index: 0, onIndexChange })} />);
      const scroller = layoutStage();
      // Open at index 0 with no scroll event: onIndexChange should not be
      // called at all (the mount-time measure is suppressed).
      expect(onIndexChange).not.toHaveBeenCalledWith(0);

      // Reader scrolls to the second panel's centre via scrollbar (scroll event
      // only, no wheel/touch/pointer): this should arm the guard and trigger a
      // step change.
      scrollStage(scroller, 1600);
      expect(onIndexChange).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── Ambient atmosphere layer (visual upgrade, task 1 of a chain) ───────
  // Colour-resolution and the reduced-motion branch are pinned exactly in
  // chart-stage.test.ts (the brief's own testable surface); these prove the
  // WIRING — that the component actually sets `--stage-accent` from
  // `atmosphereState`, updates it when the active step changes, and gates
  // the blobs' animation the same way. Real motion, blur and contrast in a
  // browser are out of reach here — see the task's report.

  it('sets --stage-accent on the dialog root to the active step’s own highlighted-series colour — the shared infrastructure later tasks reuse', () => {
    // steps[1] ('high-s0') highlights 's0'; with no overrides that resolves
    // through the DEFAULT_PALETTE, exactly like atmosphereState itself.
    render(<ChartStoryStage {...baseProps({ index: 1 })} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.getPropertyValue('--stage-accent')).toBe(atmosphereState({}, 's0', false).accent);
  });

  it('an overview step (no highlight) still sets a real --stage-accent — the first series’ own colour, never missing or invented', () => {
    // steps[0] ('overview') and steps[2] ('explore') both have highlight: null.
    render(<ChartStoryStage {...baseProps({ index: 0 })} />);
    const dialog = screen.getByRole('dialog');
    const accent = dialog.style.getPropertyValue('--stage-accent');
    expect(accent).toBe(atmosphereState({}, null, false).accent);
    expect(accent).not.toBe('');
  });

  it('the accent follows the ACTIVE step’s own highlighted series and updates the moment the step changes', () => {
    const twoHighlights: StoryStep[] = [
      { id: 'a', kind: 'series', title: 'Serie A', caption: 'a', highlight: 's0', point: null },
      { id: 'b', kind: 'series', title: 'Serie B', caption: 'b', highlight: 's1', point: null },
    ];
    const overrides = { seriesColors: { 0: '#111111', 1: '#222222' } };
    const { rerender } = render(<ChartStoryStage {...baseProps({ steps: twoHighlights, index: 0, overrides })} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.getPropertyValue('--stage-accent')).toBe('#111111');
    rerender(<ChartStoryStage {...baseProps({ steps: twoHighlights, index: 1, overrides })} />);
    expect(dialog.style.getPropertyValue('--stage-accent')).toBe('#222222');
  });

  it('the atmosphere layer sits behind everything (first child, negative z-index) and is purely decorative: aria-hidden, unclickable, never focusable', () => {
    render(<ChartStoryStage {...baseProps()} />);
    const dialog = screen.getByRole('dialog');
    const layer = dialog.firstElementChild as HTMLElement;
    expect(layer).toHaveAttribute('data-stage-atmosphere', 'true');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.className).toContain('pointer-events-none');
    expect(layer.className).toContain('-z-10');
    expect(focusables(dialog)).not.toContain(layer);
  });

  it('animated motion runs a continuous drift loop and a background-colour transition on every blob', () => {
    render(<ChartStoryStage {...baseProps()} />);
    const blobs = Array.from(document.querySelectorAll('[data-stage-atmosphere-blob]')) as HTMLElement[];
    expect(blobs.length).toBeGreaterThanOrEqual(2);
    for (const blob of blobs) {
      expect(blob.style.animation).not.toBe('none');
      expect(blob.style.animation).toContain('infinite');
      expect(blob.style.transition).toContain('background-color');
      expect(blob.style.backgroundColor).toContain('color-mix(');
      expect(blob.style.backgroundColor).toContain('var(--stage-accent)');
    }
  });

  it('under static motion (reduced motion / (hover: none) / < lg — the SAME gate the entry tilt uses) the atmosphere shows an instant tint, never a broken or missing layer', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      render(<ChartStoryStage {...baseProps()} />);
      const blobs = Array.from(document.querySelectorAll('[data-stage-atmosphere-blob]')) as HTMLElement[];
      expect(blobs.length).toBeGreaterThanOrEqual(2);
      for (const blob of blobs) {
        expect(blob.style.animation).toBe('none');
        expect(blob.style.transition).toBe('none');
        // Still a real, visible tint — never an empty/missing background.
        expect(blob.style.backgroundColor).toContain('color-mix(');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the atmosphere keyframes live in document.head, never document.body — the whole-card digit scan (chart.test.tsx) walks only document.body’s own text nodes', () => {
    render(<ChartStoryStage {...baseProps()} />);
    const headStyles = Array.from(document.head.querySelectorAll('style'));
    expect(headStyles.some((s) => s.textContent?.includes('stage-atmosphere-drift'))).toBe(true);
    const bodyStyles = Array.from(document.body.querySelectorAll('style'));
    expect(bodyStyles.some((s) => s.textContent?.includes('stage-atmosphere-drift'))).toBe(false);
  });
});
