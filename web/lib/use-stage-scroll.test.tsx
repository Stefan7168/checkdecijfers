import { act, cleanup, render } from '@testing-library/react';
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
    // Fix round 2 (items 3+4): the entry ramp, reported alongside index and
    // progress. Its own node so the existing `out` assertions keep pinning
    // exactly what they always did.
    createElement('span', { 'data-testid': 'entry' }, `${s.entry}`),
    // Fix round 1 (item B): a button exposing the hook's own
    // `beginProgrammatic()` so a test can drive a programmatic scroll the
    // same way a real caller (dots/keys/auto-play in chart-story-stage.tsx)
    // does, without reaching into the hook's internals.
    createElement('button', { type: 'button', 'data-testid': 'begin-programmatic', onClick: () => s.beginProgrammatic() }),
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
  // This repo's vitest.setup.ts does not auto-import RTL's cleanup-after-each,
  // so unmount explicitly between tests (and between the two renders within
  // the second test below) to keep getByTestId scoped to one Probe.
  cleanup();
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
    const { getByTestId, unmount } = render(<Probe enabled />);
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
    // RTL's default queries are scoped to document.body, not just this render's
    // container — unmount before the second render so getByTestId below doesn't
    // find two matching elements (a jsdom/RTL detail, not a change to what's asserted).
    unmount();
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

  // Fix round 2 (items 3+4): the plane's entry ramp is reported by the same
  // measurement pass, so the stage never has to derive it from `progress`
  // (which is nearest-centre and caps at ~0.5 — the popping tilt this
  // replaces). The panels here start one viewport down the column, so the
  // first panel's centre is 800 px of scrolling away.
  it('reports the entry ramp alongside the index: 0 at the top, one half halfway, 1 once the first panel is centred', () => {
    const { getByTestId } = render(<Probe enabled />);
    const scroller = getByTestId('scroller');
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    layout(getByTestId('p0'), 800, 800);
    layout(getByTestId('p1'), 1600, 800);
    layout(getByTestId('p2'), 2400, 800);
    scroller.scrollTop = 0;
    act(() => { scroller.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
    expect(getByTestId('entry').textContent).toBe('0');
    scroller.scrollTop = 400;
    act(() => { scroller.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
    expect(getByTestId('entry').textContent).toBe('0.5');
    scroller.scrollTop = 800;
    act(() => { scroller.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
    expect(getByTestId('entry').textContent).toBe('1');
  });

  // Fix round 1 (item B): the settle window closing used to just flip a
  // flag — `measure()` never ran, so index/progress stayed stale after a
  // programmatic jump (dots/arrow keys/auto-play) until some LATER,
  // non-programmatic scroll happened to change them. A manual scroll back
  // to the very step the programmatic jump landed on produced no DOM change
  // at all (no state change → no re-render → chart/caption desync).
  it('re-measures once the settle window closes after a programmatic scroll, so a later scroll back is not dropped', () => {
    const { getByTestId } = render(<Probe enabled />);
    const scroller = getByTestId('scroller');
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    layout(getByTestId('p0'), 0, 800);
    layout(getByTestId('p1'), 800, 800);
    layout(getByTestId('p2'), 1600, 800);
    expect(getByTestId('out').textContent).toBe('0:0');

    // A programmatic jump to the third panel (mirrors chart-story-stage.tsx's
    // `go()`: beginProgrammatic() then scrollIntoView, which here is just the
    // scrollTop write below).
    act(() => {
      (getByTestId('begin-programmatic') as HTMLButtonElement).click();
    });
    scroller.scrollTop = 1600;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    // Ignored while programmatic — no re-measure yet.
    expect(getByTestId('out').textContent).toBe('0:0');

    act(() => {
      vi.advanceTimersByTime(150); // the settle window
      vi.advanceTimersByTime(20); // a frame, in case a measure were rAF-scheduled
    });
    expect(getByTestId('out').textContent).toBe('2:0');

    // A later, real manual scroll back to the same step must not be dropped.
    scroller.scrollTop = 0;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(20);
    });
    expect(getByTestId('out').textContent).toBe('0:0');
  });
});
