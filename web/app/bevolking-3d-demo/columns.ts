// ADR 049: turns decoded municipality polygons into three.js meshes. No
// renderer here — this module is unit-tested in jsdom. Each mesh is extruded
// to depth 1 and later SCALED in z to the (fictional) population height, so
// the year slider only touches `scale.z`, never rebuilds geometry.
import { ExtrudeGeometry, Mesh, MeshLambertMaterial, Path, Shape } from 'three';
import { MIN_HEIGHT } from './scales.ts';
import { project, type LonLat, type MunicipalityFeature } from './topojson.ts';

export interface ColumnMesh {
  code: string;
  name: string;
  mesh: Mesh<ExtrudeGeometry, MeshLambertMaterial>;
}

function trace(ring: LonLat[], target: Shape | Path): void {
  ring.forEach((point, i) => {
    const [x, y] = project(point);
    if (i === 0) target.moveTo(x, y);
    else target.lineTo(x, y);
  });
  target.closePath();
}

export function buildColumns(features: MunicipalityFeature[]): ColumnMesh[] {
  return features.map((f) => {
    const shapes = f.polygons.map((rings) => {
      const shape = new Shape();
      trace(rings[0]!, shape);
      for (const hole of rings.slice(1)) {
        const path = new Path();
        trace(hole, path);
        shape.holes.push(path);
      }
      return shape;
    });
    const geometry = new ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
    const material = new MeshLambertMaterial({ color: '#bfbfbf' });
    const mesh = new Mesh(geometry, material);
    mesh.userData = { code: f.code };
    mesh.scale.z = MIN_HEIGHT;
    return { code: f.code, name: f.name, mesh };
  });
}
