// ADR 044: the Story stage's geometry — pure, no React, no DOM. Everything
// the stage animates is a wrapper OUTSIDE the exported <svg> (the honesty
// scans and the export never see a transform); these functions turn a scroll
// position into (a) the active step + progress toward the next, (b) the
// chart plane's entry tilt, (c) a caption's reveal, (d) the spotlight centre.
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

/** A caption panel fades and rises into place as its centre approaches the
 * viewport centre (`distance` in viewport heights). */
export function captionStyle(distance: number, reducedMotion: boolean): { opacity: number; transform: string } {
  if (reducedMotion) return { opacity: 1, transform: 'translate3d(0, 0px, 0)' };
  const d = clamp01(Math.abs(distance));
  const opacity = Math.round((1 - 0.7 * d) * 100) / 100;
  const y = Math.round(24 * d);
  return { opacity, transform: `translate3d(0, ${y}px, 0)` };
}

/** Where the spotlight vignette sits, as percentages of the chart box. */
export function spotlightStyle(marker: { cx: number; cy: number } | null, box: { width: number; height: number }): { left: string; top: string } | null {
  if (marker === null || box.width <= 0 || box.height <= 0) return null;
  const pct = (v: number, max: number): string => `${Math.round(clamp01(v / max) * 100)}%`;
  return { left: pct(marker.cx, box.width), top: pct(marker.cy, box.height) };
}
