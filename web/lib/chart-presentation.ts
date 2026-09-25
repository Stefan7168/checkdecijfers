// WP218 (ADR 039): the chart PRESENTATION layer — pure, no React, no Recharts.
// A presentation is a set of plain user overrides on top of the ADR 042
// designed default (2026-09-11: horizontal grid, hidden axis lines with a
// hairline baseline, DEFAULT_PALETTE) — the session-87 stock look survives
// only as the Classic look; `resolvePresentation` turns (chart context,
// overrides) into the
// EFFECTIVE values Recharts draws from plus the per-option honesty locks the
// panel explains. Nothing here ever enters a ChartSpec, buildChartSpec or an
// audit record — it projects an unchanged server-built spec for display,
// exactly like windowSpec in chart-view-state.ts.
import type { ChartForm } from './chart-view-state.ts';
import type { Lang } from './i18n/messages.ts';

export type LineWidth = 'thin' | 'normal' | 'thick' | 'extraThick';
export const LINE_WIDTH_PX: Record<LineWidth, number> = { thin: 1, normal: 2, thick: 3, extraThick: 4 };
export type MarkerMode = 'all' | 'ends' | 'provisionalOnly';
export type GridMode = 'both' | 'horizontal' | 'none';
export type XLabelMode = 'flat' | 'tilted';
export type OnOff = 'shown' | 'hidden';
export type BaselineMode = 'auto' | 'zero';
export type AreaFill = 'gradient' | 'flat';
export type PieHole = 'none' | 'donut';

