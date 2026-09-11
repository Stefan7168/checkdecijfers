import { describe, expect, it } from 'vitest';
import { captionStyle, entranceStyle, entryProgress, spotlightStyle, STAGE_AUTOPLAY_MS, STAGE_TILT_DEG, stageProgress } from './chart-stage.ts';

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
});
