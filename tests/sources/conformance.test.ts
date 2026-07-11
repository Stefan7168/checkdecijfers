// WP30b (ADR 030 D6): the conformance harness run for every source that has
// fixtures — discovery-driven: any tests/fixtures/<key>/conformance.json is
// picked up automatically. Adding source N = fixtures + manifest + ONE
// FIXTURE_ADAPTERS line below (docs/how-to-add-a-source.md, step 4); the test
// body is parameterized over the discovered manifests.
//
// CBS is the first consumer AND the harness's positive control: the replay
// adapter is the same FixtureSource the rest of the suite uses, so the
// harness exercises the REAL parse-v4 code over the real captured wire data.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FixtureSource, loadCatalogFixture, loadFixtureDocsTree } from '../../src/cbs-adapter/fixture-source.ts';
import type { SourceAdapter } from '../../src/sources/adapters.ts';
import {
  runSourceConformance,
  validateManifestShape,
  type SourceConformanceManifest,
} from '../../src/sources/conformance.ts';
import { SOURCES } from '../../src/sources/registry.ts';

const FIXTURES_ROOT = fileURLToPath(new URL('../fixtures', import.meta.url));

/** Source key → fixture-replay adapter factory. Source N's author adds ONE
 * line here (the replay adapter must run the source's REAL parse code — the
 * FixtureSource pattern, ADR 003/030 D6). */
const FIXTURE_ADAPTERS: Record<string, (fixtureDir: string) => SourceAdapter> = {
  cbs: (dir) => new FixtureSource(loadFixtureDocsTree(dir), loadCatalogFixture(dir)),
};

function discoverManifests(): Array<{ dir: string; manifest: SourceConformanceManifest }> {
  const found: Array<{ dir: string; manifest: SourceConformanceManifest }> = [];
  for (const entry of readdirSync(FIXTURES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(FIXTURES_ROOT, entry.name);
    const manifestPath = join(dir, 'conformance.json');
    if (!existsSync(manifestPath)) continue;
    found.push({
      dir,
      manifest: validateManifestShape(JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath),
    });
  }
  return found;
}

const discovered = discoverManifests();

describe('source conformance (D6: the executable done-definition)', () => {
  it('discovery finds at least the cbs manifest (a silent no-op run would be a rubber stamp)', () => {
    expect(discovered.map((d) => d.manifest.sourceKey)).toContain('cbs');
  });

  it.each(discovered.map((d) => [d.manifest.sourceKey, d] as const))(
    "source '%s' passes its conformance harness on its recorded fixtures",
    async (_key, { dir, manifest }) => {
      const makeAdapter = FIXTURE_ADAPTERS[manifest.sourceKey];
      expect(
        makeAdapter,
        `no FIXTURE_ADAPTERS entry for '${manifest.sourceKey}' — add its replay-adapter factory here`,
      ).toBeDefined();
      const info = SOURCES[manifest.sourceKey];
      expect(
        info,
        `no source registry entry for '${manifest.sourceKey}' — src/sources/registry.ts first`,
      ).toBeDefined();

      const report = await runSourceConformance(makeAdapter!(dir), manifest, info!);
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
    },
  );

  it('the cbs manifest covers every fixture table directory (no silently unchecked fixture)', () => {
    const cbs = discovered.find((d) => d.manifest.sourceKey === 'cbs')!;
    const dirs = readdirSync(cbs.dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const manifested = cbs.manifest.tables.map((t) => t.tableId).sort();
    expect(manifested).toEqual(dirs);
  });
});
