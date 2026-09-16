import { act, cleanup, render } from '@testing-library/react';
import { createElement, StrictMode, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElementWidth } from './use-element-width.ts';

// NB: this file keeps the brief's `.ts` (not `.tsx`) extension, so the probe
// component below is built with `createElement` rather than JSX syntax —
// this project's vite/oxc transform only enables JSX parsing for `.tsx`
// files, and a `.ts` file with inline JSX fails to parse. Same component,
// same assertions, no functional difference from the brief's snippet.
type Callback = (entries: { target: Element }[]) => void;
let callbacks: Callback[] = [];
// #234's regression tests need to see WHICH element each live observer is
// watching (the original bare `callbacks` array can't distinguish "still
// watching the old node" from "reattached to the new one") — `instances`
// tracks that, alongside `callbacks` which every pre-existing test still
// reads directly.
let instances: { cb: Callback; target: Element | null; disconnected: boolean }[] = [];
class FakeResizeObserver {
  private readonly entry: { cb: Callback; target: Element | null; disconnected: boolean };
  constructor(private readonly cb: Callback) {
    callbacks.push(cb);
    this.entry = { cb, target: null, disconnected: false };
    instances.push(this.entry);
  }
  observe(target: Element): void {
    this.entry.target = target;
  }
  disconnect(): void {
    callbacks = callbacks.filter((c) => c !== this.cb);
    this.entry.disconnected = true;
  }
}

