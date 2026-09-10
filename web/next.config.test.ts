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
// EXCEPT /embed/:path+ (Task 5, app/embed/[token]/page.tsx) — the one route
// meant to be loaded inside a third-party <iframe>. Next.js applies ALL
// matching headers() entries for a request path, and for the SAME header key
// matched by two entries the LATER entry in the returned array wins. Getting
// the `source` patterns wrong in either direction is a real regression: too
// broad and the whole app stays framable (clickjacking exposure); too narrow
// and the embed feature breaks (a reader's <iframe> refuses to render the
// chart) — so the tests below prove the patterns' actual matching behavior
// against Next's own matcher, not just the shape of the data this file
// returns.
//
// Group identification in these tests: the catch-all group is identified by
// a POSITIVE property — it's the group carrying the `X-Frame-Options`
// header — rather than by negating the embed group's `source` string.
// Identifying it by negation (e.g. `g.source !== '/embed/:path+'`) would
// silently misidentify things the moment a THIRD header group is ever added
// to this config (an HSTS or X-Content-Type-Options block, say): every group
// that isn't the embed group would satisfy that negation, not just the
// intended catch-all. A positive property stays correct regardless of how
// many other groups exist later.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import nextConfig from './next.config.ts';

const require = createRequire(import.meta.url);

// Same module and same options Next 16.3.4 itself uses to compile a
// headers() `source` string into the regex it matches real requests against
// — traced from next/dist/build/generate-routes-manifest.js (writes
// .next/routes-manifest.json) into next/dist/lib/build-custom-route.js's
// `buildCustomRoute`:
//   pathToRegexp(route.source, [], { strict: true, sensitive: false, delimiter: '/' })
// ...via `next/dist/compiled/path-to-regexp` — Next's own vendored,
// ncc-compiled copy (old v6-style API: pathToRegexp/match/compile/
// regexpToFunction). This is deliberately NOT the unrelated standalone
// `path-to-regexp` package that also happens to sit in this repo's
// node_modules (someone else's transitive dependency, a different major
// version — v8.4.2 — with an incompatible API): asserting against that one
// would prove nothing about what Next itself does with this pattern.
const pathToRegexpModule = require(require.resolve('next/dist/compiled/path-to-regexp')) as {
  pathToRegexp: (source: string, keys: unknown[], options: Record<string, unknown>) => RegExp;
  regexpToFunction: (re: RegExp, keys: unknown[]) => (path: string) => unknown;
};

function compile(source: string) {
  const keys: unknown[] = [];
  const regexp = pathToRegexpModule.pathToRegexp(source, keys, {
    strict: true,
    sensitive: false,
    delimiter: '/',
  });
  return pathToRegexpModule.regexpToFunction(regexp, keys);
}

