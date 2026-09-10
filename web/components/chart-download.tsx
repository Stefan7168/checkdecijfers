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
import { t, type Lang } from '../lib/i18n/messages.ts';
import {
  FRAME_CORNER_PX,
  FRAME_GRADIENT_ANGLE,
  FRAME_INSET_PX,
  FRAME_PADDING_PX,
  FRAME_SHADOW,
  frameAspectRatio,
  isFramePristine,
  type FrameValues,
} from '../lib/chart-presentation.ts';

const FOOTER_HEIGHT = 24;
const FOOTER_FONT = 'system-ui, -apple-system, sans-serif';
// #223: extra vertical room per wrapped attribution line beyond the first —
// the single-line FOOTER_HEIGHT above already covers one line's own height.
const FOOTER_LINE_HEIGHT = 14;
const FOOTER_TEXT_MARGIN_X = 12; // the footer text's x position AND its right-edge inset — one constant for both, so they can't drift apart
const PNG_SCALE = 2;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** What's needed to bake the on-screen frame into an export: the resolved
 * frame values (chart-presentation.ts) plus the chosen background image, if
 * any — the same two pieces of state ChartFrame (Task 3) renders from. */
export interface FrameExportInput {
  values: FrameValues;
  image: string | null;
}

/** The base chart width/height (chart plus a single-line footer) — the only
 * caller, buildAttributedClone, grows `totalHeight` further from here when
 * wrapAttributionText (#223) needs more than one footer line; downloadPng
 * reuses buildAttributedClone's own final width/height rather than calling
 * this directly, so the canvas it rasterizes into can never drift out of
 * step with the SVG it's sized from. */
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

/** #222: an export must always be readable, never dark mode's light-on-dark
 * text baked onto this file's own white export ground (buildAttributedClone
 * paints white unconditionally in the unframed/no-background case, and even
 * a framed export's inset card is white — see that function and buildFrame).
 * Scope boundary, not covered by this fix: a CUSTOM frame background colour
 * (buildFrame, session 92, ADR 039) has no per-property contrast guard
 * against axis/grid text (`AXIS_COLOR` in chart.tsx, `var(--muted-
 * foreground)`) the way series colours already are (`judgeColor`, ADR 039's
 * R11 guard) — a dark custom frame background could still end up low-
 * contrast against light-theme-forced axis text after this fix, same as it
 * already could against light-mode axis text before this fix ever existed.
 * Pre-existing, narrower than #222, and orthogonal to it; not fixed here.
 * Forces DOM style resolution to the LIGHT theme for the duration of `fn`,
 * regardless of the page's own active theme: dark mode here is a `.dark`
 * class on <html> (next-themes, attribute="class" — theme-provider.tsx;
 * web/app/globals.css's `@custom-variant dark (&:is(.dark *))`), so
 * temporarily removing it makes every `getComputedStyle` call inside `fn`
 * resolve against the light-mode CSS rules instead — the same class next-
 * themes itself would flip via its own documented `forcedTheme` prop (not
 * used by this codebase today; applied here directly via the DOM since this
 * runs outside React), rather than a second, hand-maintained light-colour
 * token map. Restored synchronously (even if `fn` throws) before this
 * returns, so nothing outside this call — the visible page included — ever
 * observes the theme actually changing; a no-op when already light.
 * `fn` MUST be synchronous: the restore runs the instant `fn()` returns, not
 * after anything it returns settles, so a future async `fn` would resolve
 * its OWN paint past the first `await` against the restored (possibly dark
 * again) theme — today's only caller is a plain synchronous loop, so this
 * is a contract on future callers, not a live bug. Exported for direct
 * testing. */
