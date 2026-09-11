import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, seriesColor } from './chart-presentation.ts';
import {
  atmosphereState,
  ATMOSPHERE_INTENSITY_ACTIVE,
  ATMOSPHERE_INTENSITY_OVERVIEW,
  ATMOSPHERE_MIX_MAX_PERCENT,
  captionStyle,
  entranceStyle,
  entryProgress,
  highlightSeriesIndex,
  planeDriftPx,
  planeTransform,
  spotlightStyle,
  STAGE_AUTOPLAY_MS,
  STAGE_ATMOSPHERE_TRANSITION_MS,
  STAGE_TILT_DEG,
  stageProgress,
} from './chart-stage.ts';

describe('stageProgress — which step the viewport centre is on, and how far toward the next', () => {
  const offsets = [0, 800, 1600, 2400];
  const heights = [800, 800, 800, 800];
  it('at the top the first step is active with zero progress', () => {
    expect(stageProgress(0, 800, offsets, heights)).toEqual({ index: 0, progress: 0 });
  });
  it('halfway between two centres the earlier step is active with progress one half', () => {
    // centres at 400, 1200, 2000, 2800; viewport centre = scrollTop + 400
    expect(stageProgress(400, 800, offsets, heights)).toEqual({ index: 0, progress: 0.5 });
  });
  it('past the halfway point the next step takes over and progress restarts', () => {
    const r = stageProgress(900, 800, offsets, heights); // centre 1300 → step 1 (centre 1200), 100/800 toward step 2
    expect(r.index).toBe(1);
    expect(r.progress).toBeCloseTo(0.125, 5);
  });
  it('on the last step progress is 0 and the index never exceeds the last panel', () => {
    expect(stageProgress(10_000, 800, offsets, heights)).toEqual({ index: 3, progress: 0 });
  });
  it('degenerate inputs never throw: no panels → index 0; a zero-height viewport is treated as one pixel', () => {
    expect(stageProgress(0, 800, [], [])).toEqual({ index: 0, progress: 0 });
    expect(stageProgress(0, 0, offsets, heights).index).toBe(0);
  });
});

// Fix round 2 (items 3+4): the entry ramp is its own function, because
// `stageProgress`'s nearest-centre `progress` never reaches 1 — driving the
// tilt with it popped the plane 4°→0° at the first boundary and left the
// first finding to be read at a full tilt. `entryProgress` is 1 by the time
// the first panel's centre reaches the viewport centre, i.e. before any
// number is centred for reading.
describe('entryProgress — the plane has settled before the first caption is centred', () => {
  // The first panel starts one viewport below the top: its centre (1200) is
  // 800 px of scrolling away from the viewport centre (scrollTop + 400).
  const offsets = [800, 1600, 2400];
  const heights = [800, 800, 800];
  it('is 0 at the top of the steps column', () => {
    expect(entryProgress(0, 800, offsets, heights)).toBe(0);
  });
  it('is one half halfway to the first panel’s centre', () => {
    expect(entryProgress(400, 800, offsets, heights)).toBeCloseTo(0.5, 5);
  });
  it('is 1 exactly when the first panel’s centre reaches the viewport centre, and stays 1 beyond it', () => {
    expect(entryProgress(800, 800, offsets, heights)).toBe(1);
    expect(entryProgress(4000, 800, offsets, heights)).toBe(1);
  });
  it('with no panels there is nothing to enter: 1', () => {
    expect(entryProgress(0, 800, [], [])).toBe(1);
  });
  it('a first panel already centred at scrollTop 0 starts settled — the first finding is never read tilted', () => {
    expect(entryProgress(0, 800, [0, 800], [800, 800])).toBe(1);
  });
});

describe('entranceStyle — tilted and lifted on entry, flat once read', () => {
  it('at 0 the plane is tilted STAGE_TILT_DEG, lifted, with a deep shadow; at 1 it is flat with the resting shadow', () => {
    const start = entranceStyle(0, false);
    expect(start.transform).toContain(`rotateX(${STAGE_TILT_DEG}deg)`);
    expect(start.transform).toContain('perspective(');
    const end = entranceStyle(1, false);
    expect(end.transform).toContain('rotateX(0deg)');
    expect(end.boxShadow).not.toBe(start.boxShadow);
  });
  it('clamps progress outside [0, 1]', () => {
    expect(entranceStyle(-3, false)).toEqual(entranceStyle(0, false));
    expect(entranceStyle(7, false)).toEqual(entranceStyle(1, false));
  });
  it('reduced motion is the flat resting state at every progress', () => {
    expect(entranceStyle(0, true)).toEqual(entranceStyle(1, false));
    expect(entranceStyle(0.4, true)).toEqual(entranceStyle(1, false));
  });
});

