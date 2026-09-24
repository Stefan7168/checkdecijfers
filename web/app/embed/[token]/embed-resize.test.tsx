// Session 110 (embed auto-resize): EmbedResize posts this page's own
// rendered height to its host page via postMessage, so the snippet's inline
// listener (chart-embed-dialog.test.tsx's own pinned-snippet test) can
// resize the <iframe> to fit. jsdom has no real ResizeObserver, so it's
// stubbed here (mirrors the vitest-standard shape for this class of
// browser-only API — no existing precedent in this repo to follow, since
// this is the first ResizeObserver use).
import { act, cleanup, render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbedResize } from './embed-resize.tsx';

/** A minimal ResizeObserver stub: records what it observed, and exposes its
 * own constructor callback so a test can trigger it manually to simulate a
 * real resize (nothing in jsdom ever fires one on its own). */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
}

function stubResizeObserver() {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
}

/** window.parent is a read-only, non-configurable-by-default accessor on
 * jsdom's Window in a top-level document (parent === window) — this
 * replaces it with a plain, writable stand-in object carrying a spy
 * postMessage, so the component sees "inside an iframe" and the test can
 * assert exactly what was posted. Restored in afterEach. */
function stubAsIframe() {
  const postMessage = vi.fn();
  const fakeParent = { postMessage } as unknown as Window;
  Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true });
  return postMessage;
}

async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Restore window.parent to jsdom's own default (top-level document: parent
  // === window) so it never leaks into a later test file's module state.
  Object.defineProperty(window, 'parent', { value: window, configurable: true });
});

describe('EmbedResize', () => {
  it('does nothing when not inside an iframe (window.parent === window)', async () => {
    stubResizeObserver();
    const postMessage = vi.fn();
    vi.spyOn(window, 'postMessage').mockImplementation(postMessage as never);

    render(<EmbedResize />);
    await flushFrame();

    expect(postMessage).not.toHaveBeenCalled();
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it('posts the height message to window.parent on mount when inside an iframe', async () => {
    stubResizeObserver();
    const postMessage = stubAsIframe();
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 842, configurable: true });

    render(<EmbedResize />);
    await flushFrame();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'checkdecijfers:embed-height', height: 842 }, '*');
  });

  it('observes document.documentElement so a later resize re-posts the new height', async () => {
    stubResizeObserver();
    const postMessage = stubAsIframe();
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 300, configurable: true });

    render(<EmbedResize />);
    await flushFrame();
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'checkdecijfers:embed-height', height: 300 }, '*');

    const [observer] = FakeResizeObserver.instances;
    expect(observer.observe).toHaveBeenCalledWith(document.documentElement);

    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 500, configurable: true });
    act(() => {
      observer.callback([], observer as unknown as ResizeObserver);
    });
    await flushFrame();

    expect(postMessage).toHaveBeenLastCalledWith({ type: 'checkdecijfers:embed-height', height: 500 }, '*');
  });

  it('debounces several resize-observer callbacks firing before the next frame into a single message', async () => {
    stubResizeObserver();
    const postMessage = stubAsIframe();
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 100, configurable: true });

    render(<EmbedResize />);
    await flushFrame();
    postMessage.mockClear();

    const [observer] = FakeResizeObserver.instances;
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 200, configurable: true });
    act(() => {
      observer.callback([], observer as unknown as ResizeObserver);
      observer.callback([], observer as unknown as ResizeObserver);
      observer.callback([], observer as unknown as ResizeObserver);
    });
    await flushFrame();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'checkdecijfers:embed-height', height: 200 }, '*');
  });

  it('disconnects the observer and removes the load listener on unmount', async () => {
    stubResizeObserver();
    stubAsIframe();
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 100, configurable: true });

    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<EmbedResize />);
    await flushFrame();

    const [observer] = FakeResizeObserver.instances;
    unmount();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith('load', expect.any(Function));
  });

  // Deliberately mounted ONLY under the public embed routes — a general
  // chat/dock chart is never inside an iframe, so it has no business posting
  // a resize message to a "parent" that doesn't exist. A grep-shaped test
  // rather than an import-graph assertion: cheap, exact, and fails loudly
  // the moment any OTHER app/ route starts importing this module, without
  // needing to render every route to prove a negative.
  //
  // ADR 057 (session 127), Task 5: web/app/embed/own/[publicId]/page.tsx —
  // the own-data twin of this route, also a real public iframe target — is
  // now a second sanctioned importer, per this task's own brief ("EmbedResize
  // from web/app/embed/[token]/embed-resize.tsx"). Reusing the ONE
  // component (never a copy) keeps the auto-resize postMessage contract
  // identical across both embed tiers; the exclusion below is scoped to
  // exactly that one sibling directory, not to `app/` at large.
  it('is imported only under web/app/embed/[token]/ and web/app/embed/own/ (this file itself the sole exception)', () => {
    const appDir = join(import.meta.dirname, '..', '..'); // .../web/app
    const thisDir = import.meta.dirname; // .../web/app/embed/[token]
    const ownEmbedDir = join(import.meta.dirname, '..', 'own'); // .../web/app/embed/own

    function collect(dir: string): string[] {
      let files: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(collect(full));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          files.push(full);
        }
      }
      return files;
    }

    // C2: "inside this directory", never a bare prefix — a bare startsWith
    // would also exempt a SIBLING whose name merely begins the same way
    // (e.g. a future web/app/embed/own-drafts/), silently widening the
    // sanctioned set. Pinned by the sanity check right below.
    const isUnder = (dir: string, file: string): boolean => file.startsWith(dir + sep);
    expect(isUnder(ownEmbedDir, `${ownEmbedDir}-drafts${sep}page.tsx`)).toBe(false);
    expect(isUnder(ownEmbedDir, join(ownEmbedDir, '[publicId]', 'page.tsx'))).toBe(true);

    const offenders = collect(appDir).filter((file) => {
      if (isUnder(thisDir, file)) return false; // the component + this test itself
      if (isUnder(ownEmbedDir, file)) return false; // ADR 057 Task 5's own sanctioned importer
      return readFileSync(file, 'utf8').includes('embed-resize');
    });

    expect(offenders).toEqual([]);
  });
});
