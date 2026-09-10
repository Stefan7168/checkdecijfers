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
 * (0 on the last step). Degenerate input never throws. */
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
