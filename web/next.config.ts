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
};

export default nextConfig;