// ADR 044 §"As built": the plan's §3.4 parallax was not built. This is the
// small, safe substitute — a per-step vertical "breathing" drift on the SAME
// plane wrapper the entry tilt uses, driven by `stageProgress`'s per-step
// progress rather than `entryProgress`. The exact curve is pinned at every
// progress the brief calls out (0, 0.25, 0.5, 0.75, 1) since this is exactly
// the kind of motion a real browser check cannot get from jsdom.
describe('planeDriftPx — a small vertical breathing drift, never a rotation, never a pan toward a point', () => {
  it('is 0 at a step’s own centre, peaks at 5px around the boundary with the next step, and returns to 0', () => {
    expect(planeDriftPx(0, false)).toBe(0);
    expect(planeDriftPx(0.25, false)).toBe(3.54);
    expect(planeDriftPx(0.5, false)).toBe(5);
    expect(planeDriftPx(0.75, false)).toBe(3.54);
    expect(planeDriftPx(1, false)).toBe(0);
  });
  it('is symmetric around progress 0.5 (the sine shape, not a linear ramp)', () => {
    expect(planeDriftPx(0.3, false)).toBe(planeDriftPx(0.7, false));
    expect(planeDriftPx(0.1, false)).toBe(planeDriftPx(0.9, false));
  });
  it('never exceeds the small peak (well under the caption/lift magnitudes elsewhere in this module)', () => {
    for (let p = 0; p <= 1; p += 0.05) expect(planeDriftPx(p, false)).toBeLessThanOrEqual(5);
  });
  it('clamps progress outside [0, 1] exactly like the other stage functions', () => {
    expect(planeDriftPx(-3, false)).toBe(planeDriftPx(0, false));
    expect(planeDriftPx(7, false)).toBe(planeDriftPx(1, false));
  });
  it('reduced motion is always 0, at every progress — the same gate entranceStyle honours, not a second mechanism', () => {
    expect(planeDriftPx(0, true)).toBe(0);
    expect(planeDriftPx(0.5, true)).toBe(0);
    expect(planeDriftPx(1, true)).toBe(0);
  });
});

describe('planeTransform — composes the drift onto the entry transform as a further translateY', () => {
  const entry = entranceStyle(1, false).transform; // the settled, flat entry transform

  it('is byte-identical to the entry transform when there is no drift (0px): the entry’s own behaviour is unaffected', () => {
    expect(planeTransform(entry, 0)).toBe(entry);
  });
  it('appends a translateY for a non-zero drift, leaving the entry transform’s own text untouched', () => {
    const composed = planeTransform(entry, 3.54);
    expect(composed).toBe(`${entry} translateY(3.54px)`);
    expect(composed.startsWith(entry)).toBe(true);
  });
  it('composes with the tilted (non-flat) entry transform exactly the same way', () => {
    const tilted = entranceStyle(0, false).transform;
    expect(planeTransform(tilted, 5)).toBe(`${tilted} translateY(5px)`);
  });
  it('round-trips a full step boundary: settled entry + the peak drift', () => {
    expect(planeTransform(entry, planeDriftPx(0.5, false))).toBe(`${entry} translateY(5px)`);
    expect(planeTransform(entry, planeDriftPx(0, false))).toBe(entry);
  });
});

describe('captionStyle — the active panel is fully shown, far panels fade and sit lower', () => {
  it('distance 0 is fully opaque and untranslated; distance ≥ 1 is faint; reduced motion is always shown', () => {
    expect(captionStyle(0, false)).toEqual({ opacity: 1, transform: 'translate3d(0, 0px, 0)' });
    expect(captionStyle(1, false).opacity).toBeLessThan(0.5);
    expect(captionStyle(1, false).transform).not.toBe('translate3d(0, 0px, 0)');
    expect(captionStyle(1, true)).toEqual({ opacity: 1, transform: 'translate3d(0, 0px, 0)' });
  });
});

describe('spotlightStyle — the vignette centre as percentages of the chart box', () => {
  it('maps the marker to percentages, clamped to the box; null marker → null', () => {
    expect(spotlightStyle({ cx: 160, cy: 64 }, { width: 640, height: 256 })).toEqual({ left: '25%', top: '25%' });
    expect(spotlightStyle({ cx: -10, cy: 999 }, { width: 640, height: 256 })).toEqual({ left: '0%', top: '100%' });
    expect(spotlightStyle(null, { width: 640, height: 256 })).toBeNull();
    expect(spotlightStyle({ cx: 1, cy: 1 }, { width: 0, height: 0 })).toBeNull();
  });
});

