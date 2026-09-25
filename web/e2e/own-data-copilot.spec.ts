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
import type { Locator } from '@playwright/test';
import { expect, signInAsHarnessUser, test } from './harness.ts';

/** `tests/fixtures/attachments/verkoop.csv` — Jaar;Gemeente;Omzet;Kosten, two
 * gemeenten over two years, so the line chart below has exactly two curves. */
const CSV = resolve(__dirname, '..', '..', 'tests', 'fixtures', 'attachments', 'verkoop.csv');

/** The two case questions, verbatim — anything else 400s at the llm-stub. */
const QUESTION = 'Omzet per jaar per gemeente';
const EDIT = 'totaal per gemeente, hoogste eerst, en maak er staven van';

/** `instruct/omzet-min-kosten-2021` / `-2020` (tests/fixtures/attachments/
 * cases.ts, Task 5): the same verkoop.csv, `derived: {op:'difference',
 * b:'c3'}` (Omzet minus Kosten) joined to `seriesBy:'c1'` and a single-year
 * filter — a one-moment, two-gemeente shape reached straight from upload,
 * `ownDataPieFormAllowed`'s own qualifying shape. Verbatim question text;
 * anything else 400s at the llm-stub. */
const DIFF_2021_QUESTION = 'Verschil tussen omzet en kosten per gemeente in 2021';
const DIFF_2020_QUESTION = 'Verschil tussen omzet en kosten per gemeente in 2020';

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

  // setDimmed / setHeadlineOverride (session 122, further continuation,
  // open-questions #311's own residual note): the two phase-6 primitives
  // the original parity pass skipped on the wrong assumption that the
  // PANEL already dispatching them generically (via the shared reducer)
  // meant the CHAT could name them too — it could not, until this. Both
  // reuse `chart-series-legend.tsx`/`chart-notes.tsx`, the literal SAME
  // components chart-copilot.spec.ts's own dim/headline tests exercise —
  // so the same locators and i18n text apply here, confirmed by reading
  // the source (aria-label 'Voeg notitie toe bij {series}, {period}'
  // rather than guessed), not assumed from CBS-tier parity alone.
  const DIM_MESSAGE = 'Dim Rotterdam in plaats van hem te verbergen';
  const HEADLINE_MESSAGE = 'Maak van Amsterdam in 2021 het hoofdcijfer';

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

  test(`"${DIM_MESSAGE}" through the chat dims the series the panel's own Dim button would`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await expect(page.getByRole('button', { name: 'Bestand uploaden' })).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(CSV);
    const composer = page.getByPlaceholder('Stel een vraag over je data…');
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(QUESTION);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    const dimButton = page.getByRole('button', { name: /Dim Rotterdam/ });
    await expect(dimButton).toHaveAttribute('aria-pressed', 'false');

    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(DIM_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();

    // The chip proves the chat->schema->map->command chain; the reduced
    // opacity (dimmed, not hidden — both curves still render) and the
    // panel's OWN Dim button now reading pressed prove the shared reducer
    // state genuinely changed, not just that a chip rendered.
    await expect(copilot.getByRole('button', { name: 'Serie verzwakt' })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(page.locator('path[stroke-opacity="0.35"]')).toHaveCount(1, { timeout: 5_000 });
    await expect(dimButton).toHaveAttribute('aria-pressed', 'true');
  });

  test(`"${HEADLINE_MESSAGE}" through the chat features the point the panel's own click would`, async ({ page }) => {
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
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(HEADLINE_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByRole('button', { name: 'Hoofdcijfer aangepast' })).toBeVisible({ timeout: 60_000 });

    // This card has no journalist-style "headline figure" block (that is a
    // CBS/Eurostat-only feature) — the ONE place `headlineOverrideResultId`
    // is observable here is the SAME point's own notes popover, which
    // ChartNotes (shared with the CBS tier) renders differently once an
    // override is set. Reopening Amsterdam's 2021 point — found by its own
    // aria-label, read from the source rather than guessed — proves the
    // state the chat command wrote is the real one the panel would read.
    await page.getByRole('button', { name: 'Voeg notitie toe bij Amsterdam, 2021' }).click();
    await expect(page.getByRole('button', { name: 'Toon standaard hoofdcijfer' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Maak dit het hoofdcijfer' })).toHaveCount(0);
  });
});

// Own-data chart-fit + verified-whole parity, Task 5's own e2e coverage
// (plan 2026-09-22): the six forms Tasks 1-4 already put on the PANEL
// (dumbbell/slope/heatmap, then pie/stacked/stacked100 with the
// reader-designated-total mechanism), now also reachable from the CHAT
// (COPILOT_FORMS widened, one combined fixture regen). jsdom cannot prove
// real CSS-grid layout, real Recharts path geometry, or a real Server
// Action round trip against a real (harness) dataset — this file is that
// missing proof, mirroring chart-copilot.spec.ts's own phase-5/5b blocks
// with own-data's own data-roles and test ids (confirmed by reading
// web/components/user-chart.tsx directly, not assumed from CBS parity).
test.describe.serial('the own-data chart co-pilot — chart-fit + verified-whole parity (Task 5)', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  // Two moments (2020/2021), two gemeenten (Amsterdam/Rotterdam), every
  // Omzet cell real — exactly `dumbbellFormAllowed`/`slopeFormAllowed`/
  // `heatmapFormAllowed`'s qualifying shape, and Task 1's own recorded
  // values (100/50/150/70). Reuses the SAME `QUESTION` fixture the phase-1
  // test above already uploads with, so no new dataset is needed here.
  test('a two-moment, two-gemeente chart offers dumbbell/slope/heatmap; each renders its own real structure', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await expect(page.getByRole('button', { name: 'Bestand uploaden' })).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(CSV);
    const composer = page.getByPlaceholder('Stel een vraag over je data…');
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(QUESTION);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    const dumbbellTab = page.getByRole('tab', { name: 'Dumbbell' });
    const slopeTab = page.getByRole('tab', { name: 'Helling' });
    const heatmapTab = page.getByRole('tab', { name: 'Warmtekaart' });
    await expect(dumbbellTab).toBeEnabled();
    await expect(slopeTab).toBeEnabled();
    await expect(heatmapTab).toBeEnabled();

    // Dumbbell: one row per gemeente, two dots per row joined by a
    // connector, each end labelled with its own real cell value and
    // carrying that cell's own rowRef (Task 1/2's own recorded values:
    // Amsterdam 100 -> 150, Rotterdam 50 -> 70).
    await dumbbellTab.click();
    await expect(dumbbellTab).toHaveAttribute('aria-selected', 'true');
    const canvas = page.locator('[data-role="dumbbell-canvas"]');
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('[data-role="dumbbell-row"]')).toHaveCount(2);
    await expect(canvas.locator('[data-role="dumbbell-connector"]')).toHaveCount(2);
    await expect(canvas.locator('[data-role="dumbbell-dot"]')).toHaveCount(4);
    await expect(canvas.locator('[data-role="dumbbell-dot"][data-result-id="r1:c2"]')).toHaveCount(1);
    await expect(canvas.locator('[data-role="dumbbell-dot"][data-result-id="r3:c2"]')).toHaveCount(1);
    await expect(canvas.locator('[data-role="dumbbell-dot"][data-result-id="r2:c2"]')).toHaveCount(1);
    await expect(canvas.locator('[data-role="dumbbell-dot"][data-result-id="r4:c2"]')).toHaveCount(1);
    // Exact-text comparison, not `hasText` substring filtering — verkoop's
    // own 50/150 pair would otherwise let "50" match "150" too.
    const dumbbellLabelTexts = await canvas.locator('[data-role="dumbbell-label"]').allTextContents();
    expect(dumbbellLabelTexts.sort()).toEqual(['100', '150', '50', '70'].sort());
    await expect(page.locator('.recharts-line-curve')).toHaveCount(0);
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(0);

    // Slope: the line render at exactly two moments — two curves, each ONE
    // straight segment (`d` split on `L`), four value dots, an x-axis of
    // exactly the two period labels. Ported from chart-copilot.spec.ts's own
    // phase-5 block (its slope assertions apply unchanged, per Task 1's
    // handoff — only the surrounding locators are own-data's).
    await slopeTab.click();
    await expect(slopeTab).toHaveAttribute('aria-selected', 'true');
    await expect(canvas).toHaveCount(0);
    const curves = page.locator('.recharts-line-curve');
    await expect(curves).toHaveCount(2);
    const segmentsPerCurve = await curves.evaluateAll((paths) => paths.map((path) => (path.getAttribute('d') ?? '').split('L').length - 1));
    expect(segmentsPerCurve).toEqual([1, 1]);
    await expect(page.locator('circle[data-point="value"]')).toHaveCount(4);
    await expect(page.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveText(['2020', '2021']);

    // Heatmap: the table's own rows (period x gemeente) as a CSS grid with
    // ARIA table semantics, every cell the real formatted value bound to its
    // own rowRef, outside the recharts SVG render. `xHeader` is verkoop.csv's
    // own column header text verbatim ("Jaar" — never translated, it is user
    // data), confirmed by reading chart.ts's `xHeader: xColumn.header`.
    await heatmapTab.click();
    await expect(heatmapTab).toHaveAttribute('aria-selected', 'true');
    const grid = page.locator('[data-testid="user-heatmap-grid"]');
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader')).toHaveText(['Jaar', 'Amsterdam', 'Rotterdam']);
    await expect(grid.getByRole('rowheader')).toHaveText(['2020', '2021']);
    const cells = grid.getByRole('cell');
    await expect(cells).toHaveText(['100', '50', '150', '70']);
    await expect(page.locator('[data-label-for="r1:c2"]')).toHaveText('100');
    await expect(page.locator('[data-label-for="r2:c2"]')).toHaveText('50');
    await expect(page.locator('[data-label-for="r3:c2"]')).toHaveText('150');
    await expect(page.locator('[data-label-for="r4:c2"]')).toHaveText('70');
    // This card has no separate export-container id (unlike the CBS card's
    // `[data-testid="chart-container"]`) — the equivalent absence proof is
    // that no recharts SVG element is present while the grid is shown.
    await expect(page.locator('.recharts-line-curve')).toHaveCount(0);
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(0);

    // The real-layout proof (ported from chart-copilot.spec.ts lines
    // 528-559, Task 1's own explicit handoff — jsdom cannot see any of
    // this): cells of one period share a top edge with that period's row
    // header, cells of one gemeente share a left edge with each other and
    // with that column's header, Rotterdam's column starts where
    // Amsterdam's ends, and the grid/row `display` values are real.
    const box = async (locator: Locator) => {
      const b = await locator.boundingBox();
      expect(b, 'element has a box').not.toBeNull();
      return b!;
    };
    const near = (a: number, b: number) => Math.abs(a - b) <= 1;
    const rowHeaders = grid.getByRole('rowheader');
    const columnHeaders = grid.getByRole('columnheader');
    const [r2020, r2021] = [await box(rowHeaders.nth(0)), await box(rowHeaders.nth(1))];
    const [c0, c1, c2, c3] = [await box(cells.nth(0)), await box(cells.nth(1)), await box(cells.nth(2)), await box(cells.nth(3))];
    const [hAms, hRot] = [await box(columnHeaders.nth(1)), await box(columnHeaders.nth(2))];
    expect(near(c0.y, r2020.y) && near(c1.y, r2020.y), 'row 2020 aligned').toBe(true);
    expect(near(c2.y, r2021.y) && near(c3.y, r2021.y), 'row 2021 aligned').toBe(true);
    expect(r2021.y).toBeGreaterThanOrEqual(r2020.y + r2020.height - 1);
    expect(near(c0.x, c2.x) && near(c0.x, hAms.x), 'Amsterdam column aligned').toBe(true);
    expect(near(c1.x, c3.x) && near(c1.x, hRot.x), 'Rotterdam column aligned').toBe(true);
    expect(c1.x).toBeGreaterThanOrEqual(c0.x + c0.width - 1);
    const display = await grid.evaluate((el) => ({
      grid: getComputedStyle(el).display,
      row: getComputedStyle(el.querySelector('[role="row"]')!).display,
    }));
    expect(display).toEqual({ grid: 'grid', row: 'contents' });
  });

  // A ONE-moment, two-gemeente shape — `ownDataPieFormAllowed`'s own
  // qualifying shape (own-data offers pie/stacked/stacked100 on shape
  // alone, no roster) — reached straight from upload via a NEW instruct
  // fixture (`derived: {op:'difference', b:'c3'}` joined to `seriesBy:'c1'`
  // and a single-year filter): Amsterdam and Rotterdam's Omzet-minus-Kosten
  // for 2021 alone are BOTH 60 (verified by directly running
  // buildUserChartSpec against this exact instruction, not guessed) — a
  // genuine match once one is designated as the total.
  test('a one-moment, two-gemeente chart offers pie/stacked/stacked100 unconditionally, each rendering real content; designating a matching slice renders the checked note', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await expect(page.getByRole('button', { name: 'Bestand uploaden' })).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(CSV);
    const composer = page.getByPlaceholder('Stel een vraag over je data…');
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(DIFF_2021_QUESTION);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(2, { timeout: 60_000 });

    // No special "complete roster" property needed, unlike the CBS
    // equivalent — own-data's whole guards read shape (series count / point
    // count) alone.
    const pieTab = page.getByRole('tab', { name: 'Taartdiagram', exact: true });
    const stackedTab = page.getByRole('tab', { name: 'Gestapeld', exact: true });
    const stacked100Tab = page.getByRole('tab', { name: 'Gestapeld (%)', exact: true });
    await expect(pieTab).toBeEnabled();
    await expect(stackedTab).toBeEnabled();
    await expect(stacked100Tab).toBeEnabled();

    const note = page.locator('[data-testid="own-whole-note"]');
    const amsterdam = page.locator('path.recharts-sector[data-point="value"][data-result-id="der:difference:r3:c2|r3:c3"]');
    const rotterdam = page.locator('path.recharts-sector[data-point="value"][data-result-id="der:difference:r4:c2|r4:c3"]');

    // Pie: the default, un-designated note (no server call yet), two
    // slices, each bound to its own real derived cell, each labelled with
    // its own real formatted value — no invented number, no percentage.
    await pieTab.click();
    await expect(pieTab).toHaveAttribute('aria-selected', 'true');
    await expect(note).toHaveAttribute('data-state', 'not_checked');
    await expect(note).toHaveText('Niet gecontroleerd tegen een totaal — klik op een punt om te controleren of deze delen optellen.');
    const slices = page.locator('path.recharts-sector[data-point="value"]');
    await expect(slices).toHaveCount(2);
    await expect(amsterdam).toHaveCount(1);
    await expect(rotterdam).toHaveCount(1);
    const pieLabels = page.locator('[data-role="pie-label"]');
    expect(await pieLabels.allTextContents()).toEqual(['60', '60']);
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(0);

    // Stacked: one stack (one moment), two segments, Recharts' own native
    // stacking, each bound to its own real cell, real values, no invented
    // total.
    await stackedTab.click();
    await expect(stackedTab).toHaveAttribute('aria-selected', 'true');
    await expect(note).toHaveAttribute('data-state', 'not_checked');
    const segments = page.locator('rect[data-point="value"]');
    await expect(segments).toHaveCount(2);
    const stackLabels = page.locator('[data-role="stack-label"]');
    expect(await stackLabels.allTextContents()).toEqual(['60', '60']);
    await expect(page.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveText(['2021']);
    await expect(slices).toHaveCount(0);

    // 100%-stacked: the same two segments, each an equal half of the
    // (equal) whole — pure arithmetic over the two real values on screen.
    await stacked100Tab.click();
    await expect(stacked100Tab).toHaveAttribute('aria-selected', 'true');
    await expect(segments).toHaveCount(2);
    expect(await stackLabels.allTextContents()).toEqual(['50,0%', '50,0%']);

    // Designate Amsterdam's slice as the total: the sole OTHER visible part
    // (Rotterdam, the same value) matches it exactly — a REAL server round
    // trip (requestDatasetWholeVerification), never mocked, against the
    // real (harness) dataset.
    await pieTab.click();
    await amsterdam.click();
    await expect(note).toHaveAttribute('data-state', 'checked', { timeout: 15_000 });
    // Session 129: a split derived chart now names each slice by its own
    // split value (buildUserChartSpec), so the note says WHICH slice is the
    // total. (Before, both slices were labelled "Omzet − Kosten" and only the
    // mark on the chart — still asserted below — told them apart.)
    await expect(note).toHaveText('Gecontroleerd tegen de rij die je koos: Amsterdam.');
    await expect(amsterdam).toHaveAttribute('aria-pressed', 'true');
    await expect(amsterdam).toHaveAttribute('data-whole-reference', 'true');
    await expect(rotterdam).toHaveAttribute('aria-pressed', 'false');
    await expect(rotterdam).not.toHaveAttribute('data-whole-reference');
    await expect(page.locator('[data-whole-reference="true"]')).toHaveCount(1);
    // A match still renders the chart in full.
    await expect(slices).toHaveCount(2);
    expect(await pieLabels.allTextContents()).toEqual(['60', '60']);

    // Clicking the SAME slice again clears the designation instantly, back
    // to Task 3's exact default note — no fabricated verdict lingers.
    await amsterdam.click();
    await expect(note).toHaveAttribute('data-state', 'not_checked');
    await expect(amsterdam).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-whole-reference="true"]')).toHaveCount(0);
  });

  // The mismatch twin of the test above: the SAME one-moment shape, one
  // year earlier (2020), where the two gemeenten's Omzet-minus-Kosten
  // genuinely differ (40 vs 30) — designating either one against the
  // other's real value cannot match.
  test('designating a slice whose only other visible part does not match it renders the mismatch note, and the chart still renders in full', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await expect(page.getByRole('button', { name: 'Bestand uploaden' })).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(CSV);
    const composer = page.getByPlaceholder('Stel een vraag over je data…');
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(DIFF_2020_QUESTION);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(2, { timeout: 60_000 });

    const pieTab = page.getByRole('tab', { name: 'Taartdiagram', exact: true });
    await expect(pieTab).toBeEnabled();
    await pieTab.click();
    const note = page.locator('[data-testid="own-whole-note"]');
    await expect(note).toHaveAttribute('data-state', 'not_checked');

    const slices = page.locator('path.recharts-sector[data-point="value"]');
    const pieLabels = page.locator('[data-role="pie-label"]');
    await expect(slices).toHaveCount(2);
    expect(await pieLabels.allTextContents()).toEqual(['40', '30']);

    const amsterdam = page.locator('path.recharts-sector[data-point="value"][data-result-id="der:difference:r1:c2|r1:c3"]');
    await amsterdam.click();
    await expect(note).toHaveAttribute('data-state', 'mismatch', { timeout: 15_000 });
    await expect(note).toHaveText('Deze delen tellen niet op tot Amsterdam — controleer je selectie.');
    // A mismatch still renders the chart in full — never hidden, never
    // refused.
    await expect(slices).toHaveCount(2);
    expect(await pieLabels.allTextContents()).toEqual(['40', '30']);
  });

  // Keyboard focus through a designation (session 124, Task 4 minor M2).
  // Recharts replaces every drawn slice/segment element on each re-render
  // (its items are keyed on a per-render animation id), so without the
  // card's focus restore, Enter on a slice dropped focus to <body> — found
  // by exactly this probe in a real browser before the fix.
  test('keyboard: Enter designates a pie slice / stack segment and focus stays on it through the verdict; Enter again clears it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await expect(page.getByRole('button', { name: 'Bestand uploaden' })).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(CSV);
    const composer = page.getByPlaceholder('Stel een vraag over je data…');
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(DIFF_2020_QUESTION);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(2, { timeout: 60_000 });
    const note = page.locator('[data-testid="own-whole-note"]');
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return { rowRef: el?.getAttribute('data-result-id') ?? null, pressed: el?.getAttribute('aria-pressed') ?? null };
      });
    const AMSTERDAM = 'der:difference:r1:c2|r1:c3';

    await page.getByRole('tab', { name: 'Taartdiagram', exact: true }).click();
    await page.locator(`path.recharts-sector[data-point="value"][data-result-id="${AMSTERDAM}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(note).toHaveAttribute('data-state', 'mismatch', { timeout: 15_000 });
    expect(await focused()).toEqual({ rowRef: AMSTERDAM, pressed: 'true' });
    await page.keyboard.press('Enter');
    await expect(note).toHaveAttribute('data-state', 'not_checked');
    expect(await focused()).toEqual({ rowRef: AMSTERDAM, pressed: 'false' });

    await page.getByRole('tab', { name: 'Gestapeld', exact: true }).click();
    await page.locator(`rect[data-point="value"][data-result-id="${AMSTERDAM}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(note).toHaveAttribute('data-state', 'mismatch', { timeout: 15_000 });
    expect(await focused()).toEqual({ rowRef: AMSTERDAM, pressed: 'true' });
  });

  const HEATMAP_MESSAGE = 'maak er een warmtekaart van';

  test(`"${HEATMAP_MESSAGE}" through the chat draws the same heatmap the tab does, and Undo walks it back`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await expect(page.getByRole('button', { name: 'Bestand uploaden' })).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(CSV);
    const composer = page.getByPlaceholder('Stel een vraag over je data…');
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(QUESTION);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // First the tab, directly: record what it draws.
    const heatmapTab = page.getByRole('tab', { name: 'Warmtekaart' });
    const lineTab = page.getByRole('tab', { name: 'Lijn' });
    const grid = page.locator('[data-testid="user-heatmap-grid"]');
    await heatmapTab.click();
    await expect(grid).toBeVisible();
    const cellsByTab = await grid.getByRole('cell').allTextContents();
    expect(cellsByTab).toEqual(['100', '50', '150', '70']);
    await lineTab.click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(grid).toHaveCount(0);

    // Then the chat: one `setForm` chip, the heatmap tab selected, the
    // identical grid — same cells, same order.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(HEATMAP_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByRole('button', { name: 'Weergave: Warmtekaart' })).toBeVisible({ timeout: 60_000 });
    await expect(heatmapTab).toHaveAttribute('aria-selected', 'true');
    await expect(grid).toBeVisible();
    expect(await grid.getByRole('cell').allTextContents()).toEqual(cellsByTab);

    // A chat edit is an edit like any other: the card's own Undo restores
    // Lijn. `exact`: the reply strip's own undo would otherwise also match.
    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect(lineTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(grid).toHaveCount(0);
  });
});
