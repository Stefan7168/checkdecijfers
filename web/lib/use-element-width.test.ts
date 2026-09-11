import { act, cleanup, render } from '@testing-library/react';
import { createElement, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElementWidth } from './use-element-width.ts';

// NB: this file keeps the brief's `.ts` (not `.tsx`) extension, so the probe
// component below is built with `createElement` rather than JSX syntax —
// this project's vite/oxc transform only enables JSX parsing for `.tsx`
// files, and a `.ts` file with inline JSX fails to parse. Same component,
// same assertions, no functional difference from the brief's snippet.
type Callback = (entries: { target: Element }[]) => void;
let callbacks: Callback[] = [];
class FakeResizeObserver {
  constructor(private readonly cb: Callback) { callbacks.push(cb); }
  observe(): void {}
  disconnect(): void { callbacks = callbacks.filter((c) => c !== this.cb); }
}

function Probe({ enabled, width }: { enabled: boolean; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(ref, enabled);
  return createElement('div', { ref, 'data-testid': 'box', 'data-fake-width': width }, measured);
}

// This project doesn't set vitest's `globals: true` (see vitest.config.ts),
// so Testing Library's own auto-cleanup-after-each never registers —
// chart.test.tsx's `afterEach(cleanup)` is the repo's standing pattern,
// mirrored here.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
});
