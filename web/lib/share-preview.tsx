// WP-LOOK part (a2) — the share-link preview image (session 143, 2026-09-29,
// owner decision open-questions #351, GO on the plain-English design).
//
// A Share link points to the chart's public embed page; that page has an
// Open Graph image of its own, so a pasted link unfurls with a picture of the
// chart on LinkedIn / Slack / WhatsApp / Teams / newsletters. This module is
// the PURE part: it turns a stored ChartSpec (+ the journalist headline, if
// one was saved, + the reader's chosen form) into the card the image route
// rasterises, and lists every string the card shows so a test can prove none
// of them carries a number that is not in the spec.
//
// Round 2 (session 144, owner GO): the round-1 card embedded the repo's whole
// server SVG — title, labels, footer included — as one <img>, and two things
// were wrong with it: the image tool rasterises through librsvg, which never
// sees the font we bundle, so every label came out in a fallback face; and
// twenty-four monthly x-labels at 11 px overlapped into one smear. Now the
// server renderer's plot-only mode (`renderChartPlot`, src/chart/render.ts)
// draws ONLY the marks in the SVG and hands every piece of text back with its
// coordinates; the card sets that text itself, in Inter (the site's own
// face, loaded by the route), thinned to what fits, value labels on the ends
// and the extremes, the lowest and highest values as y-axis ticks. The
// reader's chosen form travels in `?form=` (line, area or bars over time; a
// form the renderer does not draw falls back to the spec's own line, and the
// table never reaches here — the share button already refuses it).
//
// R6 / #254: every string here is a spec string, the headline figure's own
// formattedValue (never reformatted), the saved headline sentence (already
// checked when saved), or the digit-free brand line.
import type { CSSProperties, ReactElement } from 'react';
import { renderChartPlot, type RenderForm, type RenderedPlot } from '../backend/chart/render.ts';
import type { ChartSpec } from '../backend/chart/types.ts';
import { headlineFigure, type HeadlineFigure } from './chart-headline.ts';
import { DEFAULT_PALETTE } from './chart-presentation.ts';
import { stripDimensionCode } from './dim-label.ts';

export const SHARE_PREVIEW_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_PREVIEW_BRAND = 'graphmaker.studio';
/** The public claim, digit-free (CLAUDE.md, public-claim rule). */
export const SHARE_PREVIEW_TAGLINE = 'Elk getal herleidbaar tot een officiële CBS-tabel';
/** The typeface the route loads for the image tool; the card names it so the
 * two can never drift apart. */
export const SHARE_PREVIEW_FONT = 'Inter';

const PADDING = 44;
const CARD_INNER_WIDTH = SHARE_PREVIEW_SIZE.width - 2 * PADDING;
/** Plot text size: the card is shown at roughly half size in a feed, so
 * labels are set large enough to survive that. */
const PLOT_FONT_SIZE = 20;
const COLOR_INK = '#111111';
const COLOR_MUTED = '#666666';
const COLOR_PROVISIONAL = '#b45309';

/** The forms the picture can take. Anything else (the reader's dumbbell, pie,
 * heatmap, …) is drawn as the spec's own line — stated here, not guessed. */
export function previewFormFor(form: string | null | undefined): RenderForm {
  return form === 'area' || form === 'bar' ? form : 'line';
}

export interface SharePreviewModel {
  title: string;
  subtitle: string;
  headline: HeadlineFigure | null;
  headlineText: string | null;
  form: RenderForm;
  plot: RenderedPlot;
  plotDataUri: string;
  provisionalNote: string | null;
  attributionLine: string;
  /** Every string the card renders (for the digit scan). */
  strings: string[];
}

/** Base64, encoded from UTF-8 by us. Found in the first visual run: with a
 * percent-encoded URI the image tool re-encodes the SVG itself through a
 * Latin-1-only `btoa`, and the em dash every CBS attribution line carries
 * ("tabel 86141NED — Consumentenprijzen") threw InvalidCharacterError. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export function buildSharePreview(spec: ChartSpec, headlineText: string | null, form: RenderForm = 'line'): SharePreviewModel {
  const headline = headlineFigure(spec);
  // Same display rule as the card's subtitle (round 2 of part (a)): CBS's own
  // classification code never leads a label a reader sees. Display-only; the
  // spec itself is untouched.
  const dims = Object.values(spec.dimLabels).map(stripDimensionCode);
  const subtitle = [spec.unit, ...dims].filter((s) => s.length > 0).join(' · ');
  // The plot fills the width; its height is what is left under the header
  // and above the footer, so the picture is the same size for every chart.
  const headerHeight = 36 + 26 + (headlineText ? 40 : 0) + (headline ? 76 : 40) + 14;
  const footerHeight = (spec.provisionalNote ? 26 : 0) + 2 * 24 + 14;
  const plotTotal = SHARE_PREVIEW_SIZE.height - 2 * PADDING - headerHeight - footerHeight;
  const plotHeight = Math.max(120, plotTotal - (PLOT_FONT_SIZE + 6) - (PLOT_FONT_SIZE + 8) - 6);
  const plot = renderChartPlot(spec, {
    width: CARD_INNER_WIDTH,
    plotHeight,
    form: spec.kind === 'line' ? form : 'line',
    colors: DEFAULT_PALETTE,
    fontSize: PLOT_FONT_SIZE,
    valueLabels: 'ends',
  });
  const strings = [
    spec.title,
    subtitle,
    headlineText ?? '',
    headline ? `${headline.value}${headline.provisional ? '*' : ''}` : '',
    headline ? `${headline.unit} · ${headline.periodLabel}` : '',
    headline ? '' : SHARE_PREVIEW_TAGLINE,
    SHARE_PREVIEW_BRAND,
    ...plot.texts.map((t) => t.text),
    ...plot.legend.map((l) => l.label),
    spec.provisionalNote ?? '',
    spec.attributionLine,
  ].filter((s) => s !== '');
  return {
    title: spec.title,
    subtitle,
    headline,
    headlineText,
    form: spec.kind === 'line' ? form : 'line',
    plot,
    plotDataUri: svgDataUri(plot.svg),
    provisionalNote: spec.provisionalNote,
    attributionLine: spec.attributionLine,
    strings,
  };
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
  color: COLOR_INK,
  fontFamily: SHARE_PREVIEW_FONT,
};

/** A piece of plot text at its SVG coordinates. Satori has no text-anchor,
 * so a fixed-width box does the anchoring: the box is centred on `x` (or
 * ends at it) and the text is aligned inside it. `y` is the baseline; with
 * a line height of one the baseline of Inter sits ~0.8 em below the top. */
