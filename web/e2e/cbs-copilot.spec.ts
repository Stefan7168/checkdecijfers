// Chart co-pilot phase 3 (session 114, ADR 056) end to end, in a real browser
// and with ZERO real model calls: "Pas deze grafiek aan" under a CBS chart
// hides a series through the chat, ⌘Z brings it back, a request for OTHER
// data is handed to the follow-up question path, and the edit survives a
// reload. The one model call is replayed from tests/fixtures/llm/chart-copilot/
// (`npm run chart-copilot:fixtures`, cases in tests/fixtures/chart-copilot/):
// the llm-stub matches on (model, system, question), and the generator built
// those bytes with the REAL request builder, so a prompt edit breaks
// tests/chart/copilot-fixtures.test.ts first, in the unit suite.
//
// Question: the SAME `!!intent` harness injection chart-copilot.spec.ts uses
// (Amsterdam + Rotterdam, 2020–2024) — the fixture cases were captured over
// exactly that spec.
import { expect, signInAsHarnessUser, test } from './harness.ts';

const REGION_SERIES_INTENT = JSON.stringify({
  target: { kind: 'canonical', key: 'population_on_1_january' },
  period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
  derivation: 'none',
  regions: ['GM0363', 'GM0599'], // Amsterdam, Rotterdam
});

/** The fixture cases' messages, verbatim — anything else 400s at the stub. */
const HIDE = 'verberg Rotterdam';
const OTHER_DATA = 'en Utrecht erbij';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Shift+Meta+z' : 'Control+y';

test.describe.serial('the CBS chart co-pilot', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('"verberg Rotterdam" → one curve → ⌘Z → "en Utrecht erbij" becomes a follow-up → reload keeps the log', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await page.getByPlaceholder('Stel een vraag…').fill(`!!intent ${REGION_SERIES_INTENT}`);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // 1. The chat doorway under the card (the same group the own-data card
    // uses), with the CBS tier's own "figures do not change here" line.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await expect(copilot).toBeVisible();
    await expect(copilot).toContainText('De cijfers zelf veranderen hier niet');
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(HIDE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();

    // The reply: one curve left, one chip describing the series change, and
    // the cost line (the ONE digit-bearing string on this strip).
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1, { timeout: 60_000 });
    await expect(copilot.getByText('Applied one change.')).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();

    // 2. ⌘Z on the card walks the chat edit back like any other edit.
    const card = page
      .locator('div[tabindex="-1"]')
      .filter({ has: page.getByRole('button', { name: 'Ongedaan maken' }) })
      .first();
    await card.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press(UNDO);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    // ...and redo puts it back: only the history's PAST is saved, so the
    // edit must be in effect again for the reload below to prove anything.
    await page.keyboard.press(REDO);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);

    // 3. A request for OTHER data is not a view change: the reply offers to
    // ask it as a follow-up, and clicking sends the reader's OWN words into
    // the thread as a new question through the follow-up path (ADR 021 —
    // the harness's follow-up fixtures answer it, here with a clarification
    // naming the credits it would cost). What is proven is the hand-off.
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(OTHER_DATA);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    const followUp = copilot.getByRole('button', { name: 'Stel als vervolgvraag' });
    await expect(followUp).toBeVisible({ timeout: 60_000 });
    await followUp.click();
    await expect(page.getByText(OTHER_DATA, { exact: true })).toBeVisible();
    await expect(page.getByText(/antwoorden op de wedervraag kost/)).toBeVisible({ timeout: 60_000 });

    // 4. Persistence: the chat edit went into the SAME chart_edits log the
    // panel edits use. Past the 800 ms debounce, a fresh page, the thread
    // reopened from the sidebar: Rotterdam is still hidden, Undo is offered.
    await page.waitForTimeout(1500);
    await page.reload();
    await page.getByRole('button', { name: /^!!intent/ }).first().click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Ongedaan maken' }).first()).toBeEnabled();
  });
});
