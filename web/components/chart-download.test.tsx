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
    expect(screen.getByRole('button', { name: 'Download als PNG' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download als SVG' })).toBeInTheDocument();
  });

  it('shows the failure message when no chart <svg> exists under the container yet', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <div ref={ref}>
        <ChartDownloadMenu containerRef={ref} attributionText="attributie" filenameBase="checkdecijfers-12345NED" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download als SVG' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Download als SVG' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Download als SVG' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Download als PNG' }));
    // jsdom's canvas.getContext('2d') returns null -> the guarded branch.
    expect(await screen.findByText('Downloaden lukte niet in deze browser.')).toBeInTheDocument();
  });
});
