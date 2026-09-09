// WP218 (ADR 039): the chart PRESENTATION layer — pure, no React, no Recharts.
// A presentation is a set of plain user overrides on top of the session-87
// stock look; `resolvePresentation` turns (chart context, overrides) into the
// EFFECTIVE values Recharts draws from plus the per-option honesty locks the
// panel explains. Nothing here ever enters a ChartSpec, buildChartSpec or an
// audit record — it projects an unchanged server-built spec for display,
// exactly like windowSpec in chart-view-state.ts.
import { z } from 'zod';
import type { ChartForm } from './chart-view-state.ts';
import type { Lang } from './i18n/messages.ts';

export type LineWidth = 'thin' | 'normal' | 'thick' | 'extraThick';
export const LINE_WIDTH_PX: Record<LineWidth, number> = { thin: 1, normal: 2, thick: 3, extraThick: 4 };
export type MarkerMode = 'all' | 'provisionalOnly';
export type GridMode = 'both' | 'horizontal' | 'none';
export type XLabelMode = 'flat' | 'tilted';
export type OnOff = 'shown' | 'hidden';
export type BaselineMode = 'auto' | 'zero';

export interface ChartPresentation {
  lineWidth: LineWidth;
  markers: MarkerMode;
  grid: GridMode;
  xLabels: XLabelMode;
  axisLines: OnOff;
  valueLabels: OnOff;
  zeroBaseline: BaselineMode;
  /** Series index → lowercase '#rrggbb'. Absent index = palette colour. */
  seriesColors: Record<number, string>;
  /** A family name from FONT_OPTIONS (or, later, a brand font); null = the page font. */
  fontFamily: string | null;
  /** WP218 phase 4 (design §4): the language THIS chart's card copy is
   * shown in. null = follow the app language (`useLang()`); 'nl'/'en' pins
   * the chart regardless of the app's own switch. Applicable on EVERY form,
   * table included, and never locked — unlike every other key here it has
   * no honesty consequence, so no form ever overrides or disables it. The
   * Style panel — the only control that sets it — is never mounted in table
   * form (`chart.tsx`: `state.form !== 'table'`), so in table form the key
   * still APPLIES (a value chosen on a chart form keeps translating the
   * table's card copy) but cannot be changed until a chart form is shown. */
  language: Lang | null;
  /** The Frame tab (design §C2): the chart sits inside this background,
   * padding, corner radius, drop shadow, card inset and export aspect ratio.
   * Final-review fix: table form has NO frame and NO Style panel (as
   * before) — a framed table would need its own export path, so the frame
   * keys are not applicable in table form either, exactly like every other
   * key above. */
  frameBackground: FrameBackground;
  framePadding: FramePadding;
  frameCorners: FrameCorners;
  frameShadow: FrameShadow;
  frameInset: FrameInset;
  frameAspect: FrameAspect;
}

export type FramePadding = 'none' | 'small' | 'medium' | 'large';
export type FrameCorners = 'square' | 'rounded' | 'veryRounded';
export type FrameShadow = 'none' | 'soft' | 'strong';
export type FrameInset = 'none' | 'small' | 'large';
export type FrameAspect = 'auto' | '16:9' | '4:5' | '1:1' | '1.91:1';
export type FrameBackground =
  | 'none'
  | { kind: 'solid'; hex: string }
  | { kind: 'gradient'; from: string; to: string }
  | { kind: 'image' };
export type PresentationOverrides = Partial<ChartPresentation>;
export type PresentationKey = keyof ChartPresentation;

// Series palette — session 87 visual redesign (owner decision, docs/
// superpowers/specs/2026-09-07-chat-chart-visual-redesign-design.md): "use the
// basic Recharts style" = the colours Recharts' own documentation examples
// use. Moved here from chart.tsx (re-exported there) so the pure resolver can
// own the default colour without importing React.
export const RECHARTS_PALETTE: readonly string[] = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f', '#ffbb28', '#ff8042'];

/** Today's literals (chart.tsx before WP218) — the stock look is pinned by a
 * deep-equal test so the session-87 decision cannot drift without an edit. */
export const STOCK_PRESENTATION: ChartPresentation = {
  lineWidth: 'normal',
  markers: 'all',
  grid: 'both',
  xLabels: 'flat',
  axisLines: 'shown',
  valueLabels: 'shown',
  zeroBaseline: 'auto',
  seriesColors: {},
  fontFamily: null,
  language: null,
  frameBackground: 'none',
  framePadding: 'none',
  frameCorners: 'square',
  frameShadow: 'none',
  frameInset: 'none',
  frameAspect: 'auto',
};

