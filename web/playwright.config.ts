// End-to-end smoke test config (session 110). Seven short Playwright tests that
// drive the REAL app in a REAL browser through the local dev harness
// (scripts/dev-harness/) — zero secrets, zero LLM spend, no production database:
// PGlite holds the hermetic CBS fixture snapshot, :9911 stands in for Supabase
// Auth and :9912 replays the committed LLM fixtures.
//
// Why this exists: session 110's third UX audit found "Bewijs deze cijfers" —
// the product's namesake action — present on a live answer and gone from every
// STORED one, because a server-side import of a 'use client' module threw and
// was swallowed. No unit test could see that: vitest loads both modules as
// plain modules, so the RSC/server-action boundary that actually breaks never
// exists there. Only a real browser against a real server can. The `replay`
// test below is the pin for exactly that class of bug.
//
// The harness lifecycle belongs to Playwright via `webServer` —
// scripts/dev-harness/start-all.mjs brings up all three processes and exits
// non-zero if any of them dies, so a half-started harness fails loudly instead
// of masquerading as a product bug.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The web unit suite is vitest over `**/*.test.{ts,tsx}` (vitest.config.ts);
  // `.spec.ts` under e2e/ belongs to Playwright alone, so neither runner ever
  // picks up the other's files.
  testMatch: '**/*.spec.ts',
  // One user, one fixture database, one thread list: these tests share state by
  // construction (each question spends credits from the same balance and adds a
  // row to the same sidebar), and the replay test deliberately re-opens the
  // thread the previous test created. Serial, single worker, in file order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A retry re-runs only a FAILED test, so the happy path costs nothing extra.
  retries: process.env.CI ? 1 : 0,
  // Generous, not slow: the steady-state tests finish in a few seconds each,
  // but `next dev` compiles routes and server actions ON DEMAND, so whichever
  // test asks the first question pays Turbopack's one-off compile.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3102',
    locale: 'nl-NL',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Escape hatch for a machine where `npx playwright install chromium`
    // cannot reach the download CDN but a compatible Chromium is already on
    // disk — the same CHROMIUM_PATH convention scripts/dev-harness/ask.mjs and
    // shot.mjs already use. Unset (the normal case, including CI) ⇒ Playwright's
    // own managed browser.
    ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../scripts/dev-harness/start-all.mjs',
    url: 'http://localhost:3102/',
    // Locally: reuse a harness the developer already has running. In CI there
    // is never one to reuse, and silently attaching to a stray process would
    // make the run non-hermetic.
    reuseExistingServer: !process.env.CI,
    // Cold start = PGlite restoring the fixture snapshot + registering the
    // Eurostat fixture table + Turbopack compiling `/`.
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
