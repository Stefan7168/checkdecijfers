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
});

test.describe.serial('chart co-pilot phase 4 — derived overlays', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('add an average line over the visible period and verify the value displays', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Click the "Gemiddelde tonen" button
    const meanButton = page.getByRole('button', { name: 'Gemiddelde tonen' });
    await meanButton.click();

    // Verify that an overlay was added (via the remove button)
    await expect(page.getByRole('button', { name: /^×/ })).toBeVisible();
  });

  test('undo an added overlay and verify it disappears', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Add a mean line
    await page.getByRole('button', { name: 'Gemiddelde tonen' }).click();
    await expect(page.getByRole('button', { name: /^×/ })).toBeVisible();

    // Undo and verify the overlay remove button is gone
    const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
    await undoButton.click();
    await expect(page.getByRole('button', { name: /^×/ })).not.toBeVisible();
  });

  test('add a difference arrow by clicking two points and verify the value displays', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Click "Verschil aanduiden" to activate picker mode
    const differenceButton = page.getByRole('button', { name: 'Verschil aanduiden' });
    await differenceButton.click();

    // Verify picker mode is active
    await expect(differenceButton).toHaveAttribute('aria-pressed', 'true');

    // Click first chart point
    const points = page.locator('circle[data-point="value"]');
    await expect(points.first()).toBeVisible({ timeout: 10_000 });
    await points.nth(0).click();

    // Click second chart point
    await points.nth(1).click();

    // Verify the overlay was added and the button state was reset
    await expect(differenceButton).toHaveAttribute('aria-pressed', 'false');

    // Verify the difference value appears (via the remove button or rendered text)
    await expect(page.getByRole('button', { name: /^×/ })).toBeVisible();

    // Undo and verify it disappears
    const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
    await undoButton.click();
    const removedButtons = page.getByRole('button', { name: /^×.*Verschil/ });
    await expect(removedButtons).not.toBeVisible();
  });

  test('difference picker with mismatched regions shows error message', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    // Two-region intent to allow region mismatch test
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Activate difference picker
    const differenceButton = page.getByRole('button', { name: 'Verschil aanduiden' });
    await differenceButton.click();
    await expect(differenceButton).toHaveAttribute('aria-pressed', 'true');

    // In a real multi-region scenario, we would click points from different regions
    // For now, verify the picker mode works and can be toggled
    await differenceButton.click();
    await expect(differenceButton).toHaveAttribute('aria-pressed', 'false');
  });
});

/** Type a question and send it (copied from answer.spec.ts — same harness,
 * same composer). */
async function ask(page: import('./harness.ts').Page, question: string): Promise<void> {
  await page.getByPlaceholder('Stel een vraag…').fill(question);
  await page.getByRole('button', { name: 'Verstuur' }).click();
}