describe('framing headers (ADR 041)', () => {
  it('exports an async headers() function', () => {
    expect(typeof nextConfig.headers).toBe('function');
  });

  it('denies framing by default (X-Frame-Options: DENY, CSP frame-ancestors none)', async () => {
    const groups = await nextConfig.headers!();
    const catchAll = groups.find((g) => g.headers.some((h) => h.key === 'X-Frame-Options'));
    expect(catchAll).toBeDefined();
    const byKey = Object.fromEntries(catchAll!.headers.map((h) => [h.key, h.value]));
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });

  it('permits any-origin framing on /embed/:path+, and does NOT also send X-Frame-Options: DENY there', async () => {
    const groups = await nextConfig.headers!();
    const embedGroup = groups.find((g) => g.source === '/embed/:path+');
    expect(embedGroup).toBeDefined();
    const byKey = Object.fromEntries(embedGroup!.headers.map((h) => [h.key, h.value]));
    expect(byKey['Content-Security-Policy']).toContain('frame-ancestors *');
    expect(byKey['X-Frame-Options']).toBeUndefined();
  });

  it("the catch-all source pattern does not itself match /embed paths (so DENY can never win there)", async () => {
    // WHICH MECHANISM, AND WHY: this proves the pattern's real matching
    // behavior against Next's own matcher (see the module-level `compile`
    // helper above for exactly which module/options, and why) — a
    // data-shape assertion on the returned array (like the two tests above)
    // cannot catch a wrong regex, because the `source` string is just text
    // to those tests. A wrong regex is exactly the failure mode this task's
    // brief calls out as the real risk, so it gets a real proof, not an
    // inspection.
    const groups = await nextConfig.headers!();
    const catchAll = groups.find((g) => g.headers.some((h) => h.key === 'X-Frame-Options'));
    const embedGroup = groups.find((g) => g.source === '/embed/:path+');
    expect(catchAll).toBeDefined();
    expect(embedGroup).toBeDefined();

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

  it('the bare /embed path (no token) matches ONLY the catch-all group, not the embed group', async () => {
    // Proof for the fix that closed the one real overlap on a served path.
    // The embed route (app/embed/[token]/page.tsx) has a REQUIRED dynamic
    // segment, so `/embed` alone is never a real page — but the earlier
    // `source`, `/embed/:path*` (zero-or-more segments), matched bare
    // `/embed` too, putting it in BOTH groups at once. Confirmed live before
    // this fix: `curl -sI /embed` returned both `X-Frame-Options: DENY` and
    // `Content-Security-Policy: frame-ancestors *` on the same response, and
    // per the CSP spec browsers ignore X-Frame-Options whenever
    // frame-ancestors is present — so that response was technically
    // framable, even though /embed itself serves no real content (just the
    // default 404 shell). `/embed/:path+` (one-or-more) requires a segment,
    // so bare `/embed` now falls out of the embed group entirely and only
    // the catch-all (DENY, unopposed) applies.
    //
    // Verified directly against next/dist/compiled/path-to-regexp before
    // writing this assertion: compiling the OLD source '/embed/:path*'
    // matches '/embed' (truthy) same as the catch-all does (the overlap);
    // compiling the NEW source '/embed/:path+' does not (false).
    const groups = await nextConfig.headers!();
    const catchAll = groups.find((g) => g.headers.some((h) => h.key === 'X-Frame-Options'));
    const embedGroup = groups.find((g) => g.source === '/embed/:path+');
    expect(catchAll).toBeDefined();
    expect(embedGroup).toBeDefined();

    expect(compile(catchAll!.source)('/embed')).not.toBe(false);
    expect(compile(embedGroup!.source)('/embed')).toBe(false);
  });

  it('documents a known, accepted quirk: header-source matching is case-insensitive, so /EMBED/<token> still matches the embed group even though the real [token] route is case-sensitive and never serves anything there', async () => {
    // This is a "pin the current, accepted behavior" test, not a "this must
    // never happen" test. `buildCustomRoute` compiles every headers()
    // `source` with `sensitive: false` (see the module-level `compile`
    // helper above) — that's Next's own default, not something this config
    // opts into — while this app's actual file-based routing for
    // app/embed/[token]/page.tsx is case-sensitive, so `/EMBED/abc123` (or
    // any other-cased variant) 404s for real but still gets the permissive
    // `frame-ancestors *` header at the headers-matching layer. This is the
    // same "gets the permissive header, serves nothing real" shape as the
    // bare-/embed case above, just via case rather than path shape. Closing
    // it structurally would need `experimental.caseSensitiveRoutes: true`,
    // which has a much broader blast radius than this one route (out of
    // scope — see next.config.ts's file-level comment). If a future change
    // deliberately alters this (e.g. flipping `sensitive`, or adding
    // per-route case sensitivity), this test should force that change to be
    // conscious, not a silent drift.
    const groups = await nextConfig.headers!();
    const embedGroup = groups.find((g) => g.source === '/embed/:path+');
    expect(embedGroup).toBeDefined();

    expect(compile(embedGroup!.source)('/EMBED/abc123')).not.toBe(false);
  });
});
