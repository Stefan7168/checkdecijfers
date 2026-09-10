import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Bake the pinned Supabase CA cert (src/db/client.ts) into DATABASE_CA_CERT
// at build time. This runs under plain Node (next.config.ts is loaded
// directly by the Next CLI, never bundled by Turbopack), so
// import.meta.url/fileURLToPath work exactly as they do in the CLI scripts —
// unlike inside a Turbopack-bundled server function, where the same
// resolution pattern is silently reinterpreted as a client-asset reference
// (ADR 018 decision 7; src/db/client.ts has the full explanation). The cert
// is Supabase's *public* root CA, not a secret, so baking its contents into
// the build output carries no exposure risk.
const CA_PATH = fileURLToPath(new URL("../config/supabase-prod-ca-2021.pem", import.meta.url));

const nextConfig: NextConfig = {
  env: {
    DATABASE_CA_CERT: readFileSync(CA_PATH, "utf8"),
  },
  // ADR 041: deny iframe-embedding everywhere EXCEPT /embed/:path+, which is
  // the one route (Task 5, web/app/embed/[token]/page.tsx) meant to be
  // loaded inside a third-party <iframe>. Next applies ALL matching entries
  // for a request path, and for the SAME header key matched by two entries
  // the LATER entry wins. On every REAL served path the two `source`
  // patterns are mutually exclusive: a real embed page always has a token
  // segment ([token] is a required dynamic segment, so `/embed/:path+` —
  // one-or-more, not zero-or-more — is the accurate match for it), and the
  // catch-all's negative lookahead excludes every `/embed/...` path. See
  // next.config.test.ts for the proof that the exclusion actually holds
  // against Next's own path-to-regexp matcher, not just by inspection.
  //
  // Two known, accepted quirks remain on paths that never reach the real
  // embed page — both are "gets the permissive header, but no real embed
  // content behind it" shapes, not security regressions, and neither is
  // worth closing given the cost:
  //   1. Bare `/embed` (no token at all) is why `:path+` matters: with the
  //      earlier `:path*` (zero-or-more) it matched BOTH groups at once —
  //      confirmed live, `curl -sI /embed` returned both `X-Frame-Options:
  //      DENY` and `frame-ancestors *`, and per the CSP spec browsers ignore
  //      X-Frame-Options whenever frame-ancestors is present, so that
  //      response was technically framable. `:path+` requires a segment, so
  //      bare `/embed` now falls out of the embed group entirely and only
  //      the catch-all (DENY) applies. (In this local run bare `/embed`
  //      307-redirects to /login, same as any other unrecognized path — not
  //      that it particularly matters what it does, since it's the HEADERS
  //      that this fix is about.)
  //   2. Header-source matching is case-INSENSITIVE by Next's own default
  //      (`sensitive: false` — see next.config.test.ts), while this app's
  //      real `[token]` route matching is case-SENSITIVE. So `/EMBED/<any>`
  //      (or any other-cased variant) still matches this embed group and
  //      gets `frame-ancestors *`, even though the case-sensitive dynamic
  //      route can never match it — so it never reaches the real embed page
  //      (confirmed live: currently a 307 redirect to /login, same generic
  //      handling as any other unrecognized path). Closing this
  //      structurally would need `experimental.caseSensitiveRoutes: true`,
  //      which has a much broader blast radius than this one route — out of
  //      scope here. Pinned as expected, current behavior in
  //      next.config.test.ts.
  async headers() {
    return [
      {
        // Everything NOT under /embed/. Kept as a regex-negative-lookahead
        // source (rather than e.g. a hardcoded list of other routes) so a
        // brand-new top-level route is DENY-protected by default the moment
        // it's added, with zero risk of someone forgetting to list it here.
        source: "/:path((?!embed/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        // The embed feature's whole point is third-party framing, so no
        // X-Frame-Options here at all (not even ALLOWALL, which isn't a
        // real directive) — only the modern CSP directive, wide open.
        // `:path+` (one-or-more segments), deliberately not `:path*`
        // (zero-or-more) — see the file-level comment above for why the
        // bare `/embed` path must NOT match this group.
        source: "/embed/:path+",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
};

export default nextConfig;