describe('constants', () => {
  it('auto-play advances every four seconds; the tilt stays under the spec cap', () => {
    expect(STAGE_AUTOPLAY_MS).toBe(4000);
    expect(STAGE_TILT_DEG).toBeLessThanOrEqual(12);
  });
  it('the atmosphere colour transition is within the brief’s 400-600ms band, and its peak mix stays conservative (a glow, never a wash)', () => {
    expect(STAGE_ATMOSPHERE_TRANSITION_MS).toBeGreaterThanOrEqual(400);
    expect(STAGE_ATMOSPHERE_TRANSITION_MS).toBeLessThanOrEqual(600);
    expect(ATMOSPHERE_MIX_MAX_PERCENT).toBeGreaterThan(0);
    expect(ATMOSPHERE_MIX_MAX_PERCENT).toBeLessThanOrEqual(40);
  });
});

// Ambient atmosphere layer (visual upgrade, task 1 of a chain): only the
// colour-resolution logic and the reduced-motion branch are testable
// without a browser — the brief's own instruction. The actual drifting,
// blurred CSS this feeds is asserted only for WIRING in
// chart-story-stage.test.tsx (e.g. that `--stage-accent` is set to exactly
// what this module resolves); its motion and contrast in a real browser are
// out of reach here — see the task's report.
describe('highlightSeriesIndex — a story step’s highlight key (s<index>) to the series index seriesColor wants', () => {
  it('parses s<N> for any series index', () => {
    expect(highlightSeriesIndex('s0')).toBe(0);
    expect(highlightSeriesIndex('s3')).toBe(3);
    expect(highlightSeriesIndex('s12')).toBe(12);
  });
  it('an overview step (highlight null) falls back to the first series — never a different, invented index', () => {
    expect(highlightSeriesIndex(null)).toBe(0);
  });
  it('a malformed key falls back to the first series rather than throwing or returning NaN', () => {
    expect(highlightSeriesIndex('nope')).toBe(0);
    expect(highlightSeriesIndex('s')).toBe(0);
    expect(highlightSeriesIndex('sX')).toBe(0);
    expect(highlightSeriesIndex('')).toBe(0);
  });
});

describe('atmosphereState — the ambient layer’s colour, intensity and motion gate (never an invented colour)', () => {
  it('resolves the accent through the SAME seriesColor the chart itself draws from, for a custom series colour', () => {
    const overrides = { seriesColors: { 1: '#123456' } };
    expect(atmosphereState(overrides, 's1', false).accent).toBe(seriesColor({ seriesColors: overrides.seriesColors }, 1));
    expect(atmosphereState(overrides, 's1', false).accent).toBe('#123456');
  });
  it('an un-overridden series falls back to the same DEFAULT_PALETTE entry the chart itself uses, for every series index', () => {
    for (let i = 0; i < DEFAULT_PALETTE.length; i++) {
      expect(atmosphereState({}, `s${i}`, false).accent).toBe(DEFAULT_PALETTE[i]);
    }
  });
  it('an overview step (highlight null) uses the FIRST series’ own colour, at reduced intensity — never a different hue', () => {
    const overview = atmosphereState({ seriesColors: { 0: '#abcdef' } }, null, false);
    expect(overview.accent).toBe('#abcdef');
    expect(overview.intensity).toBe(ATMOSPHERE_INTENSITY_OVERVIEW);
    expect(overview.intensity).toBeLessThan(ATMOSPHERE_INTENSITY_ACTIVE);
  });
  it('a step that highlights a real series gets full intensity', () => {
    expect(atmosphereState({}, 's0', false).intensity).toBe(ATMOSPHERE_INTENSITY_ACTIVE);
    expect(atmosphereState({}, 's4', false).intensity).toBe(ATMOSPHERE_INTENSITY_ACTIVE);
  });
  it('the reduced-motion branch: animated is false exactly when staticMotion is true, independent of the highlight or colour', () => {
    expect(atmosphereState({}, 's0', true).animated).toBe(false);
    expect(atmosphereState({}, null, true).animated).toBe(false);
    expect(atmosphereState({}, 's0', false).animated).toBe(true);
    expect(atmosphereState({}, null, false).animated).toBe(true);
  });
  it('static motion never changes the colour or intensity — only whether it animates', () => {
    const overrides = { seriesColors: { 2: '#654321' } };
    const animated = atmosphereState(overrides, 's2', false);
    const staticVariant = atmosphereState(overrides, 's2', true);
    expect(staticVariant.accent).toBe(animated.accent);
    expect(staticVariant.intensity).toBe(animated.intensity);
    expect(staticVariant.animated).toBe(false);
    expect(animated.animated).toBe(true);
  });
});