export interface ChartPresentation {
  lineWidth: LineWidth;
  markers: MarkerMode;
  grid: GridMode;
  xLabels: XLabelMode;
  axisLines: OnOff;
  valueLabels: OnOff;
  zeroBaseline: BaselineMode;
  /** ADR 042: area form only — a vertical gradient fill (colour at the top
   * fading to almost nothing at the baseline) or the flat fill. Honest
   * either way because the area form already forces a zero baseline. */
  areaFill: AreaFill;
  /** Phase 5b (verified-whole, session 117, spec §11 "donut is styling, not
   * a form"): pie form only — a hole in the middle (the donut look) or none.
   * Honest either way: the slices are the same verified whole, the hole
   * draws nothing and hides nothing. Same mechanism as `areaFill` — one
   * form-specific enum key, never a fourth ChartForm member. */
  pieHole: PieHole;
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

// Series palettes.
// `RECHARTS_PALETTE` — the session-87 "basic Recharts" look (the colours
// Recharts' own documentation examples use). Since ADR 042 (2026-09-11) it
// is no longer the default: it stays for the Classic look and for the
// continuity pins.
export const RECHARTS_PALETTE: readonly string[] = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f', '#ffbb28', '#ff8042'];
// `DEFAULT_PALETTE` — the designed default (ADR 042). The first four are
// Okabe–Ito's blue / vermillion / bluish green / reddish purple (the
// standard colour-blind-safe set); the other four are hand-tuned to the
// same luminance band. Every entry is ≥ 3.0:1 against BOTH card colours
// (no judgeColor warning on either theme — pinned) and the first four stay
// ≥ 0.07 apart in OKLab under simulated protanopia / deuteranopia /
// tritanopia (pinned). One palette for both themes: no theme hook, and the
// export (which resolves against the light theme, #222) needs no special
// case. Cycles for series nine and up; the Tabel view remains the honest
// surface for many series.
export const DEFAULT_PALETTE: readonly string[] = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#b8860b', '#3a8fc4', '#6a5acd', '#6f8d2a'];

/** The session-87 literals (chart.tsx before WP218) — the "Classic" look,
 * kept verbatim for the Classic template and pinned by a test. */
export const CLASSIC_PRESENTATION: ChartPresentation = {
  lineWidth: 'normal',
  markers: 'all',
  grid: 'both',
  xLabels: 'flat',
  axisLines: 'shown',
  valueLabels: 'shown',
  zeroBaseline: 'auto',
  areaFill: 'flat',
  pieHole: 'none',
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

/** The product's stock look = the designed default (ADR 042, 2026-09-11):
 * markers on the first and last point only, a quiet horizontal grid, no
 * axis lines (a hairline baseline is drawn by chart.tsx whenever a grid
 * is shown), a gradient area fill. Deep-equal pinned by a test so the
 * decision cannot drift without an edit. Colour comes from DEFAULT_PALETTE
 * via `seriesColor` (an empty `seriesColors` map = the palette).
 * 2026-09-16 (chart-card polish Task 5, owner-confirmed): small frame
 * padding so the plot no longer sits flush against the rounded, shadowed
 * frame edge b86556f introduced. */
export const STOCK_PRESENTATION: ChartPresentation = {
  lineWidth: 'normal',
  markers: 'ends',
  grid: 'horizontal',
  xLabels: 'flat',
  axisLines: 'hidden',
  valueLabels: 'shown',
  zeroBaseline: 'auto',
  areaFill: 'gradient',
  pieHole: 'none',
  seriesColors: {},
  fontFamily: null,
  language: null,
  frameBackground: 'none',
  framePadding: 'small',
  frameCorners: 'rounded',
  frameShadow: 'soft',
  frameInset: 'none',
  frameAspect: 'auto',
};

export const HEX_COLOR = /^#[0-9a-f]{6}$/;
// A font family is a plain name: letters, digits, spaces — nothing that could
// leak into a CSS string or a Google Fonts URL as syntax.
export const FONT_FAMILY_NAME = /^[A-Za-z0-9 ]{1,40}$/;

// Landing-bundle pass 3 (session 110, docs/session-briefs/2026-09-13-build-
// performance-diagnosis.md "Target A"): this used to be a zod schema
// (`overridesSchema`/`frameBackgroundSchema`/`hexSchema`), but `chart.tsx`
// calls `sanitizeOverrides` (via `withAccountDefault`/`resolvePresentation`)
// on EVERY chart render, including the anonymous landing's own SSR'd
// gallery chart — so `zod` (a ~382 KB chunk) shipped to every first-time
// visitor for a check that, on the render path, only ever re-validates
// already-well-typed `PresentationOverrides` (panel state, a curated
// template's `overrides`, or the once-sanitized account-style context
// value — see chart-style-context.tsx). The untrusted-input case — a raw
// jsonb blob straight off `user_chart_styles`, or a browser-submitted patch
// — is the WRITE path (`app/chart-style-actions.ts`'s `saveMyChartStyle`,
// a `'use server'` action Next.js never bundles into the client), which
// keeps its own private, zod-backed strict validator
// (`sanitizeOverridesStrict` in that file) as the actual security boundary.
// This hand-written validator mirrors that zod schema's exact semantics
// (same enums, same 6-digit-hex-after-lowercasing rule, same `.strict()`
// exact-key-set rule per frameBackground variant) — pinned byte-for-byte by
// the existing `sanitizeOverrides` tests below, which the write path's
// strict validator is ALSO tested against (chart-style-actions.test.ts) so
// the two can never quietly diverge. `zod` is no longer imported by this
// module, so it drops out of `chart.tsx`'s import graph entirely.
const ENUM_OPTIONS: Partial<Record<PresentationKey, readonly string[]>> = {
  lineWidth: ['thin', 'normal', 'thick', 'extraThick'],
  markers: ['all', 'ends', 'provisionalOnly'],
  grid: ['both', 'horizontal', 'none'],
  xLabels: ['flat', 'tilted'],
  axisLines: ['shown', 'hidden'],
  valueLabels: ['shown', 'hidden'],
  zeroBaseline: ['auto', 'zero'],
  areaFill: ['gradient', 'flat'],
  pieHole: ['none', 'donut'],
  framePadding: ['none', 'small', 'medium', 'large'],
  frameCorners: ['square', 'rounded', 'veryRounded'],
  frameShadow: ['none', 'soft', 'strong'],
  frameInset: ['none', 'small', 'large'],
  frameAspect: ['auto', '16:9', '4:5', '1:1', '1.91:1'],
};

// The full override key set, exactly the keys `ChartPresentation` declares
// (and the zod schema's old `.shape` keys) — sanitizeOverrides only ever
// looks at keys named here, so an unknown/extra key on `raw` is ignored the
// same way an unrecognised zod-schema key would be.
const OVERRIDE_KEYS: readonly PresentationKey[] = [
  'lineWidth', 'markers', 'grid', 'xLabels', 'axisLines', 'valueLabels',
  'zeroBaseline', 'areaFill', 'pieHole', 'seriesColors', 'fontFamily', 'language',
  'frameBackground', 'framePadding', 'frameCorners', 'frameShadow',
  'frameInset', 'frameAspect',
];

/** A string, lowercased, matching `HEX_COLOR` (6 hex digits after '#') —
 * the same "transform-then-regex" order the old zod `hexSchema` used, so
 * '#ABCDEF' passes (lowercases first) but '#abc' (3-digit shorthand) still
 * fails. null on anything else. */
function parseHexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const lower = v.toLowerCase();
  return HEX_COLOR.test(lower) ? lower : null;
}

/** Mirrors the old `frameBackgroundSchema` union, including each object
 * variant's `.strict()` — an object with the right `kind` but ANY extra or
 * missing key is rejected outright, not partially accepted. */
function parseFrameBackground(v: unknown): FrameBackground | undefined {
  if (v === 'none') return 'none';
  if (typeof v !== 'object' || v === null) return undefined;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (obj.kind === 'solid' && keys.length === 2 && keys.includes('hex')) {
    const hex = parseHexColor(obj.hex);
    return hex !== null ? { kind: 'solid', hex } : undefined;
  }
  if (obj.kind === 'gradient' && keys.length === 3 && keys.includes('from') && keys.includes('to')) {
    const from = parseHexColor(obj.from);
    const to = parseHexColor(obj.to);
    return from !== null && to !== null ? { kind: 'gradient', from, to } : undefined;
  }
  if (obj.kind === 'image' && keys.length === 1) {
    return { kind: 'image' };
  }
  return undefined;
}

/** Mirrors the old `z.record(z.string(), z.unknown())` + manual per-index
 * loop: any plain object passes the outer shape check, then only integer-
 * string keys with a valid hex value survive into the result. */
function parseSeriesColors(v: unknown): Record<number, string> | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const colors: Record<number, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!/^\d+$/.test(k)) continue;
    const index = Number(k);
    const hex = parseHexColor(val);
    if (Number.isInteger(index) && hex !== null) colors[index] = hex;
  }
  return colors;
}

