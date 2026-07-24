import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// testTimeout raised from vitest's 5s default (session 56, 2026-07-25).
// app/onboarding-cron.test.ts exercises the route by DYNAMICALLY importing it
// (`await import('./api/onboarding-cron/route.ts')`) inside the test body,
// which pulls the whole backend module graph — the Anthropic SDK, the CBS
// adapter, the ingestion job — through the transform pipeline right there. On a
// loaded machine that import alone exceeds 5s and the test fails as a TIMEOUT,
// not a logic failure: measured green in ~1s on an idle machine, and failing
// here (both with and WITHOUT the session's own changes) while the backend
// suite's PGlite instances were running.
//
// Same class and same fix as the root config's hookTimeout history — slow is
// fine, flaky is not. Deliberately modest: this is a jsdom workspace with no
// database, so a test that genuinely needs longer than this is a bug worth
// seeing rather than a ceiling worth raising again.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15_000,
  },
});
