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
import { attributedSvgMarkup, ChartDownloadMenu } from './chart-download.tsx';

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