export function withLightThemeResolution<T>(fn: () => T): T {
  if (typeof document === 'undefined') return fn();
  const root = document.documentElement;
  if (!root.classList.contains('dark')) return fn();
  root.classList.remove('dark');
  try {
    return fn();
  } finally {
    root.classList.add('dark');
  }
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

/** #223: the footer attribution line used to be a single `<text>` element
 * that ran off the right edge on a narrow chart (SVG text does not wrap).
 * Estimates how many characters of the footer's 11px sans-serif fit in
 * `maxWidth` px and greedy-word-wraps onto that budget — **Assumption:**
 * `AVG_CHAR_WIDTH` is a conservative estimate, not a measured value: this
 * environment has no real font metrics to measure against (jsdom's canvas
 * is a no-op without the `canvas` npm package this repo doesn't install,
 * per chart-download.test.tsx's own header comment), and a per-character
 * estimate is open-questions #223's own explicitly-sanctioned alternative
 * to a canvas measurement — worth a real-browser spot-check, not done
 * here. Pinned to 6.5, matching `chart.tsx`'s `labelWidthPx` (the same
 * 11px label font's own established per-character estimate) rather than a
 * second, independently hand-tuned number for the identical measurement.
 * **Known residual gap, not fully closed by this fix:** a single WORD
 * longer than one line's own character budget is never broken (breaking
 * a CBS category name mid-syllable would be its own readability bug), so
 * an unusually long single word — e.g. a compound Dutch term like
 * "Consumentenvertrouwen." — can still slightly exceed its own line's
 * estimated width on a very narrow chart, the same failure mode as #223
 * itself at a smaller scale. Multi-word overflow (the reported bug) is
 * fully fixed; this narrower single-word case is accepted, not solved,
 * because character-accurate wrapping is structurally impossible without
 * real font metrics this environment cannot get. Exported for direct
 * testing. */
export function wrapAttributionText(text: string, maxWidth: number): string[] {
  const AVG_CHAR_WIDTH = 6.5;
  const maxChars = Math.max(1, Math.floor(maxWidth / AVG_CHAR_WIDTH));
  // Precondition: `text` is single-spaced (no leading/trailing/double
  // spaces) — true of every caller today (chart.tsx, user-chart.tsx build
  // attribution lines from fixed templates). A run of spaces would split
  // into empty-string "words" that can silently collapse across a forced
  // line break; not guarded against, since nothing reachable produces one.
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '' || candidate.length <= maxChars) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/** Builds the attributed chart clone (paint inlined, white bg rect + footer
 * text baked in) WITHOUT serializing it — the part of the old
 * `attributedSvgMarkup` shared by the unframed and framed paths. */
function buildAttributedClone(
  svg: SVGSVGElement,
  attributionText: string,
  resolvePaint: PaintResolver,
  // Final-review fix: when a non-pristine frame is active (or an image
  // background is set), the frame's own background must show through the
  // chart area exactly as it does on screen — so the unconditional white
  // ground this clone used to paint first is skipped in that case. Defaults
  // to true so the unframed/pristine export stays byte-identical to before.
  paintWhiteBg = true,
): { clone: SVGSVGElement; width: number; totalHeight: number } {
  const { width, totalHeight: baseHeight } = measureSvg(svg);
  // #223: FOOTER_HEIGHT (baked into baseHeight by measureSvg) already fits
  // one line; only lines beyond the first grow the footer, so a short
  // attribution that already fit stays byte-identical to before this fix.
  const footerLines = wrapAttributionText(attributionText, width - FOOTER_TEXT_MARGIN_X * 2);
  const extraLines = Math.max(0, footerLines.length - 1);
  const totalHeight = baseHeight + extraLines * FOOTER_LINE_HEIGHT;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Resolve paint BEFORE adding the footer nodes, so clone and original still
  // line up element for element. #222: always resolved against light theme —
  // see withLightThemeResolution.
  withLightThemeResolution(() => inlineComputedPaint(svg, clone, resolvePaint));
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(totalHeight));
  clone.setAttribute('viewBox', `0 0 ${width} ${totalHeight}`);

  if (paintWhiteBg) {
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', String(width));
    bg.setAttribute('height', String(totalHeight));
    bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);
  }

  // Lines stack upward from the same baseline the single-line footer always
  // used (totalHeight - 8) — the LAST line sits there, earlier lines above
  // it, so a single-line footer's own line is completely unmoved.
  footerLines.forEach((line, i) => {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(FOOTER_TEXT_MARGIN_X));
    const fromBottom = (footerLines.length - 1 - i) * FOOTER_LINE_HEIGHT;
    text.setAttribute('y', String(totalHeight - 8 - fromBottom));
    text.setAttribute('font-family', FOOTER_FONT);
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', '#71717a');
    // Single line: use attributionText verbatim (byte-identical to before
    // this fix), never the word-split-and-rejoined form, so a stray double
    // space or other whitespace quirk in the source string can never change
    // the common case's output.
    text.textContent = footerLines.length === 1 ? attributionText : line;
    clone.appendChild(text);
  });

  return { clone, width, totalHeight };
}