function parseOverrideValue(key: PresentationKey, value: unknown): { ok: true; value: unknown } | { ok: false } {
  const options = ENUM_OPTIONS[key];
  if (options) {
    return typeof value === 'string' && options.includes(value) ? { ok: true, value } : { ok: false };
  }
  switch (key) {
    case 'seriesColors': {
      const colors = parseSeriesColors(value);
      return colors !== undefined ? { ok: true, value: colors } : { ok: false };
    }
    case 'fontFamily': {
      if (value === null) return { ok: true, value: null };
      if (typeof value === 'string' && FONT_FAMILY_NAME.test(value)) return { ok: true, value };
      return { ok: false };
    }
    case 'language': {
      if (value === null || value === 'nl' || value === 'en') return { ok: true, value };
      return { ok: false };
    }
    case 'frameBackground': {
      const bg = parseFrameBackground(value);
      return bg !== undefined ? { ok: true, value: bg } : { ok: false };
    }
    default:
      return { ok: false };
  }
}

/** Allow-list parse of anything claiming to be overrides (a reducer patch, a
 * stored row, a URL someday). Unknown keys, wrong enum values, malformed
 * colours and non-numeric series indexes are DROPPED, never thrown on. */
export function sanitizeOverrides(raw: unknown): PresentationOverrides {
  if (raw === null || typeof raw !== 'object') return {};
  const out: PresentationOverrides = {};
  // Per-key parse so one bad key doesn't discard its siblings.
  for (const key of OVERRIDE_KEYS) {
    if (!(key in raw)) continue;
    const parsed = parseOverrideValue(key, (raw as Record<string, unknown>)[key]);
    if (!parsed.ok) continue;
    (out as Record<string, unknown>)[key] = parsed.value;
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
  // Phase 5b (verified-whole): a pie has no axis at all, so its slices'
  // own values are the only CBS numbers on the chart — its OWN reason (not
  // valueLabelsBar, which names a staafdiagram), same effect: force shown,
  // lock the toggle.
  valueLabelsPie: 'Zonder waarden toont een taartdiagram alleen verhoudingen: elke punt draagt bewust zijn eigen cijfer.',
} as const;

const ALL_KEYS: PresentationKey[] = ['lineWidth', 'markers', 'grid', 'xLabels', 'axisLines', 'valueLabels', 'zeroBaseline', 'areaFill', 'pieHole', 'seriesColors', 'fontFamily'];
/** Phase 5b: the keys that describe an AXIS or a LINE — none of which a
 * pie has (no x/y axis, no grid, no stroke, no baseline). Removed from
 * `applicable` in pie form the way `areaFill` is removed outside area form:
 * not an honesty lock, simply nothing on the chart for them to act on. */
const AXIS_KEYS: PresentationKey[] = ['lineWidth', 'markers', 'grid', 'xLabels', 'axisLines', 'zeroBaseline'];
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
    // ADR 042: the fill is a property of the area form alone.
    if (ctx.form !== 'area') applicable.delete('areaFill');
    // Phase 5b: the hole is a property of the pie form alone (spec §11).
    if (ctx.form !== 'pie') applicable.delete('pieHole');
    // Phase 5b: stacked and 100%-stacked ARE bar charts (Recharts' own
    // native stacking of one <Bar> per region), so they take the bar
    // branch verbatim — value labels forced shown and the baseline forced
    // to zero, each with the SAME bar reason (they are staafdiagrammen; the
    // wording holds). A stacked bar drawn from a non-zero baseline would
    // misstate every segment's share of the whole.
    if (ctx.form === 'bar' || ctx.form === 'hbar' || ctx.form === 'stacked' || ctx.form === 'stacked100') {
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
    } else if (ctx.form === 'pie') {
      // Phase 5b: a pie has no axis and no stroke — every axis/line key is
      // simply not applicable (AXIS_KEYS). Value labels are forced shown
      // with their own reason: a pie shows no axis at all, so without each
      // slice's own real cell value the reader would be left with bare
      // proportions and not one CBS number (the same honesty rule the bar
      // lock states, for a chart with even less of a scale). `pieHole`,
      // `seriesColors`, `fontFamily` and the frame stay on offer.
      for (const key of AXIS_KEYS) applicable.delete(key);
      values.valueLabels = 'shown';
      locks.valueLabels = LOCK_REASONS.valueLabelsPie;
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

/** Final-review fix I4 (chart.tsx and user-chart.tsx's own, previously
 * duplicated, `<Area>` fillOpacity calculations): an area's fill amount is
 * ONE base fraction per fill type (0.25 for a flat/solid fill, 1 for the
 * gradient — the full-strength, non-dimmed look) times the series' own
 * effective `opacity` (1 normal, 0.35 user-dimmed, 0.25 highlight-dimmed —
 * see chart.tsx's `seriesOpacity`/user-chart.tsx's `opacityFor`), and
 * `opacity` must be the SOLE multiplier — never stacked with a second,
 * separate dim-specific shrink. The pre-fix code branched on a `dimmed`
 * boolean to ALSO swap the base fraction down (0.25→0.1 solid, 1→0.4
 * gradient) and then multiplied THAT by `opacity` again, so a user-dimmed
 * series (opacity 0.35) got both reductions at once: 0.1 × 0.35 = 0.035 (a
 * flat fill at ~3.5% opacity — effectively invisible, defeating the entire
 * point of "dimmed, not hidden"). Extracted as its own pure, directly
 * testable function — area form is single-series-only (`areaFormAllowed`
 * below), so the on-screen legend that drives `opacity` for line/bar charts
 * never mounts for an area chart at all; the only way this ever runs with a
 * genuinely dimmed `opacity` is a command dispatched some other way (e.g.
 * the chat co-pilot's `setDimmed`), which a rendered-UI test cannot easily
 * reach — a plain unit test over this function is the honest way to prove
 * the arithmetic itself is right. */
export function areaFillOpacityFor(areaFill: AreaFill, opacity: number): number {
  return (areaFill === 'gradient' ? 1 : 0.25) * opacity;
}

/** The first and last PLOTTED point of one series (periodCodes) — the
 * anchors of the 'ends' marker mode. Built by chart.tsx from the DISPLAYED
 * (possibly zoomed) spec so the visible window's own ends get markers. */
export interface SeriesEndpoints {
  first: string;
  last: string;
}

/** ADR 042: which point markers are drawn. A provisional point is ALWAYS
 * visible (R11 — the hollow ring is honesty, not styling); 'all' draws every
 * point; 'ends' the first and last plotted point; 'provisionalOnly' none
 * else. Hidden markers stay in the DOM at opacity 0 (chart.tsx), so the
 * [data-point] count, keyboard walking and click-to-annotate never change. */
export function markerVisible(mode: MarkerMode, provisional: boolean, periodCode: string, ends: SeriesEndpoints | null): boolean {
  if (provisional || mode === 'all') return true;
  if (mode === 'provisionalOnly') return false;
  return ends !== null && (periodCode === ends.first || periodCode === ends.last);
}

/** ADR 042: the chart's height follows the card's measured width — 9:16 of
 * it, never below 256 px (the pre-ADR-042 fixed `h-64`) nor above 360 px —
 * so a wide dock or chat chart stops looking squat. An unmeasured width
 * (SSR, jsdom, 0) keeps the 256 px floor. Applied by chart.tsx as an
 * explicit height from a ResizeObserver, never via CSS aspect-ratio (the
 * session-92 battle-test lesson). */
export const CHART_MIN_HEIGHT_PX = 256;
export const CHART_MAX_HEIGHT_PX = 360;
export function chartHeightForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return CHART_MIN_HEIGHT_PX;
  return Math.max(CHART_MIN_HEIGHT_PX, Math.min(CHART_MAX_HEIGHT_PX, Math.round(width * (9 / 16))));
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

/** `index` is the SERIES's own index — an explicit `seriesColors` override
 * (the Style panel, keyed by series index) always wins per series and is
 * looked up on `index`, never on `paletteIndex`. `paletteIndex` (defaults to
 * `index`, so every pre-existing call site is unaffected) is a SEPARATE
 * knob for which palette slot an un-overridden series falls back to.
 * Session 110 UX audit pass 3, row 11: a comparison-shaped chart (every
 * series one point, >= 2 series — `isComparisonShaped`, chart-view-state.ts)
 * passes `paletteIndex: 0` for every series from its caller in chart.tsx, so
 * every un-overridden bar/row shares the palette's first colour instead of
 * cycling through all 8 and repeating after the 8th region — the region is
 * the axis and the measure is the same, so colour was never carrying
 * information there, only running out of distinct values to show. A
 * genuine time series (line/area, and any multi-point `kind: 'bar'`) is
 * never comparison-shaped and keeps passing `paletteIndex === index`, i.e.
 * the unchanged cycling palette. */
export function seriesColor(
  values: Pick<ChartPresentation, 'seriesColors'>,
  index: number,
  paletteIndex: number = index,
): string {
  return values.seriesColors[index] ?? DEFAULT_PALETTE[paletteIndex % DEFAULT_PALETTE.length]!;
}

/** The minimal per-series shape `remapSeriesColorsByIdentity` needs — the
 * same two fields every real `ChartSeries` (`backend/chart/types.ts`)
 * carries, kept structural here rather than importing that type so this
 * file stays the pure "no ChartSpec" leaf its header describes. */
export interface SeriesIdentity {
  label: string;
  regionCode: string | null;
}

/** #287 fix round: a continuing chart's `seriesColors` override is keyed by
 * a series' INDEX within the spec that was showing when the reader set it
 * (chart-config-panel.tsx dispatches `{ seriesColors: { [index]: hex } }`).
 * Carrying that raw index-keyed map onto a NEW spec — as chat.tsx's co-pilot
 * seed does for a follow-up answer that "continues" an earlier card
 * (`extendsPreviousChart`: same table/unit/kind/dims, NOT same series — a
 * different region/series set is entirely possible) — would recolour
 * whichever series happens to land on the same index, not the one the
 * reader actually coloured (#287).
 *
 * This remaps by series IDENTITY instead of position: `regionCode` when the
 * series has one, else `label`. Safe as a unique key because a spec's
 * series are built one-per-region into a `Map<regionCode, ChartSeries>`
 * (src/chart/build.ts's `seriesByRegion`) — at most ONE series per spec can
 * have a null `regionCode` (the single national/measure-labelled series a
 * regionless table produces), so falling back to `label` for that one case
 * never collides with a real region code. A colour whose identity is not
 * present in `toSeries` is DROPPED rather than carried onto an arbitrary
 * index — the honest behaviour once the reader's colour choice no longer
 * applies to anything the new chart actually draws. */
export function remapSeriesColorsByIdentity(
  colors: Record<number, string> | undefined,
  fromSeries: readonly SeriesIdentity[],
  toSeries: readonly SeriesIdentity[],
): Record<number, string> {
  if (colors === undefined || Object.keys(colors).length === 0) return {};
  const identityOf = (series: SeriesIdentity): string => series.regionCode ?? `label:${series.label}`;
  const hexByIdentity = new Map<string, string>();
  for (const [indexKey, hex] of Object.entries(colors)) {
    const series = fromSeries[Number(indexKey)];
    if (series === undefined) continue;
    hexByIdentity.set(identityOf(series), hex);
  }
  const remapped: Record<number, string> = {};
  toSeries.forEach((series, index) => {
    const hex = hexByIdentity.get(identityOf(series));
    if (hex !== undefined) remapped[index] = hex;
  });
  return remapped;
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
  { family: 'Archivo Black', source: 'google', stack: `"Archivo Black", ${SANS}` },
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
// ADR 042: dawn's and sand's dark ends were retuned so no preset refuses any
// DEFAULT_PALETTE colour (the old sand end refused the first default colour,
// i.e. every chart) — gated by a test.
export const FRAME_GRADIENT_PRESETS: readonly { id: 'dawn' | 'ocean' | 'forest' | 'berry' | 'slate' | 'sand'; from: string; to: string }[] = [
  { id: 'dawn', from: '#fde68a', to: '#f9a8d4' },
  { id: 'ocean', from: '#38bdf8', to: '#1e3a8a' },
  { id: 'forest', from: '#bbf7d0', to: '#166534' },
  { id: 'berry', from: '#f9a8d4', to: '#7e22ce' },
  { id: 'slate', from: '#e2e8f0', to: '#334155' },
  { id: 'sand', from: '#fef3c7', to: '#92400e' },
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
