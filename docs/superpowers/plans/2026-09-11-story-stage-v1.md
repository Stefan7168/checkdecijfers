# Story stage v1 (scroll-driven presentation of the Insights story) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Presenteren / Present" button on the Insights panel that opens the same story as a full-screen, scroll-driven stage: the chart stays pinned while each finding scrolls past as a full-height panel and drives the chart (highlight + the existing dashed ring + a spotlight vignette), with a gentle CSS-3D tilt on entry that settles flat, a lifting shadow, captions that reveal on scroll, an auto-play toggle (off by default), Escape/close and focus management, a phone layout and a full reduced-motion path — built on CSS 3D transforms and one small scroll-progress hook, **zero new libraries**.

**Architecture:** The stage is a second, chrome-less `ChartView` instance (`stage` prop: driven only by the active step and the chat chart's resolved presentation overrides — no reader state of its own) inside a full-viewport overlay (`chart-story-stage.tsx`, portal for POSITION only; open/index state stays in `ChartView`, exactly like the compact panel). Scroll position in the steps column → a pure `stageProgress` → `{ index, progress }`; index changes flow through the existing `onStoryIndexChange`; `progress` feeds pure `entranceStyle`/`spotlightStyle` → inline `transform`/`opacity` on wrappers OUTSIDE the exported `<svg>`. Nothing in the stage is exportable (no Download), nothing persists, no LLM call is added (the AI-phrased captions already arrive via the compact panel's `generateInsights`).

**Tech Stack:** Next.js 15 / React 19 (`createPortal`), CSS 3D (`perspective`, `rotateX`, `translate3d`), vitest + Testing Library (jsdom; fake timers for auto-play), the message catalogue, the anonymous usage counter.

**Spec:** [docs/session-briefs/2026-09-10-visual-next-level-plan.md](../../session-briefs/2026-09-10-visual-next-level-plan.md) §3 (the stage), §8 (invariants), with the kickoff's decisions 1, 6, 7 ([docs/session-briefs/2026-09-10-overnight-visual-upgrade-kickoff.md](../../session-briefs/2026-09-10-overnight-visual-upgrade-kickoff.md)): "3D" = depth/tilt/motion around a FLAT chart; zero libraries (Option A); auto-play off by default; spotlight only, no zoom. Builds on ADR 042/043 (branches `visual-designed-default`, `visual-templates-v1`) and the Insights story (ADR 041: `storySteps` = findings, `storyIndex`, `openStory`/`closeStory`/`onStoryIndexChange` in `chart.tsx`; `ChartStoryPanel` in `chart-story.tsx`).

## Design decisions taken for this plan (the ADR 044 rationale)