function svgEl(tag: string): Element {
  return document.createElementNS(SVG_NS, tag);
}

/** Converts a CSS `linear-gradient(<angle>deg, from, to)` angle into SVG
 * `userSpaceOnUse` gradient endpoints, in PIXELS, that reproduce the same
 * on-screen direction AND geometry (the standard CSS gradient-line formula —
 * https://www.w3.org/TR/css-images-3/#linear-gradients). CSS's angle
 * convention is 0deg = to top, 90deg = to right (clockwise from "up"), so the
 * direction unit vector is (sin a, -cos a); the gradient line's length is
 * `|W sin a| + |H cos a|`, centred on the box's own centre. Final-review fix:
 * this replaces the old `objectBoundingBox` (0..1) approximation, which only
 * matched CSS exactly for a square box — `userSpaceOnUse` in px is exact for
 * any W×H. Returned for a box positioned at the origin; the caller adds the
 * rect's actual x/y offset. Exported for direct unit testing. */
export function gradientEndpoints(angleDeg: number, width: number, height: number): { x1: number; y1: number; x2: number; y2: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;
  // `+ 0` normalizes a `-0` result (e.g. cos of a right angle can land on
  // -0) to plain `0`, so callers never see the sign-bit distinction.
  const round3 = (n: number): number => Math.round(n * 1000) / 1000 + 0;
  return {
    x1: round3(cx - (dx * length) / 2),
    y1: round3(cy - (dy * length) / 2),
    x2: round3(cx + (dx * length) / 2),
    y2: round3(cy + (dy * length) / 2),
  };
}

/** Per-module export counter so consecutive exports never collide on the
 * same clipPath id when multiple framed SVGs coexist in the DOM (e.g. two
 * chart exports rendered/inspected side by side). */
let clipIdCounter = 0;

/** Builds the OUTER framed svg around an already-attributed chart clone
 * (design §C3). Geometry mirrors ChartFrame (Task 3, chart-frame.tsx) —
 * same px maps, same shadow spec — so the export can never drift from what
 * is shown on screen. Returns the outer svg element plus its pixel size and
 * the fill `downloadPng` should use behind it (solid colour, else `null` =
 * transparent). */
