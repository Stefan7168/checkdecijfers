// ADR 049: the structural pins that keep the demo OUT of the product —
// grep-as-a-test, the tests/docs/doc-conventions.test.ts discipline.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `new URL(relative, import.meta.url)` is rewritten by Vite's
// `vite:asset-import-meta-url` plugin under the project's default jsdom
// environment (a "client"-consumer environment) into an http: dev-server
// URL, at which point `fileURLToPath` throws "The URL must be of scheme
// file" — documented at next.config.test.ts:1-23 and hit again here
// (asset.test.ts's fix is the same one applied below).
const DEMO = dirname(fileURLToPath(import.meta.url));
const WEB = join(DEMO, '../..');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (lstatSync(full).isSymbolicLink()) continue; // web/backend → ../src: never walk into the product
    if (entry === 'node_modules' || entry === '.next') continue;
    if (lstatSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}
const outside = [...sources(join(WEB, 'app')), ...sources(join(WEB, 'components')), ...sources(join(WEB, 'lib')), join(WEB, 'proxy.ts')].filter((f) => !f.startsWith(DEMO));
const inside = sources(DEMO);
const read = (f: string): string => readFileSync(f, 'utf8');

describe('bundle isolation — three lives only in this directory, behind one dynamic import', () => {
  it('no file outside the demo directory imports three', () => {
    for (const f of outside) expect(read(f), relative(WEB, f)).not.toMatch(/from\s+['"]three(\/|['"])/);
  });
  it('the loader is the ONLY reference to map3d.tsx, and it is a dynamic import; page.tsx never imports three-touching modules statically', () => {
    const loader = read(join(DEMO, 'map3d-loader.tsx'));
    expect(loader).toMatch(/import\(\s*['"]\.\/map3d\.tsx['"]\s*\)/);
    expect(loader).not.toMatch(/^import .* from ['"]\.\/map3d\.tsx['"]/m);
    const page = read(join(DEMO, 'page.tsx'));
    for (const m of ['map3d.tsx', 'scene.ts', 'columns.ts']) expect(page).not.toContain(`./${m}`);
    for (const f of inside.filter((f) => !/map3d-loader\.tsx$|\.test\.tsx?$/.test(f))) expect(read(f), relative(WEB, f)).not.toMatch(/from ['"]\.\/map3d\.tsx['"]/);
  });
});

describe('product isolation — no real data, no pipeline, no LLM, no live external call', () => {
  it('nothing in the demo directory reaches the backend, the database, the Anthropic SDK, a server action or an http(s) URL', () => {
    // Test files are excluded from this particular scan: THIS file's own
    // source necessarily contains the literal patterns below (they are its
    // own regexes), which would otherwise make the check self-defeating.
    // The invariant this pins is about what SHIPS (the non-test modules);
    // it is unaffected by a test file quoting a pattern it asserts against.
    for (const f of inside.filter((f) => !/\.test\.tsx?$/.test(f))) {
      const src = read(f);
      const name = relative(WEB, f);
      expect(src, name).not.toMatch(/backend\//);
      expect(src, name).not.toMatch(/lib\/db\.ts/);
      expect(src, name).not.toMatch(/@anthropic-ai/);
      expect(src, name).not.toMatch(/['"]use server['"]/);
      expect(src, name).not.toMatch(/fetch\(\s*['"`]https?:/);
    }
  });
});

describe('undiscoverable — nothing links here', () => {
  it('the route string appears nowhere outside its own directory', () => {
    for (const f of outside) expect(read(f), relative(WEB, f)).not.toContain('bevolking-3d-demo');
  });
});
