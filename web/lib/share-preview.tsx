// WP-LOOK part (a2) — the share-link preview image (session 143, 2026-09-29,
// owner decision open-questions #351, GO on the plain-English design).
//
// A Share link points to the chart's public embed page; that page now has an
// Open Graph image of its own, so a pasted link unfurls with a picture of the
// chart on LinkedIn / Slack / WhatsApp / Teams / newsletters. This module is
// the PURE part: it turns a stored ChartSpec (+ the journalist headline, if
// one was saved) into the card the image route rasterises, and lists every
// string the card shows so a test can prove none of them carries a number
// that is not in the spec.
//
// Mechanism (cheapest that works, measured in a spike before building): the
// plot is the repo's own dependency-free server SVG renderer (ADR 014,
// `src/chart/render.ts` — title, subtitle, legend, plot, axis labels and the
// attribution footer, all from spec strings, covered by its own honesty
// tests), embedded whole as an <img> data URI; Next's built-in image tool
// (`ImageResponse`, Satori + resvg) lays out the typography around it. No new
// dependency, no AI, no schema change, no outside service. The renderer's own
// text renders in resvg's bundled fallback face — accepted for round 1.
//
// R6 / #254: every string here is a spec string, the headline figure's own
// formattedValue (never reformatted), the saved headline sentence (already
// checked when saved), or the digit-free brand line.
import type { CSSProperties, ReactElement } from 'react';
import { renderChartSvg } from '../backend/chart/render.ts';
import type { ChartSpec } from '../backend/chart/types.ts';
import { headlineFigure, type HeadlineFigure } from './chart-headline.ts';
import { stripDimensionCode } from './dim-label.ts';

export const SHARE_PREVIEW_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_PREVIEW_BRAND = 'checkdecijfers.nl';
/** The public claim, digit-free (CLAUDE.md, public-claim rule). */
export const SHARE_PREVIEW_TAGLINE = 'Elk getal herleidbaar tot een officiële CBS-tabel';

const PADDING = 48;
/** The renderer draws at its own natural width; the <img> scales it up. */
const PLOT_SVG_WIDTH = 640;
// Shallow on purpose: at 640 wide the renderer's fixed 11–14 px text scales
// up ~1.7× to fill the card's 1104 px; a taller plot would be capped by the
// card's height and end up narrow instead (first visual run: 806 px wide).
const PLOT_SVG_PLOT_HEIGHT = 120;
const CARD_INNER_WIDTH = SHARE_PREVIEW_SIZE.width - 2 * PADDING;

export interface SharePreviewModel {
  headline: HeadlineFigure | null;
  headlineText: string | null;
  plotSvg: string;
  plotDataUri: string;
  /** The <img> box, computed from the SVG's own width/height attributes so the
   * chart is never cropped or stretched. */
  plot: { width: number; height: number };
  /** Every string the card renders outside the plot SVG (for the digit scan). */
  strings: string[];
}

/** Base64, encoded from UTF-8 by us. Found in the first visual run: with a
 * percent-encoded URI the image tool re-encodes the SVG itself through a
 * Latin-1-only `btoa`, and the em dash every CBS attribution line carries
 * ("tabel 86141NED — Consumentenprijzen") threw InvalidCharacterError. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function svgSize(svg: string): { width: number; height: number } {
  const w = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg);
  const h = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);
  return { width: w ? Number(w[1]) : PLOT_SVG_WIDTH, height: h ? Number(h[1]) : 300 };
}

export function buildSharePreview(spec: ChartSpec, headlineText: string | null): SharePreviewModel {
  const headline = headlineFigure(spec);
  // Same display rule as the card's subtitle (round 2 of part (a)): CBS's own
  // classification code never leads a label a reader sees. Display-only; the
  // spec itself is untouched.
  const displaySpec: ChartSpec = {
    ...spec,
    dimLabels: Object.fromEntries(Object.entries(spec.dimLabels).map(([k, v]) => [k, stripDimensionCode(v)])),
  };
  const plotSvg = renderChartSvg(displaySpec, { width: PLOT_SVG_WIDTH, plotHeight: PLOT_SVG_PLOT_HEIGHT });
  const natural = svgSize(plotSvg);
  // Fit: scale to the inner width, but never past the height left under the
  // headline block (the sentence, if any, plus the figure row).
  const headerHeight = (headlineText ? 40 : 0) + (headline ? 80 : 48) + 16;
  const maxHeight = SHARE_PREVIEW_SIZE.height - 2 * PADDING - headerHeight;
  const scale = Math.min(CARD_INNER_WIDTH / natural.width, maxHeight / natural.height);
  const plot = { width: Math.floor(natural.width * scale), height: Math.floor(natural.height * scale) };
  const strings = [
    headlineText ?? '',
    headline ? `${headline.value}${headline.provisional ? '*' : ''}` : '',
    headline ? `${headline.unit} · ${headline.periodLabel}` : '',
    SHARE_PREVIEW_BRAND,
  ].filter((s) => s !== '');
  return { headline, headlineText, plotSvg, plotDataUri: svgDataUri(plotSvg), plot, strings };
}

// Satori rules: inline styles only, every element with several children is
// display:flex, no CSS variables, no Tailwind.
const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: `${SHARE_PREVIEW_SIZE.width}px`,
  height: `${SHARE_PREVIEW_SIZE.height}px`,
  padding: `${PADDING}px`,
  background: '#ffffff',
  color: '#111111',
  fontFamily: 'sans-serif',
};

export function SharePreviewCard({ model }: { model: SharePreviewModel }): ReactElement {
  const { headline, headlineText } = model;
  return (
    <div style={card}>
      {headlineText ? (
        <div style={{ display: 'flex', fontSize: '26px', fontWeight: 600, lineHeight: 1.2, marginBottom: '6px' }}>{headlineText}</div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'baseline', width: '100%' }}>
        {headline ? (
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div style={{ display: 'flex', fontSize: '64px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>
              {headline.value}
              {headline.provisional ? '*' : ''}
            </div>
            <div style={{ display: 'flex', fontSize: '26px', color: '#666666', marginLeft: '16px' }}>
              {headline.unit} · {headline.periodLabel}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: '26px', color: '#666666' }}>{SHARE_PREVIEW_TAGLINE}</div>
        )}
        <div style={{ display: 'flex', marginLeft: 'auto', fontSize: '22px', fontWeight: 600, color: '#111111' }}>{SHARE_PREVIEW_BRAND}</div>
      </div>
      <div style={{ display: 'flex', marginTop: '16px', width: '100%', justifyContent: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img>; next/image has no meaning here. */}
        <img src={model.plotDataUri} width={model.plot.width} height={model.plot.height} alt="" />
      </div>
    </div>
  );
}

/** A link whose answer is gone (invalid token, redacted or missing record):
 * the brand and the claim, not a single digit. */
export function NeutralPreviewCard(): ReactElement {
  return (
    <div style={{ ...card, justifyContent: 'center', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', fontSize: '64px', fontWeight: 700, letterSpacing: '-0.02em' }}>{SHARE_PREVIEW_BRAND}</div>
      <div style={{ display: 'flex', fontSize: '30px', color: '#666666', marginTop: '16px' }}>{SHARE_PREVIEW_TAGLINE}</div>
    </div>
  );
}

export const NEUTRAL_PREVIEW_STRINGS = [SHARE_PREVIEW_BRAND, SHARE_PREVIEW_TAGLINE];
