// Shared plumbing for the end-to-end smoke tests (session 110).
//
// Two things every spec here needs and neither should re-invent: the harness's
// session cookie (so a test can be LOGGED IN without a real Supabase project or
// a real magic link), and a console-error watch that fails a test whose page
// threw in the browser — the cheap half of "a real browser would have caught
// it" that costs nothing to keep on.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

// Playwright transpiles the tests to CommonJS (web/ has no `"type": "module"`),
// so `__dirname` is the reliable anchor here and `import.meta.url` is not —
// it throws "Cannot use 'import.meta' outside a module" at load time.
const here = __dirname;

/** The one fixed harness user's `@supabase/ssr` session cookie, written by
 * scripts/dev-harness/auth-stub.mjs when the harness starts (so it exists by
 * the time any test runs — Playwright's `webServer` waits for the app to
 * answer, which is strictly after the stub booted). Also pins the UI language
 * to Dutch, the same thing ask.mjs/shot.mjs do, so the assertions below can
 * match exact copy regardless of the machine's own locale. */
export async function signInAsHarnessUser(context: BrowserContext, baseURL: string): Promise<void> {
  const file = resolve(here, '..', '..', 'scripts', 'dev-harness', 'session-cookie.json');
  const cookies = JSON.parse(readFileSync(file, 'utf8')) as { name: string; value: string }[];
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
  await context.addCookies([{ name: 'lang', value: 'nl', url: baseURL }]);
}

/** Dutch UI without a session — the logged-out landing needs the same language
 * pin, minus the auth cookie. */
export async function useDutch(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addCookies([{ name: 'lang', value: 'nl', url: baseURL }]);
}

/** `test` plus an always-on console-error watch. Anything the browser logs at
 * error level, and any uncaught page exception, fails the test it happened in.
 * Deliberately unfiltered: today every page in this walk is clean, and the day
 * one is not, that is the finding. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      await use(errors);
      expect(errors, 'the browser logged errors on this page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
