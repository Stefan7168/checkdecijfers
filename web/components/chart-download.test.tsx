// #170(3): chart download-as-image. attributedSvgMarkup is tested directly
// against a hand-built SVG element (no Recharts/ResizeObserver setup needed —
// the WHOLE point of factoring it out of ChartDownloadMenu). The component
// itself is exercised only for its failure legs, mirroring StatCard's own
// test file (stat-card.test.tsx): jsdom has no real canvas or image
// decoding, so both reachable failure paths are pinned there, not re-proven
// here — this file additionally pins the chart-specific failure leg (no
// live <svg> under the container yet, e.g. Recharts not yet measured).
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attributedSvgMarkup,
  ChartDownloadMenu,
  framedSvgMarkup,
  gradientEndpoints,
  withLightThemeResolution,
  type FrameExportInput,
} from './chart-download.tsx';
import { STOCK_PRESENTATION, type FrameValues } from '../lib/chart-presentation.ts';

afterEach(cleanup);

function sampleSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  svg.setAttribute('width', '400');
  svg.setAttribute('height', '200');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '10');
  rect.setAttribute('height', '10');
  svg.appendChild(rect);
  return svg;
}

describe('attributedSvgMarkup', () => {
  it('bakes the attribution text into the returned markup', () => {
    const markup = attributedSvgMarkup(sampleSvg(), 'Bron: CBS StatLine, tabel 12345NED. checkdecijfers.nl');
    expect(markup).toContain('Bron: CBS StatLine, tabel 12345NED. checkdecijfers.nl');
  });

  it('grows the height to make room for the footer, width unchanged', () => {
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie');
    expect(markup).toContain('width="400"');
    expect(markup).toContain('height="224"');
    expect(markup).toContain('viewBox="0 0 400 224"');
  });

  it('preserves the original chart content (the source rect) in the clone', () => {
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie');
    expect(markup).toContain('<rect width="10" height="10"');
  });
});

describe('gradientEndpoints', () => {
  // CSS linear-gradient angle convention: 0deg = to top, 90deg = to right,
  // 135deg = towards bottom-right. Final-review fix: this is now the exact
  // CSS gradient-line formula in px (userSpaceOnUse), not the old 0..1
  // objectBoundingBox approximation — direction d = (sin a, -cos a), line
  // length L = |W sin a| + |H cos a|, centred on the box's own centre.
  it('0deg points to top: bottom-centre to top-centre', () => {
    expect(gradientEndpoints(0, 200, 100)).toEqual({ x1: 100, y1: 100, x2: 100, y2: 0 });
  });

  it('90deg on any WxH box: purely horizontal, vertically centred, from left edge to right edge', () => {
    for (const [w, h] of [[200, 100], [50, 300], [1, 1]]) {
      expect(gradientEndpoints(90, w, h)).toEqual({ x1: 0, y1: h / 2, x2: w, y2: h / 2 });
    }
  });

  it('135deg on a 200x100 box matches the CSS gradient-line formula computed independently', () => {
    const angleDeg = 135;
    const width = 200;
    const height = 100;
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const length = Math.abs(width * dx) + Math.abs(height * dy);
    const cx = width / 2;
    const cy = height / 2;
    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    const expected = {
      x1: round3(cx - (dx * length) / 2),
      y1: round3(cy - (dy * length) / 2),
      x2: round3(cx + (dx * length) / 2),
      y2: round3(cy + (dy * length) / 2),
    };
    expect(gradientEndpoints(angleDeg, width, height)).toEqual(expected);
  });

  it('180deg points to bottom: top-centre to bottom-centre', () => {
    expect(gradientEndpoints(180, 200, 100)).toEqual({ x1: 100, y1: 0, x2: 100, y2: 100 });
  });
});