function Probe({ enabled, width }: { enabled: boolean; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(ref, enabled);
  return createElement('div', { ref, 'data-testid': 'box', 'data-fake-width': width }, measured);
}

/** #234, trigger path 1 (schema-refusal null → element): the ref stays
 * `null` until `attach` flips true, `enabled` never changes. */
function NullableProbe({ attach, width }: { attach: boolean; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(ref, true);
  return createElement(
    'div',
    { 'data-testid': 'shell' },
    attach ? createElement('div', { ref, 'data-testid': 'box', 'data-fake-width': width }) : null,
    String(measured),
  );
}

/** #234, trigger path 2 (Frame Inset reparenting): the SAME ref lands on a
 * genuinely different DOM node once `wrapped` flips, without the component
 * itself ever unmounting — mirrors chart-frame.tsx's own inset toggle,
 * where an inline conditional wrapper div appearing around the ref'd
 * element (with Frame Aspect left at 'Auto') makes React reuse the outer
 * DOM node for the new wrapper and mount the ref'd div fresh one level
 * in, rather than moving the existing node. */
function ReparentProbe({ wrapped, width }: { wrapped: boolean; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(ref, true);
  const box = createElement('div', { ref, 'data-testid': 'box', 'data-fake-width': width }, String(measured));
  return wrapped ? createElement('div', { 'data-testid': 'wrapper' }, box) : box;
}

// This project doesn't set vitest's `globals: true` (see vitest.config.ts),
// so Testing Library's own auto-cleanup-after-each never registers —
// chart.test.tsx's `afterEach(cleanup)` is the repo's standing pattern,
// mirrored here.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  callbacks = [];
  instances = [];
});

describe('useElementWidth', () => {
  it('is 0 without a ResizeObserver (jsdom, SSR) and when disabled', () => {
    const { getByTestId } = render(createElement(Probe, { enabled: true, width: 700 }));
    expect(getByTestId('box').textContent).toBe('0');
    // Unmount the first probe before mounting the second — both render
    // into `document.body`, and the default (unscoped) `getByTestId` below
    // would otherwise match both boxes at once.
    cleanup();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const disabled = render(createElement(Probe, { enabled: false, width: 700 }));
    expect(disabled.getByTestId('box').textContent).toBe('0');
    expect(callbacks.length).toBe(0);
  });
  it('reports the observed border-box width and ignores sub-pixel jitter', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { getByTestId } = render(createElement(Probe, { enabled: true, width: 700 }));
    const box = getByTestId('box');
    box.getBoundingClientRect = () => ({ width: 700 }) as DOMRect;
    act(() => callbacks[0]!([{ target: box }]));
    expect(box.textContent).toBe('700');
    box.getBoundingClientRect = () => ({ width: 700.3 }) as DOMRect;
    act(() => callbacks[0]!([{ target: box }]));
    expect(box.textContent).toBe('700');
    box.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
    act(() => callbacks[0]!([{ target: box }]));
    expect(box.textContent).toBe('400');
  });

  // #234, trigger path 1: a schema-refusal render followed by a spec swap
  // on the same mounted instance — `ref.current` goes null → an element
  // while `enabled` never changes, so a `[ref, enabled]`-keyed effect would
  // never re-fire and the chart would stay stuck at its unmeasured floor.
  it('attaches once ref.current transitions from null to an element, with enabled unchanged', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { getByTestId, rerender } = render(createElement(NullableProbe, { attach: false, width: 700 }));
    expect(instances.length).toBe(0);
    rerender(createElement(NullableProbe, { attach: true, width: 700 }));
    expect(instances.length).toBe(1);
    expect(instances[0]!.target).toBe(getByTestId('box'));
    expect(instances[0]!.disconnected).toBe(false);
  });

  // #234, trigger path 2: chart-frame.tsx's Frame Inset toggle (Frame Aspect
  // left at 'Auto') reparents the ref'd node one level up or down without
  // ever unmounting the component — the ResizeObserver must follow it to
  // the NEW node and disconnect from the stale one, not silently keep
  // watching a detached element forever.
  it('disconnects the stale observer and reattaches to the new node when the ref is reparented', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { getByTestId, rerender } = render(createElement(ReparentProbe, { wrapped: false, width: 700 }));
    const firstBox = getByTestId('box');
    expect(instances.length).toBe(1);
    expect(instances[0]!.target).toBe(firstBox);

    rerender(createElement(ReparentProbe, { wrapped: true, width: 700 }));
    const secondBox = getByTestId('box');
    // The reparenting actually happened — otherwise this test would prove
    // nothing about the bug it targets.
    expect(secondBox).not.toBe(firstBox);
    expect(instances[0]!.disconnected).toBe(true);
    expect(instances.length).toBe(2);
    expect(instances[1]!.target).toBe(secondBox);
    expect(instances[1]!.disconnected).toBe(false);

    // And the reverse direction (wrapped → unwrapped) — the row's own text
    // says both directions of the toggle hit this, not just one.
    rerender(createElement(ReparentProbe, { wrapped: false, width: 700 }));
    const thirdBox = getByTestId('box');
    expect(thirdBox).not.toBe(secondBox);
    expect(instances[1]!.disconnected).toBe(true);
    expect(instances.length).toBe(3);
    expect(instances[2]!.target).toBe(thirdBox);
    expect(instances[2]!.disconnected).toBe(false);
  });

  // A near-miss found while fixing #234, not asked for by the row itself:
  // Next.js's own default is React StrictMode ON in development, which
  // mounts every component twice (run effects, clean them up, run again) as
  // a diagnostic. An earlier version of the fix above disconnected the
  // observer on that simulated unmount without also resetting `observedRef`
  // — so the simulated remount's poll effect saw "nothing changed" and
  // never created a replacement, permanently stuck watching nothing for the
  // rest of the component's REAL lifetime. This renders under an actual
  // `<StrictMode>` wrapper (not simulated by hand) so a regression here
  // fails for the same reason the real bug would have.
  it('still ends up watching the element after a real StrictMode double-mount', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { getByTestId } = render(createElement(StrictMode, null, createElement(Probe, { enabled: true, width: 700 })));
    const box = getByTestId('box');
    const live = instances.filter((i) => !i.disconnected);
    expect(live.length).toBe(1);
    expect(live[0]!.target).toBe(box);
    // And it still actually reports measurements, not just "an observer
    // exists somewhere" — the live one must be the one whose callback fires.
    box.getBoundingClientRect = () => ({ width: 555 }) as DOMRect;
    act(() => live[0]!.cb([{ target: box }]));
    expect(box.textContent).toBe('555');
  });
});