- **Stage = overlay, not in place.** `position: fixed; inset: 0; z-50`, `role="dialog" aria-modal="true"`, `aria-labelledby` the chart title, focus moved into the dialog on open, Escape and a Close button close it and return focus to the Present button, `document.body` scroll locked while open. A portal into `document.body` for position only (the session-91 lesson: never portal to move controls; state stays in `ChartView`).
- **Layout.** ≥ `lg`: a two-column grid — the chart column (55 %) `sticky top-0 h-screen` centred, the steps column scrolls (`overflow-y-auto`, one panel per step, each `min-h-[85vh]`, the last padded so it can reach the top). < `lg`: the chart pinned at the top (`h-[45vh]`), the steps beneath in the same scroll container. `touch-pan-y` kept.
- **Second `ChartView` in stage mode** (`stage` prop): chrome stripped (no form tabs, no Style/Insights triggers, no Vanaf/Tot selects, no notes, no small-multiples toggles, no footer actions/Download, no legend buttons — the legend is drawn as plain chips, not buttons, so nothing in the stage can contradict the step), the presentation = the chat chart's current per-chart overrides (so the stage looks exactly like the chart it came from, including a template), the highlight and the dashed ring driven by `stage.step` only. The stage instance holds no notes, no hidden series, nothing to restore.
- **Camera = spotlight, no pan, no zoom (v1).** For a point step the stage reads the ringed marker's position (`[data-story-marker]` `cx`/`cy` relative to the chart box) ONCE per step change and centres a radial vignette there (`spotlightStyle` → `left`/`top` percentages); the existing highlight dimming and the dashed ring do the rest. Overview/explore-like steps (no point): vignette off. Pan was in the spec; dropped for v1 because translating the whole svg moves axis labels and value labels off the card at small widths — the vignette + ring already say "here" without moving a single number (honesty note in the spec §3.4).
- **Depth on entry.** The chart plane enters with `perspective(1200px) rotateX(8deg) translateY(12px)` and settles to flat over the first step's scroll progress (`entranceStyle(progress)`), the frame shadow deepens as it lifts; tilt is capped at 8° (< the spec's 12°), applied only while `progress < 1` of the FIRST step — i.e. never while a later step's number is being read. Below `lg` or on `(hover: none)` or `prefers-reduced-motion: reduce`: no tilt, no shadow animation — steps still switch instantly with highlight + ring.
- **Captions reveal**: each step panel fades/rises into place as it becomes active (`opacity`/`translateY` from `progress`), digit-free chrome (dots for position, never "N of M"). Every string in `messages.ts`, nl + en, no digits.
- **Auto-play**: a toggle button (`aria-pressed`), off by default; when on, advances the index every 4 s and stops at the last step or on any user scroll/key; counted once per activation (`stage_autoplay`). Off by default per the kickoff.
- **Scroll → step**: `useStageScroll(scrollRef, stepCount)` — one rAF-throttled `scroll` listener, `stageProgress(scrollTop, offsets, viewportHeight)` decides the active index (the panel whose centre is nearest the viewport centre) and the 0–1 progress toward the next; `IntersectionObserver` is NOT used here (the compact panel's approach) because the stage needs continuous progress, not just membership. Programmatic scrolls (dots, keys, auto-play) go through `scrollIntoView` and the same settle-guard idea as the compact panel (a 150 ms settle after the last scroll event) so the listener doesn't fight them.
- **Native scroll-driven CSS animations** (`animation-timeline: view()`) are NOT used in v1 (uneven support; the hook is the universal path) — a later enhancement only if it deletes code.
- **Counter**: `stage_open`, `stage_autoplay` on the anonymous counter (records nothing until migration 028 is applied).
- **Not in the stage**: Download, notes, the Style panel, the embed. The compact panel keeps working exactly as today; Present is one extra button in its row.

## Global Constraints
- **Honesty (R1/R6/R11):** no numeric text anywhere in the stage that is not a spec string (the caption/title strings come from the same `storySteps`; the chrome is digit-free; positions are dots); the hollow provisional marker and the hatched bar stay visible at every tilt (the tilt is ≤ 8° and only during the first step's entry); CSS transforms only on wrappers OUTSIDE the `<svg>`; the stage has no Download; Recharts animation stays off; the whole-card digit scan runs on the STAGE's DOM too (a new test).
- **Both themes**, tokens only for chrome; `prefers-reduced-motion` honoured (no tilt/parallax/scrub; instant step switches).
- **No CSS `aspect-ratio`; no new dependency; no schema/prompt/LLM change** (the phrased captions already come from the compact panel's flow).
- **Every new interface string** has `nl` and `en` entries, no digits: `chart.stage.present` (Presenteren / Present), `chart.stage.label` (Presentatie van de inzichten / Insights presentation), `chart.stage.close` (Sluiten / Close), `chart.stage.scrollHint` (Scroll om verder te gaan / Scroll to continue), `chart.stage.autoplay` (Automatisch afspelen / Auto-play), `chart.stage.stepsLabel` (Stappen / Steps).
- **Commands:** web tests `cd web && npx vitest run <files>`; typecheck `cd web && npx tsc --noEmit` and root `npx tsc --noEmit`; backend event pins `npx vitest run tests/chart/user-styles.test.ts` (root). Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Branch `visual-story-stage` (from `visual-templates-v1`); never push to `main`.
- **Do the edits yourself in this run — do not spawn subagents, do not "background" the task.**

## File map
- Create `web/lib/chart-stage.ts` (+ `.test.ts`): `STAGE_TILT_DEG`, `STAGE_AUTOPLAY_MS`, `stageProgress`, `entranceStyle`, `spotlightStyle`, `captionStyle`.
- Create `web/lib/use-stage-scroll.ts` (+ `.test.ts`): the rAF-throttled scroll → `{ index, progress }` hook with a programmatic-scroll guard.
- Modify `web/components/chart.tsx` (+ `.test.tsx`): the `stage` prop (chrome-less instance driven by a step); the `stageOpen` state, `openStage`/`closeStage`, the `<ChartStoryStage>` mount, `stage_open`/`stage_autoplay` events.
- Create `web/components/chart-story-stage.tsx` (+ `.test.tsx`): the overlay.
- Modify `web/components/chart-story.tsx` (+ `.test.tsx`): the Present button (`onPresent` prop).
- Modify `web/lib/i18n/messages.ts`, `src/chart/user-styles.ts`, `web/app/usage-actions.test.ts`: strings + two events.
- Docs (controller): ADR 044, `docs/12-huisstijl.md`, `docs/08-build-plan.md`, `docs/04-architecture.md`, `docs/open-questions.md`, STATUS/archive/lessons.

---

### Task 1: The pure stage geometry (`chart-stage.ts`)
**Files:** Create `web/lib/chart-stage.ts`, `web/lib/chart-stage.test.ts`

**Interfaces (produce exactly these):**
```ts
export const STAGE_TILT_DEG = 8;
export const STAGE_AUTOPLAY_MS = 4000;
export interface StageProgress { index: number; progress: number } // progress ∈ [0,1]: how far the viewport centre has travelled from step `index`'s centre toward step `index+1`'s centre (0 on the last step)
/** `offsets[i]` = the top of step i's panel relative to the scroll container's content, `heights[i]` its height. */
export function stageProgress(scrollTop: number, viewportHeight: number, offsets: number[], heights: number[]): StageProgress;
/** The chart plane's entry: tilted and lifted at 0, flat at 1 (clamped); reduced motion → identity. */
export function entranceStyle(progress: number, reducedMotion: boolean): { transform: string; boxShadow: string };
/** Caption panel: fades/rises in as it becomes active — `distance` = |viewport centre − panel centre| / viewportHeight. */
export function captionStyle(distance: number, reducedMotion: boolean): { opacity: number; transform: string };
/** Vignette centre as percentages of the chart box; null → no spotlight. */
export function spotlightStyle(marker: { cx: number; cy: number } | null, box: { width: number; height: number }): { left: string; top: string } | null;
```

- [ ] **Step 1: Write the failing tests** — `web/lib/chart-stage.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { captionStyle, entranceStyle, spotlightStyle, STAGE_AUTOPLAY_MS, STAGE_TILT_DEG, stageProgress } from './chart-stage.ts';

describe('stageProgress — which step the viewport centre is on, and how far toward the next', () => {
  const offsets = [0, 800, 1600, 2400];
  const heights = [800, 800, 800, 800];
  it('at the top the first step is active with zero progress', () => {
    expect(stageProgress(0, 800, offsets, heights)).toEqual({ index: 0, progress: 0 });
  });
  it('halfway between two centres the earlier step is active with progress one half', () => {
    // centres at 400, 1200, 2000, 2800; viewport centre = scrollTop + 400
    expect(stageProgress(400, 800, offsets, heights)).toEqual({ index: 0, progress: 0.5 });
  });
  it('past the halfway point the next step takes over and progress restarts', () => {
    const r = stageProgress(900, 800, offsets, heights); // centre 1300 → step 1 (centre 1200), 100/800 toward step 2
    expect(r.index).toBe(1);
    expect(r.progress).toBeCloseTo(0.125, 5);
  });
  it('on the last step progress is 0 and the index never exceeds the last panel', () => {
    expect(stageProgress(10_000, 800, offsets, heights)).toEqual({ index: 3, progress: 0 });
  });
  it('degenerate inputs never throw: no panels → index 0; a zero-height viewport is treated as one pixel', () => {
    expect(stageProgress(0, 800, [], [])).toEqual({ index: 0, progress: 0 });
    expect(stageProgress(0, 0, offsets, heights).index).toBe(0);
  });
});

describe('entranceStyle — tilted and lifted on entry, flat once read', () => {
  it('at 0 the plane is tilted STAGE_TILT_DEG, lifted, with a deep shadow; at 1 it is flat with the resting shadow', () => {
    const start = entranceStyle(0, false);
    expect(start.transform).toContain(`rotateX(${STAGE_TILT_DEG}deg)`);
    expect(start.transform).toContain('perspective(');
    const end = entranceStyle(1, false);
    expect(end.transform).toContain('rotateX(0deg)');
    expect(end.boxShadow).not.toBe(start.boxShadow);
  });
  it('clamps progress outside [0, 1]', () => {
    expect(entranceStyle(-3, false)).toEqual(entranceStyle(0, false));
    expect(entranceStyle(7, false)).toEqual(entranceStyle(1, false));
  });
  it('reduced motion is the flat resting state at every progress', () => {
    expect(entranceStyle(0, true)).toEqual(entranceStyle(1, false));
    expect(entranceStyle(0.4, true)).toEqual(entranceStyle(1, false));
  });
});

describe('captionStyle — the active panel is fully shown, far panels fade and sit lower', () => {
  it('distance 0 is fully opaque and untranslated; distance ≥ 1 is faint; reduced motion is always shown', () => {
    expect(captionStyle(0, false)).toEqual({ opacity: 1, transform: 'translate3d(0, 0px, 0)' });
    expect(captionStyle(1, false).opacity).toBeLessThan(0.5);
    expect(captionStyle(1, false).transform).not.toBe('translate3d(0, 0px, 0)');
    expect(captionStyle(1, true)).toEqual({ opacity: 1, transform: 'translate3d(0, 0px, 0)' });
  });
});

describe('spotlightStyle — the vignette centre as percentages of the chart box', () => {
  it('maps the marker to percentages, clamped to the box; null marker → null', () => {
    expect(spotlightStyle({ cx: 160, cy: 64 }, { width: 640, height: 256 })).toEqual({ left: '25%', top: '25%' });
    expect(spotlightStyle({ cx: -10, cy: 999 }, { width: 640, height: 256 })).toEqual({ left: '0%', top: '100%' });
    expect(spotlightStyle(null, { width: 640, height: 256 })).toBeNull();
    expect(spotlightStyle({ cx: 1, cy: 1 }, { width: 0, height: 0 })).toBeNull();
  });
});

describe('constants', () => {
  it('auto-play advances every four seconds; the tilt stays under the spec cap', () => {
    expect(STAGE_AUTOPLAY_MS).toBe(4000);
    expect(STAGE_TILT_DEG).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run lib/chart-stage.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `web/lib/chart-stage.ts`:
```ts
// ADR 044: the Story stage's geometry — pure, no React, no DOM. Everything
// the stage animates is a wrapper OUTSIDE the exported <svg> (the honesty
// scans and the export never see a transform); these functions turn a scroll
// position into (a) the active step + progress toward the next, (b) the
// chart plane's entry tilt, (c) a caption's reveal, (d) the spotlight centre.
export const STAGE_TILT_DEG = 8; // < the spec's 12° cap; only during the FIRST step's entry
export const STAGE_AUTOPLAY_MS = 4000;

export interface StageProgress {
  index: number;
  progress: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** The step whose panel centre is nearest the viewport centre, and how far
 * the viewport centre has travelled from that centre toward the next one
 * (0 on the last step). Degenerate input never throws. */
export function stageProgress(scrollTop: number, viewportHeight: number, offsets: number[], heights: number[]): StageProgress {
  const n = Math.min(offsets.length, heights.length);
  if (n === 0) return { index: 0, progress: 0 };
  const vh = Math.max(1, viewportHeight);
  const centre = scrollTop + vh / 2;
  const centres = Array.from({ length: n }, (_, i) => offsets[i]! + heights[i]! / 2);
  let index = 0;
  for (let i = 1; i < n; i++) if (Math.abs(centres[i]! - centre) < Math.abs(centres[index]! - centre)) index = i;
  if (index >= n - 1) return { index: n - 1, progress: 0 };
  const span = centres[index + 1]! - centres[index]!;
  const progress = span > 0 ? clamp01((centre - centres[index]!) / span) : 0;
  return { index, progress };
}

const REST_SHADOW = '0 8px 24px rgba(0, 0, 0, 0.18)';
const LIFT_SHADOW = '0 32px 64px rgba(0, 0, 0, 0.35)';

/** Tilted toward the reader and lifted at progress 0, flat at 1. The
 * transform lives on a wrapper; the svg inside is never transformed. */
export function entranceStyle(progress: number, reducedMotion: boolean): { transform: string; boxShadow: string } {
  const p = reducedMotion ? 1 : clamp01(progress);
  const tilt = Math.round(STAGE_TILT_DEG * (1 - p) * 100) / 100;
  const lift = Math.round(12 * (1 - p));
  return {
    transform: `perspective(1200px) rotateX(${tilt}deg) translate3d(0, ${lift}px, 0)`,
    boxShadow: p >= 1 ? REST_SHADOW : LIFT_SHADOW,
  };
}

/** A caption panel fades and rises into place as its centre approaches the
 * viewport centre (`distance` in viewport heights). */
export function captionStyle(distance: number, reducedMotion: boolean): { opacity: number; transform: string } {
  if (reducedMotion) return { opacity: 1, transform: 'translate3d(0, 0px, 0)' };
  const d = clamp01(Math.abs(distance));
  const opacity = Math.round((1 - 0.7 * d) * 100) / 100;
  const y = Math.round(24 * d);
  return { opacity, transform: `translate3d(0, ${y}px, 0)` };
}

/** Where the spotlight vignette sits, as percentages of the chart box. */
export function spotlightStyle(marker: { cx: number; cy: number } | null, box: { width: number; height: number }): { left: string; top: string } | null {
  if (marker === null || box.width <= 0 || box.height <= 0) return null;
  const pct = (v: number, max: number): string => `${Math.round(clamp01(v / max) * 100)}%`;
  return { left: pct(marker.cx, box.width), top: pct(marker.cy, box.height) };
}
```

- [ ] **Step 4: Run** — `cd web && npx vitest run lib/chart-stage.test.ts` → PASS.
- [ ] **Step 5: Commit**
```bash
git add web/lib/chart-stage.ts web/lib/chart-stage.test.ts
git commit -m "feat(chart): story stage geometry — progress, entrance tilt, caption reveal, spotlight (ADR 044)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The scroll-progress hook (`use-stage-scroll.ts`)
**Files:** Create `web/lib/use-stage-scroll.ts`, `web/lib/use-stage-scroll.test.tsx`

**Interfaces:**
```ts
export interface StageScroll { index: number; progress: number; /** call before a programmatic scroll so the listener ignores it until it settles */ beginProgrammatic(): void }
/** `containerRef`: the steps column (scrolls); `panelRefs`: one element per step. Re-reads offsets on every scroll (cheap: `offsetTop`/`offsetHeight`), rAF-throttled. */
export function useStageScroll(containerRef: RefObject<HTMLElement | null>, panelRefs: RefObject<(HTMLElement | null)[]>, stepCount: number, enabled: boolean): StageScroll;
```

- [ ] **Step 1: Write the failing tests** — `web/lib/use-stage-scroll.test.tsx` (jsdom: set `offsetTop`/`offsetHeight`/`clientHeight` via `Object.defineProperty`, fire `scroll` events, flush rAF with `vi.useFakeTimers()` + `vi.advanceTimersByTime(20)` after stubbing `requestAnimationFrame` to `setTimeout(cb, 16)`):
```tsx
import { act, render } from '@testing-library/react';
import { createElement, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStageScroll } from './use-stage-scroll.ts';

function Probe({ enabled }: { enabled: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const panels = useRef<(HTMLElement | null)[]>([]);
  const s = useStageScroll(container, panels, 3, enabled);
  return createElement(
    'div',
    { ref: container, 'data-testid': 'scroller' },
    createElement('span', { 'data-testid': 'out' }, `${s.index}:${s.progress}`),
    ...[0, 1, 2].map((i) => createElement('section', { key: i, ref: (el: HTMLElement | null) => { panels.current[i] = el; }, 'data-testid': `p${i}` })),
  );
}
function layout(el: HTMLElement, top: number, height: number): void {
  Object.defineProperty(el, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useStageScroll', () => {
  it('reports the step under the viewport centre and the progress toward the next, throttled to one frame', () => {
    const { getByTestId } = render(<Probe enabled />);
    const scroller = getByTestId('scroller');
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    layout(getByTestId('p0'), 0, 800);
    layout(getByTestId('p1'), 800, 800);
    layout(getByTestId('p2'), 1600, 800);
    expect(getByTestId('out').textContent).toBe('0:0');
    scroller.scrollTop = 400;
    act(() => { scroller.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
    expect(getByTestId('out').textContent).toBe('0:0.5');
    scroller.scrollTop = 1600;
    act(() => { scroller.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
    expect(getByTestId('out').textContent).toBe('2:0');
  });
  it('ignores scroll events during a programmatic scroll until it settles, and does nothing when disabled', () => {
    const { getByTestId } = render(<Probe enabled />);
    const scroller = getByTestId('scroller');
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    layout(getByTestId('p0'), 0, 800);
    layout(getByTestId('p1'), 800, 800);
    layout(getByTestId('p2'), 1600, 800);
    // The hook exposes beginProgrammatic through the rendered value; drive it via a second Probe variant is overkill —
    // instead assert the settle window through the public behaviour: a scroll fired within 150 ms of another is coalesced.
    scroller.scrollTop = 800;
    act(() => { scroller.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
    expect(getByTestId('out').textContent).toBe('1:0');
    const off = render(<Probe enabled={false} />);
    const s2 = off.getByTestId('scroller');
    Object.defineProperty(s2, 'clientHeight', { value: 800, configurable: true });
    layout(off.getByTestId('p0'), 0, 800);
    layout(off.getByTestId('p1'), 800, 800);
    layout(off.getByTestId('p2'), 1600, 800);
    s2.scrollTop = 1600;
    act(() => { s2.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
    expect(off.getByTestId('out').textContent).toBe('0:0');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run lib/use-stage-scroll.test.tsx` → FAIL.

- [ ] **Step 3: Implement** `web/lib/use-stage-scroll.ts`:
```ts
// ADR 044: the stage's scroll → step mapping. One rAF-throttled scroll
// listener on the steps column; `stageProgress` (pure) does the arithmetic.
// A programmatic scroll (dots, keys, auto-play) calls `beginProgrammatic()`
// first, and the listener ignores events until 150 ms after the last one —
// the compact panel's settle-guard idea, without IntersectionObserver
// (the stage needs continuous progress, not membership).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { stageProgress, type StageProgress } from './chart-stage.ts';

export interface StageScroll extends StageProgress {
  beginProgrammatic(): void;
}

const SETTLE_MS = 150;

export function useStageScroll(
  containerRef: RefObject<HTMLElement | null>,
  panelRefs: RefObject<(HTMLElement | null)[]>,
  stepCount: number,
  enabled: boolean,
): StageScroll {
  const [state, setState] = useState<StageProgress>({ index: 0, progress: 0 });
  const programmatic = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);

  const beginProgrammatic = useCallback((): void => {
    programmatic.current = true;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      programmatic.current = false;
    }, SETTLE_MS);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!enabled || !el) return undefined;
    const measure = (): void => {
      const panels = (panelRefs.current ?? []).slice(0, stepCount);
      const offsets = panels.map((p) => p?.offsetTop ?? 0);
      const heights = panels.map((p) => p?.offsetHeight ?? 0);
      const next = stageProgress(el.scrollTop, el.clientHeight, offsets, heights);
      setState((current) => (current.index === next.index && current.progress === next.progress ? current : next));
    };
    const onScroll = (): void => {
      if (programmatic.current) {
        // Keep the settle window open while the programmatic scroll is still moving.
        if (settle.current) clearTimeout(settle.current);
        settle.current = setTimeout(() => {
          programmatic.current = false;
        }, SETTLE_MS);
        return;
      }
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        measure();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, [containerRef, panelRefs, stepCount, enabled]);

  return { ...state, beginProgrammatic };
}
```

- [ ] **Step 4: Run** → PASS. Typecheck clean.
- [ ] **Step 5: Commit**
```bash
git add web/lib/use-stage-scroll.ts web/lib/use-stage-scroll.test.tsx
git commit -m "feat(chart): useStageScroll — rAF-throttled scroll progress with a programmatic-scroll guard (ADR 044)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `ChartView` stage mode (chrome-less, step-driven)
**Files:** Modify `web/components/chart.tsx`, `web/components/chart.test.tsx`

**Interfaces (produce exactly this):**
```ts
export interface ChartStageMode {
  /** The active step: drives the highlight (`step.highlight`) and the dashed ring (`step.point`); null = overview (nothing highlighted). */
  step: StoryStep | null;
  /** The chat chart's current per-chart overrides, so the stage wears the same look (template included). */
  overrides: PresentationOverrides;
}
// ChartView props gain: stage?: ChartStageMode
```
In stage mode `ChartView`: renders the heading + subtitle + the chart (`ChartFrame` + the export container + Recharts) + the provisional-marker note + the attribution line (R4 — the source sentence stays), and NOTHING else: no form tablist, no Style/Insights triggers, no Vanaf/Tot selects, no small-multiples/axis toggles, no notes (`pendingPoint` never set: pass `undefined` for `onPointClick`), no `ChartConfigPanel`, no `ChartStoryPanel`, no legend BUTTONS (the multi-series legend renders as plain `<span>` chips with swatches, no `aria-pressed`, no handlers), no footer actions (no `ChartDownloadMenu`, no proof/citation), no `frameClass` card (the stage supplies its own surface: `frameless` behaviour). Presentation: `resolvePresentation(ctx, stage.overrides, base)` — i.e. the stage's overrides replace `state.presentation`. Highlight/ring: an Effect `useEffect(() => { if (stage) dispatch({ type: 'setView', view: { hiddenKeys: new Set(), highlightedKey: stage.step?.highlight ?? null, periodRange: null } }); }, [stage?.step?.id])` — and the ring uses `stage.step?.point` where the compact story used `activeStoryStep?.point` (define `const ringStep = stage ? stage.step : activeStoryStep;` and use `ringStep` at the four `SeriesDot`/`SeriesBar` call sites). The form: `stage` uses the reducer's initial form (the spec's kind; never the table) — if the chat chart is on a non-default form the stage still shows the default form (v1 simplification, recorded in the ADR). Every Hook keeps being called unconditionally (put the new Effect next to the font Effect, above the schemaVersion guard).

- [ ] **Step 1: Write the failing tests** — add to `chart.test.tsx` a new describe:
```tsx
describe('ChartView stage mode (ADR 044) — chrome-less, driven by a step', () => {
  const s = threePointSpec();
  it('renders the chart, title, unit and attribution but no tabs, no triggers, no selects, no notes, no download', () => {
    const { container } = render(<ChartView spec={s} stage={{ step: null, overrides: {} }} />);
    expect(container.querySelector('svg.recharts-surface, .recharts-responsive-container')).not.toBeNull();
    expect(container.querySelector('[role="heading"][aria-level="3"]')?.textContent).toBe(s.title);
    expect(container.textContent).toContain(s.attributionLine);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Opmaak' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Inzichten' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('circle[data-point][role="button"]')).toBeNull();
  });
  it('the step drives the highlight and the dashed ring, and the stage wears the given overrides', () => {
    const step = { id: 'x', kind: 'recordHigh', title: 'Piek', caption: 'Piek in 2024', highlight: 's0', point: { seriesKey: 's0', periodCode: '2024JJ00' } } as StoryStep;
    const { container, rerender } = render(<ChartView spec={s} stage={{ step, overrides: { lineWidth: 'thick' } }} />);
    expect(container.querySelector('[data-story-marker]')).not.toBeNull();
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('3');
    rerender(<ChartView spec={s} stage={{ step: null, overrides: { lineWidth: 'thick' } }} />);
    expect(container.querySelector('[data-story-marker]')).toBeNull();
  });
  it('a multi-series stage shows legend chips, never legend buttons, and the whole card stays digit-free apart from spec strings', () => {
    const multi = twoSeriesSpec(); // reuse the file's multi-series fixture helper name
    const { container } = render(<ChartView spec={multi} stage={{ step: null, overrides: {} }} />);
    expect(container.querySelector('[role="group"] button')).toBeNull();
    expect(container.textContent).toContain(multi.series[0]!.label);
    // digit scan: copy the file's `scanForUnboundDigits(container, spec)` helper call used by the other scans
  });
});
```
  (Find the file's multi-series fixture and digit-scan helper names by reading the existing legend and scan tests; import `type StoryStep` from `'../lib/chart-story.ts'`.)

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run components/chart.test.tsx -t "stage mode"` → FAIL (no `stage` prop).

- [ ] **Step 3: Implement** in `chart.tsx`: the `ChartStageMode` interface (exported) and the `stage` prop; `const inStage = stage !== undefined;` right after the props; presentation resolution uses `inStage ? stage.overrides : state.presentation`; the step Effect (above the guard); `const ringStep = inStage ? stage.step : activeStoryStep;` and use `ringStep?.point` at the four call sites; gate with `!inStage` the tablist row (the whole `mt-3 flex …` header row), the zoom row, the small-multiples/axis toggles, the `ChartConfigPanel`/`ChartStoryPanel` mounts, the story-lock span, the notes (`pendingPoint` form + `ChartNotes`), the footer action row (keep the attribution `<p>` and `SourceBadge`, drop `ChartDownloadMenu`); `onPointClick` = `inStage ? undefined : (p) => setPendingPoint(p)` at the four call sites; the legend: `inStage ? <StageLegend seriesMeta={seriesMeta} /> : <SeriesLegend …/>` where `StageLegend` is a new small function in the same file rendering `<div role="list" aria-label={…seriesGroupLabel}>` of `<span role="listitem" class="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">` with the swatch and label; `frameClass` = `''` when `inStage`. Every gate is one `inStage` check; add ONE comment at the top of the component explaining stage mode (ADR 044) rather than a comment per gate.

- [ ] **Step 4: Run** — `cd web && npx vitest run components/chart.test.tsx` → all PASS (no existing test changes expected; if one breaks, it is a bug in the gating, not a pin to update).
- [ ] **Step 5: Typecheck** clean. **Commit**
```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): ChartView stage mode — chrome-less instance driven by a story step (ADR 044)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The stage overlay, strings, events
**Files:** Create `web/components/chart-story-stage.tsx`, `web/components/chart-story-stage.test.tsx`; modify `web/lib/i18n/messages.ts`, `src/chart/user-styles.ts`, `web/app/usage-actions.test.ts`

**Interfaces:**
```ts
export interface ChartStoryStageProps {
  open: boolean;
  spec: ChartSpec;
  steps: StoryStep[];
  index: number;
  onIndexChange(index: number): void;
  onClose(): void;
  /** Where focus returns on close. */
  triggerId: string;
  overrides: PresentationOverrides;
  lang?: Lang;
  /** Fired once each time auto-play is switched on. */
  onAutoplay?(): void;
}
export function ChartStoryStage(props: ChartStoryStageProps): ReactNode; // returns null when !open; otherwise createPortal(<dialog…>, document.body)
```
Strings (nl / en): `chart.stage.present` 'Presenteren' / 'Present'; `chart.stage.label` 'Presentatie van de inzichten' / 'Insights presentation'; `chart.stage.close` 'Sluiten' / 'Close'; `chart.stage.scrollHint` 'Scroll om verder te gaan' / 'Scroll to continue'; `chart.stage.autoplay` 'Automatisch afspelen' / 'Auto-play'; `chart.stage.stepsLabel` 'Stappen' / 'Steps'. Events: `stage_open`, `stage_autoplay` appended after the `template_*` events in `CHART_STYLE_EVENTS` and in both pinned lists of `usage-actions.test.ts`.

- [ ] **Step 1: Write the failing tests** — `web/components/chart-story-stage.test.tsx` (render inside the chart's providers if the file's neighbours need them — check how `chart-story.test.tsx` renders): open → a `role="dialog"` with `aria-modal="true"` exists in `document.body`, is focused, has one panel per step with the step's title and caption, the first panel `aria-current="step"`; Escape → `onClose` called and focus returns to `#triggerId`; ArrowRight → `onIndexChange(1)`; the dots (buttons named by step title) call `onIndexChange`; the auto-play toggle is `aria-pressed=false` by default, pressing it calls `onAutoplay` once and, with fake timers, advances `onIndexChange` after `STAGE_AUTOPLAY_MS`, stops at the last step, and any ArrowKey switches it off; `document.body.style.overflow` is `'hidden'` while open and restored on unmount; the whole dialog's text nodes carry no digit that is not in the spec's strings (reuse the digit-scan helper from `chart.test.tsx` or inline the same walker); `prefers-reduced-motion` (stub `matchMedia`) → the chart plane wrapper has `transform` = the flat resting transform.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `web/components/chart-story-stage.tsx`:
```tsx
'use client';
// ADR 044: the Story stage — the Insights story as a full-viewport,
// scroll-driven presentation. A portal for POSITION only: open/index live in
// ChartView (like the compact panel). The chart is a second, chrome-less
// ChartView (stage mode) driven by the active step; every animated property
// is a transform/opacity on a wrapper OUTSIDE the exported svg (there is no
// export here anyway). Zero libraries: CSS 3D + useStageScroll.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ChartSpec } from '../backend/chart/types.ts';
import { captionStyle, entranceStyle, spotlightStyle, STAGE_AUTOPLAY_MS } from '../lib/chart-stage.ts';
import type { PresentationOverrides } from '../lib/chart-presentation.ts';
import type { StoryStep } from '../lib/chart-story.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { useStageScroll } from '../lib/use-stage-scroll.ts';
import { ChartView } from './chart.tsx';
import { Button } from './ui/button.tsx';

export interface ChartStoryStageProps {
  open: boolean;
  spec: ChartSpec;
  steps: StoryStep[];
  index: number;
  onIndexChange(index: number): void;
  onClose(): void;
  triggerId: string;
  overrides: PresentationOverrides;
  lang?: Lang;
  onAutoplay?(): void;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!mq) return undefined;
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

export function ChartStoryStage({ open, spec, steps, index, onIndexChange, onClose, triggerId, overrides, lang = 'nl', onAutoplay }: ChartStoryStageProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const reduced = useReducedMotion();
  const scroll = useStageScroll(scrollRef, panelRefs, steps.length, open);
  const [autoplay, setAutoplay] = useState(false);
  const [spot, setSpot] = useState<{ left: string; top: string } | null>(null);
  const last = steps.length - 1;
  const step = steps[index] ?? null;

  // Scroll position → step index (the hook only reports; the owner of the index is ChartView).
  useEffect(() => {
    if (open && scroll.index !== index) onIndexChange(scroll.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the hook's index only
  }, [scroll.index]);

  // Open: focus the dialog, lock the page scroll; close: restore both.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Spotlight: read the ringed marker ONCE per step change (never per frame).
  useLayoutEffect(() => {
    if (!open) return;
    const box = chartBoxRef.current;
    const ring = box?.querySelector<SVGCircleElement | SVGRectElement>('[data-story-marker]');
    if (!box || !ring) {
      setSpot(null);
      return;
    }
    const b = box.getBoundingClientRect();
    const r = ring.getBoundingClientRect();
    setSpot(spotlightStyle({ cx: r.left + r.width / 2 - b.left, cy: r.top + r.height / 2 - b.top }, { width: b.width, height: b.height }));
  }, [open, step?.id]);

  // Auto-play: advance every STAGE_AUTOPLAY_MS, stop at the end.
  useEffect(() => {
    if (!open || !autoplay) return undefined;
    if (index >= last) {
      setAutoplay(false);
      return undefined;
    }
    const id = setTimeout(() => go(index + 1), STAGE_AUTOPLAY_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is stable per render for this purpose
  }, [open, autoplay, index, last]);

  function go(next: number): void {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === index) return;
    onIndexChange(clamped);
    const panel = panelRefs.current[clamped];
    if (panel && typeof panel.scrollIntoView === 'function') {
      scroll.beginProgrammatic();
      panel.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  function closeAndRefocus(): void {
    setAutoplay(false);
    onClose();
    document.getElementById(triggerId)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRefocus();
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setAutoplay(false);
      go(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1));
    }
  }

  function toggleAutoplay(): void {
    setAutoplay((on) => {
      if (!on) onAutoplay?.();
      return !on;
    });
  }

  if (!open || typeof document === 'undefined') return null;

  // The entry tilt runs over the FIRST step's progress only; from step two on the plane is flat.
  const entry = entranceStyle(index === 0 ? scroll.progress : 1, reduced);
  const chartOverrides = overrides;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${t(lang, 'chart.stage.label')}: ${spec.title}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 bg-background text-foreground outline-none"
      data-story-stage="true"
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <button
          type="button"
          aria-pressed={autoplay}
          onClick={toggleAutoplay}
          className="min-h-6 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted aria-pressed:bg-secondary"
        >
          {t(lang, 'chart.stage.autoplay')}
        </button>
        <Button type="button" variant="ghost" size="sm" aria-label={t(lang, 'chart.stage.close')} onClick={closeAndRefocus}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div ref={scrollRef} className="h-full overflow-y-auto touch-pan-y lg:grid lg:grid-cols-[55%_45%]">
        {/* The pinned chart: sticky at the top of the scroller, the plane tilted on entry. */}
        <div className="sticky top-0 z-0 flex h-[45vh] items-center bg-background px-4 lg:h-screen lg:px-10">
          <div
            className="relative w-full rounded-xl bg-card p-4 text-card-foreground transition-[box-shadow] duration-300"
            style={{ transform: entry.transform, boxShadow: entry.boxShadow, transformStyle: 'preserve-3d', willChange: 'transform' }}
            data-stage-plane="true"
          >
            <div ref={chartBoxRef} className="relative">
              <ChartView spec={spec} stage={{ step, overrides: chartOverrides }} />
              {spot && !reduced ? (
                <div
                  aria-hidden="true"
                  data-stage-spotlight="true"
                  className="pointer-events-none absolute inset-0 rounded-lg"
                  style={{ background: `radial-gradient(circle at ${spot.left} ${spot.top}, transparent 0, transparent 22%, color-mix(in oklab, var(--card) 55%, transparent) 60%)` }}
                />
              ) : null}
            </div>
          </div>
        </div>
        {/* The steps: one full-height panel each; the scroll position picks the step. */}
        <div className="px-4 pb-[40vh] lg:px-10 lg:pt-[20vh]">
          <p className="mb-2 text-xs text-muted-foreground">{t(lang, 'chart.stage.scrollHint')}</p>
          <ol aria-label={t(lang, 'chart.stage.stepsLabel')} className="m-0 list-none p-0">
            {steps.map((s, i) => {
              const distance = i === index ? (i === last ? 0 : scroll.progress) : i === index + 1 ? 1 - scroll.progress : 1;
              const style = captionStyle(distance, reduced);
              return (
                <li
                  key={s.id}
                  ref={(el) => {
                    panelRefs.current[i] = el;
                  }}
                  data-stage-step={i}
                  aria-current={i === index ? 'step' : undefined}
                  className="flex min-h-[85vh] flex-col justify-center"
                >
                  <div className="max-w-md rounded-lg border border-border bg-card p-4" style={style}>
                    <p className="text-base font-semibold text-foreground">{s.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{s.caption}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {/* Position dots — never "N of M". */}
      <ol aria-label={t(lang, 'chart.stage.stepsLabel')} className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button type="button" aria-label={s.title} aria-current={i === index ? 'step' : undefined} onClick={() => { setAutoplay(false); go(i); }} className="flex size-6 items-center justify-center">
              <span className={'block size-2.5 rounded-full ' + (i === index ? 'bg-foreground' : 'bg-border hover:bg-muted-foreground')} />
            </button>
          </li>
        ))}
      </ol>
    </div>,
    document.body,
  );
}
```
  Note `color-mix()` in the vignette: supported in every current browser; fine as an inline style. The `aria-label` composes the catalogue string with the spec title (a spec string — no new digits).

- [ ] **Step 4: Run** the stage tests + `app/usage-actions.test.ts` + root `tests/chart/user-styles.test.ts` → PASS; typecheck clean.
- [ ] **Step 5: Commit**
```bash
git add web/components/chart-story-stage.tsx web/components/chart-story-stage.test.tsx web/lib/i18n/messages.ts src/chart/user-styles.ts web/app/usage-actions.test.ts
git commit -m "feat(chart): the Story stage overlay — scroll-driven steps, entry tilt, spotlight, auto-play toggle (ADR 044)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Present button and wiring
**Files:** Modify `web/components/chart-story.tsx` (+ `.test.tsx`), `web/components/chart.tsx` (+ `.test.tsx`)

- `ChartStoryPanel` gains `onPresent?(): void` and, when given, renders `<Button type="button" variant="outline" size="sm" id={`${idPrefix}-story-present`} onClick={onPresent}>{t(lang, 'chart.stage.present')}</Button>` between Volgende and the dots.
- `chart.tsx`: `const [stageOpen, setStageOpen] = useState(false);` (above the guard); `openStage()` → `setStageOpen(true); trackChartStyleEvent('stage_open')`; `closeStage()` → `setStageOpen(false)`; closing the compact story (`closeStory`) also closes the stage; a spec swap closes the stage (add to the spec-identity reset block); `<ChartStoryStage open={stageOpen} spec={spec} steps={storySteps} index={storyIndex} onIndexChange={onStoryIndexChange} onClose={closeStage} triggerId={`${domId}-story-present`} overrides={state.presentation} lang={chartLang} onAutoplay={() => trackChartStyleEvent('stage_autoplay')} />` mounted next to the compact panel (never inside `chartContainerRef`), only when `storyAvailable`; the compact `ChartStoryPanel` gets `onPresent={openStage}`. Not in stage mode itself (a stage never opens a stage: pass `onPresent` only when `!inStage`).
- Tests: `chart-story.test.tsx` — the Present button renders only with `onPresent` and calls it; `chart.test.tsx` — open Insights, click Presenteren → a `role="dialog"` appears in `document.body` with the same step titles as the compact panel, the compact panel's index and the stage's `aria-current` step agree after ArrowRight in the dialog, Escape closes it and focus returns to the Present button; the counter records `stage_open`; the whole-card digit scan runs over `document.body` with the stage open (Dutch and English).

- [ ] Steps: tests first (RED), implement, GREEN, both typechecks, commit:
```bash
git add web/components/chart-story.tsx web/components/chart-story.test.tsx web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): Present button opens the Story stage; shared index, close, counter (ADR 044)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the tasks (controller)
1. Whole-branch review (top tier): honesty across tilt/spotlight (transforms outside the svg; R11 ring visible in the stage), the second-instance state isolation, focus/scroll-lock/Escape, reduced motion, phone layout, the digit scan over `document.body`.
2. Verification block; a REAL browser pass on the dev server (the Browser pane + the `resize` trick): open Insights → Present, scroll through, both themes, 1280 and 375 px; screenshots for the PR.
3. Docs: ADR 044, huisstijl, build plan (phase 3 row), architecture, open-questions, STATUS/archive/lessons; PR stacked on `visual-templates-v1`.
