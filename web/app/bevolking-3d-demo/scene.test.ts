import { describe, expect, it } from 'vitest';
import { buildColumns, buildFloor } from './columns.ts';
import { buildFakeDataset } from './fake-data.ts';
import { CAMERA_HOME, createScene, hasWebGl, HEIGHT_TWEEN_MS } from './scene.ts';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';
import { areaKm2, decodeMunicipalities } from './topojson.ts';

describe('createScene — the no-WebGL path (ADR 049)', () => {
  it('reports no WebGL in jsdom and returns null instead of throwing', () => {
    const canvas = document.createElement('canvas');
    expect(hasWebGl(canvas)).toBe(false);
    const features = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    const dataset = buildFakeDataset(features.map((f) => ({ code: f.code, name: f.name, areaKm2: areaKm2(f) })));
    expect(createScene(canvas, buildColumns(features), buildFloor(features), dataset, { theme: 'light', reducedMotion: false })).toBeNull();
  });
  it('the home camera sits above the map and the tween is short', () => {
    expect(CAMERA_HOME.y).toBeGreaterThan(0);
    expect(HEIGHT_TWEEN_MS).toBeLessThanOrEqual(500);
  });
});