export const HEX_COLOR = /^#[0-9a-f]{6}$/;
// A font family is a plain name: letters, digits, spaces — nothing that could
// leak into a CSS string or a Google Fonts URL as syntax.
export const FONT_FAMILY_NAME = /^[A-Za-z0-9 ]{1,40}$/;

const hexSchema = z.string().transform((s) => s.toLowerCase()).pipe(z.string().regex(HEX_COLOR));
const frameBackgroundSchema = z.union([
  z.literal('none'),
  z.object({ kind: z.literal('solid'), hex: hexSchema }).strict(),
  z.object({ kind: z.literal('gradient'), from: hexSchema, to: hexSchema }).strict(),
  z.object({ kind: z.literal('image') }).strict(),
]);
const overridesSchema = z.object({
  lineWidth: z.enum(['thin', 'normal', 'thick', 'extraThick']).optional(),
  markers: z.enum(['all', 'provisionalOnly']).optional(),
  grid: z.enum(['both', 'horizontal', 'none']).optional(),
  xLabels: z.enum(['flat', 'tilted']).optional(),
  axisLines: z.enum(['shown', 'hidden']).optional(),
  valueLabels: z.enum(['shown', 'hidden']).optional(),
  zeroBaseline: z.enum(['auto', 'zero']).optional(),
  seriesColors: z.record(z.string(), z.unknown()).optional(),
  fontFamily: z.string().regex(FONT_FAMILY_NAME).nullable().optional(),
  language: z.enum(['nl', 'en']).nullable().optional(),
  frameBackground: frameBackgroundSchema.optional(),
  framePadding: z.enum(['none', 'small', 'medium', 'large']).optional(),
  frameCorners: z.enum(['square', 'rounded', 'veryRounded']).optional(),
  frameShadow: z.enum(['none', 'soft', 'strong']).optional(),
  frameInset: z.enum(['none', 'small', 'large']).optional(),
  frameAspect: z.enum(['auto', '16:9', '4:5', '1:1', '1.91:1']).optional(),
});

/** Allow-list parse of anything claiming to be overrides (a reducer patch, a
 * stored row, a URL someday). Unknown keys, wrong enum values, malformed
 * colours and non-numeric series indexes are DROPPED, never thrown on. */