describe('ChartDownloadMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  function stubUrlApi(): void {
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
  }

  it('offers both format options on click', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <div ref={ref}>
        <ChartDownloadMenu containerRef={ref} attributionText="attributie" filenameBase="checkdecijfers-12345NED" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.getByRole('menuitem', { name: 'Download als PNG' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download als SVG' })).toBeInTheDocument();
  });

  it('shows the failure message when no chart <svg> exists under the container yet', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <div ref={ref}>
        <ChartDownloadMenu containerRef={ref} attributionText="attributie" filenameBase="checkdecijfers-12345NED" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download als SVG' }));
    expect(screen.getByText('Downloaden lukte niet in deze browser.')).toBeInTheDocument();
  });

  it('downloads the SVG directly when a chart <svg> is present (no canvas needed)', () => {
    stubUrlApi();
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <div ref={ref}>
        {/* eslint-disable-next-line react/no-unknown-property */}
        <svg data-testid="chart-svg" width="400" height="200" />
        <ChartDownloadMenu containerRef={ref} attributionText="attributie" filenameBase="checkdecijfers-12345NED" />
      </div>,
    );
    expect(container.querySelector('[data-testid="chart-svg"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download als SVG' }));
    expect(screen.queryByText('Downloaden lukte niet in deze browser.')).toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('shows the failure message when the SVG download throws (e.g. no URL.createObjectURL)', () => {
    // Deliberately do NOT stub URL.createObjectURL: jsdom's real URL has no
    // such method, so triggerDownload throws synchronously inside the try
    // block downloadSvg wraps its body in.
    const ref = createRef<HTMLDivElement>();
    render(
      <div ref={ref}>
        {/* eslint-disable-next-line react/no-unknown-property */}
        <svg data-testid="chart-svg" width="400" height="200" />
        <ChartDownloadMenu containerRef={ref} attributionText="attributie" filenameBase="checkdecijfers-12345NED" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download als SVG' }));
    expect(screen.getByText('Downloaden lukte niet in deze browser.')).toBeInTheDocument();
  });

  it('shows the failure message when no canvas 2d context is available for PNG (the jsdom leg)', async () => {
    stubUrlApi();
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const ref = createRef<HTMLDivElement>();
    render(
      <div ref={ref}>
        {/* eslint-disable-next-line react/no-unknown-property */}
        <svg data-testid="chart-svg" width="400" height="200" />
        <ChartDownloadMenu containerRef={ref} attributionText="attributie" filenameBase="checkdecijfers-12345NED" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download als PNG' }));
    // jsdom's canvas.getContext('2d') returns null -> the guarded branch.
    expect(await screen.findByText('Downloaden lukte niet in deze browser.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// #197 step 1 (session 69) — the menu that shipped as #170(3) was the app's
// first disclosure control and came with none of the ARIA that pattern needs;
// and its export serialized `var(--token)` paint that no standalone file can
// resolve. Both pinned here.
// ---------------------------------------------------------------------------

describe('ChartDownloadMenu — accessibility (#197)', () => {
  function renderMenu() {
    const ref = createRef<HTMLDivElement>();
    return render(
      <div>
        <button type="button">elders</button>
        <div ref={ref}>
          <svg data-testid="chart-svg" width="400" height="200" />
          <ChartDownloadMenu containerRef={ref} attributionText="attributie" filenameBase="checkdecijfers-12345NED" />
        </div>
      </div>,
    );
  }

  it('exposes the trigger as a menu button whose aria-expanded tracks the open state and aria-controls names the menu', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Download' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('moves focus into the menu on open, and closes on Escape with focus back on the trigger', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Download' });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Download als PNG' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the pointer goes down anywhere outside it', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elders' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('announces a failed download as an alert instead of silently colouring a span', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <div ref={ref}>
        <ChartDownloadMenu containerRef={ref} attributionText="attributie" filenameBase="checkdecijfers-12345NED" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download als SVG' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Downloaden lukte niet in deze browser.');
  });
});

describe('attributedSvgMarkup — paint survives leaving the page (#197)', () => {
  it('replaces var(--token) and currentColor paint with the computed colour, so the standalone file is not blank', () => {
    const svg = sampleSvg();
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke', 'var(--series-1)');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('stroke', 'currentColor');
    dot.setAttribute('fill', 'white');
    svg.appendChild(dot);
    const markup = attributedSvgMarkup(svg, 'attributie', () => ({ stroke: 'rgb(30, 64, 175)', fill: 'none' }));
    expect(markup).not.toContain('var(--');
    expect(markup).not.toContain('currentColor');
    expect(markup).toContain('stroke="rgb(30, 64, 175)"');
    // Literal paint the source already had is left exactly as it was.
    expect(markup).toContain('fill="white"');
  });

  it('leaves the markup untouched when the resolver has nothing to offer', () => {
    // (jsdom's own getComputedStyle is NOT this case: it answers SVG paint
    // with made-up defaults, so the default resolver is exercised only for
    // "does not throw" here — its real behaviour needs a browser.)
    const svg = sampleSvg();
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke', 'var(--series-1)');
    svg.appendChild(path);
    expect(attributedSvgMarkup(svg, 'attributie', () => null)).toContain('stroke="var(--series-1)"');
    expect(attributedSvgMarkup(svg, 'attributie', () => ({ stroke: '', fill: 'var(--x)' }))).toContain(
      'stroke="var(--series-1)"',
    );
    expect(() => attributedSvgMarkup(svg, 'attributie')).not.toThrow();
  });
});

describe('withLightThemeResolution (#222: exports must stay readable in dark mode)', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('runs fn without touching the class when the page is already light', () => {
    expect(withLightThemeResolution(() => 'result')).toBe('result');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('removes the dark class for the duration of fn, then restores it', () => {
    document.documentElement.classList.add('dark');
    let sawDuringCall: boolean | null = null;
    const result = withLightThemeResolution(() => {
      sawDuringCall = document.documentElement.classList.contains('dark');
      return 'result';
    });
    expect(sawDuringCall).toBe(false);
    expect(result).toBe('result');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('restores the dark class even when fn throws', () => {
    document.documentElement.classList.add('dark');
    expect(() =>
      withLightThemeResolution(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('attributedSvgMarkup — paint resolves against light theme even in dark mode (#222)', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  function svgNeedingResolve(): SVGSVGElement {
    const svg = sampleSvg();
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke', 'var(--series-1)');
    svg.appendChild(path);
    return svg;
  }

  it('resolves paint with the dark class removed, so a dark-mode export never bakes light-on-dark text onto the white export ground', () => {
    document.documentElement.classList.add('dark');
    let sawDarkDuringResolve: boolean | null = null;
    attributedSvgMarkup(svgNeedingResolve(), 'attributie', () => {
      sawDarkDuringResolve = document.documentElement.classList.contains('dark');
      return { stroke: 'rgb(30, 64, 175)', fill: 'none' };
    });
    expect(sawDarkDuringResolve).toBe(false);
  });

  it('leaves the page in dark mode after the export is built', () => {
    document.documentElement.classList.add('dark');
    attributedSvgMarkup(svgNeedingResolve(), 'attributie', () => ({ stroke: 'rgb(30, 64, 175)', fill: 'none' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 4 (design §C3): the frame baked into the export. `pristineFrame` is
// `STOCK_PRESENTATION`'s frame slice — `isFramePristine` true, no image —
// the binding case that must stay byte-identical to the pre-frame output.
// ---------------------------------------------------------------------------

const pristineFrame: FrameValues = {
  frameBackground: STOCK_PRESENTATION.frameBackground,
  framePadding: STOCK_PRESENTATION.framePadding,
  frameCorners: STOCK_PRESENTATION.frameCorners,
  frameShadow: STOCK_PRESENTATION.frameShadow,
  frameInset: STOCK_PRESENTATION.frameInset,
  frameAspect: STOCK_PRESENTATION.frameAspect,
};

describe('attributedSvgMarkup — frame (Task 4, design §C3)', () => {
  it('is byte-identical to the unframed export when frame is absent', () => {
    const withoutFrame = attributedSvgMarkup(sampleSvg(), 'attributie');
    const withUndefinedFrame = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, undefined);
    expect(withUndefinedFrame).toBe(withoutFrame);
  });

  it('is byte-identical to the unframed export when the frame is pristine and has no image', () => {
    const withoutFrame = attributedSvgMarkup(sampleSvg(), 'attributie');
    const framed = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, { values: pristineFrame, image: null });
    expect(framed).toBe(withoutFrame);
  });

  it('solid background: grows the outer size by padding and draws a filled rect', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameBackground: { kind: 'solid', hex: '#112233' } },
      image: null,
    };
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    // sampleSvg: 400x200 chart, +24 footer = 400x224; +2*16 padding = 432x256.
    expect(markup).toContain('width="432"');
    expect(markup).toContain('height="256"');
    expect(markup).toContain('fill="#112233"');
  });

  it('gradient background: draws a userSpaceOnUse linearGradient with both stops, endpoints matching gradientEndpoints in px', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameBackground: { kind: 'gradient', from: '#ffffff', to: '#000000' } },
      image: null,
    };
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    expect(markup).toContain('<linearGradient id="frame-bg"');
    expect(markup).toContain('gradientUnits="userSpaceOnUse"');
    // sampleSvg: 400x200 chart, +24 footer = 400x224; +small(16) padding on
    // each side = 432x256 outer; with no shadow the bg rect fills the whole
    // outer box (432x256) at (0,0) — chart-download.tsx's own bgX/bgY.
    const { x1, y1, x2, y2 } = gradientEndpoints(135, 432, 256);
    expect(markup).toContain(`x1="${x1}"`);
    expect(markup).toContain(`y1="${y1}"`);
    expect(markup).toContain(`x2="${x2}"`);
    expect(markup).toContain(`y2="${y2}"`);
    expect(markup).not.toContain('gradientTransform');
    expect(markup).toContain('stop-color="#ffffff"');
    expect(markup).toContain('stop-color="#000000"');
    expect(markup).toContain('fill="url(#frame-bg)"');
  });

  it('image background: draws an <image> with the data URL, and a clipPath when corners > 0', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameCorners: 'rounded', frameBackground: { kind: 'image' } },
      image: 'data:image/png;base64,AAAA',
    };
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    // Declares xmlns:xlink for the xlink:href fallback below.
    expect(markup).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(markup).toContain('href="data:image/png;base64,AAAA"');
    expect(markup).toContain('xlink:href="data:image/png;base64,AAAA"');
    expect(markup).toContain('<clipPath');
    const clipMatch = markup.match(/<clipPath id="(frame-clip-\d+)"/);
    expect(clipMatch).not.toBeNull();
    expect(markup).toContain(`clip-path="url(#${clipMatch![1]})"`);
  });

  // Final-review fix (Fix 6): a `filter` on the same element as a
  // `clip-path` clips the shadow too — the drop-shadow must instead sit on a
  // <g> wrapping the clipped <image>, so the filter applies AFTER clipping.
  it('image + rounded corners + shadow: the filter sits on a <g> wrapping the clipped <image>', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameCorners: 'rounded', frameBackground: { kind: 'image' }, frameShadow: 'soft' },
      image: 'data:image/png;base64,AAAA',
    };
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    const host = document.createElement('div');
    host.innerHTML = markup;
    const image = host.querySelector('image');
    expect(image).not.toBeNull();
    expect(image!.getAttribute('clip-path')).toMatch(/^url\(#frame-clip-\d+\)$/);
    expect(image!.hasAttribute('filter')).toBe(false);
    const group = image!.closest('g[filter]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('filter')).toBe('url(#frame-shadow)');
  });

  it('uses a different clip id on consecutive exports so they never collide', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameCorners: 'rounded', frameBackground: { kind: 'image' } },
      image: 'data:image/png;base64,AAAA',
    };
    const first = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    const second = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    const firstId = first.match(/<clipPath id="(frame-clip-\d+)"/)![1];
    const secondId = second.match(/<clipPath id="(frame-clip-\d+)"/)![1];
    expect(firstId).not.toBe(secondId);
  });

  // Final-review fix (Fix 4): with no background at all, the frame's own
  // background/inset rect used to be the only thing that could carry the
  // shadow filter — so no background meant no shadow, even with
  // frameShadow set. With inset off, a dedicated white shadow-casting rect
  // must now be emitted (an intentional screen/export asymmetry: the chart
  // stays transparent on screen, but the export needs an opaque ground for
  // the shadow to read against).
  it('shadow with no background and inset off: still emits feDropShadow and a rect using the shadow filter', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameBackground: 'none', frameShadow: 'soft', frameInset: 'none' },
      image: null,
    };
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    expect(markup).toContain('<feDropShadow');
    expect(markup).toMatch(/<rect[^>]*filter="url\(#frame-shadow[^)]*\)"/);
  });

  it('shadow: draws a feDropShadow filter', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameBackground: { kind: 'solid', hex: '#ffffff' }, frameShadow: 'soft' },
      image: null,
    };
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    expect(markup).toContain('<feDropShadow');
  });

  it('inset: draws the inner white card rect', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameBackground: { kind: 'solid', hex: '#112233' }, frameInset: 'small' },
      image: null,
    };
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    // Two fills: the frame background and the white inset card.
    expect(markup).toContain('fill="#112233"');
    expect(markup).toContain('fill="#ffffff"');
  });

  // Final-review fix (Fix 1): the chart clone used to always paint its own
  // unconditional white ground first — wrong once a frame is active, since
  // the frame's own background (or transparency, with inset off) must show
  // through the chart area exactly as on screen.
  it('framed solid background: exactly one fill="#ffffff" when inset is on (the inset card), none when inset is off', () => {
    const withInset: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameBackground: { kind: 'solid', hex: '#112233' }, frameInset: 'small' },
      image: null,
    };
    const withInsetMarkup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, withInset);
    expect(withInsetMarkup.match(/fill="#ffffff"/g)?.length ?? 0).toBe(1);

    const withoutInset: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'small', frameBackground: { kind: 'solid', hex: '#112233' }, frameInset: 'none' },
      image: null,
    };
    const withoutInsetMarkup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, withoutInset);
    expect(withoutInsetMarkup.match(/fill="#ffffff"/g)?.length ?? 0).toBe(0);
  });

  // Round-2 fix: a frame with only padding/corners/aspect set (nothing that
  // actually paints behind the chart — no bg, inset off) must keep the white
  // chart ground: previously ANY non-pristine frame dropped it, leaving a
  // transparent chart area with nothing painted behind it.
  it('padding-only frame (no bg, inset off): keeps the white chart ground and a white PNG canvas fill', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'large' },
      image: null,
    };
    const result = framedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    expect(result.markup).toContain('fill="#ffffff"');
    expect(result.canvasFill).toBe('#ffffff');
  });

  it('1:1 aspect on a wide chart: outer height equals outer width, and the nested svg is vertically centred', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, frameAspect: '1:1' },
      image: null,
    };
    const markup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    const outerWidthMatch = markup.match(/^<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/);
    const outerHeightMatch = markup.match(/^<svg[^>]*\sheight="(\d+(?:\.\d+)?)"/);
    expect(outerWidthMatch).not.toBeNull();
    expect(outerHeightMatch).not.toBeNull();
    expect(outerWidthMatch![1]).toBe(outerHeightMatch![1]);
    const outerHeight = Number(outerHeightMatch![1]);
    // sampleSvg is 400x200 chart, +24 footer = 400x224 natural height (no
    // padding/inset/shadow in pristineFrame), which is the nested svg's
    // natural (un-widened) height.
    const naturalHeight = 224;
    const nestedYMatch = markup.match(/<svg[^>]*\sy="(\d+(?:\.\d+)?)"/);
    expect(nestedYMatch).not.toBeNull();
    const nestedY = Number(nestedYMatch![1]);
    expect(nestedY).toBeGreaterThan(0);
    expect(Math.abs(nestedY - (outerHeight - naturalHeight) / 2)).toBeLessThanOrEqual(1);
  });

  it('the attribution text node is present exactly once, and textContent matches the unframed export', () => {
    const frame: FrameExportInput = {
      values: { ...pristineFrame, framePadding: 'medium', frameBackground: { kind: 'solid', hex: '#112233' }, frameCorners: 'rounded', frameInset: 'small', frameShadow: 'soft' },
      image: null,
    };
    const unframedMarkup = attributedSvgMarkup(sampleSvg(), 'attributie');
    const framedMarkup = attributedSvgMarkup(sampleSvg(), 'attributie', undefined, frame);
    // jsdom's XML parser mishandles this markup's nested <svg>, so parse via
    // a container in the HTML parser instead (case-insensitive, but the tags
    // here are already lower-case).
    const unframedHost = document.createElement('div');
    unframedHost.innerHTML = unframedMarkup;
    const framedHost = document.createElement('div');
    framedHost.innerHTML = framedMarkup;
    expect(framedHost.querySelectorAll('text')).toHaveLength(1);
    expect(framedHost.textContent).toBe(unframedHost.textContent);
  });
});
