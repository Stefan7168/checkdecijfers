// Two 0.1° × 0.1° squares sharing their vertical edge, quantised (scale
// 0.001, translate [5, 52]). A = GM0001 (left), B = GM0002 (right).
// arc 0: A's own three edges, arc 1: the shared edge (bottom → top), arc 2:
// B's own three edges. B uses arc 1 reversed (~1 = -2).
export const TWO_SQUARES_TOPOLOGY = {
  type: 'Topology',
  transform: { scale: [0.001, 0.001], translate: [5, 52] },
  objects: {
    gemeente_2024: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', arcs: [[0, 1]], properties: { statcode: 'GM0001', statnaam: 'Aa' } },
        { type: 'Polygon', arcs: [[2, -2]], properties: { statcode: 'GM0002', statnaam: 'Bee' } },
      ],
    },
  },
  arcs: [
    [[100, 100], [-100, 0], [0, -100], [100, 0]],
    [[100, 0], [0, 100]],
    [[100, 0], [100, 0], [0, 100], [-100, 0]],
  ],
} as const;
