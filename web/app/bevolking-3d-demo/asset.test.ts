import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { areaKm2, decodeMunicipalities } from './topojson.ts';

// `new URL('../../public/...', import.meta.url)` would be rewritten by Vite's
// `vite:asset-import-meta-url` plugin under the project's default jsdom
// environment (a "client"-consumer environment) into an http: dev-server
// URL, at which point `fileURLToPath` throws "The URL must be of scheme
// file" — documented at next.config.test.ts:1-23. dirname()+join() on this
// file's own `import.meta.url` (chart.test.tsx:891's precedent) avoids that
// special-cased syntax entirely, so this test needs no environment override.
const currentDir = dirname(fileURLToPath(import.meta.url));
const ASSET = join(currentDir, '../../public/demo/gemeente_2024.topojson');

describe('the committed boundary asset (ADR 049) — real shapes, real names, and nothing else real', () => {
  it('exists, is the expected size class, and decodes under our assumed object/property names', () => {
    const size = statSync(ASSET).size;
    expect(size).toBeGreaterThan(100_000);
    expect(size).toBeLessThan(400_000);
    const features = decodeMunicipalities(JSON.parse(readFileSync(ASSET, 'utf8')));
    expect(features.length).toBeGreaterThanOrEqual(300);
    expect(features.length).toBeLessThanOrEqual(400);
    const codes = new Set(features.map((f) => f.code));
    expect(codes.size).toBe(features.length);
    for (const f of features) {
      expect(f.code).toMatch(/^GM\d{4}$/);
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.polygons.length).toBeGreaterThan(0);
      for (const rings of f.polygons) {
        const outer = rings[0]!;
        expect(outer.length).toBeGreaterThanOrEqual(4);
        expect(outer[0]).toEqual(outer[outer.length - 1]);
        for (const [lon, lat] of outer) {
          expect(lon).toBeGreaterThan(3.2);
          expect(lon).toBeLessThan(7.3);
          expect(lat).toBeGreaterThan(50.7);
          expect(lat).toBeLessThan(53.7);
        }
      }
    }
    const total = features.reduce((sum, f) => sum + areaKm2(f), 0);
    expect(total).toBeGreaterThan(30_000);
    expect(total).toBeLessThan(45_000);
  });
});
