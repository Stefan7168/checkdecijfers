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
//
// #197 step 1 (session 69): this was the app's first disclosure menu and
// shipped without the ARIA that pattern needs (menu button semantics,
// Escape/outside-click close, focus management, an announced failure) —
// added here. And the export serialized `var(--token)` paint verbatim, which
// no standalone SVG file or <img> can resolve — lines would simply not draw.
// attributedSvgMarkup now inlines the COMPUTED paint of every element first.
'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

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

/** What a paint resolver returns for one element — the computed values of
 * the properties a standalone SVG cannot derive from the page's stylesheet. */
export interface ResolvedPaint {
  stroke?: string;
  fill?: string;
  fontFamily?: string;
  fontSize?: string;
}

export type PaintResolver = (element: Element) => ResolvedPaint | null;

function defaultResolvePaint(element: Element): ResolvedPaint | null {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return null;
  const computed = window.getComputedStyle(element);
  return {
    stroke: computed.stroke,
    fill: computed.fill,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
  };
}

/** Paint the page can resolve but a standalone file cannot. */
function needsResolving(value: string | null): boolean {
  return value !== null && (value.includes('var(') || value === 'currentColor');
}

/** A computed value worth writing into the file — never another var()/
 * currentColor, never empty (jsdom and unsupported properties yield ''). */
function usable(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('var(') && value !== 'currentColor';
}

/** Rewrites token-based paint on the clone to the ORIGINAL element's computed
 * paint, element by element (clone and original share tree order). Text
 * additionally gets its computed font so the file does not fall back to the
 * viewer's serif default. Anything the resolver cannot improve is left
 * exactly as it was. */
function inlineComputedPaint(original: SVGSVGElement, clone: SVGSVGElement, resolvePaint: PaintResolver): void {
  const originals = [original, ...original.querySelectorAll('*')];
  const clones = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < clones.length && i < originals.length; i++) {
    const source = originals[i];
    const target = clones[i];
    const strokeNeeded = needsResolving(target.getAttribute('stroke'));
    const fillNeeded = needsResolving(target.getAttribute('fill'));
    const isText = target.tagName.toLowerCase() === 'text';
    if (!strokeNeeded && !fillNeeded && !isText) continue;
    const paint = resolvePaint(source);
    if (paint === null) continue;
    if (strokeNeeded && usable(paint.stroke)) target.setAttribute('stroke', paint.stroke);
    if (fillNeeded && usable(paint.fill)) target.setAttribute('fill', paint.fill);
    if (isText) {
      if (!target.hasAttribute('font-family') && usable(paint.fontFamily)) {
        target.setAttribute('font-family', paint.fontFamily);
      }
      if (!target.hasAttribute('font-size') && usable(paint.fontSize)) {
        target.setAttribute('font-size', paint.fontSize);
      }
    }
  }
}

/** Clones the live chart SVG and bakes a footer attribution line into the
 * markup itself (never left to on-page text alone) — the whole point of
 * #170(3) is a shareable image that still carries proof of source once it
 * leaves this page. Exported for direct testing: constructing a plain SVG
 * element needs no Recharts/ResizeObserver setup at all. `resolvePaint`
 * defaults to the page's computed styles; tests inject a deterministic one. */
export function attributedSvgMarkup(
  svg: SVGSVGElement,
  attributionText: string,
  resolvePaint: PaintResolver = defaultResolvePaint,
): string {
  const { width, totalHeight } = measureSvg(svg);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Resolve paint BEFORE adding the footer nodes, so clone and original still
  // line up element for element.
  inlineComputedPaint(svg, clone, resolvePaint);
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

const MENU_ITEM_CLASS = 'block w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-paper-sunken';

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
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const secondItemRef = useRef<HTMLButtonElement>(null);

  // WAI-ARIA menu button: focus lands on the first item when the menu opens.
  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  // A pointer going down anywhere outside closes the menu — before this it
  // could only be closed by picking an option, which on a phone left an
  // orphaned floating panel over other tappable content.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function closeAndRefocus(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRefocus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = document.activeElement === firstItemRef.current ? secondItemRef : firstItemRef;
      next.current?.focus();
    }
  }

  function withLiveSvg(action: (svg: SVGSVGElement) => void): void {
    closeAndRefocus();
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) {
      setFailed(true);
      return;
    }
    setFailed(false);
    action(svg);
  }

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="min-h-6 px-1 text-xs text-ink-muted underline"
      >
        Download
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Downloadformaat"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-10 mt-1 whitespace-nowrap rounded-md border border-line bg-paper-raised py-1 shadow-sm"
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={() => withLiveSvg((svg) => downloadPng(svg, attributionText, filenameBase, () => setFailed(true)))}
          >
            Download als PNG
          </button>
          <button
            ref={secondItemRef}
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={() =>
              withLiveSvg((svg) => downloadSvg(svg, attributionText, filenameBase, () => setFailed(true)))
            }
          >
            Download als SVG
          </button>
        </div>
      ) : null}
      {failed ? (
        <span role="alert" className="ml-2 text-xs text-danger">
          Downloaden lukte niet in deze browser.
        </span>
      ) : null}
    </div>
  );
}