function buildFrame(
  chartClone: SVGSVGElement,
  chartWidth: number,
  chartHeight: number,
  frame: FrameExportInput,
): { outer: SVGSVGElement; outerW: number; outerH: number; canvasFill: string | null } {
  const values = frame.values;
  const padding = FRAME_PADDING_PX[values.framePadding];
  const corner = FRAME_CORNER_PX[values.frameCorners];
  const inset = FRAME_INSET_PX[values.frameInset];
  const shadow = FRAME_SHADOW[values.frameShadow];
  const shadowMargin = shadow ? shadow.blur + Math.abs(shadow.dy) : 0;
  const aspect = frameAspectRatio(values.frameAspect);

  const naturalW = chartWidth + 2 * (padding + inset + shadowMargin);
  const naturalH = chartHeight + 2 * (padding + inset + shadowMargin);

  // Never crop: whichever dimension the aspect ratio demands more of is
  // extended, the other stays put, and the natural content is centred in
  // the extra room.
  let outerW = naturalW;
  let outerH = naturalH;
  if (aspect !== null) {
    if (naturalW / naturalH > aspect) {
      outerH = naturalW / aspect;
    } else {
      outerW = naturalH * aspect;
    }
  }
  const extraX = (outerW - naturalW) / 2;
  const extraY = (outerH - naturalH) / 2;

  const bgX = shadowMargin + extraX;
  const bgY = shadowMargin + extraY;
  const bgW = naturalW - 2 * shadowMargin;
  const bgH = naturalH - 2 * shadowMargin;
  const contentX = padding + inset + shadowMargin + extraX;
  const contentY = padding + inset + shadowMargin + extraY;

  const outer = svgEl('svg') as SVGSVGElement;
  outer.setAttribute('xmlns', SVG_NS);
  // Declared via setAttributeNS (not setAttribute) so the serializer
  // recognizes it as the actual namespace declaration for the xlink:href
  // set below with setAttributeNS, rather than emitting an ns1: prefix.
  outer.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', 'http://www.w3.org/1999/xlink');
  outer.setAttribute('width', String(outerW));
  outer.setAttribute('height', String(outerH));
  outer.setAttribute('viewBox', `0 0 ${outerW} ${outerH}`);

  const bg = values.frameBackground;
  let defs: Element | null = null;
  function ensureDefs(): Element {
    if (defs === null) {
      defs = svgEl('defs');
      outer.appendChild(defs);
    }
    return defs;
  }

  if (bg !== 'none' && bg.kind === 'gradient') {
    const gradient = svgEl('linearGradient');
    gradient.setAttribute('id', 'frame-bg');
    gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    const { x1, y1, x2, y2 } = gradientEndpoints(FRAME_GRADIENT_ANGLE, bgW, bgH);
    gradient.setAttribute('x1', String(x1 + bgX));
    gradient.setAttribute('y1', String(y1 + bgY));
    gradient.setAttribute('x2', String(x2 + bgX));
    gradient.setAttribute('y2', String(y2 + bgY));
    const stop1 = svgEl('stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', bg.from);
    const stop2 = svgEl('stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', bg.to);
    gradient.appendChild(stop1);
    gradient.appendChild(stop2);
    ensureDefs().appendChild(gradient);
  }

  if (shadow !== null) {
    const filter = svgEl('filter');
    filter.setAttribute('id', 'frame-shadow');
    // Generous filter region so the blur is never clipped at the filter's
    // own default (-10%..110%) bounding box.
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');
    const dropShadow = svgEl('feDropShadow');
    dropShadow.setAttribute('dx', String(shadow.dx));
    dropShadow.setAttribute('dy', String(shadow.dy));
    dropShadow.setAttribute('stdDeviation', String(shadow.blur / 2));
    dropShadow.setAttribute('flood-opacity', String(shadow.alpha));
    filter.appendChild(dropShadow);
    ensureDefs().appendChild(filter);
  }

  let canvasFill: string | null = null;

  if (bg !== 'none') {
    if (bg.kind === 'image') {
      // `{ kind: 'image' }` with no image chosen yet renders as 'none'
      // (chart-frame.tsx's backgroundStyle does the same on screen).
      if (frame.image !== null) {
        let clipId: string | null = null;
        if (corner > 0) {
          clipId = `frame-clip-${++clipIdCounter}`;
          const clipPath = svgEl('clipPath');
          clipPath.setAttribute('id', clipId);
          const clipRect = svgEl('rect');
          clipRect.setAttribute('x', String(bgX));
          clipRect.setAttribute('y', String(bgY));
          clipRect.setAttribute('width', String(bgW));
          clipRect.setAttribute('height', String(bgH));
          clipRect.setAttribute('rx', String(corner));
          clipPath.appendChild(clipRect);
          ensureDefs().appendChild(clipPath);
        }
        const image = svgEl('image');
        image.setAttribute('href', frame.image);
        image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', frame.image);
        image.setAttribute('x', String(bgX));
        image.setAttribute('y', String(bgY));
        image.setAttribute('width', String(bgW));
        image.setAttribute('height', String(bgH));
        image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        if (clipId !== null) image.setAttribute('clip-path', `url(#${clipId})`);
        // Final-review fix: a `filter` on the SAME element as a `clip-path`
        // applies to the CLIPPED result, so a drop-shadow's blur/offset
        // would itself get clipped away at the rounded corner — wrong, the
        // shadow needs to escape the clip. Wrapping the clipped <image> in a
        // <g filter="..."> applies the filter to the group AFTER clipping,
        // so the shadow reads correctly outside the rounded corners.
        if (shadow !== null) {
          const group = svgEl('g');
          group.setAttribute('filter', 'url(#frame-shadow)');
          group.appendChild(image);
          outer.appendChild(group);
        } else {
          outer.appendChild(image);
        }
      }
    } else {
      const rect = svgEl('rect');
      rect.setAttribute('x', String(bgX));
      rect.setAttribute('y', String(bgY));
      rect.setAttribute('width', String(bgW));
      rect.setAttribute('height', String(bgH));
      rect.setAttribute('rx', String(corner));
      rect.setAttribute('fill', bg.kind === 'solid' ? bg.hex : 'url(#frame-bg)');
      if (shadow !== null) rect.setAttribute('filter', 'url(#frame-shadow)');
      outer.appendChild(rect);
      if (bg.kind === 'solid') canvasFill = bg.hex;
    }
  }

  // Final-review fix: a background paints its OWN shadow-carrying rect/image
  // above, but with no background at all (`'none'`, or `'image'` with
  // nothing chosen yet) nothing was emitted for the shadow filter to attach
  // to — so the shadow silently vanished. Priority: the inset card, if any,
  // is already an opaque white rect, so the shadow filter goes there;
  // otherwise a dedicated white ground rect (matching the frame's chart-area
  // bounding box) is emitted just to carry the shadow — this deliberately
  // uses white even though the chart itself is transparent on screen in
  // this case (documented: docs/open-questions.md, docs/decisions/039).
  const noBackgroundPainted = bg === 'none' || (bg.kind === 'image' && frame.image === null);

  if (values.frameInset !== 'none') {
    const card = svgEl('rect');
    card.setAttribute('x', String(bgX + padding));
    card.setAttribute('y', String(bgY + padding));
    card.setAttribute('width', String(chartWidth + 2 * inset));
    card.setAttribute('height', String(chartHeight + 2 * inset));
    card.setAttribute('rx', String(corner));
    card.setAttribute('fill', '#ffffff');
    if (shadow !== null && noBackgroundPainted) card.setAttribute('filter', 'url(#frame-shadow)');
    outer.appendChild(card);
  } else if (shadow !== null && noBackgroundPainted) {
    const shadowGround = svgEl('rect');
    shadowGround.setAttribute('x', String(bgX));
    shadowGround.setAttribute('y', String(bgY));
    shadowGround.setAttribute('width', String(bgW));
    shadowGround.setAttribute('height', String(bgH));
    shadowGround.setAttribute('rx', String(corner));
    shadowGround.setAttribute('fill', '#ffffff');
    shadowGround.setAttribute('filter', 'url(#frame-shadow)');
    outer.appendChild(shadowGround);
  }

  chartClone.setAttribute('x', String(contentX));
  chartClone.setAttribute('y', String(contentY));
  outer.appendChild(chartClone);

  // Round-2 fix: when nothing paints behind the chart (no background, inset
  // off) the chart clone keeps its own white ground — so the PNG canvas
  // behind the whole export must be white too, matching that ground rather
  // than leaving the canvas transparent around it.
  if (canvasFill === null && noBackgroundPainted && values.frameInset === 'none') {
    canvasFill = '#ffffff';
  }

  return { outer, outerW, outerH, canvasFill };
}

