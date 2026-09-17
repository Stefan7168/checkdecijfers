'use client';

import { useEffect } from 'react';

// Session 110 (embed auto-resize, ADR 041 session-110 addendum): the embed
// page's own document now grows with its content (web/app/layout.tsx's
// isEmbedRoute-conditional min-h-dvh body, commit 080dbd4) — this component
// is what tells the HOST page how tall that content actually is, so the
// snippet's own inline <script> (chart-embed-dialog.tsx's buildEmbedCode)
// can resize the <iframe> to fit. The iframe's `height="680"` attribute
// (EMBED_DEFAULT_HEIGHT_PX) stays the no-JS/blocked-script fallback; this is
// the mechanism that makes it unnecessary for a chart whose content differs
// from the measured default (markers, a long definitionLine, a footer that
// wraps to two lines on a narrow host).
//
// One-way, minimal payload by design (HARD LIMIT): this component NEVER
// listens for inbound `message` events, and posts nothing but a plain
// number — no chart data, no token, no anything the host page didn't
// already have (it already has this exact iframe's `src`). The
// `targetOrigin` is `'*'` because a public embed's host page origin is
// unknown by design — any third-party site can paste the snippet, there is
// no allowlist of hosts to name here — and `'*'` is safe precisely because
// the payload carries nothing confidential, only a height in pixels.
//
// Lives ONLY under web/app/embed/[token]/ (not e.g. web/components/) so a
// non-embed route can never accidentally import and mount it — pinned by
// this file's own co-located test plus a grep check in page.test.tsx.
export function EmbedResize() {
  useEffect(() => {
    // Not inside an iframe (e.g. a direct visit to the embed URL, or this
    // component rendered in a test with no parent frame) — nothing to
    // resize, and nothing to post.
    if (window.parent === window) return;

    // Debounced to at most one message per animation frame: the
    // ResizeObserver callback, the `load` event and the fonts-ready promise
    // below can all fire in quick succession around initial mount, and
    // multiple rAF-coalesced DOM mutations must not turn into a flood of
    // postMessage calls.
    let scheduled = false;
    function postHeight() {
      scheduled = false;
      const height = document.documentElement.scrollHeight;
      window.parent.postMessage({ type: 'checkdecijfers:embed-height', height }, '*');
    }
    function scheduleHeight() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(postHeight);
    }

    // Initial measurement — don't wait for a resize to happen first.
    scheduleHeight();

    // Late-loading images/iframes-within-the-chart (none today, but cheap
    // insurance) finishing after first paint can still grow the page.
    window.addEventListener('load', scheduleHeight);

    // The main mechanism: any DOM size change (data loads, a reading
    // toggle, a footer wrapping to a second line) re-measures automatically.
    const observer = new ResizeObserver(scheduleHeight);
    observer.observe(document.documentElement);

    // Web fonts swapping in after the ResizeObserver's own first callback
    // can still change wrapped-text height (the attribution/footer line is
    // the concrete case) — one more scheduled measurement once fonts
    // settle. `document.fonts` is undefined in some older/embedded
    // browsers and in jsdom by default; both are handled as a no-op.
    document.fonts?.ready?.then(scheduleHeight).catch(() => {});

    return () => {
      window.removeEventListener('load', scheduleHeight);
      observer.disconnect();
    };
  }, []);

  return null;
}
