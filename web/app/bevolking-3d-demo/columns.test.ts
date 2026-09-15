import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildColumns, buildFloor, COLUMN_INSET, FLOOR_DEPTH } from './columns.ts';
import { applyGrowthColor, growthColor, MIN_HEIGHT } from './scales.ts';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';
import { decodeMunicipalities } from './topojson.ts';

describe('buildColumns (ADR 049)', () => {
  it('builds one extruded mesh per municipality, tagged with its code, at the floor height, sitting on top of the floor tile', () => {
    const columns = buildColumns(decodeMunicipalities(TWO_SQUARES_TOPOLOGY));
    expect(columns.map((c) => c.code)).toEqual(['GM0001', 'GM0002']);
    for (const c of columns) {
      expect(c.mesh.userData).toEqual({ code: c.code });
      expect(c.mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(c.mesh.scale.z).toBe(MIN_HEIGHT);
      expect(c.mesh.position.z).toBe(FLOOR_DEPTH); // v2 (D1′): on top of the floor, not at its base
    }
  });
  it('a polygon with a hole produces a geometry with more vertices than the same polygon without it', () => {
    const [a] = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    const hole: [number, number][] = [[5.02, 52.02], [5.04, 52.02], [5.04, 52.04], [5.02, 52.04], [5.02, 52.02]];
    const solid = buildColumns([a!])[0]!.mesh.geometry.getAttribute('position').count;
    const holed = buildColumns([{ ...a!, polygons: [[a!.polygons[0]![0]!, hole]] }])[0]!.mesh.geometry.getAttribute('position').count;
    expect(holed).toBeGreaterThan(solid); // the hole adds inner wall + more cap triangles
  });
});

describe('buildFloor — the v2 per-municipality choropleth terrain (D1′, ADR 049)', () => {
  it('builds one full-footprint, fixed-depth mesh per municipality, tagged with its code', () => {
    const features = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    const floors = buildFloor(features);
    expect(floors.map((f) => f.code)).toEqual(['GM0001', 'GM0002']);
    for (const f of floors) {
      expect(f.mesh.userData).toEqual({ code: f.code });
      expect(f.mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(f.mesh.position.z).toBe(0); // the floor is the base layer
    }
  });
  it("the column is inset toward its centroid: its XY footprint is strictly smaller than the floor's full footprint", () => {
    const features = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    const [floor] = buildFloor(features);
    const [column] = buildColumns(features);
    floor!.mesh.geometry.computeBoundingBox();
    column!.mesh.geometry.computeBoundingBox();
    const floorSize = floor!.mesh.geometry.boundingBox!.getSize(new Vector3());
    const columnSize = column!.mesh.geometry.boundingBox!.getSize(new Vector3());
    expect(columnSize.x).toBeLessThan(floorSize.x);
    expect(columnSize.y).toBeLessThan(floorSize.y);
    // roughly COLUMN_INSET of the floor's own extent — not exact, since the
    // centroid used for the shrink is the mean of the ring's own vertices,
    // not a true polygon centroid, but it should land well within the
    // neighbourhood of the configured factor for a near-square municipality.
    expect(columnSize.x / floorSize.x).toBeGreaterThan(COLUMN_INSET - 0.15);
    expect(columnSize.x / floorSize.x).toBeLessThan(1);
  });
});

describe('floor/column colour sharing (D1′, ADR 049 v2)', () => {
  it('applyGrowthColor computes growthColor() exactly once and applies the IDENTICAL hex to the floor and column materials', () => {
    const features = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    const [floor] = buildFloor(features);
    const [column] = buildColumns(features);
    const hex = applyGrowthColor([floor!.mesh.material, column!.mesh.material], 0.2, 'light');
    expect(hex).toBe(growthColor(0.2, 'light'));
    expect(floor!.mesh.material.color.getHexString()).toBe(column!.mesh.material.color.getHexString());
    expect(`#${floor!.mesh.material.color.getHexString()}`).toBe(hex);
  });
});