export interface FramedExport {
  markup: string;
  width: number;
  height: number;
  /** Fill for the PNG canvas: a solid colour, or `null` for transparent. */
  canvasFill: string | null;
}

/** The one place both `attributedSvgMarkup` and `downloadPng` derive the
 * framed (or unframed) export from — so a PNG and an SVG of the same chart,
 * framed the same way, can never show different geometry. With no `frame`,
 * or a pristine frame and no image, the output is byte-identical to the
 * pre-frame export (pinned by test): the outer svg IS the attributed chart
 * clone, nothing wrapped around it. */
export function framedSvgMarkup(
  svg: SVGSVGElement,
  attributionText: string,
  resolvePaint: PaintResolver = defaultResolvePaint,
  frame?: FrameExportInput,
): FramedExport {
  const isFramed = frame !== undefined && !(isFramePristine(frame.values) && frame.image === null);
  // Round-2 fix: the clone's own white ground is skipped only when
  // something actually paints behind the chart — a solid/gradient
  // background, an image background with an image actually chosen, or the
  // inset card (which supplies its own white). A frame that only touches
  // padding/corners/aspect paints nothing, so the white ground must stay —
  // otherwise the chart area exports transparent with nothing behind it.
  const bg = isFramed ? frame!.values.frameBackground : 'none';
  const backgroundPaints =
    bg !== 'none' && (bg.kind === 'solid' || bg.kind === 'gradient' || (bg.kind === 'image' && frame!.image !== null));
  const insetEnabled = isFramed && frame!.values.frameInset !== 'none';
  const paintWhiteBg = !(backgroundPaints || insetEnabled);
  const { clone, width, totalHeight } = buildAttributedClone(svg, attributionText, resolvePaint, paintWhiteBg);
  if (!isFramed) {
    return { markup: new XMLSerializer().serializeToString(clone), width, height: totalHeight, canvasFill: '#ffffff' };
  }
  const { outer, outerW, outerH, canvasFill } = buildFrame(clone, width, totalHeight, frame!);
  return { markup: new XMLSerializer().serializeToString(outer), width: outerW, height: outerH, canvasFill };
}

