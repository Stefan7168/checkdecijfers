// The own-data chart co-pilot (session 113, co-pilot phase 2, ADR 056) end to
// end, in a real browser and with ZERO real model calls: upload a CSV, ask for
// a chart, then ask the chat under the card to turn it into totals per
// gemeente as bars — undo it, redo it, reload, and find it still there.
//
// Why this spec exists (and why a component test cannot replace it): every
// boundary this walk crosses is invisible to vitest. The upload is a Server
// Action over FormData; the question and the edit are two more, each charging
// credits through the billing gate; and the persistence leg writes and reads
// `chart_edits` keyed by the DATASET TURN (migration 035) — the PGlite harness
// applies every migration file, so that column exists there. jsdom loads both
// sides of all of it as plain modules, so the only honest proof is a real
// server plus a real reload.
//
// The two model calls are replayed from `tests/fixtures/llm/attachments/`
// (`npm run attachments:fixtures`, cases in `tests/fixtures/attachments/`).
// The llm-stub matches on (model, system, question), and the generator builds
// those bytes with the REAL request builders — so a prompt edit breaks
// `tests/attachments/fixtures.test.ts` first, in the unit suite, rather than
// silently replaying a stale answer here.
import { resolve } from 'node:path';
import { expect, signInAsHarnessUser, test } from './harness.ts';

/** `tests/fixtures/attachments/verkoop.csv` — Jaar;Gemeente;Omzet;Kosten, two
 * gemeenten over two years, so the line chart below has exactly two curves. */
const CSV = resolve(__dirname, '..', '..', 'tests', 'fixtures', 'attachments', 'verkoop.csv');

/** The two case questions, verbatim — anything else 400s at the llm-stub. */
const QUESTION = 'Omzet per jaar per gemeente';
const EDIT = 'totaal per gemeente, hoogste eerst, en maak er staven van';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Shift+Meta+z' : 'Control+y';

test.describe.serial('the own-data chart co-pilot', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('upload → chart → "maak er staven van" → undo → reload keeps the edit', async ({ page }) => {
    // 1. Upload. The file input is the hidden one Chat renders only when
    // `attachments.enabled` (ATTACHMENTS_ENABLED=1, set by the harness) — the
    // visible control is the "Bestand uploaden" chip that clicks it.
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await expect(page.getByRole('button', { name: 'Bestand uploaden' })).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(CSV);

    // The dataset thread: its own composer, and the file's name in the sidebar.
    const composer = page.getByPlaceholder('Stel een vraag over je data…');
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /verkoop\.csv/ }).first()).toBeVisible();

    // 2. The question → one line per gemeente, inside the dashed frame that
    // marks a user-data chart (H2). Two curves, one per gemeente.
    await composer.fill(QUESTION);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    const card = page.locator('div.border-dashed[tabindex="-1"]');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('Your data · unverified');
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // 3. The chat under the card. The reply applies TWO commands — the data
    // change first (copilot/map.ts rule 1), then the form — so the recipe
    // reads as one data chip plus one view chip.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(EDIT);
    await copilot.getByRole('button', { name: 'Versturen' }).click();

    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(2, { timeout: 60_000 });
    await expect(page.locator('.recharts-line-curve')).toHaveCount(0);
    await expect(
      copilot.getByRole('button', { name: 'Data: Som van Omzet per Gemeente, hoogste eerst' }),
    ).toBeVisible();
    await expect(copilot.getByRole('button', { name: 'Weergave: Staaf' })).toBeVisible();

    // The Data panel is the doorway that chip points at, and it agrees with
    // the chart: the summary is a sum.
    const dataTrigger = page.getByRole('button', { name: 'Data', exact: true });
    await dataTrigger.click();
    const aggregate = page.getByLabel('Samenvatten');
    await expect(aggregate).toHaveValue('sum');
    await expect(aggregate.locator('option:checked')).toHaveText('Som');

    // 4. ⌘Z twice — the form command, then the data command. Focus first: the
    // handler sits on the card's own div (`tabIndex={-1}`), so a click on its
    // padding is what makes the keyboard reach it (the same click the phase-1
    // spec documents).
    await card.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press(UNDO);
    await page.keyboard.press(UNDO);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(0);
    await expect(aggregate).toHaveValue('none');
    await expect(aggregate.locator('option:checked')).toHaveText('Geen');

    // 5. Redo both, then reload. Redo is not decoration here: only the
    // history's PAST is saved (`serializeHistory`), so an undone command is
    // deliberately not persisted — putting the edit back is what there is to
    // prove survives the round trip.
    await page.keyboard.press(REDO);
    await page.keyboard.press(REDO);
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(2);

    // Past the 800 ms save debounce, then a genuinely fresh page. Threads are
    // not routed by URL, so the thread is reopened from the sidebar — a
    // dataset thread's title is the stored file name.
    await page.waitForTimeout(1500);
    await page.reload();
    await page.getByRole('button', { name: /verkoop\.csv/ }).first().click();
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(2, { timeout: 60_000 });
    await expect(page.locator('.recharts-line-curve')).toHaveCount(0);
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    const aggregateAfterReload = page.getByLabel('Samenvatten');
    await expect(aggregateAfterReload).toHaveValue('sum');
    await expect(aggregateAfterReload.locator('option:checked')).toHaveText('Som');
  });

  // Own-data co-pilot parity (own-data session continuation): the CBS
  // tier's phase-6 storytelling primitives (goal line, era shading,
  // derived overlay) ported to this card. One real round trip is the proof
  // for the shared mechanism — same reasoning chart-copilot.spec.ts's own
  // era-shading test documents: all three cases share this chart's request
  // shape and differ only in message, so an `exact` llm-stub hit on this
  // one proves the prompt/capabilities bytes are unchanged for the other
  // two as well. Difference is chosen over the other two because it is
  // the one with genuinely NEW server-side computation behind it
  // (requestDatasetDerivation -> deriveChartOverlay) — unlike a goal line
  // or era shading, which are pure client-side annotations, this is the
  // path most worth proving against a REAL server action, not a mock.
  const DIFFERENCE_MESSAGE = 'Laat het verschil zien tussen Amsterdam in 2020 en 2021';

  test(`"${DIFFERENCE_MESSAGE}" through the chat draws a real, server-computed overlay`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await expect(page.getByRole('button', { name: 'Bestand uploaden' })).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(CSV);
    const composer = page.getByPlaceholder('Stel een vraag over je data…');
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(QUESTION);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(DIFFERENCE_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();

    // The chip proves the chat->schema->map->command chain; the drawn
    // ReferenceLine (with a real, server-computed label, per this session's
    // own R6-analog distinction from a reader-typed goal line/era label)
    // proves requestDatasetDerivation really ran, for real, not mocked.
    await expect(copilot.getByRole('button', { name: 'Overlay toegevoegd' })).toBeVisible({ timeout: 60_000 });
    const chartContainer = page.locator('[data-testid="user-chart-container"]');
    await expect(chartContainer.locator('.recharts-reference-line')).toHaveCount(1, { timeout: 15_000 });
    // Amsterdam: 100 (2020) -> 150 (2021) per verkoop.csv — a difference of
    // +50 (later minus earlier), 0 decimals (both source cells are whole
    // numbers, per decimalsOf's own rule).
    await expect(chartContainer).toContainText('+50');
  });
});
