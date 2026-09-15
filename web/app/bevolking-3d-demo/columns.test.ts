import { describe, expect, it } from 'vitest';
import { buildColumns } from './columns.ts';
import { MIN_HEIGHT } from './scales.ts';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';
import { decodeMunicipalities } from './topojson.ts';

describe('buildColumns (ADR 049)', () => {
  it('builds one extruded mesh per municipality, tagged with its code, at the floor height', () => {
    const columns = buildColumns(decodeMunicipalities(TWO_SQUARES_TOPOLOGY));
    expect(columns.map((c) => c.code)).toEqual(['GM0001', 'GM0002']);
    for (const c of columns) {
      expect(c.mesh.userData).toEqual({ code: c.code });
      expect(c.mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(c.mesh.scale.z).toBe(MIN_HEIGHT);
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
