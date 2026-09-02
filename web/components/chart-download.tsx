// #170(3): chart download-as-image, brought forward from the Phase-2 OG-image
// bundle by owner request (session 69). Same technique as StatCard's PNG
// export (#80, stat-card.tsx) — serialize the SVG actually on screen via
// canvas, so the download structurally cannot drift from what was shown —
// extended two ways: (1) Recharts renders its own SVG dynamically inside
// ResponsiveContainer, so there is no ref to a self-authored <svg> to hold;
// the live node is looked up from the container at click time instead. (2)
// the owner wants a choice of PNG or SVG, so both formats serialize the SAME
// attributed markup (attributedSvgMarkup) rather than building two divergent
// exports — a PNG and an SVG of the same chart can never show different text.
'use client';

import { useState, type RefObject } from 'react';

const FOOTER_HEIGHT = 24;
const FOOTER_FONT = 'system-ui, -apple-system, sans-serif';
const PNG_SCALE = 2;

/** The one place chart export dimensions are derived — downloadPng reuses
 * this rather than re-deriving width/height itself, so the canvas it
 * rasterizes into can never drift out of step with the SVG it's sized from. */
function measureSvg(svg: SVGSVGElement): { width: number; totalHeight: number } {
  const width = svg.clientWidth || Number(svg.getAttribute('width')) || 600;
  const height = svg.clientHeight || Number(svg.getAttribute('height')) || 300;
  return { width, totalHeight: height + FOOTER_HEIGHT };
}

/** Clones the live chart SVG and bakes a footer attribution line into the
 * markup itself (never left to on-page text alone) — the whole point of
 * #170(3) is a shareable image that still carries proof of source once it
 * leaves this page. Exported for direct testing: constructing a plain SVG
 * element needs no Recharts/ResizeObserver setup at all. */
export function attributedSvgMarkup(svg: SVGSVGElement, attributionText: string): string {
  const { width, totalHeight } = measureSvg(svg);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(totalHeight));
  clone.setAttribute('viewBox', `0 0 ${width} ${totalHeight}`);

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(totalHeight));
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '12');
  text.setAttribute('y', String(totalHeight - 8));
  text.setAttribute('font-family', FOOTER_FONT);
  text.setAttribute('font-size', '11');
  text.setAttribute('fill', '#71717a');
  text.textContent = attributionText;
  clone.appendChild(text);

  return new XMLSerializer().serializeToString(clone);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadSvg(
  svg: SVGSVGElement,
  attributionText: string,
  filenameBase: string,
  onFailure: () => void,
): void {
  try {
    const markup = attributedSvgMarkup(svg, attributionText);
    triggerDownload(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), `${filenameBase}.svg`);
  } catch {
    // Matches downloadPng: every failure surfaces the same user-visible
    // message rather than an uncaught exception with no on-page feedback.
    onFailure();
  }
}

// Mirrors StatCard's downloadPng exactly (SVG -> Image -> canvas -> PNG blob),
// rasterizing the SAME attributed markup the SVG download serializes, at 2x
// for crisper downloads on high-DPI screens.
function downloadPng(
  svg: SVGSVGElement,
  attributionText: string,
  filenameBase: string,
  onFailure: () => void,
): void {
  const { width, totalHeight: height } = measureSvg(svg);
  const markup = attributedSvgMarkup(svg, attributionText);
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  image.onerror = () => {
    URL.revokeObjectURL(svgUrl);
    onFailure();
  };
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width * PNG_SCALE;
    canvas.height = height * PNG_SCALE;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      URL.revokeObjectURL(svgUrl);
      onFailure();
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(svgUrl);
    canvas.toBlob((png) => {
      if (png === null) {
        onFailure();
        return;
      }
      triggerDownload(png, `${filenameBase}.png`);
    }, 'image/png');
  };
  image.src = svgUrl;
}

export function ChartDownloadMenu({
  containerRef,
  attributionText,
  filenameBase,
}: {
  /** The element WRAPPING the chart's ResponsiveContainer — Recharts renders
   * its own <svg> dynamically, so the live node is found at click time
   * rather than held by a ref of its own. */
  containerRef: RefObject<HTMLElement | null>;
  attributionText: string;
  filenameBase: string;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  function withLiveSvg(action: (svg: SVGSVGElement) => void): void {
    setOpen(false);
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) {
      setFailed(true);
      return;
    }
    setFailed(false);
    action(svg);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-ink-muted underline"
      >
        Download
      </button>
      {open ? (
        <div className="absolute z-10 mt-1 whitespace-nowrap rounded-md border border-line bg-paper-raised py-1 shadow-sm">
          <button
            type="button"
            className="block w-full px-3 py-1 text-left text-xs text-ink hover:bg-paper-sunken"
            onClick={() => withLiveSvg((svg) => downloadPng(svg, attributionText, filenameBase, () => setFailed(true)))}
          >
            Download als PNG
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1 text-left text-xs text-ink hover:bg-paper-sunken"
            onClick={() =>
              withLiveSvg((svg) => downloadSvg(svg, attributionText, filenameBase, () => setFailed(true)))
            }
          >
            Download als SVG
          </button>
        </div>
      ) : null}
      {failed ? (
        <span className="ml-2 text-xs text-danger">Downloaden lukte niet in deze browser.</span>
      ) : null}
    </div>
  );
}
