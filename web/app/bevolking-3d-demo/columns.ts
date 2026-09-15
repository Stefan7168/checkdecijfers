// ADR 049, reworked v2 (D1′, session 104): turns decoded municipality
// polygons into TWO paired three.js meshes per municipality — a
// full-footprint FLOOR tile (the always-visible choropleth terrain, a thin
// fixed depth, never tweened by the year slider) and an INSET COLUMN
// (shrunk ~6% toward its own centroid, so tall neighbouring columns show a
// visible seam instead of fusing into one mass) that sits on top of it at
// the same (x, y). Both share this file's ONE shape-tracing path
// (buildShapes); only the inset factor differs — reusing the existing
// geometry-building path rather than adding a second one. No renderer here
// — pure geometry, unit-tested in jsdom. The year slider only ever touches
// the column mesh's `scale.z`, never rebuilds geometry.
import { ExtrudeGeometry, Mesh, MeshLambertMaterial, Path, Shape } from 'three';
import { MIN_HEIGHT } from './scales.ts';
import { project, type LonLat, type MunicipalityFeature } from './topojson.ts';

export interface ColumnMesh {
  code: string;
  name: string;
  mesh: Mesh<ExtrudeGeometry, MeshLambertMaterial>;
}
export interface FloorMesh {
  code: string;
  name: string;
  mesh: Mesh<ExtrudeGeometry, MeshLambertMaterial>;
}

/** How much the population column shrinks toward its own centroid relative
 * to its full footprint — the floor tile below it keeps the FULL footprint,
 * so the gap this produces between neighbouring columns is what makes tall
 * columns read as distinct buildings rather than a fused coloured mass. */
export const COLUMN_INSET = 0.94;
/** The floor tile's fixed extrusion depth: thin, and NEVER scaled by the
 * year tween — it is the "always visible" terrain layer under the column. */
export const FLOOR_DEPTH = 0.15;
/** Placeholder colour before the scale first applies — the same sanctioned
 * literal ADR 049 D6 already documents for the column mesh, now shared by
 * the floor tile too (not a new colour literal). */
const PLACEHOLDER_COLOR = '#bfbfbf';

type Point = [number, number];

/** Area-weighted-enough centroid for a demo: the mean of the OUTER ring's
 * projected vertices across every polygon in the feature (holes excluded —
 * an inset target doesn't need to account for them). */
function centroidOfOuterRings(polygons: LonLat[][][]): Point {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const rings of polygons) {
    const outer = rings[0];
    if (!outer) continue;
    for (const point of outer) {
      const [x, y] = project(point);
      sx += x;
      sy += y;
      n++;
    }
  }
  return n > 0 ? [sx / n, sy / n] : [0, 0];
}

function traceProjected(points: Point[], target: Shape | Path): void {
  points.forEach(([x, y], i) => {
    if (i === 0) target.moveTo(x, y);
    else target.lineTo(x, y);
  });
  target.closePath();
}

function insetTowards(points: Point[], centroid: Point, factor: number): Point[] {
  if (factor >= 1) return points;
  const [cx, cy] = centroid;
  return points.map(([x, y]): Point => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

/** Traces a feature's rings into three.js Shapes, optionally shrinking every
 * ring toward the feature's own centroid first (a pure client-side geometry
 * transform — no new dependency). `insetFactor === 1` reproduces the
 * original, un-inset footprint (used for the floor tile). */
function buildShapes(f: MunicipalityFeature, insetFactor: number): Shape[] {
  const centroid = insetFactor < 1 ? centroidOfOuterRings(f.polygons) : ([0, 0] as Point);
  return f.polygons.map((rings) => {
    const shape = new Shape();
    traceProjected(insetTowards(rings[0]!.map(project), centroid, insetFactor), shape);
    for (const hole of rings.slice(1)) {
      const path = new Path();
      traceProjected(insetTowards(hole.map(project), centroid, insetFactor), path);
      shape.holes.push(path);
    }
    return shape;
  });
}

export function buildColumns(features: MunicipalityFeature[]): ColumnMesh[] {
  return features.map((f) => {
    const geometry = new ExtrudeGeometry(buildShapes(f, COLUMN_INSET), { depth: 1, bevelEnabled: false });
    const material = new MeshLambertMaterial({ color: PLACEHOLDER_COLOR });
    const mesh = new Mesh(geometry, material);
    mesh.userData = { code: f.code };
    mesh.position.z = FLOOR_DEPTH; // sits ON TOP of the floor tile at the same (x, y)
    mesh.scale.z = MIN_HEIGHT;
    return { code: f.code, name: f.name, mesh };
  });
}

export function buildFloor(features: MunicipalityFeature[]): FloorMesh[] {
  return features.map((f) => {
    const geometry = new ExtrudeGeometry(buildShapes(f, 1), { depth: FLOOR_DEPTH, bevelEnabled: false });
    const material = new MeshLambertMaterial({ color: PLACEHOLDER_COLOR });
    const mesh = new Mesh(geometry, material);
    mesh.userData = { code: f.code };
    return { code: f.code, name: f.name, mesh };
  });
}