/** Clones the live chart SVG and bakes a footer attribution line into the
 * markup itself (never left to on-page text alone) — the whole point of
 * #170(3) is a shareable image that still carries proof of source once it
 * leaves this page. Exported for direct testing: constructing a plain SVG
 * element needs no Recharts/ResizeObserver setup at all. `resolvePaint`
 * defaults to the page's computed styles; tests inject a deterministic one.
 * `frame` (Task 4, design §C3) bakes the on-screen frame into the markup —
 * absent, or a pristine frame with no image, and the output is byte-
 * identical to before frames existed. */
export function attributedSvgMarkup(
  svg: SVGSVGElement,
  attributionText: string,
  resolvePaint: PaintResolver = defaultResolvePaint,
  frame?: FrameExportInput,
): string {
  return framedSvgMarkup(svg, attributionText, resolvePaint, frame).markup;
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
  frame?: FrameExportInput,
): void {
  try {
    const markup = attributedSvgMarkup(svg, attributionText, undefined, frame);
    triggerDownload(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), `${filenameBase}.svg`);
  } catch {
    // Matches downloadPng: every failure surfaces the same user-visible
    // message rather than an uncaught exception with no on-page feedback.
    onFailure();
  }
}

// Mirrors StatCard's downloadPng exactly (SVG -> Image -> canvas -> PNG blob),
// rasterizing the SAME attributed (and, when framed, same framed) markup the
// SVG download serializes, at 2x for crisper downloads on high-DPI screens.
// Canvas size is the OUTER svg size × PNG_SCALE, from `framedSvgMarkup` — so
// the PNG can never disagree with the SVG about how big the frame is.
function downloadPng(
  svg: SVGSVGElement,
  attributionText: string,
  filenameBase: string,
  onFailure: () => void,
  frame?: FrameExportInput,
): void {
  const { markup, width, height, canvasFill } = framedSvgMarkup(svg, attributionText, undefined, frame);
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
    if (canvasFill !== null) {
      ctx.fillStyle = canvasFill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
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

const MENU_ITEM_CLASS = 'block w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted';

export function ChartDownloadMenu({
  containerRef,
  attributionText,
  filenameBase,
  lang = 'nl',
  frame,
  frameImage = null,
}: {
  /** The element WRAPPING the chart's ResponsiveContainer — Recharts renders
   * its own <svg> dynamically, so the live node is found at click time
   * rather than held by a ref of its own. */
  containerRef: RefObject<HTMLElement | null>;
  attributionText: string;
  filenameBase: string;
  /** WP218 phase 4 (#219): the resolved chart language ChartView passes down
   * — defaults to 'nl' so an existing direct render (a test with no `lang`)
   * keeps its current Dutch output. */
  lang?: Lang;
  /** Task 4 (design §C3): the resolved frame values — same `pres` ChartFrame
   * (Task 3) renders from — so PNG/SVG exports carry the same frame shown on
   * screen. Optional: an existing direct render (a test with no `frame`)
   * keeps today's unframed export byte-identical. */
  frame?: FrameValues;
  frameImage?: string | null;
}) {
  const frameInput: FrameExportInput | undefined = frame === undefined ? undefined : { values: frame, image: frameImage };
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
        className="min-h-6 px-1 text-xs text-muted-foreground underline"
      >
        {t(lang, 'chart.download.trigger')}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t(lang, 'chart.download.menuLabel')}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-10 mt-1 whitespace-nowrap rounded-md border border-border bg-card py-1 shadow-sm"
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={() =>
              withLiveSvg((svg) => downloadPng(svg, attributionText, filenameBase, () => setFailed(true), frameInput))
            }
          >
            {t(lang, 'chart.download.png')}
          </button>
          <button
            ref={secondItemRef}
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={() =>
              withLiveSvg((svg) => downloadSvg(svg, attributionText, filenameBase, () => setFailed(true), frameInput))
            }
          >
            {t(lang, 'chart.download.svg')}
          </button>
        </div>
      ) : null}
      {failed ? (
        <span role="alert" className="ml-2 text-xs text-destructive">
          {t(lang, 'chart.download.failed')}
        </span>
      ) : null}
    </div>
  );
}
