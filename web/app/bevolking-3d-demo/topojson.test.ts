import { describe, expect, it } from 'vitest';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';
import { areaKm2, decodeMunicipalities, NL_CENTER, project, WORLD_UNITS_PER_DEGREE } from './topojson.ts';

describe('decodeMunicipalities — hand-rolled TopoJSON (ADR 049)', () => {
  it('decodes quantised, delta-encoded arcs and joins them into closed rings', () => {
    const [a, b] = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    expect(a).toMatchObject({ code: 'GM0001', name: 'Aa' });
    expect(b).toMatchObject({ code: 'GM0002', name: 'Bee' });
    const ringA = a!.polygons[0]![0]!;
    const ringB = b!.polygons[0]![0]!;
    const close = (ring: [number, number][], expected: [number, number][]) => {
      expect(ring).toHaveLength(expected.length);
      ring.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(expected[i]![0], 6);
        expect(y).toBeCloseTo(expected[i]![1], 6);
      });
    };
    close(ringA, [[5.1, 52.1], [5, 52.1], [5, 52], [5.1, 52], [5.1, 52.1]]);
    close(ringB, [[5.1, 52], [5.2, 52], [5.2, 52.1], [5.1, 52.1], [5.1, 52]]);
  });
  it('supports MultiPolygon and a topology without a transform (absolute arcs)', () => {
    const raw = {
      type: 'Topology',
      objects: { gemeente_2024: { type: 'GeometryCollection', geometries: [{ type: 'MultiPolygon', arcs: [[[0]], [[1]]], properties: { statcode: 'GM0003', statnaam: 'Cee' } }] } },
      arcs: [
        [[5, 52], [5.1, 52], [5.1, 52.1], [5, 52]],
        [[6, 52], [6.1, 52], [6.1, 52.1], [6, 52]],
      ],
    };
    const [c] = decodeMunicipalities(raw);
    expect(c!.polygons).toHaveLength(2);
    expect(c!.polygons[1]![0]![0]).toEqual([6, 52]);
  });
  it('fails loudly, naming what it found, when the object or the property keys are not what we assume', () => {
    expect(() => decodeMunicipalities({ ...TWO_SQUARES_TOPOLOGY, objects: { other: TWO_SQUARES_TOPOLOGY.objects.gemeente_2024 } })).toThrow(/objects present: other/);
    const badProps = { ...TWO_SQUARES_TOPOLOGY, objects: { gemeente_2024: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0, 1]], properties: { GM_CODE: 'x' } }] } } };
    expect(() => decodeMunicipalities(badProps)).toThrow(/keys present: GM_CODE/);
    expect(() => decodeMunicipalities({ type: 'Nope' })).toThrow();
  });
});

describe('project / areaKm2', () => {
  it('projects around the NL centre, x compressed by cos(lat); the centre maps to the origin', () => {
    expect(project([NL_CENTER.lon, NL_CENTER.lat])).toEqual([0, 0]);
    const [x, y] = project([5.1, 52.1]);
    expect(y).toBeCloseTo(-0.1 * WORLD_UNITS_PER_DEGREE, 6);
    expect(x).toBeCloseTo(-0.2 * Math.cos((52.2 * Math.PI) / 180) * WORLD_UNITS_PER_DEGREE, 6);
  });
  it('a 0.1° square at 52° is roughly 76 km²; a hole is subtracted', () => {
    const [a] = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
    expect(areaKm2(a!)).toBeCloseTo(75.8, 0);
    const withHole = { ...a!, polygons: [[a!.polygons[0]![0]!, [[5.02, 52.02], [5.04, 52.02], [5.04, 52.04], [5.02, 52.04], [5.02, 52.02]] as [number, number][]]] };
    expect(areaKm2(withHole)).toBeLessThan(areaKm2(a!));
    expect(areaKm2(withHole)).toBeGreaterThan(areaKm2(a!) * 0.9);
  });
});
