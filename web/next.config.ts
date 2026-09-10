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
  // ADR 041: deny iframe-embedding everywhere EXCEPT /embed/:path*, which is
  // the one route (Task 5, web/app/embed/[token]/page.tsx) meant to be
  // loaded inside a third-party <iframe>. Next applies ALL matching entries
  // for a request path, and for the SAME header key matched by two entries
  // the LATER entry wins — but here the two `source` patterns are mutually
  // exclusive by construction (the catch-all's negative lookahead excludes
  // every `/embed/...` path), so there is no request path both groups ever
  // match, and no header-merge ordering to reason about in practice. See
  // next.config.test.ts for the proof that the exclusion actually holds
  // against Next's own path-to-regexp matcher, not just by inspection.
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
        source: "/embed/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
};

export default nextConfig;