export function sanitizeOverrides(raw: unknown): PresentationOverrides {
  if (raw === null || typeof raw !== 'object') return {};
  const out: PresentationOverrides = {};
  // Per-key parse so one bad key doesn't discard its siblings.
  for (const key of Object.keys(overridesSchema.shape) as PresentationKey[]) {
    if (!(key in raw)) continue;
    const parsed = overridesSchema.pick({ [key]: true } as never).safeParse({ [key]: (raw as Record<string, unknown>)[key] });
    if (!parsed.success) continue;
    const value = (parsed.data as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === 'seriesColors') {
      const colors: Record<number, string> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const index = /^\d+$/.test(k) ? Number(k) : NaN;
        const hex = hexSchema.safeParse(v);
        if (Number.isInteger(index) && hex.success) colors[index] = hex.data;
      }
      out.seriesColors = colors;
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** WP218 phase 2 (owner decision C): turns whatever is stored as the
 * signed-in user's account default (an unknown JSON blob, straight off the
 * `user_chart_styles` row) into a full `ChartPresentation` to use as
 * `resolvePresentation`'s `base` — the same allow-list sanitiser as any
 * other untrusted overrides input, so garbage or a stale/removed key can
 * never reach the resolver. Junk (not an object, or an object with no valid
 * keys) collapses to the stock look; a valid partial degrades the rest to
 * stock, exactly like an ordinary per-chart override would. */
export function withAccountDefault(account: unknown): ChartPresentation {
  const clean = sanitizeOverrides(account);
  return { ...STOCK_PRESENTATION, ...clean, seriesColors: { ...(clean.seriesColors ?? {}) } };
}

export interface PresentationContext {
  kind: 'line' | 'bar';
  form: ChartForm;
  seriesCount: number;
  hasProvisional: boolean;
}

export interface ResolvedPresentation {
  values: ChartPresentation;
  locks: Partial<Record<PresentationKey, string>>;
  applicable: ReadonlySet<PresentationKey>;
  pristine: boolean;
}

// Lock reasons: fixed, digit-free Dutch strings (the whole-card honesty
// scans in chart.test.tsx tokenise every text node — a digit here would be
// the first non-CBS number inside the card). English variants live in
// PANEL_COPY (chart-config-panel.tsx) for phase 4; the resolver only ever
// needs one language because the panel maps reasons by key, not by text.
export const LOCK_REASONS = {
  valueLabelsBar: 'Zonder waarden heeft een staafdiagram geen schaal: de as toont bewust geen eigen getallen.',
  zeroBaselineBar: 'Een staafdiagram begint altijd bij nul.',
  // WP218 phase 5: a filled area encodes magnitude the same way a bar does,
  // so it gets its OWN reason (not zeroBaselineBar) even though the effect
  // — force zero, lock the toggle — is identical in shape to the bar case.
  zeroBaselineArea: 'Een gevuld vlak begint altijd bij nul.',
} as const;

const ALL_KEYS: PresentationKey[] = ['lineWidth', 'markers', 'grid', 'xLabels', 'axisLines', 'valueLabels', 'zeroBaseline', 'seriesColors', 'fontFamily'];
const FRAME_KEYS: PresentationKey[] = ['frameBackground', 'framePadding', 'frameCorners', 'frameShadow', 'frameInset', 'frameAspect'];

export function resolvePresentation(
  ctx: PresentationContext,
  overrides: PresentationOverrides,
  base: ChartPresentation = STOCK_PRESENTATION,
): ResolvedPresentation {
  const clean = sanitizeOverrides(overrides);
  const values: ChartPresentation = {
    ...base,
    ...clean,
    seriesColors: { ...base.seriesColors, ...(clean.seriesColors ?? {}) },
  };
  const locks: Partial<Record<PresentationKey, string>> = {};
  const applicable = new Set<PresentationKey>();
  // In table form the ChartConfigPanel is never mounted at all (`chart.tsx`:
  // `{state.form !== 'table' ? <ChartConfigPanel …/> : null}`), so none of
  // `ALL_KEYS` or the frame keys is reachable through it there — only
  // `language` stays applicable in every form (below), matching ADR 039's
  // "hidden in Tabel form".
  if (ctx.form !== 'table') {
    for (const key of ALL_KEYS) applicable.add(key);
    for (const key of FRAME_KEYS) applicable.add(key);
    if (ctx.form === 'bar' || ctx.form === 'hbar') {
      applicable.delete('lineWidth');
      applicable.delete('markers');
      applicable.delete('zeroBaseline');
      values.valueLabels = 'shown';
      locks.valueLabels = LOCK_REASONS.valueLabelsBar;
      values.zeroBaseline = 'zero';
      locks.zeroBaseline = LOCK_REASONS.zeroBaselineBar;
      // WP218 phase 5: horizontal bar puts region labels on the CATEGORY
      // (y) axis, not the number axis — there is no x-axis label orientation
      // to offer, unlike a vertical bar's period labels.
      if (ctx.form === 'hbar') applicable.delete('xLabels');
    } else if (ctx.form === 'area') {
      // WP218 phase 5: otherwise identical to 'line' (lineWidth/markers/grid/
      // xLabels/etc. stay applicable and unforced) — only the baseline is
      // forced to zero, because a fill encodes magnitude exactly like a bar
      // does. Left IN `applicable` (unlike bar's zeroBaseline) so the panel
      // can show the toggle locked with its own reason, rather than hiding
      // it outright.
      values.zeroBaseline = 'zero';
      locks.zeroBaseline = LOCK_REASONS.zeroBaselineArea;
    }
  }
  // WP218 phase 4: unlike every other key, `language` has no honesty
  // consequence for any chart form — it is offered, never locked, on every
  // form, table included.
  applicable.add('language');
  const pristine = Object.keys(clean).every((k) => k === 'seriesColors' && Object.keys(clean.seriesColors ?? {}).length === 0);
  return { values, locks, applicable, pristine };
}

/** R11: the hollow provisional ring must stay legible at every stroke width —
 * the marker grows with the line so a 4 px stroke cannot swallow a 2 px ring. */
export function dotGeometry(w: LineWidth): { r: number; ring: number } {
  return { r: Math.max(4, LINE_WIDTH_PX[w] + 2), ring: 2 };
}

/** Tilted x labels need reserved axis height or the export clips them (the
 * svg height is fixed by the container). 6.5 px/char at the 11 px label font
 * (labelWidthPx in chart.tsx) × sin 45° ≈ 0.71, plus padding, capped. */
/** A tilted label hangs to the LEFT of its tick (text-anchor end, −45°); the
 * first tick sits at the plot's left edge, so the chart needs that much extra
 * left margin beyond the y-axis or the label is clipped by the card (found in
 * the WP218 phase-1 browser pass at desktop and 375 px). Same 6.5 px/char ×
 * cos 45° estimate as xAxisHeight. */
export function xLabelOverhang(mode: XLabelMode, longestLabel: string): number {
  if (mode === 'flat') return 0;
  return Math.min(96, Math.ceil(longestLabel.length * 6.5 * 0.71));
}

export function xAxisHeight(mode: XLabelMode, longestLabel: string): number | undefined {
  if (mode === 'flat') return undefined;
  return Math.min(96, Math.ceil(longestLabel.length * 6.5 * 0.71) + 20);
}

export function seriesColor(values: Pick<ChartPresentation, 'seriesColors'>, index: number): string {
  return values.seriesColors[index] ?? RECHARTS_PALETTE[index % RECHARTS_PALETTE.length]!;
}

// --- colours -----------------------------------------------------------------
// The card grounds the hollow R11 ring is drawn on (globals.css): light
// --card oklch(1 0 0) = #ffffff, dark --card oklch(0.205 0 0) ≈ #171717.
export const CARD_LIGHT = '#ffffff';
export const CARD_DARK = '#171717';
/** Below this ratio against a card the ring is indistinguishable from it. */
export const COLOR_REFUSE_BELOW = 1.25;
/** Below this the ring is visible but weak — warn, still apply. */
export const COLOR_WARN_BELOW = 3;

export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  return null;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(hexA: string, hexB: string): number {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export type ColorVerdict = { ok: true; warning: 'light' | 'dark' | 'both' | null } | { ok: false; reason: string };

export const COLOR_REFUSAL =
  'Deze kleur is niet toegepast: de open markering voor voorlopige cijfers zou in een van de thema’s onzichtbaar worden.';

/** Round-2: same refuse/warn semantics as `judgeColor`, but against an
 * arbitrary set of backdrops rather than the fixed light/dark card pair —
 * so a series colour (or a brand palette entry) can be judged against
 * whatever is ACTUALLY behind the chart right now (`frameBackdrops`),
 * not only the two card colours. Refuses if contrast is below
 * COLOR_REFUSE_BELOW against ANY backdrop; warns if below COLOR_WARN_BELOW
 * against any (per light/dark card wording only when those two backdrops
 * are exactly the cards — otherwise a generic 'both' reads best). */
export function judgeColorAgainst(hex: string, backdrops: string[]): ColorVerdict {
  const ratios = backdrops.map((backdrop) => contrastRatio(hex, backdrop));
  if (ratios.some((r) => r < COLOR_REFUSE_BELOW)) return { ok: false, reason: COLOR_REFUSAL };
  // The warning names a theme only when the backdrops ARE the two cards
  // (judgeColor's call); against frame backdrops a weak contrast is a plain
  // 'both' — there is no light/dark side to a solid or a gradient.
  const isCardPair = backdrops.length === 2 && backdrops[0] === CARD_LIGHT && backdrops[1] === CARD_DARK;
  if (isCardPair) {
    const weakLight = ratios[0]! < COLOR_WARN_BELOW;
    const weakDark = ratios[1]! < COLOR_WARN_BELOW;
    return { ok: true, warning: weakLight && weakDark ? 'both' : weakLight ? 'light' : weakDark ? 'dark' : null };
  }
  return { ok: true, warning: ratios.some((r) => r < COLOR_WARN_BELOW) ? 'both' : null };
}

/** Owner decision B with the R11 guard: a colour that would hide the hollow
 * provisional ring on EITHER theme's card is refused; a weak one is applied
 * with a per-theme warning. Every stock palette colour passes (pinned). */
export function judgeColor(hex: string): ColorVerdict {
  return judgeColorAgainst(hex, [CARD_LIGHT, CARD_DARK]);
}

// --- fonts -------------------------------------------------------------------
export interface FontOption {
  family: string;
  source: 'system' | 'google';
  stack: string;
}
const SANS = 'ui-sans-serif, system-ui, sans-serif';
const SERIF = 'ui-serif, Georgia, serif';
export const FONT_OPTIONS: readonly FontOption[] = [
  { family: 'Roboto', source: 'google', stack: `"Roboto", ${SANS}` },
  { family: 'Open Sans', source: 'google', stack: `"Open Sans", ${SANS}` },
  { family: 'Lato', source: 'google', stack: `"Lato", ${SANS}` },
  { family: 'Merriweather', source: 'google', stack: `"Merriweather", ${SERIF}` },
  { family: 'Playfair Display', source: 'google', stack: `"Playfair Display", ${SERIF}` },
  { family: 'Georgia', source: 'system', stack: `"Georgia", ${SERIF}` },
  { family: 'Arial', source: 'system', stack: `"Arial", ${SANS}` },
];
// --- frame (design §C2) -------------------------------------------------------
export const FRAME_PADDING_PX: Record<FramePadding, number> = { none: 0, small: 16, medium: 32, large: 56 };
export const FRAME_CORNER_PX: Record<FrameCorners, number> = { square: 0, rounded: 12, veryRounded: 28 };
export const FRAME_INSET_PX: Record<FrameInset, number> = { none: 0, small: 12, large: 24 };
/** One shadow definition used by CSS (box-shadow) and SVG (feDropShadow) alike. */
export const FRAME_SHADOW: Record<FrameShadow, { dx: number; dy: number; blur: number; alpha: number } | null> = {
  none: null,
  soft: { dx: 0, dy: 4, blur: 12, alpha: 0.18 },
  strong: { dx: 0, dy: 10, blur: 28, alpha: 0.32 },
};
export const FRAME_GRADIENT_ANGLE = 135;
export const FRAME_GRADIENT_PRESETS: readonly { id: 'dawn' | 'ocean' | 'forest' | 'berry' | 'slate' | 'sand'; from: string; to: string }[] = [
  { id: 'dawn', from: '#fde68a', to: '#f472b6' },
  { id: 'ocean', from: '#38bdf8', to: '#1e3a8a' },
  { id: 'forest', from: '#bbf7d0', to: '#166534' },
  { id: 'berry', from: '#f9a8d4', to: '#7e22ce' },
  { id: 'slate', from: '#e2e8f0', to: '#334155' },
  { id: 'sand', from: '#fef3c7', to: '#b45309' },
];

const FRAME_ASPECT_RATIOS: Record<Exclude<FrameAspect, 'auto'>, number> = {
  '16:9': 16 / 9,
  '4:5': 4 / 5,
  '1:1': 1,
  '1.91:1': 1.91,
};

export function frameAspectRatio(aspect: FrameAspect): number | null {
  return aspect === 'auto' ? null : FRAME_ASPECT_RATIOS[aspect];
}

/** The colours the series must stay legible against: the inset card colour
 * when inset is on (card light/dark), else the solid hex or both gradient
 * ends; 'none'/'image' → the card colours (today's behaviour). */
export function frameBackdrops(values: Pick<ChartPresentation, 'frameBackground' | 'frameInset'>): string[] {
  if (values.frameInset !== 'none') return [CARD_LIGHT, CARD_DARK];
  const bg = values.frameBackground;
  if (bg === 'none' || bg.kind === 'image') return [CARD_LIGHT, CARD_DARK];
  if (bg.kind === 'solid') return [bg.hex];
  return [bg.from, bg.to];
}

export type FrameValues = Pick<ChartPresentation, 'frameBackground' | 'framePadding' | 'frameCorners' | 'frameShadow' | 'frameInset' | 'frameAspect'>;

export function isFramePristine(values: FrameValues): boolean {
  return (
    values.frameBackground === 'none' &&
    values.framePadding === 'none' &&
    values.frameCorners === 'square' &&
    values.frameShadow === 'none' &&
    values.frameInset === 'none' &&
    values.frameAspect === 'auto'
  );
}

export function findFont(family: string | null): FontOption | undefined {
  return family === null ? undefined : FONT_OPTIONS.find((f) => f.family === family);
}
/** undefined = inherit the page font (the stock look). An unknown family
 * (a brand font, phase 3) gets a sans stack — the name is regex-validated by
 * sanitizeOverrides before it can reach here. */
export function fontStack(family: string | null): string | undefined {
  if (family === null) return undefined;
  return findFont(family)?.stack ?? `"${family}", ${SANS}`;
}
