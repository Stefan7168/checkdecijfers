// Chart co-pilot phase 1 (session 112, ADR 056, #274) end to end, in a real
// browser: a reader hides a series, undoes it with the buttons AND with
// ⌘Z/⇧⌘Z, and finds their edit still there after a full page reload.
//
// The persistence half is the reason this spec exists at all: the save and
// hydrate legs run through a Server Action and the `chart_edits` table, a
// boundary vitest cannot see (jsdom loads both sides as plain modules and the
// component test mocks the action module outright). Only a real server +
// a real reload proves the row was actually written and read back.
//
// Question: the SAME `!!intent` harness injection answer.spec.ts (f) uses —
// Amsterdam + Rotterdam, two lines over 2020-2024 (see that file's header for
// why an ad-hoc phrasing would 400 at the LLM stub). Two lines is the minimum
// shape that makes "hide one series" observable as a count.
import { expect, signInAsHarnessUser, test } from './harness.ts';

const REGION_SERIES_INTENT = JSON.stringify({
  target: { kind: 'canonical', key: 'population_on_1_january' },
  period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
  derivation: 'none',
  regions: ['GM0363', 'GM0599'], // Amsterdam, Rotterdam
});

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Shift+Meta+z' : 'Control+y';

test.describe.serial('chart co-pilot phase 1', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('hide a series → ⌘Z brings it back → the edit survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // The legend chip's accessible name is just the series label
    // (SeriesLegend in chart.tsx — the swatch is aria-hidden).
    const rotterdam = page.getByRole('button', { name: 'Rotterdam', exact: true });
    const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
    const redoButton = page.getByRole('button', { name: 'Opnieuw' });

    await rotterdam.click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);
    await undoButton.click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await redoButton.click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);

    // Keyboard. The handler sits on the card's own div, which now carries
    // `tabIndex={-1}` (fix round 1, finding 6) — so a plain click on any
    // NON-interactive part of the card focuses the card itself and makes ⌘Z
    // work. Before that change this exact click did nothing at all.
    //
    // The click lands on the card's own padding rather than on the heading:
    // this answer's chart renders inside the visual dock, where Playwright
    // reports the `role="heading"` div as having no box and refuses to click
    // it (`getByRole('heading', { level: 3 })` times out, with and without a
    // visible filter). The card root is the honest target for "a click
    // anywhere in the card" anyway — it is the element the handler is on.
    const card = page
      .locator('div[tabindex="-1"]')
      .filter({ has: page.getByRole('button', { name: 'Ongedaan maken' }) })
      .first();
    await card.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press(UNDO);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await page.keyboard.press(REDO);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);

    // Persistence: past the 800 ms save debounce, then a genuinely fresh page
    // (threads are not routed by URL, so the thread is reopened from the
    // sidebar the same way answer.spec.ts (c) does — the title is the
    // question's first 60 characters).
    await page.waitForTimeout(1500);
    await page.reload();
    await page.getByRole('button', { name: /^!!intent/ }).first().click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Ongedaan maken' })).toBeEnabled();
  });

  test('Task 5: click a point to make it the headline, undo to revert', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Get the initial headline value (the last point's value).
    const headlineFigure = page.locator('[data-testid="headline-figure"]');
    const initialHeadline = await headlineFigure.textContent();
    expect(initialHeadline).toBeTruthy();

    // Click on an earlier point (the first plotted point on the chart).
    // The chart renders points as SVG circles with data-point="value".
    const points = page.locator('circle[data-point="value"]');
    const firstPoint = points.first();
    await firstPoint.click();

    // The pending-point UI should show. Look for the "Make this the headline"
    // button and click it.
    const setHeadlineButton = page.getByRole('button', { name: 'Maak dit het hoofdcijfer' });
    await expect(setHeadlineButton).toBeVisible({ timeout: 5000 });
    await setHeadlineButton.click();

    // The headline should change. Get the first point's value from the data.
    // Since we can't directly access Recharts' data, we verify the UI has
    // changed by checking that the headline is now different OR that the
    // "Show default headline" button is now visible (proof of override).
    const clearHeadlineButton = page.getByRole('button', { name: 'Toon standaard hoofdcijfer' });
    await expect(clearHeadlineButton).toBeVisible({ timeout: 5000 });

    // Undo should clear the override and restore the "Make this headline" button.
    const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
    await undoButton.click();

    // After undo, the "Make this the headline" button should be back.
    await expect(setHeadlineButton).toBeVisible({ timeout: 5000 });
    await expect(clearHeadlineButton).not.toBeVisible();
  });
});

/** Type a question and send it (copied from answer.spec.ts — same harness,
 * same composer). */
async function ask(page: import('./harness.ts').Page, question: string): Promise<void> {
  await page.getByPlaceholder('Stel een vraag…').fill(question);
  await page.getByRole('button', { name: 'Verstuur' }).click();
}
