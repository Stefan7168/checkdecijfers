// ADR 049: a minimal TopoJSON → municipality-polygon decoder (≈40 lines) and
// the demo's map projection. Hand-rolled instead of `topojson-client` so the
// demo's only new library stays `three`. Validated with zod so a file that is
// not what we assume fails LOUDLY, naming what it actually contains, instead
// of rendering an empty map.
import { z } from 'zod';

export type LonLat = [number, number];
export interface MunicipalityFeature {
  code: string;
  name: string;
  polygons: LonLat[][][];
}

// **Assumption** (open-questions #251): the cartomap gemeente_2024 file keeps
// PDOK/CBS's `statcode`/`statnaam` properties under an object named after the
// file. asset.test.ts (Task 4) verifies this against the real file and prints
// the real keys on a mismatch — the fix is these three constants, nothing else.
export const TOPO_OBJECT = 'gemeente_2024';
export const CODE_KEY = 'statcode';
export const NAME_KEY = 'statnaam';

const arcIndexes = z.array(z.number().int());
const properties = z.record(z.string(), z.unknown()).optional();
const geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), arcs: z.array(arcIndexes), properties }),
  z.object({ type: z.literal('MultiPolygon'), arcs: z.array(z.array(arcIndexes)), properties }),
]);
const topologySchema = z.object({
  type: z.literal('Topology'),
  transform: z.object({ scale: z.tuple([z.number(), z.number()]), translate: z.tuple([z.number(), z.number()]) }).optional(),
  objects: z.record(z.string(), z.object({ type: z.literal('GeometryCollection'), geometries: z.array(geometry) })),
  arcs: z.array(z.array(z.tuple([z.number(), z.number()]))),
});
type Topology = z.infer<typeof topologySchema>;

function decodeArc(topology: Topology, index: number): LonLat[] {
  const arc = topology.arcs[index];
  if (!arc) throw new Error(`topojson: arc ${index} does not exist`);
  const t = topology.transform;
  if (!t) return arc.map(([x, y]) => [x, y]);
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
  });
}

function decodeRing(topology: Topology, indexes: number[]): LonLat[] {
  const out: LonLat[] = [];
  for (const i of indexes) {
    let points = decodeArc(topology, i < 0 ? ~i : i);
    if (i < 0) points = points.slice().reverse();
    out.push(...(out.length > 0 ? points.slice(1) : points));
  }
  return out;
}

export function decodeMunicipalities(raw: unknown, objectName: string = TOPO_OBJECT): MunicipalityFeature[] {
  const topology = topologySchema.parse(raw);
  const object = topology.objects[objectName];
  if (!object) throw new Error(`topojson: object "${objectName}" not found; objects present: ${Object.keys(topology.objects).join(', ')}`);
  return object.geometries.map((g, i) => {
    const props = g.properties ?? {};
    const code = props[CODE_KEY];
    const name = props[NAME_KEY];
    if (typeof code !== 'string' || typeof name !== 'string') {
      throw new Error(`topojson: geometry ${i} lacks string "${CODE_KEY}"/"${NAME_KEY}"; keys present: ${Object.keys(props).join(', ')}`);
    }
    const polygons = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    return { code, name, polygons: polygons.map((rings) => rings.map((ring) => decodeRing(topology, ring))) };
  });
}

// --- projection ---------------------------------------------------------------
// Equirectangular around the middle of the country, x compressed by cos(lat):
// the Netherlands spans ≈ 2.8° of latitude, so this is visually indistinguishable
// from a conformal projection at demo scale and needs no library.
export const NL_CENTER = { lon: 5.3, lat: 52.2 } as const;
export const WORLD_UNITS_PER_DEGREE = 60;
const COS_LAT = Math.cos((NL_CENTER.lat * Math.PI) / 180);

export function project([lon, lat]: LonLat): [number, number] {
  return [(lon - NL_CENTER.lon) * COS_LAT * WORLD_UNITS_PER_DEGREE, (lat - NL_CENTER.lat) * WORLD_UNITS_PER_DEGREE];
}

const KM_PER_DEGREE = 111.2;
function ringAreaKm2(ring: LonLat[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1 * y2 - x2 * y1;
  }
  return (Math.abs(sum) / 2) * KM_PER_DEGREE * KM_PER_DEGREE * COS_LAT;
}
/** Only ever feeds the fake generator's density input — an APPROXIMATE area is fine. */
export function areaKm2(feature: MunicipalityFeature): number {
  return feature.polygons.reduce((total, rings) => total + rings.reduce((acc, ring, i) => acc + (i === 0 ? 1 : -1) * ringAreaKm2(ring), 0), 0);
}