function PlotText({ x, y, text, size, weight, anchor, color }: RenderedPlot['texts'][number]): ReactElement {
  const box = 480;
  const left = anchor === 'middle' ? x - box / 2 : anchor === 'end' ? x - box : x;
  const justify = anchor === 'middle' ? 'center' : anchor === 'end' ? 'flex-end' : 'flex-start';
  return (
    <div
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${y - size * 0.8}px`,
        width: `${box}px`,
        display: 'flex',
        justifyContent: justify,
        fontSize: `${size}px`,
        lineHeight: 1,
        fontWeight: weight === 'bold' ? 700 : 400,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  );
}

export function SharePreviewCard({ model }: { model: SharePreviewModel }): ReactElement {
  const { headline, headlineText, plot } = model;
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', fontSize: '28px', fontWeight: 600, lineHeight: 1.2 }}>{model.title}</div>
          {model.subtitle ? (
            <div style={{ display: 'flex', fontSize: '20px', color: COLOR_MUTED, lineHeight: 1.3, marginTop: '2px' }}>{model.subtitle}</div>
          ) : null}
        </div>
        <div style={{ display: 'flex', fontSize: '22px', fontWeight: 600, color: COLOR_INK, marginLeft: '24px', whiteSpace: 'nowrap' }}>
          {SHARE_PREVIEW_BRAND}
        </div>
      </div>
      {headlineText ? (
        <div style={{ display: 'flex', fontSize: '26px', fontWeight: 600, lineHeight: 1.2, marginTop: '14px' }}>{headlineText}</div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'baseline', width: '100%', marginTop: headlineText ? '8px' : '14px' }}>
        {headline ? (
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div style={{ display: 'flex', fontSize: '60px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>
              {headline.value}
              {headline.provisional ? '*' : ''}
            </div>
            <div style={{ display: 'flex', fontSize: '24px', color: COLOR_MUTED, marginLeft: '16px' }}>
              {headline.unit} · {headline.periodLabel}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: '24px', color: COLOR_MUTED }}>{SHARE_PREVIEW_TAGLINE}</div>
        )}
        {plot.legend.length > 1 ? (
          <div style={{ display: 'flex', marginLeft: 'auto', alignItems: 'center' }}>
            {plot.legend.map((entry) => (
              <div key={entry.label} style={{ display: 'flex', alignItems: 'center', marginLeft: '18px', fontSize: '20px', color: COLOR_INK }}>
                <div style={{ display: 'flex', width: '14px', height: '14px', background: entry.color, marginRight: '8px' }} />
                {entry.label}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', position: 'relative', width: `${plot.width}px`, height: `${plot.height}px`, marginTop: '14px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img>; next/image has no meaning here. */}
        <img src={model.plotDataUri} width={plot.width} height={plot.height} alt="" style={{ position: 'absolute', left: 0, top: 0 }} />
        {plot.texts.map((t, i) => (
          <PlotText key={i} {...t} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
        {model.provisionalNote ? (
          <div style={{ display: 'flex', fontSize: '18px', color: COLOR_PROVISIONAL, lineHeight: 1.3, marginBottom: '4px' }}>{model.provisionalNote}</div>
        ) : null}
        <div style={{ display: 'flex', fontSize: '17px', color: COLOR_MUTED, lineHeight: 1.35 }}>{model.attributionLine}</div>
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
      <div style={{ display: 'flex', fontSize: '30px', color: COLOR_MUTED, marginTop: '16px' }}>{SHARE_PREVIEW_TAGLINE}</div>
    </div>
  );
}

export const NEUTRAL_PREVIEW_STRINGS = [SHARE_PREVIEW_BRAND, SHARE_PREVIEW_TAGLINE];
