// @vitest-environment node
//
// Per-file override of the project's default `jsdom` environment (vitest.config.ts).
// Required here for a reason that has NOTHING to do with headers() itself:
// next.config.ts's existing (untouched) CA-cert block does
// `new URL("../config/...pem", import.meta.url)`, and Vite's own
// `vite:asset-import-meta-url` plugin (node_modules/vite/dist/node/chunks/node.js,
// `applyToEnvironment: environment.config.consumer === "client"`) rewrites
// exactly that syntax into a resolved dev-server asset URL — but ONLY for a
// "client"-consumer environment, which is what `jsdom` is under Vite's
// environments API. Confirmed empirically: under the default jsdom
// environment, `new URL(relative, import.meta.url)` resolves to
// `http://localhost:3000/@fs/...` (protocol `http:`), so
// `fileURLToPath(...)` throws "The URL must be of scheme file" the instant
// next.config.ts is imported — before headers() is ever reached. Under
// `node` (an "ssr"-consumer environment, where that plugin does not apply),
// the same expression resolves to a real `file://` URL, exactly as it does
// when Next's own CLI loads this file directly under plain Node (the
// scenario next.config.ts's own top-of-file comment already documents). So
// `node` here isn't a workaround bolted on to dodge a failure — it's the
// environment that actually matches how this file is loaded in reality;
// `jsdom` was never the right environment for a config file that touches no
// DOM.
//
// ADR 041: this app's clickjacking-protection headers. Every route must deny
// iframe-embedding (X-Frame-Options: DENY, CSP frame-ancestors 'none')
// EXCEPT /embed/:path* (Task 5, app/embed/[token]/page.tsx) — the one route
// meant to be loaded inside a third-party <iframe>. Next.js applies ALL
// matching headers() entries for a request path, and for the SAME header key
// matched by two entries the LATER entry in the returned array wins. Getting
// the `source` patterns wrong in either direction is a real regression: too
// broad and the whole app stays framable (clickjacking exposure); too narrow
// and the embed feature breaks (a reader's <iframe> refuses to render the
// chart) — so the last test below proves the pattern's actual matching
// behavior against Next's own matcher, not just the shape of the data this
// file returns.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import nextConfig from './next.config.ts';

const require = createRequire(import.meta.url);

describe('framing headers (ADR 041)', () => {
  it('exports an async headers() function', () => {
    expect(typeof nextConfig.headers).toBe('function');
  });

  it('denies framing by default (X-Frame-Options: DENY, CSP frame-ancestors none)', async () => {
    const groups = await nextConfig.headers!();
    const catchAll = groups.find((g) => g.source !== '/embed/:path*');
    expect(catchAll).toBeDefined();
    const byKey = Object.fromEntries(catchAll!.headers.map((h) => [h.key, h.value]));
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });

  it('permits any-origin framing on /embed/:path*, and does NOT also send X-Frame-Options: DENY there', async () => {
    const groups = await nextConfig.headers!();
    const embedGroup = groups.find((g) => g.source === '/embed/:path*');
    expect(embedGroup).toBeDefined();
    const byKey = Object.fromEntries(embedGroup!.headers.map((h) => [h.key, h.value]));
    expect(byKey['Content-Security-Policy']).toContain('frame-ancestors *');
    expect(byKey['X-Frame-Options']).toBeUndefined();
  });

  it('the catch-all source pattern does not itself match /embed paths (so DENY can never win there)', async () => {
    // WHICH MECHANISM, AND WHY: this proves the pattern's real matching
    // behavior against Next's own matcher — a data-shape assertion on the
    // returned array (like the two tests above) cannot catch a wrong regex,
    // because the `source` string is just text to those tests. A wrong
    // regex is exactly the failure mode this task's brief calls out as the
    // real risk, so it gets a real proof, not an inspection.
    //
    // Traced Next 16.3.4's own source (in this repo's node_modules) to find
    // the EXACT call that turns a headers() `source` string into the regex
    // Next actually matches requests against:
    //   next/dist/build/generate-routes-manifest.js — the file that writes
    //     .next/routes-manifest.json — does:
    //       headers: headers.map((r) => buildCustomRoute('header', r))
    //   next/dist/lib/build-custom-route.js's buildCustomRoute does:
    //       pathToRegexp(route.source, [], { strict: true, sensitive: false, delimiter: '/' })
    //   ...calling that `pathToRegexp` from next/dist/compiled/path-to-regexp
    //   — Next's OWN vendored copy of the library, required by its exact
    //   package specifier ("next/dist/compiled/path-to-regexp") the same way
    //   Next's own code requires it.
    //
    // This is deliberately NOT the standalone `path-to-regexp` sitting in
    // this repo's node_modules (a transitive dependency of something else,
    // pulled in at v8.4.2) — that package has a different major version and
    // a different API/behavior than what Next bundles, and asserting against
    // it would prove nothing about what Next itself does with this pattern.
    // Confirmed the two are actually different modules before relying on
    // this: `next/dist/compiled/path-to-regexp/index.js` is a single-file
    // ncc-compiled bundle (old v6-style API: pathToRegexp/match/compile/
    // regexpToFunction), while node_modules/path-to-regexp resolves to a
    // separate v8.4.2 install with an incompatible API shape.
    //
    // This turned out to be the brief's "cheap, direct" option — requiring
    // the exact compiled module Next bundles worked cleanly via plain CJS
    // `require` (no ESM-interop ambiguity to fight), so the fallback
    // (building the app and reading .next/routes-manifest.json's resolved
    // `regex` strings) wasn't needed for this test. That fallback path is
    // still exercised for real, independently, in this task's own Step 5/6
    // (a real `next build` + `curl` against the running app — see the task
    // report), which re-proves the same property on fully compiled output
    // rather than on a re-derivation of it.
    const pathToRegexpModule = require(require.resolve('next/dist/compiled/path-to-regexp')) as {
      pathToRegexp: (source: string, keys: unknown[], options: Record<string, unknown>) => RegExp;
      regexpToFunction: (re: RegExp, keys: unknown[]) => (path: string) => unknown;
    };

    const groups = await nextConfig.headers!();
    const catchAll = groups.find((g) => g.source !== '/embed/:path*');
    const embedGroup = groups.find((g) => g.source === '/embed/:path*');
    expect(catchAll).toBeDefined();
    expect(embedGroup).toBeDefined();

    // Same options buildCustomRoute passes for EVERY header route (see the
    // trace above) — this is not a guess at reasonable-sounding options, it
    // is what Next 16.3.4 itself passes.
    function compile(source: string) {
      const keys: unknown[] = [];
      const regexp = pathToRegexpModule.pathToRegexp(source, keys, {
        strict: true,
        sensitive: false,
        delimiter: '/',
      });
      return pathToRegexpModule.regexpToFunction(regexp, keys);
    }

    const catchAllMatches = compile(catchAll!.source);
    expect(catchAllMatches('/login')).not.toBe(false);
    expect(catchAllMatches('/')).not.toBe(false);
    expect(catchAllMatches('/credits')).not.toBe(false);
    expect(catchAllMatches('/embed/abc123')).toBe(false);

    // Symmetry check: the embed group's OWN source really does match the
    // path the catch-all was just proven to stay out of, using the exact
    // same compilation — so the two groups are proven mutually exclusive on
    // this path, not just "the first one avoids it and we assume the second
    // one covers it".
    const embedMatches = compile(embedGroup!.source);
    expect(embedMatches('/embed/abc123')).not.toBe(false);
  });
});
