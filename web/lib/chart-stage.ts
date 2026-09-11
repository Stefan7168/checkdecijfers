// ADR 044: the Story stage's geometry — pure, no React, no DOM. Everything
// the stage animates is a wrapper OUTSIDE the exported <svg> (the honesty
// scans and the export never see a transform); these functions turn a scroll
// position into (a) the active step + progress toward the next, (b) the
// chart plane's entry tilt, (c) a caption's reveal, (d) the spotlight centre,
// (e) the ambient atmosphere layer's colour + motion gate.
import { seriesColor, type PresentationOverrides } from './chart-presentation.ts';

export const STAGE_TILT_DEG = 8; // < the spec's 12° cap; only during the FIRST step's entry
export const STAGE_AUTOPLAY_MS = 4000;

export interface StageProgress {
  index: number;
  progress: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** The step whose panel centre is nearest the viewport centre, and how far
 * the viewport centre has travelled from that centre toward the next one
 * (0 on the last step). Degenerate input never throws.
 *
 * Nearest-centre semantics, stated exactly (the doc comment used to imply a
 * full 0→1 sweep per step, which this function has never produced): the
 * NEAREST panel is the active one, so `progress` is 0 at that panel's own
 * centre and only reaches ~0.5 at the boundary with the next panel — the
 * moment the next panel becomes the nearest and `progress` restarts near 0.
 * Anything that wants a continuous 0→1 ramp must scale it (the stage's
 * captions use `2 * progress`) or use `entryProgress` below. Behaviour is
 * unchanged: `useStageScroll` and its tests pin these exact numbers. */
export function stageProgress(scrollTop: number, viewportHeight: number, offsets: number[], heights: number[]): StageProgress {
  const n = Math.min(offsets.length, heights.length);
  if (n === 0) return { index: 0, progress: 0 };
  const vh = Math.max(1, viewportHeight);
  const centre = scrollTop + vh / 2;
  const centres = Array.from({ length: n }, (_, i) => offsets[i]! + heights[i]! / 2);
  let index = 0;
  for (let i = 1; i < n; i++) if (Math.abs(centres[i]! - centre) < Math.abs(centres[index]! - centre)) index = i;
  if (index >= n - 1) return { index: n - 1, progress: 0 };
  const span = centres[index + 1]! - centres[index]!;
  const progress = span > 0 ? clamp01((centre - centres[index]!) / span) : 0;
  return { index, progress };
}

/** How far the plane's ENTRY has run: 0 at the top of the steps column, 1
 * once the FIRST panel's centre has reached the viewport centre — i.e. the
 * plane is guaranteed flat by the moment the first finding is centred and
 * read. (`stageProgress`'s nearest-centre `progress` caps at ~0.5 and
 * restarts at every boundary, so driving the tilt with it made the plane pop
 * 4°→0° at step one and left the first number to be read at a full 8° tilt —
 * the geometry defect this function exists to remove.)
 *
 * No panels → 1 (nothing to tilt for). First panel already centred at
 * scrollTop 0 → 1: a settled plane from the start, never a tilted first
 * finding. */
export function entryProgress(scrollTop: number, viewportHeight: number, offsets: number[], heights: number[]): number {
  const n = Math.min(offsets.length, heights.length);
  if (n === 0) return 1;
  const vh = Math.max(1, viewportHeight);
  const firstCentre = offsets[0]! + heights[0]! / 2;
  const travel = firstCentre - vh / 2;
  if (travel <= 0) return 1;
  return clamp01(scrollTop / travel);
}

const REST_SHADOW = '0 8px 24px rgba(0, 0, 0, 0.18)';
const LIFT_SHADOW = '0 32px 64px rgba(0, 0, 0, 0.35)';

/** Tilted toward the reader and lifted at progress 0, flat at 1. The
 * transform lives on a wrapper; the svg inside is never transformed. */
export function entranceStyle(progress: number, reducedMotion: boolean): { transform: string; boxShadow: string } {
  const p = reducedMotion ? 1 : clamp01(progress);
  const tilt = Math.round(STAGE_TILT_DEG * (1 - p) * 100) / 100;
  const lift = Math.round(12 * (1 - p));
  return {
    transform: `perspective(1200px) rotateX(${tilt}deg) translate3d(0, ${lift}px, 0)`,
    boxShadow: p >= 1 ? REST_SHADOW : LIFT_SHADOW,
  };
}

// The plan's §3.4 wanted continued motion "between steps" too (parallax);
// ADR 044 §"As built" recorded that as not built — a full multi-layer
// parallax needs Recharts to stop being one SVG. What follows is the small,
// safe substitute: a per-step vertical "breathing" drift on the SAME plane
// wrapper the entry tilt already uses, so the plane is not perfectly static
// for the whole reading. It is driven by `stageProgress`'s PER-STEP
// nearest-centre progress, never `entryProgress` (that ramp is fully spent
// settling the entry tilt before the first caption is read — see above) —
// and it is a translateY only, never rotateX: the tilt stays confined to the
// entry window exactly as ADR 044 decision 4 requires, and this never
// touches it.
const PLANE_DRIFT_PEAK_PX = 5; // small "breathing" peak, well inside the brief's 4-6px band

/** How far the chart plane drifts vertically once it has settled: 0 at a
 * step's own centre (`progress` 0), peaking at `PLANE_DRIFT_PEAK_PX` around
 * the boundary with the next step (`progress` 0.5), back to 0 at `progress`
 * 1 — a sine keeps the motion smooth at both ends so it never pops. Nothing
 * here reads a marker's position (unlike the dropped translate-to-centre pan,
 * ADR 044 decision 5): the direction and magnitude depend only on scroll
 * progress, never on where anything is drawn, so it cannot drift toward a
 * data point. Because `stageProgress` clamps a step's own `progress` to 0
 * until the viewport centre passes that step's centre, this is also always
 * exactly 0 for the whole entry window (`entryProgress` < 1) — the drift and
 * the tilt never run at the same time by construction, not by a guard here. */
export function planeDriftPx(progress: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const p = clamp01(progress);
  return Math.round(Math.sin(p * Math.PI) * PLANE_DRIFT_PEAK_PX * 100) / 100;
}

/** Composes the drift onto the entry transform as a further `translateY`.
 * Appending is equivalent to folding the px into the entry's own
 * `translate3d` Y component (pure translations commute), but keeps
 * `entranceStyle`'s own string untouched so a future change to one cannot
 * silently break the other — and is byte-identical to `entryTransform` when
 * there is no drift to apply (0 px, or reduced motion), so the entry's own
 * behaviour is provably unaffected in that case. */
export function planeTransform(entryTransform: string, driftPx: number): string {
  return driftPx === 0 ? entryTransform : `${entryTransform} translateY(${driftPx}px)`;
}

// Editorial reveal (visual upgrade, task 2 of the chain — captions): on top
// of the existing fade + rise, a far panel is also a touch SOFTER (out of
// focus) and a touch SMALLER, both resolving to nothing by the moment its own
// centre reaches the viewport centre — "sharpens as the panel becomes
// active" per the brief. The opacity and Y-translate formulas below are
// BYTE-IDENTICAL to before this task (only additive fields were introduced),
// so every existing caller of those two numbers — including the component's
// own `caption(i).style.opacity` assertions — is unaffected by this change;
// what changed is the return SHAPE (a new `filter` field) and the
// `transform` string, which now has a `scale(...)` trailing the existing
// `translate3d(...)` — the same append-a-further-transform-function technique
// `planeTransform` already uses on the chart plane, just inlined here since
// there is only ever one caller.
const CAPTION_BLUR_PEAK_PX = 6; // soft, never illegible — distance 0 (the only distance a caption is actually READ at) is always exactly 0
const CAPTION_SCALE_MIN = 0.96; // "a subtle scale" per the brief — a held breath, not a zoom

/** A caption panel fades, rises, softly blurs and shrinks a touch into place
 * as its centre approaches the viewport centre (`distance` in viewport
 * heights). The active panel (distance 0) is always fully opaque, perfectly
 * sharp, unscaled and untranslated — the one state a reader is ever actually
 * reading text in; distance ≥ 1 is faint, translated, gently defocused and a
 * touch smaller, never harder to read than the plain fade already was.
 * Reduced motion collapses to that exact same flat, sharp, at-rest style at
 * EVERY distance — the guarantee this function must never weaken. */
export function captionStyle(distance: number, reducedMotion: boolean): { opacity: number; transform: string; filter: string } {
  if (reducedMotion) return { opacity: 1, transform: 'translate3d(0, 0px, 0)', filter: 'blur(0px)' };
  const d = clamp01(Math.abs(distance));
  const opacity = Math.round((1 - 0.7 * d) * 100) / 100;
  const y = Math.round(24 * d);
  const scale = Math.round((1 - (1 - CAPTION_SCALE_MIN) * d) * 1000) / 1000;
  const blur = Math.round(CAPTION_BLUR_PEAK_PX * d * 100) / 100;
  return {
    opacity,
    transform: `translate3d(0, ${y}px, 0) scale(${scale})`,
    filter: `blur(${blur}px)`,
  };
}

/** Where the spotlight vignette sits, as percentages of the chart box. */
export function spotlightStyle(marker: { cx: number; cy: number } | null, box: { width: number; height: number }): { left: string; top: string } | null {
  if (marker === null || box.width <= 0 || box.height <= 0) return null;
  const pct = (v: number, max: number): string => `${Math.round(clamp01(v / max) * 100)}%`;
  return { left: pct(marker.cx, box.width), top: pct(marker.cy, box.height) };
}

// ─── Ambient atmosphere layer (visual upgrade, task 1 of a chain) ──────────
//
// A full-viewport, purely decorative backdrop behind the chart/caption
// content (chart-story-stage.tsx's `data-stage-atmosphere` layer) — the
// brief was "make the stage feel like a real presentation, not a plain
// overlay". Only the COLOUR + MOTION-GATE inputs to that CSS live here
// (pure, testable without a browser); the actual blurred, drifting shapes
// are plain CSS in the component, because jsdom cannot verify motion at all
// — see this module's own header comment and the component's doc comments
// for what is and isn't checked by a test.

/** `StoryStep.highlight` (chart-story.ts) is `s<index>` — buildRows' own
 * positional series key — or null for an overview step with nothing
 * highlighted. Parses that key into the series index `seriesColor` wants.
 * A null or malformed key (there should never be one, but this never
 * throws) falls back to the FIRST series (index 0) rather than inventing an
 * index out of thin air — `atmosphereState` below is what actually keeps an
 * overview step undramatic (reduced intensity), never a different colour. */
export function highlightSeriesIndex(highlight: string | null): number {
  if (highlight === null) return 0;
  const match = /^s(\d+)$/.exec(highlight);
  return match ? Number(match[1]) : 0;
}

/** The atmosphere's intensity for an overview step (`highlight` null) —
 * "reasonable and undramatic": the same colour as an actively highlighted
 * step would use (never an invented hue), just far less present. */
export const ATMOSPHERE_INTENSITY_OVERVIEW = 0.4;
/** The atmosphere's intensity for a step that highlights a real series. */
export const ATMOSPHERE_INTENSITY_ACTIVE = 1;

/** The atmosphere glow's peak colour-mix percentage (at intensity 1) —
 * deliberately conservative. Every piece of REAL text this product's R4
 * requires to stay legible (the source/attribution line, the caveat notes,
 * the captions) sits inside an OPAQUE `bg-card` container that this layer
 * never shows through regardless of the percentage chosen here, by
 * construction — see the component's doc comment. This cap instead bounds
 * the one thing that ISN'T behind an opaque card: the close/auto-play
 * button chrome, so a glow passing behind that corner never meaningfully
 * moves its contrast. Multiplied by `AtmosphereState.intensity`. */
export const ATMOSPHERE_MIX_MAX_PERCENT = 30;

/** The colour transition's duration when the active step's colour changes —
 * within the brief's 400-600ms band. */
export const STAGE_ATMOSPHERE_TRANSITION_MS = 500;

export interface AtmosphereState {
  /** A raw colour value (e.g. `'#0072b2'`) — never invented: always the
   * active step's own highlighted-series colour, resolved through the
   * SAME `seriesColor` the chart itself draws from, so the glow always
   * matches what is actually drawn. This is the value
   * chart-story-stage.tsx sets `--stage-accent` to. */
  accent: string;
  /** 0-1 multiplier the atmosphere's own colour-mix percentages scale by —
   * `ATMOSPHERE_INTENSITY_OVERVIEW` for a null highlight (an overview
   * step), else `ATMOSPHERE_INTENSITY_ACTIVE`. */
  intensity: number;
  /** False under the SAME `staticMotion` gate `entranceStyle`/
   * `captionStyle`/`planeDriftPx` already use (prefers-reduced-motion,
   * (hover: none), < lg) — not a second motion switch. When false the
   * component shows an instant, static tint with no drift loop and no
   * colour-transition animation (never a missing/broken layer). */
  animated: boolean;
}

/** Resolves the atmosphere layer's colour, intensity and motion gate from
 * the active step's `highlight` key, the chart's own series-colour
 * overrides, and the stage's existing motion gate — pure, so both the
 * colour-resolution logic and the reduced-motion branch are testable
 * without a browser (chart-stage.test.ts pins both; the actual drifting,
 * blurred CSS this feeds cannot be verified outside one — see
 * chart-story-stage.tsx and this task's own report). */
export function atmosphereState(overrides: PresentationOverrides, highlight: string | null, staticMotion: boolean): AtmosphereState {
  return {
    accent: seriesColor({ seriesColors: overrides.seriesColors ?? {} }, highlightSeriesIndex(highlight)),
    intensity: highlight === null ? ATMOSPHERE_INTENSITY_OVERVIEW : ATMOSPHERE_INTENSITY_ACTIVE,
    animated: !staticMotion,
  };
}
